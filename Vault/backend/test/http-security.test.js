const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAuthenticate, tokenMatches, validUserId, isAllowedEndpoint, fetchAppsScript } = require('../http-security');
test('no caller-selected user identity, even in development', async () => {
  for (const header of [undefined, 'Basic ignored', 'Bearer bad', 'Bearer good']) {
    let code = 200, called = false;
    const guard = createAuthenticate(async (t, revoked) => { assert.equal(revoked, true); if (t !== 'good') throw Error('expired'); return { uid: 'verified-user' }; });
    const req = { headers: { authorization: header, 'x-user-id': 'victim' } };
    await guard(req, { status(c) { code = c; return this; }, json() {} }, () => { called = true; });
    assert.equal(called, header === 'Bearer good'); assert.equal(code, called ? 200 : 401);
    if (called) assert.equal(req.userId, 'verified-user');
  }
});
test('session paths and internal tokens reject untrusted identifiers', () => {
  for (const id of ['../victim', '/tmp/path', 'x/y', '', {}, 'a'.repeat(129)]) assert.equal(validUserId(id), false);
  assert.equal(validUserId('firebase_UID-123'), true);
  assert.equal(tokenMatches('', ''), false); assert.equal(tokenMatches('fixture-token', 'wrong'), false); assert.equal(tokenMatches('fixture-token', 'fixture-token'), true);
});
test('Apps Script SSRF boundaries apply before requests and on each redirect', async () => {
  for (const url of ['http://127.0.0.1/', 'https://127.0.0.1/', 'https://script.google.com.evil/macros/s/id/exec', 'https://user:pass@script.google.com/macros/s/id/exec', 'https://script.google.com:8443/macros/s/id/exec']) assert.equal(isAllowedEndpoint(url), false);
  const endpoint = 'https://script.google.com/macros/s/fixture/exec'; assert.equal(isAllowedEndpoint(endpoint), true);
  process.env.APPS_SCRIPT_AUTH_CONFIG = JSON.stringify({ 'fixture-user': { endpoint, secret: 'fixture-secret-not-real-123456789012345' } });
  const options = { method: 'POST', body: JSON.stringify({ session: 'fixture-user' }) };
  let calls = 0;
  await assert.rejects(fetchAppsScript('https://127.0.0.1/', {}, async () => { calls++; }), /Unsupported/); assert.equal(calls, 0);
  await assert.rejects(fetchAppsScript(endpoint, options, async () => { calls++; return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }); }), /Unsupported/); assert.equal(calls, 1);
  await assert.rejects(fetchAppsScript(endpoint, { ...options, body: JSON.stringify({ session: 'other-user' }) }, async () => { calls++; }), /not configured/);
  assert.equal(calls, 1);
  calls = 0;
  const response = await fetchAppsScript(endpoint, options, async (url, options) => {
    calls++; assert.equal(options.redirect, 'manual');
    if (calls === 1) return new Response(null, { status: 302, headers: { location: 'https://script.googleusercontent.com/macros/echo?fixture=1' } });
    assert.equal(options.method, 'GET'); assert.equal(options.body, undefined); return new Response('ok');
  }); assert.equal(await response.text(), 'ok');
});
