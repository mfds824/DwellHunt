// Offline contract checks. Does not submit to any live service.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const box = { window: {} };
vm.runInNewContext(fs.readFileSync('viewing-config.js', 'utf8'), box);
const config = box.window.DWELLHUNT_VIEWING;
assert.equal(config.turnstileSiteKey, '0x4AAAAAAFlgi62lRvCmxFzi');
assert.equal(config.bookingUrl, 'https://wstmendis.app.n8n.cloud/webhook/dwellhunt-virtual-viewing');
assert.deepEqual(Object.keys(config).sort(), ['bookingUrl', 'turnstileSiteKey']);
const app = fs.readFileSync('app.js', 'utf8');
const seed = app.slice(app.indexOf('y=[{id:`prop-'), app.indexOf('],b=', app.indexOf('y=[{id:`prop-')));
const listings = [...seed.matchAll(/\{id:`(prop-[^`]+)`,title:`([^`]+)`/g)].map(m => [m[1], m[2]]);
assert.equal(listings.length, 10);
assert.equal(new Set(listings.map(r => r[0])).size, 10);
const header = 'property_id,property_title,property_url,active,agent_id,agent_email,calendar_id,telegram_chat_id,telegram_user_ids';
const template = fs.readFileSync('DH_Viewing_Properties.template-INACTIVE.csv', 'utf8').trim().split(/\r?\n/);
assert.equal(template.shift(), header);
assert.equal(template.length, listings.length);
// Current ten titles have no commas/quotes; fail rather than silently parse future CSV incorrectly.
listings.forEach(([id, title], i) => {
  assert(!/[,"\r\n]/.test(title));
  assert.equal(template[i], `${id},${title},https://mfds824.github.io/DwellHunt/,false,,,,,`);
});
assert.equal(fs.readFileSync('DH_Viewing_Properties.approved-import.csv', 'utf8').trim(), header);
assert(!template.join('\n').includes('REQUIRED_CONFIG'));
const adapter = fs.readFileSync('virtual-viewing.js', 'utf8');
assert(adapter.includes("action: 'booking'"));
assert(adapter.includes('turnstile_token: token'));
assert(adapter.includes('crypto.getRandomValues(new Uint8Array(24))'));
assert(adapter.includes("'Content-Type': 'text/plain;charset=UTF-8'"));
const html = fs.readFileSync('index.html', 'utf8');
for (const file of ['app.js', 'style.css', 'photo-upload.js', 'viewing-config.js', 'virtual-viewing.js', 'virtual-viewing.css']) {
  assert(html.includes(`./${file}`)); assert(fs.existsSync(file));
}
console.log('PASS public config, ten exact seed IDs/titles, nine-column inactive template, zero approved rows, booking action/token/randomness contract, JSON transport and relative local assets. Static checks only.');
