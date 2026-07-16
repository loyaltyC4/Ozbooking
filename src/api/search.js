// GET /api/search?city=Sydney&checkin=&checkout=&guests=2
// Public gets the public-margin price. Members (valid Supabase session) get the lower member-margin price (CUG), gated server-side.
const { DATA, call, hasKey, verifyUser, PUBLIC_MARGIN, MEMBER_MARGIN } = require('./_liteapi');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Vary', 'Authorization');
  res.setHeader('Access-Control-Allow-Origin', '*'); // public guest rate data; allows the StaysAfrica frontend to read ZAR rates cross-origin

  const { city = 'Sydney', checkin, checkout, guests = '2', countryCode = 'AU', currency = 'AUD', nat = 'AU' } = req.query || {};
  if (!hasKey) return res.status(200).json({ hotels: [], member: false, source: 'no_key' });
  if (!checkin || !checkout) return res.status(400).json({ error: 'checkin and checkout required' });

  // CUG gate: authenticated members are priced at the lower margin.
  const user = await verifyUser(req);
  const member = !!user;
  const margin = member ? MEMBER_MARGIN : PUBLIC_MARGIN;
  const pubF = 1 + PUBLIC_MARGIN / 100, memF = 1 + MEMBER_MARGIN / 100;

  const body = {
    checkin, checkout, currency, guestNationality: nat,
    countryCode, cityName: city,
    occupancies: [{ adults: Math.max(1, parseInt(guests, 10) || 2) }],
    includeHotelData: true, maxRatesPerHotel: 1, limit: 30, timeout: 8, margin
  };

  const { ok, status, json } = await call(DATA, '/hotels/rates', { method: 'POST', body });
  if (!ok || !json || !Array.isArray(json.data)) {
    return res.status(200).json({ hotels: [], member, source: 'empty', status });
  }

  const meta = {};
  (json.hotels || []).forEach(h => { meta[h.id] = h; });

  const hotels = json.data.map(d => {
    const m = meta[d.hotelId] || {};
    const roomTypes = d.roomTypes || [];
    let cheapest = null;
    for (const rt of roomTypes) {
      const amt = rt.offerRetailRate && rt.offerRetailRate.amount;
      if (amt != null && (!cheapest || amt < cheapest.offerRetailRate.amount)) cheapest = rt;
    }
    if (!cheapest) cheapest = roomTypes[0] || null;
    const price = cheapest && cheapest.offerRetailRate ? cheapest.offerRetailRate.amount : null; // net * (1 + margin)
    const suggested = cheapest && cheapest.suggestedSellingPrice ? cheapest.suggestedSellingPrice.amount : null;
    const cr = (cheapest && cheapest.rates && cheapest.rates[0]) || {};        // cheapest rate detail
    const cp = cr.cancellationPolicies || {};
    const mainP = m.main_photo || m.thumbnail || null;
    const h = {
      hotelId: d.hotelId,
      offerId: cheapest ? cheapest.offerId : null,
      hotelName: m.name || null,
      address: m.address || '',
      stars: m.stars || 0,
      rating: m.rating || null,
      reviewCount: m.review_count || null,
      mainPhoto: mainP,
      photo2: (m.thumbnail && m.thumbnail !== mainP) ? m.thumbnail : null, // 2nd image for hover
      refundable: cp.refundableTag === 'RFN',
      board: cr.boardName || null,
      suggested,
      currency: (cheapest && cheapest.offerRetailRate && cheapest.offerRetailRate.currency) || 'AUD'
    };
    if (price != null) {
      if (member) { const net = price / memF; h.memberPrice = Math.round(price); h.retail = Math.round(net * pubF); }
      else { h.retail = Math.round(price); }
    }
    return h;
  }).filter(h => h.retail != null && h.hotelName);

  res.status(200).json({ hotels, member, source: 'live' });
};
