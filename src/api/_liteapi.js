// Shared LiteAPI helper - key stays server-side (env var). Not a route (underscore prefix).
const KEY = process.env.LITEAPI_KEY || '';
const DATA = 'https://api.liteapi.travel/v3.0';
const BOOK = 'https://book.liteapi.travel/v3.0';

// Supabase (publishable key is public/client-safe; used here only to verify a caller's session)
const SUPA_URL = 'https://fuaommqybyqsiayzofmb.supabase.co';
const SUPA_ANON = 'sb_publishable_Ab3q7O7GPpOA_pleL8nMQQ_VMyRNEEJ';

// Commission margins (percent added to the LiteAPI net rate). Every booking stays profitable.
// PUBLIC_MARGIN keeps the public price near the hotel's suggested price (rate-compliant).
// MEMBER_MARGIN is lower -> members get a below-suggested price (a CUG deal), gated behind login, still profitable.
// Tune these two numbers to set your commission. MEMBER_MARGIN must stay > 0 to never sell at a loss.
const PUBLIC_MARGIN = 25;
const MEMBER_MARGIN = 10;

async function call(base, path, { method = 'GET', body } = {}) {
  const headers = { 'X-API-Key': KEY, accept: 'application/json' };
  if (body) headers['content-type'] = 'application/json';
  try {
    const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    return { ok: false, status: 0, json: null, error: String(e) };
  }
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

// Verify the caller's Supabase session SERVER-SIDE. Returns the user object or null.
// This is the CUG gate: member/CUG rates are only returned when this resolves to a real user.
async function verifyUser(req) {
  const hdr = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7).trim() : '';
  if (!token) return null;
  try {
    const res = await fetch(SUPA_URL + '/auth/v1/user', {
      headers: { apikey: SUPA_ANON, Authorization: 'Bearer ' + token }
    });
    if (!res.ok) return null;
    const u = await res.json();
    return (u && u.id) ? u : null;
  } catch (e) {
    return null;
  }
}

module.exports = { KEY, DATA, BOOK, call, readBody, hasKey: !!KEY, verifyUser, PUBLIC_MARGIN, MEMBER_MARGIN };
