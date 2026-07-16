// POST /api/prebook { offerId, member? }  -> { ok, data:{ prebookId, ... } }
// Booking a member/CUG-flagged offer requires a valid Supabase session.
const { BOOK, call, readBody, hasKey, verifyUser } = require('./_liteapi');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  if (!hasKey) return res.status(200).json({ ok: false, error: 'no_key' });
  const { offerId, member } = readBody(req);
  if (!offerId) return res.status(400).json({ ok: false, error: 'offerId required' });

  if (member) {
    const user = await verifyUser(req);
    if (!user) return res.status(401).json({ ok: false, error: 'Members-only rate requires sign in' });
  }

  // usePaymentSdk:true -> LiteAPI returns secretKey + transactionId so the GUEST pays LiteAPI directly (no fronting).
  const r = await call(BOOK, '/rates/prebook', { method: 'POST', body: { usePaymentSdk: true, offerId } });
  if (!r.ok || !r.json || !r.json.data) {
    return res.status(200).json({ ok: false, status: r.status, error: (r.json && r.json.error) || 'prebook failed' });
  }
  res.status(200).json({ ok: true, data: r.json.data });
};
