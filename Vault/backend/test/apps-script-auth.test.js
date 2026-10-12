const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../SCRIPT INPUT DATA WA TO GOOGLE SHEET.txt'), 'utf8');
test('Apps Script rejects anonymous, wrong-secret and cross-user commands before accessing sheets', () => {
  const secret = 'fixture-secret-not-real-123456789012345'; let writes = 0;
  const ctx = { PropertiesService: { getScriptProperties: () => ({ getProperty: key => ({ GATEWAY_SECRET: secret, GATEWAY_USER_ID: 'fixture-user' })[key] }) },
    SpreadsheetApp: { openById: () => { writes++; throw Error('Unexpected spreadsheet access'); } },
    ContentService: { MimeType: { TEXT: 'text' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) } };
  vm.createContext(ctx); vm.runInContext(source, ctx);
  for (const body of [{ command: 'new_recap', body: 'reset' }, { session: 'fixture-user', gatewaySecret: 'wrong', body: 'reset' }, { session: 'victim', gatewaySecret: secret, body: 'reset' }]) {
    const result = ctx.doPost({ postData: { contents: JSON.stringify(body) } });
    assert.match(result.text, /Authentication required/); assert.equal(writes, 0);
  }
  const result = ctx.doPost({ postData: { contents: JSON.stringify({ session: 'fixture-user', gatewaySecret: secret, command: 'ping', body: 'ping' }) } });
  assert.equal(result.text, 'pong'); assert.equal(writes, 0);
  assert.ok(!ctx.doGet().text.includes('SPREADSHEET_ID'));
});
