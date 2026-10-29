// Offline resource/metadata checks only; no browser, course or model requests.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name));
const text = name => read(name).toString('utf8');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const manifest = JSON.parse(text('assets/runtime-logo-manifest.json'));
const source = text('学习通AI助手.user.js');
const template = text('sources/panel-template.html');
const pinned = {
  original: '831b890495e2d8f9f3ba066db6062683877f6c2447307786bfacf63cc96c2694',
  source: 'ec232ae8af99b0a0f5a25a8bfc9a3edd92f065379cf7798a34605b2d3e8be995',
  floating: { width:176, height:176, bytes:28613, sha256:'e74f86084213d7566139eb93d1a5ddb7f115d60bb2996cf5a154d2c479f49252' },
  metadata: { width:32, height:32, bytes:2123, sha256:'84aaae5cd63e48faf3587a0990687141f49c6b358bb24aa9eb2edcbad55c143a' },
};
let passed = 0;
function test(name, action) { action(); passed++; console.log('PASS ' + name); }
function png(data, width, height) {
  assert(data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
  assert.equal(data.readUInt32BE(8), 13); assert.equal(data.toString('ascii', 12, 16), 'IHDR');
  assert.equal(data.readUInt32BE(16), width); assert.equal(data.readUInt32BE(20), height);
  assert.equal(data[24], 8); assert.equal(data[25], 6, 'RGBA color type must retain alpha');
}
function dataUri(value) {
  assert.match(value, /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/);
  const encoded = value.slice(value.indexOf(',') + 1), data = Buffer.from(encoded, 'base64');
  assert.equal(data.toString('base64'), encoded); return data;
}
function rule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(escaped + '\\{([^}]+)\\}').exec(css);
  assert(match, 'Missing CSS rule: ' + selector); return match[1];
}

test('Original logo is preserved and blue RGBA source is pinned', () => {
  const original = read('assets/logo.png');
  assert.equal(manifest.originalSource, 'logo.png'); assert.equal(manifest.originalSourceSha256, pinned.original);
  assert.equal(sha(original), pinned.original);
  png(original, 1254, 1254);
  assert.equal(manifest.source, 'logo-blue.png'); assert.equal(manifest.sourceSha256, pinned.source);
  const blue=read('assets/logo-blue.png');assert.equal(sha(blue), pinned.source);assert.deepEqual(manifest.sourceSize,[1254,1254]);png(blue,1254,1254);
});
test('176px floating and 32px metadata PNGs match their fixed RGBA assets and manifest', () => {
  for (const kind of ['floating','metadata']) {
    const entry = manifest.files[kind], expected = pinned[kind], data = read('assets/' + entry.file);
    assert.equal(path.basename(entry.file), entry.file); assert.equal(entry.mode, 'RGBA');
    for (const key of ['width','height','bytes','sha256']) assert.equal(entry[key], expected[key]);
    assert.equal(data.length, expected.bytes); assert.equal(sha(data), expected.sha256);
    png(data, expected.width, expected.height);
  }
});
test('Complete script embeds the exact metadata and floating PNG bytes', () => {
  const icon = /^\/\/ @icon\s+(\S+)\s*$/m.exec(source);
  const floating = /<img class="launcher-icon" src="([^"]+)"/.exec(source);
  assert(icon); assert(floating);
  assert(dataUri(icon[1]).equals(read('assets/' + manifest.files.metadata.file)));
  assert(dataUri(floating[1]).equals(read('assets/' + manifest.files.floating.file)));
  assert(!source.includes('__ASSISTANT_ICON__')); assert(!source.includes('__FLOATING_LAUNCHER_ICON__'));
});
test('Existing updater accepts the complete metadata and recognizes version 1.33.1', () => {
  const updateSource = text('sources/assistant-updates.js');
  const functions = ['assistantVersionParts','assistantUpdateScriptVersion'].map(name => {
    const match = new RegExp('    function ' + name + '\\([^]*?\\n    \\}').exec(updateSource);
    assert(match, 'Existing updater function not found: ' + name); return match[0];
  }).join('\n');
  const version = script => vm.runInNewContext(functions + '\nassistantUpdateScriptVersion(script)', {script});
  assert.equal(version(source), '1.33.1'); assert.equal(version(source.replace(/\n/g, '\r\n')), '1.33.1');
  const header = /^\/\/ ==UserScript==\n([\s\S]*?)^\/\/ ==\/UserScript==/m.exec(source);
  assert(header && header.index === 0); assert(header[1].length > 0 && header[1].length <= 16000);
  const oversized = source.replace(/^\/\/ @icon\s+[^\n]+/m, '// @icon ' + 'x'.repeat(16001));
  assert.throws(() => version(oversized));
});
test('Metadata uses no external font resource, require or resource-text grant', () => {
  assert(!/^\/\/ @resource\b/m.test(source)); assert(!/^\/\/ @require\b/m.test(source));
  assert(!/^\/\/ @grant\s+GM_getResourceText\b/m.test(source));
  assert(!/\bGM_getResourceText\s*\(/.test(source));
  for (const name of ['namespace','updateURL','downloadURL']) {
    const line = new RegExp('^// @' + name + '\\s+(\\S+)\\s*$', 'm').exec(source);
    assert(line, 'Missing update/install metadata: ' + name);
    if (name === 'namespace') assert.equal(line[1], 'local.chaoxing.quiz');
    else assert.match(line[1], /^https:\/\/raw\.githubusercontent\.com\/zhu-hailin\/chaoxing-ai-assistant\/main\/.+\.user\.js$/);
  }
});
test('Floating button stays 44px, transparent and draggable markup stays intact', () => {
  for (const css of [template,source]) {
    const floating = rule(css, '#floating-launcher');
    for (const declaration of ['width:44px','height:44px','padding:0','border:0','border-radius:0','background:transparent','box-shadow:none','touch-action:none','user-select:none','overflow:visible'])
      assert(floating.split(';').includes(declaration), declaration);
    assert(rule(css, '#floating-launcher:hover').split(';').includes('background:transparent'));
    const image = rule(css, '#floating-launcher .launcher-icon');
    for (const declaration of ['width:44px','height:44px','object-fit:contain','pointer-events:none']) assert(image.split(';').includes(declaration), declaration);
    assert.match(css, /id="floating-launcher"[^>]*aria-controls="panel"[^>]*aria-expanded="false"/);
    assert.match(css, /class="launcher-icon"[^>]*draggable="false"/);
  }
});
console.log(`PASS ${passed} logo asset/metadata checks`);
