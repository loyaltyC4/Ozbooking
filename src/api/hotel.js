// GET /api/hotel?hotelId=&checkin=&checkout=&guests=2
// Rich hotel details + rooms. Members (valid session) are priced at the lower member margin (CUG), gated server-side.
const { DATA, call, hasKey, verifyUser, PUBLIC_MARGIN, MEMBER_MARGIN } = require('./_liteapi');

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Vary', 'Authorization');

  const { hotelId, checkin, checkout, guests = '2', currency = 'AUD', nat = 'AU' } = req.query || {};
  if (!hotelId) return res.status(400).json({ error: 'hotelId required' });
  if (!hasKey) return res.status(200).json({ hotel: null, rooms: [], member: false, source: 'no_key' });

  const user = await verifyUser(req);
  const member = !!user;
  const margin = member ? MEMBER_MARGIN : PUBLIC_MARGIN;
  const pubF = 1 + PUBLIC_MARGIN / 100, memF = 1 + MEMBER_MARGIN / 100;

  // ---- Metadata + gallery + room catalog (static content) ----
  const meta = await call(DATA, `/data/hotel?hotelId=${encodeURIComponent(hotelId)}`);
  const d = (meta.json && meta.json.data) || {};

  const images = Array.isArray(d.hotelImages)
    ? d.hotelImages.map(i => i.urlHd || i.url).filter(Boolean).slice(0, 24)
    : [];

  // Build a lookup of catalog rooms by normalized name for enrichment
  const catalog = Array.isArray(d.rooms) ? d.rooms : [];
  const catByName = {};
  catalog.forEach(r => { if (r.roomName) catByName[norm(r.roomName)] = r; });
  const matchCatalog = (name) => {
    const n = norm(name);
    if (!n) return null;
    if (catByName[n]) return catByName[n];
    // substring either way, else best token overlap
    let best = null, bestScore = 0;
    for (const r of catalog) {
      const cn = norm(r.roomName);
      if (!cn) continue;
      if (n.includes(cn) || cn.includes(n)) return r;
      const at = new Set(n.match(/[a-z]+/g) || []), bt = (cn.match(/[a-z]+/g) || []);
      const overlap = bt.filter(t => at.has(t)).length;
      if (overlap > bestScore) { bestScore = overlap; best = r; }
    }
    return bestScore >= 2 ? best : null;
  };
  const roomExtra = (name) => {
    const r = matchCatalog(name);
    if (!r) return {};
    const photo = Array.isArray(r.photos) && r.photos.length ? (r.photos[0].hd_url || r.photos[0].url) : null;
    const photos = Array.isArray(r.photos) ? r.photos.map(p => p.hd_url || p.url).filter(Boolean).slice(0, 6) : [];
    const bed = Array.isArray(r.bedTypes) && r.bedTypes.length
      ? r.bedTypes.map(b => `${b.quantity > 1 ? b.quantity + ' × ' : ''}${b.bedType}`).join(', ')
      : null;
    const amenities = Array.isArray(r.roomAmenities)
      ? r.roomAmenities.map(a => a.name).filter(Boolean).slice(0, 8) : [];
    return {
      photo, photos,
      size: r.roomSizeSquare || null, sizeUnit: r.roomSizeUnit || 'sqm',
      bed, maxOccupancy: r.maxOccupancy || null,
      roomDesc: (r.description || '').replace(/\s+/g, ' ').trim().slice(0, 200) || null,
      amenities
    };
  };

  // ---- Live rooms / rates ----
  let rooms = [];
  if (checkin && checkout) {
    const body = {
      checkin, checkout, currency, guestNationality: nat,
      hotelIds: [hotelId],
      occupancies: [{ adults: Math.max(1, parseInt(guests, 10) || 2) }],
      timeout: 10, margin
    };
    const r = await call(DATA, '/hotels/rates', { method: 'POST', body });
    const roomTypes = (r.json && r.json.data && r.json.data[0] && r.json.data[0].roomTypes) || [];
    const parsed = roomTypes.map(o => {
      const rate = (o.rates && o.rates[0]) || {};
      const rr = rate.retailRate || {};
      const price = (o.offerRetailRate && o.offerRetailRate.amount) != null
        ? o.offerRetailRate.amount
        : (rr.total && rr.total[0] && rr.total[0].amount);
      const suggested = (o.suggestedSellingPrice && o.suggestedSellingPrice.amount) != null
        ? o.suggestedSellingPrice.amount
        : (rr.suggestedSellingPrice && rr.suggestedSellingPrice[0] && rr.suggestedSellingPrice[0].amount);
      const suggestedSource = (o.suggestedSellingPrice && o.suggestedSellingPrice.source)
        || (rr.suggestedSellingPrice && rr.suggestedSellingPrice[0] && rr.suggestedSellingPrice[0].source) || null;
      const tax = (rr.taxesAndFees && rr.taxesAndFees[0]) || null;
      const cp = rate.cancellationPolicies || {};
      const cancelInfo = (cp.cancelPolicyInfos && cp.cancelPolicyInfos[0]) || null;
      const refundable = cp.refundableTag === 'RFN';
      return {
        offerId: o.offerId || null,
        roomName: rate.name || 'Room',
        board: rate.boardName || 'Room only',
        refundable,
        cancelDeadline: refundable && cancelInfo ? (cancelInfo.cancelTime || null) : null,
        taxesIncluded: tax ? !!tax.included : null,
        taxAmount: tax && tax.amount != null ? Math.round(tax.amount) : null,
        maxOccupancy: rate.maxOccupancy || null,
        suggested: suggested != null ? suggested : null,
        suggestedSource,
        currency: (o.offerRetailRate && o.offerRetailRate.currency) || 'AUD',
        _price: price != null ? price : null
      };
    }).filter(x => x._price != null);

    // Dedupe by room name (keep cheapest), sort ascending, cap 8, enrich, price
    const seen = {};
    for (const x of parsed) {
      const k = norm(x.roomName) || x.roomName;
      if (!seen[k] || x._price < seen[k]._price) seen[k] = x;
    }
    rooms = Object.values(seen).sort((a, b) => a._price - b._price).slice(0, 8).map(x => {
      const price = x._price; delete x._price;
      Object.assign(x, roomExtra(x.roomName));
      if (member) { const net = price / memF; x.memberPrice = Math.round(price); x.retail = Math.round(net * pubF); }
      else { x.retail = Math.round(price); }
      return x;
    });
  }

  // ---- Assemble rich hotel object ----
  const s = d.sentiment_analysis || {};
  const times = d.checkinCheckoutTimes || {};
  const hotel = d.name ? {
    hotelId,
    name: d.name,
    address: d.address || (d.city || ''),
    city: d.city || '',
    country: d.country || '',
    stars: d.starRating || 0,
    rating: d.rating || null,
    reviewCount: d.reviewCount || null,
    facilities: (Array.isArray(d.hotelFacilities) ? d.hotelFacilities : (Array.isArray(d.facilities) ? d.facilities : []))
      .map(f => (f && (f.name || f.facilityName)) || (typeof f === 'string' ? f : '')).filter(Boolean).slice(0, 24),
    description: (d.hotelDescription || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 900),
    images,
    mainPhoto: d.main_photo || images[0] || null,
    lat: (d.location && d.location.latitude) || null,
    lng: (d.location && d.location.longitude) || null,
    checkin: times.checkin_start || null,
    checkout: times.checkout || null,
    importantInfo: (d.hotelImportantInformation || '').replace(/\s+/g, ' ').trim().slice(0, 600) || null,
    childAllowed: d.childAllowed, petsAllowed: d.petsAllowed,
    sentiment: (s.categories || s.pros || s.cons) ? {
      pros: Array.isArray(s.pros) ? s.pros.slice(0, 5) : [],
      cons: Array.isArray(s.cons) ? s.cons.slice(0, 5) : [],
      categories: Array.isArray(s.categories) ? s.categories.map(c => ({
        name: c.name, rating: c.rating, description: c.description
      })).slice(0, 8) : []
    } : null
  } : null;

  res.status(200).json({ hotel, rooms, member, source: hotel ? 'live' : 'empty' });
};
