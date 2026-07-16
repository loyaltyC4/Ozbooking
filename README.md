# OzBookings

Direct-booking site for Australian hotels and experiences — [ozbookings.com](https://ozbookings.com).

Static multi-page front end enhanced with vanilla JS, backed by Vercel serverless
functions that proxy **LiteAPI** (hotels) and **Viator** (experiences), with optional
**Supabase** auth for member (CUG) pricing and saved trips.

## Structure

```
src/
  index.html            Home
  search.html           Hotel search results
  hotel.html            Hotel detail + room selection
  checkout.html         Checkout (LiteAPI hosted payment widget)
  confirmation.html     Booking confirmation
  experiences.html      Experiences hub  · experience.html  Experience detail
  about / contact / help / privacy / terms .html
  shared.js             Shared client logic (nav, footer, auth, i18n, formatting)
  styles.css            Global styles
  api/
    _liteapi.js         Shared helper — server-side keys + margins + Supabase verify
    search.js           GET  /api/search
    hotel.js            GET  /api/hotel
    prebook.js          POST /api/prebook
    book.js             POST /api/book
    experiences.js      GET  /api/experiences
  vercel.json           Cache-control headers
```

## Deployment

Hosted on **Vercel** (project `bookaustralia`). **Root Directory = `src`**, no build
step; `src/api/*.js` are auto-deployed as serverless functions.

### Required environment variables (set in Vercel project settings)

| Var | Purpose |
|-----|---------|
| `LITEAPI_KEY` | LiteAPI hotel search / rates / booking |
| `VIATOR_KEY`  | Viator experiences |

The Supabase URL and **publishable** anon key are client-safe and live in source;
member/CUG rates are gated server-side by verifying the caller's Supabase session.

## Pricing model

`api/_liteapi.js` adds a commission margin to the LiteAPI net rate:
`PUBLIC_MARGIN` for everyone, a lower `MEMBER_MARGIN` for signed-in members (a CUG deal).
The struck-through "typical" price shown next to a room is LiteAPI's
`suggestedSellingPrice` (the supplier's suggested retail price) — it is **not** a live
quote from any third-party booking site.
