// Created by i729
const crypto = require('node:crypto');
function validUserId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value); }
function tokenMatches(expected, supplied) {
  if (!expected || typeof supplied !== 'string') return false;
  const a = Buffer.from(expected), b = Buffer.from(supplied);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function createAuthenticate(verifyToken) {
  return async (req, res, next) => {
    const header = req.headers.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return res.status(401).json({ error: 'Firebase authentication required' });
    try {
      const user = await verifyToken(token, true);
      if (!validUserId(user.uid)) return res.status(403).json({ error: 'Unsupported account identifier' });
      req.userId = user.uid; req.user = user;
      return next();
    } catch { return res.status(401).json({ error: 'Invalid Firebase session' }); }
  };
}
function isAllowedEndpoint(value) {
  if (!value) return true;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname === 'script.google.com' && !u.port && !u.username && !u.password &&
      /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(u.pathname);
  } catch { return false; }
}
async function fetchAppsScript(endpoint, options = {}, fetchImpl = fetch) {
  if (!endpoint || !isAllowedEndpoint(endpoint)) throw Error('Unsupported Apps Script endpoint');
  let payload;
  try { payload = JSON.parse(options.body); } catch { throw Error('Invalid Apps Script payload'); }
  if (!validUserId(payload.session)) throw Error('Invalid Apps Script account');
  let accounts;
  try { accounts = JSON.parse(process.env.APPS_SCRIPT_AUTH_CONFIG || '{}'); } catch { throw Error('Apps Script authentication configuration invalid'); }
  const account = accounts[payload.session];
  if (!account || account.endpoint !== endpoint || typeof account.secret !== 'string' || account.secret.length < 32) {
    throw Error('Apps Script authentication not configured for this account and endpoint');
  }
  const body = JSON.stringify({ ...payload, gatewaySecret: account.secret });
  let url = new URL(endpoint), init = { ...options, body, redirect: 'manual' };
  for (let n = 0; n < 4; n++) {
    const response = await fetchImpl(url.toString(), init);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) throw Error('Invalid Apps Script redirect');
    const next = new URL(location, url);
    if (next.protocol !== 'https:' || !['script.google.com', 'script.googleusercontent.com'].includes(next.hostname) ||
        next.port || next.username || next.password) throw Error('Unsupported Apps Script redirect');
    if (response.status === 303 || ([301, 302].includes(response.status) && init.method === 'POST')) init = { ...init, method: 'GET', body: undefined };
    await response.body?.cancel();
    url = next;
  }
  throw Error('Too many Apps Script redirects');
}
module.exports = { validUserId, tokenMatches, createAuthenticate, isAllowedEndpoint, fetchAppsScript };
