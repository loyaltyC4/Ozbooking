// SSR indexable hotel page — served at /hotel/:id via a rewrite to /api/hotel-page?hotelId=:id
// Renders full HTML (Hotel + BreadcrumbList JSON-LD, title/meta/canonical) for crawlers + AI,
// then funnels booking into the existing interactive hotel.html flow (payment untouched).
const { DATA, call, hasKey, PUBLIC_MARGIN } = require('./_liteapi');

const BASE = 'https://ozbookings.com';
const CITY_SLUGS = { sydney:'sydney', melbourne:'melbourne', goldcoast:'gold-coast', cairns:'cairns', brisbane:'brisbane', perth:'perth', adelaide:'adelaide', hobart:'hobart' };
const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const escA = s => esc(s).replace(/"/g,'&quot;');
const money = n => 'A$' + Math.round(n).toLocaleString();
const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function fmt(d){ return d.toISOString().slice(0,10); }
function defaultDates(){ const t=new Date(); const ci=new Date(t.getTime()+14*864e5); const co=new Date(t.getTime()+17*864e5); return { ci:fmt(ci), co:fmt(co), nights:3 }; }

function shell(status, res, title, bodyHtml, opts){
  opts = opts || {};
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', opts.cache || 'public, s-maxage=600, stale-while-revalidate=3600');
  const robots = opts.noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large';
  res.end(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<base href="/">
<title>${esc(title)}</title>
${opts.head || ''}
<meta name="robots" content="${robots}">
<link rel="stylesheet" href="styles.css?v=20260703b">
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<link rel="icon" href="/favicon.svg">
<meta name="theme-color" content="#14171A">
${opts.style || ''}
</head>
<body>
<div id="nav-mount"></div>
${bodyHtml}
<div id="footer-mount"></div>
<script src="shared.js?v=20260703b"></script>
<script>
  document.getElementById('nav-mount').innerHTML = BA.renderNav('search');
  document.getElementById('footer-mount').innerHTML = BA.renderFooter();
  BA.init();
</script>
</body>
</html>`);
}

module.exports = async (req, res) => {
  const hotelId = (req.query && (req.query.hotelId || req.query.id)) || '';
  const notFound = (msg) => shell(404, res,
    'Hotel not found — OzBookings',
    `<main class="wrap" style="padding:80px 0;text-align:center"><h1 style="font-size:32px">Hotel not found</h1><p style="color:#697079;margin:12px 0 24px">${esc(msg||'We couldn’t load this hotel. It may no longer be available.')}</p><a class="btn btn-coral" href="search.html?city=Sydney"><span>Search hotels</span><span class="btn-i"><i class="ph-bold ph-magnifying-glass"></i></span></a></main>`,
    { noindex:true, cache:'public, s-maxage=60' });

  try {
    if (!hotelId) return notFound('No hotel was specified.');
    if (!hasKey) return notFound('Live data is temporarily unavailable.');

    const { ci, co, nights } = defaultDates();
    const pubF = 1 + PUBLIC_MARGIN / 100;

    // metadata + rooms in parallel
    const [meta, rates] = await Promise.all([
      call(DATA, `/data/hotel?hotelId=${encodeURIComponent(hotelId)}`),
      call(DATA, '/hotels/rates', { method:'POST', body:{ checkin:ci, checkout:co, currency:'AUD', guestNationality:'AU', hotelIds:[hotelId], occupancies:[{adults:2}], timeout:10, margin:PUBLIC_MARGIN } })
    ]);
    const d = (meta.json && meta.json.data) || {};
    if (!d.name) return notFound('This hotel is no longer listed.');

    const images = Array.isArray(d.hotelImages) ? d.hotelImages.map(i=>i.urlHd||i.url).filter(Boolean).slice(0,8) : [];
    const mainPhoto = d.main_photo || images[0] || '';
    const city = d.city || '';
    const country = d.country || 'Australia';
    const stars = d.starRating || 0;
    const rating = d.rating || null;
    const reviewCount = d.reviewCount || null;
    const address = d.address || city;
    const lat = (d.location && d.location.latitude) || null;
    const lng = (d.location && d.location.longitude) || null;
    const description = (d.hotelDescription || '').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
    const facilities = (Array.isArray(d.hotelFacilities) ? d.hotelFacilities : (Array.isArray(d.facilities) ? d.facilities : []))
      .map(f => (f && (f.name || f.facilityName)) || (typeof f === 'string' ? f : '')).filter(Boolean).slice(0,18);

    // rooms
    const roomTypes = (rates.json && rates.json.data && rates.json.data[0] && rates.json.data[0].roomTypes) || [];
    const parsed = roomTypes.map(o => {
      const rate = (o.rates && o.rates[0]) || {};
      const price = (o.offerRetailRate && o.offerRetailRate.amount) != null ? o.offerRetailRate.amount : null;
      const suggested = (o.suggestedSellingPrice && o.suggestedSellingPrice.amount) != null ? o.suggestedSellingPrice.amount : null;
      const cp = rate.cancellationPolicies || {};
      return { name: rate.name || 'Room', board: rate.boardName || 'Room only', refundable: cp.refundableTag === 'RFN',
        retail: price != null ? Math.round(price) : null, suggested: suggested != null ? Math.round(suggested) : null };
    }).filter(x => x.retail != null);
    const seen = {}; parsed.forEach(x => { const k = norm(x.name) || x.name; if (!seen[k] || x.retail < seen[k].retail) seen[k] = x; });
    const rooms = Object.values(seen).sort((a,b)=>a.retail-b.retail).slice(0,8);

    const prices = rooms.map(r=>r.retail).filter(Boolean);
    const low = prices.length ? Math.min(...prices) : null;
    const high = prices.length ? Math.max(...prices) : null;
    const bookHref = `hotel.html?hotelId=${encodeURIComponent(hotelId)}&ci=${ci}&co=${co}&gu=2`;
    const canon = `${BASE}/hotel/${encodeURIComponent(hotelId)}`;

    const citySlug = CITY_SLUGS[norm(city)] || null;
    const cityCrumbUrl = citySlug ? `${BASE}/hotels-in-${citySlug}` : `${BASE}/`;
    const cityCrumbName = citySlug ? `Hotels in ${city}` : 'Australia';

    const title = `${d.name}${city?', '+city:''} — Rates, Reviews & Direct Booking | OzBookings`;
    const metaDesc = `${d.name} in ${city||'Australia'}. Book direct and see the room's direct rate next to the typical selling price${rating?` — rated ${rating}/10`:''}. Free cancellation on most stays, no hidden booking fees.`;

    // ---- JSON-LD ----
    const hotelLd = { '@type':'Hotel', '@id':canon+'#hotel', name:d.name, url:canon,
      address:{ '@type':'PostalAddress', streetAddress:address, addressLocality:city, addressCountry:country||'AU' } };
    if (mainPhoto) hotelLd.image = images.length ? images.slice(0,6) : [mainPhoto];
    if (description) hotelLd.description = description.slice(0,300);
    if (stars) hotelLd.starRating = { '@type':'Rating', ratingValue:stars, bestRating:5 };
    if (rating) hotelLd.aggregateRating = { '@type':'AggregateRating', ratingValue:rating, bestRating:10, ratingCount: reviewCount || undefined };
    if (lat && lng) hotelLd.geo = { '@type':'GeoCoordinates', latitude:lat, longitude:lng };
    if (facilities.length) hotelLd.amenityFeature = facilities.slice(0,12).map(f=>({ '@type':'LocationFeatureSpecification', name:f, value:true }));
    if (low) hotelLd.priceRange = high && high!==low ? `${money(low)}–${money(high)} / night` : `${money(low)} / night`;
    if (low) hotelLd.makesOffer = { '@type':'Offer', priceCurrency:'AUD', price:low, availability:'https://schema.org/InStock', url:canon, priceSpecification:{ '@type':'PriceSpecification', price:low, priceCurrency:'AUD', description:`from ${money(low)} for ${nights} nights` } };
    const jsonld = JSON.stringify({ '@context':'https://schema.org', '@graph':[
      hotelLd,
      { '@type':'BreadcrumbList', itemListElement:[
        { '@type':'ListItem', position:1, name:'Home', item:BASE+'/' },
        { '@type':'ListItem', position:2, name:cityCrumbName, item:cityCrumbUrl },
        { '@type':'ListItem', position:3, name:d.name, item:canon }
      ]}
    ]});

    const head = `<meta name="description" content="${escA(metaDesc)}">
<link rel="canonical" href="${canon}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="OzBookings">
<meta property="og:url" content="${canon}">
<meta property="og:title" content="${escA(d.name+(city?', '+city:'')+' — OzBookings')}">
<meta property="og:description" content="${escA(metaDesc)}">
${mainPhoto?`<meta property="og:image" content="${escA(mainPhoto)}">`:''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escA(d.name+' — OzBookings')}">
<meta name="twitter:description" content="${escA(metaDesc)}">
${mainPhoto?`<meta name="twitter:image" content="${escA(mainPhoto)}">`:''}
<script type="application/ld+json">${jsonld}</script>`;

    const style = `<style>
  .hh{position:relative;min-height:52vh;display:flex;align-items:flex-end;color:#fff;padding:0 0 40px}
  .hh .bg{position:absolute;inset:0;overflow:hidden}.hh .bg img{width:100%;height:100%;object-fit:cover}
  .hh .bg::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(10,13,18,.15),rgba(10,13,18,.85))}
  .hh .in{position:relative;z-index:2}
  .crumb{font-size:13px;color:rgba(255,255,255,.82);margin-bottom:12px}.crumb a{color:rgba(255,255,255,.82);text-decoration:none}
  .hh h1{font-family:var(--display,'Space Grotesk',sans-serif);font-weight:700;font-size:clamp(28px,5vw,52px);line-height:1.03;letter-spacing:-.02em;margin:0 0 10px}
  .hmeta{display:flex;gap:14px;flex-wrap:wrap;align-items:center;color:rgba(255,255,255,.92);font-size:14.5px;margin-bottom:20px}
  .hmeta .rate{background:#14171A;color:#fff;font-weight:700;padding:3px 9px;border-radius:8px}
  .stars{color:#ffcf5a;letter-spacing:2px}
  .sec{padding:40px 0}.sec h2{font-family:var(--display,'Space Grotesk',sans-serif);font-weight:700;font-size:clamp(22px,3vw,32px);margin:0 0 16px}
  .prose p{color:var(--tx2,#3a4048);max-width:80ch;line-height:1.7;margin:0 0 12px}
  .gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
  .gal img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:12px;background:#f0efeb}
  .rooms{display:grid;gap:14px}
  .room{display:flex;flex-wrap:wrap;gap:16px;justify-content:space-between;align-items:center;border:1px solid var(--bd,#e5e2db);border-radius:14px;padding:18px 20px;background:var(--bg-el,#fff)}
  .room .rn{font-family:var(--display,'Space Grotesk',sans-serif);font-weight:600;font-size:17px;margin:0 0 4px}
  .room .rb{color:var(--tx3,#697079);font-size:13.5px}
  .room .rp{text-align:right;min-width:180px}
  .room .po{color:var(--tx3,#697079);text-decoration:line-through;font-size:13px;display:block}
  .room .pn{font-family:var(--display,'Space Grotesk',sans-serif);font-weight:700;font-size:22px}
  .room .pt{color:var(--tx3,#697079);font-size:13px}
  .room .sv{display:inline-block;background:#FDEDE7;color:#B23F1C;font-weight:700;font-size:12px;padding:2px 8px;border-radius:999px;margin-top:4px}
  .chips{display:flex;flex-wrap:wrap;gap:8px}.chip{border:1px solid var(--bd,#e5e2db);border-radius:999px;padding:7px 13px;font-size:13.5px;color:var(--tx2,#3a4048);background:var(--bg-el,#fff)}
  .mapwrap{border-radius:14px;overflow:hidden;border:1px solid var(--bd,#e5e2db)}.mapwrap iframe{width:100%;height:340px;border:0;display:block}
  .disc{color:var(--tx3,#697079);font-size:13px;margin-top:10px}
</style>`;

    const galleryHtml = images.length>1 ? `<section class="sec" style="padding-top:0"><div class="gal">${images.slice(0,8).map(u=>`<img loading="lazy" src="${escA(u)}" alt="${escA(d.name+' — '+city)}">`).join('')}</div></section>` : '';
    const descHtml = description ? `<section class="sec prose" style="padding-top:0"><h2>About ${esc(d.name)}</h2><p>${esc(description.slice(0,900))}</p></section>` : '';
    const roomsHtml = rooms.length ? `<section class="sec" style="padding-top:0"><h2>Rooms &amp; live rates</h2><p class="disc" style="margin:-6px 0 16px">Prices for ${esc(ci)} to ${esc(co)} (${nights} nights), 2 guests. Your direct rate is shown next to the hotel’s typical selling price — not a quote from any third-party site.</p><div class="rooms">${rooms.map(r=>{
      const per=Math.round(r.retail/nights); const typ=(r.suggested&&r.suggested>r.retail)?Math.round(r.suggested/nights):null;
      const sv=(r.suggested&&r.suggested>r.retail)?Math.round((1-r.retail/r.suggested)*100):null;
      return `<div class="room"><div><div class="rn">${esc(r.name)}</div><div class="rb">${esc(r.board)}${r.refundable?' · <span style="color:#087443;font-weight:600">Free cancellation</span>':''}</div></div><div class="rp">${typ?`<span class="po">${money(typ)} typical</span>`:''}<span class="pn">${money(per)}</span> <span class="pt">/night · ${money(r.retail)} total</span>${sv?`<br><span class="sv">Save ${sv}%</span>`:''}<div style="margin-top:10px"><a class="btn btn-sm btn-coral" href="${bookHref}"><span>Select</span><span class="btn-i"><i class="ph-bold ph-arrow-right"></i></span></a></div></div></div>`;
    }).join('')}</div></section>` : `<section class="sec" style="padding-top:0"><h2>Check availability</h2><p class="prose">Live rates load when you choose your dates.</p><a class="btn btn-coral" href="${bookHref}"><span>Check availability &amp; book</span><span class="btn-i"><i class="ph-bold ph-arrow-right"></i></span></a></section>`;
    const faciHtml = facilities.length ? `<section class="sec" style="padding-top:0"><h2>Facilities</h2><div class="chips">${facilities.map(f=>`<span class="chip">${esc(f)}</span>`).join('')}</div></section>` : '';
    const mapHtml = (lat&&lng) ? `<section class="sec" style="padding-top:0"><h2>Location</h2><p class="prose" style="margin-bottom:14px">${esc(address)}</p><div class="mapwrap"><iframe loading="lazy" title="Map of ${escA(d.name)}" src="https://www.openstreetmap.org/export/embed.html?bbox=${lng-0.01},${lat-0.008},${lng+0.01},${lat+0.008}&layer=mapnik&marker=${lat},${lng}"></iframe></div></section>` : '';
    const starHtml = stars ? `<span class="stars">${'★'.repeat(Math.min(5,Math.round(stars)))}</span>` : '';
    const ratingHtml = rating ? `<span class="rate">${rating}</span><span>${reviewCount?esc(reviewCount)+' reviews':'Guest rated'}</span>` : '';

    const body = `<header class="hh">
  <div class="bg">${mainPhoto?`<img src="${escA(mainPhoto)}" alt="${escA(d.name)}">`:''}</div>
  <div class="in wrap">
    <nav class="crumb" aria-label="Breadcrumb"><a href="/">Home</a> &rsaquo; <a href="${citySlug?('/hotels-in-'+citySlug):'/'}">${esc(cityCrumbName)}</a> &rsaquo; ${esc(d.name)}</nav>
    <h1>${esc(d.name)}</h1>
    <div class="hmeta">${starHtml}${ratingHtml}<span><i class="ph-fill ph-map-pin"></i> ${esc(address)}</span></div>
    <a class="btn btn-coral" href="${bookHref}"><span>${low?`Check availability — from ${money(Math.round(low/nights))}/night`:'Check availability &amp; book'}</span><span class="btn-i"><i class="ph-bold ph-arrow-right"></i></span></a>
  </div>
</header>
<main class="wrap">
  ${descHtml}
  ${roomsHtml}
  ${galleryHtml}
  ${faciHtml}
  ${mapHtml}
  <section class="sec" style="padding-top:0"><p class="disc">Rates and availability are provided in real time through our supplier network and can change. The price shown at checkout is the price that applies. Free cancellation, where offered, follows the policy shown on your selected rate.</p></section>
</main>`;

    return shell(200, res, title, body, { head, style, cache:'public, s-maxage=3600, stale-while-revalidate=86400' });
  } catch (e) {
    return notFound('Something went wrong loading this hotel.');
  }
};
