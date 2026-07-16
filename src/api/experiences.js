// GET /api/experiences?dest=357&count=12
// Server-side Viator proxy (affiliate). Key stays in env VIATOR_KEY. Returns curated, high-converting experiences.
const KEY = process.env.VIATOR_KEY || '';
const BASE = 'https://api.viator.com/partner';

function durationText(d) {
  if (!d) return null;
  const fmt = (m) => {
    if (m == null) return null;
    if (m >= 1440) { const days = Math.round(m / 1440); return days + (days > 1 ? ' days' : ' day'); }
    if (m >= 60) { const h = Math.floor(m / 60), mm = m % 60; return mm ? `${h}h ${mm}m` : `${h} hour${h > 1 ? 's' : ''}`; }
    return `${m} min`;
  };
  if (d.fixedDurationInMinutes != null) return fmt(d.fixedDurationInMinutes);
  if (d.variableDurationFromMinutes != null && d.variableDurationToMinutes != null)
    return `${fmt(d.variableDurationFromMinutes)}–${fmt(d.variableDurationToMinutes)}`;
  if (d.unstructuredDuration) return d.unstructuredDuration;
  return null;
}

function pickImage(images) {
  if (!Array.isArray(images) || !images.length) return null;
  const cover = images.find(i => i.isCover) || images[0];
  const vs = (cover.variants || []).slice().sort((a, b) => (a.width || 0) - (b.width || 0));
  // prefer ~480-720 wide for cards
  const good = vs.find(v => v.width >= 400) || vs[vs.length - 1];
  return good ? good.url : null;
}

const H = () => ({ 'exp-api-key': KEY, 'Accept': 'application/json;version=2.0', 'Accept-Language': 'en-AU', 'Content-Type': 'application/json' });

function galleryImages(images, n) {
  const out = [];
  (images || []).forEach(im => {
    const vs = (im.variants || []).slice().sort((a, b) => (a.width || 0) - (b.width || 0));
    const good = vs.filter(v => v.width <= 800).pop() || vs[vs.length - 1];
    if (good && good.url) out.push(good.url);
  });
  return out.slice(0, n);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=1800, stale-while-revalidate=86400');
  const { dest, count = '12', code } = req.query || {};
  if (!KEY) return res.status(200).json({ experiences: [], product: null, source: 'no_key' });

  // ---- Single product detail (for the on-site experience page) ----
  if (code) {
    try {
      const r = await fetch(`${BASE}/products/${encodeURIComponent(code)}`, { headers: H() });
      const p = await r.json();
      if (!p || !p.title) return res.status(200).json({ product: null, source: 'empty' });
      const rv = p.reviews || {};
      const cp = p.cancellationPolicy || {};
      const product = {
        code: p.productCode,
        title: p.title,
        description: (p.description || '').trim(),
        images: galleryImages(p.images, 12),
        rating: rv.combinedAverageRating ? Math.round(rv.combinedAverageRating * 10) / 10 : null,
        reviews: rv.totalReviews || 0,
        duration: durationText((p.itinerary && p.itinerary.duration) || p.duration),
        inclusions: (p.inclusions || []).map(i => i.otherDescription || i.typeDescription || i.categoryDescription).filter(Boolean).slice(0, 10),
        cancellation: cp.description || null,
        freeCancel: cp.type && cp.type !== 'ALL_SALES_FINAL',
        privateTour: !!(p.itinerary && p.itinerary.privateTour),
        skipLine: !!(p.itinerary && p.itinerary.skipTheLine),
        meeting: (p.logistics && p.logistics.start && p.logistics.start[0] && p.logistics.start[0].description) || null,
        url: p.productUrl
      };
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
      return res.status(200).json({ product, source: 'live' });
    } catch (e) {
      return res.status(200).json({ product: null, source: 'error', error: String(e) });
    }
  }

  if (!dest) return res.status(400).json({ error: 'dest required' });

  const want = Math.max(1, Math.min(24, parseInt(count, 10) || 12));

  const body = {
    filtering: { destination: parseInt(dest, 10) },
    sorting: { sort: 'DEFAULT' },          // Viator's own popularity/relevance ranking = best conversion
    pagination: { start: 1, count: 40 },   // over-fetch, then apply a social-proof floor
    currency: 'AUD'
  };

  let json = null, status = 0;
  try {
    const r = await fetch(`${BASE}/products/search`, {
      method: 'POST',
      headers: {
        'exp-api-key': KEY,
        'Accept': 'application/json;version=2.0',
        'Accept-Language': 'en-AU',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    status = r.status;
    json = await r.json();
  } catch (e) {
    return res.status(200).json({ experiences: [], source: 'error', error: String(e) });
  }

  const products = (json && json.products) || [];
  const mapped = products.map(p => {
    const rv = p.reviews || {};
    return {
      code: p.productCode,
      title: p.title,
      img: pickImage(p.images),
      rating: rv.combinedAverageRating ? Math.round(rv.combinedAverageRating * 10) / 10 : null,
      reviews: rv.totalReviews || 0,
      duration: durationText(p.duration),
      fromPrice: p.pricing && p.pricing.summary ? Math.round(p.pricing.summary.fromPrice) : null,
      currency: (p.pricing && p.pricing.currency) || 'AUD',
      freeCancel: Array.isArray(p.flags) && p.flags.includes('FREE_CANCELLATION'),
      sellsOut: Array.isArray(p.flags) && p.flags.includes('LIKELY_TO_SELL_OUT'),
      instant: p.confirmationType === 'INSTANT',
      url: p.productUrl
    };
  })
  // conversion filter: strong social proof + a bookable price + image; keep Viator's popularity order
  .filter(x => x.img && x.fromPrice != null && x.reviews >= 50 && (x.rating == null || x.rating >= 4))
  .slice(0, want);

  res.status(200).json({ experiences: mapped, total: json && json.totalCount, source: mapped.length ? 'live' : 'empty', status });
};
