// POST /api/book { prebookId, holder:{firstName,lastName,email,phone}, guests?:[], member? } -> { ok, data:{ bookingId, ... } }
// Booking a member/CUG-flagged rate requires a valid Supabase session.
const { BOOK, call, readBody, hasKey, verifyUser } = require('./_liteapi');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  if (!hasKey) return res.status(200).json({ ok: false, error: 'no_key' });
  const { prebookId, holder, guests, member, transactionId } = readBody(req);
  if (!prebookId || !holder || !holder.firstName || !holder.email) {
    return res.status(400).json({ ok: false, error: 'prebookId and holder (firstName,lastName,email) required' });
  }

  if (member) {
    const user = await verifyUser(req);
    if (!user) return res.status(401).json({ ok: false, error: 'Members-only rate requires sign in' });
  }

  // Guest paid LiteAPI via the Payment SDK -> finalize with TRANSACTION_ID (no charge to our card).
  const payment = transactionId ? { method: 'TRANSACTION_ID', transactionId } : { method: 'ACC_CREDIT_CARD' };

  const body = {
    prebookId,
    holder: {
      firstName: holder.firstName,
      lastName: holder.lastName || '',
      email: holder.email,
      phone: holder.phone || '0000000000'
    },
    guests: (Array.isArray(guests) && guests.length) ? guests : [{
      occupancyNumber: 1, firstName: holder.firstName, lastName: holder.lastName || '', email: holder.email
    }],
    payment
  };

  const r = await call(BOOK, '/rates/book', { method: 'POST', body });
  if (!r.ok || !r.json || !r.json.data) {
    return res.status(200).json({ ok: false, status: r.status, error: (r.json && r.json.error) || 'book failed' });
  }
  res.status(200).json({ ok: true, data: r.json.data });
};
