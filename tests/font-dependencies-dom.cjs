// Offline regression for pinned real dependencies. No model or remote font requests.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '学习通AI助手.user.js'), 'utf8');
const entry = "    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startQuizObserver, { once: true });\n    else startQuizObserver();";
assert(source.includes(entry));
const tableDeclaration = /const BUNDLED_FONT_TABLE_JSON\s*=\s*("(?:\\.|[^"\\])*");/;
const tableMatch = tableDeclaration.exec(source);
assert(tableMatch, 'The complete script must contain the bundled table JSON literal');
const tableBytes = fs.readFileSync(path.join(root, 'vendor/font/table.json'));
const tableJSON = JSON.parse(tableMatch[1]);
const pinnedTableSha = 'fbc6ae3c795a46ca2bd0994e68e7cb90ca4d9a046f335512657760d9a4fdf875';
const digest = value => crypto.createHash('md5').update(value, 'utf8').digest('hex');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

// Construct a minimal TTF from scratch: glyph 1 maps U+4E00 to a triangle.
// No third-party font sample, installed system font or remote sample is used.
function triangleFont(twoGlyphs = false) {
    const glyphs = twoGlyphs ? 3 : 2;
    const head = Buffer.alloc(54); head.writeUInt32BE(0x00010000, 0); head.writeUInt16BE(1000, 18);
    const hhea = Buffer.alloc(36); hhea.writeUInt32BE(0x00010000, 0); hhea.writeUInt16BE(glyphs, 34);
    const maxp = Buffer.alloc(32); maxp.writeUInt32BE(0x00010000, 0); maxp.writeUInt16BE(glyphs, 4);
    const hmtx = Buffer.alloc(glyphs * 4); for (let index = 0; index < glyphs; index++) hmtx.writeUInt16BE(500, index * 4);
    const cmap = Buffer.alloc(44); cmap.writeUInt16BE(1, 2); cmap.writeUInt16BE(3, 4); cmap.writeUInt16BE(1, 6); cmap.writeUInt32BE(12, 8);
    const f = cmap.subarray(12); f.writeUInt16BE(4, 0); f.writeUInt16BE(32, 2); f.writeUInt16BE(4, 6); f.writeUInt16BE(4, 8); f.writeUInt16BE(1, 10);
    f.writeUInt16BE(twoGlyphs ? 19969 : 19968, 14); f.writeUInt16BE(65535, 16); f.writeUInt16BE(19968, 20); f.writeUInt16BE(65535, 22);
    f.writeInt16BE(1 - 19968, 24); f.writeUInt16BE(1, 26);
    const loca = Buffer.alloc((glyphs + 1) * 2); loca.writeUInt16BE(10, 4); if (twoGlyphs) loca.writeUInt16BE(20, 6);
    const glyf = Buffer.alloc(twoGlyphs ? 40 : 20); glyf.writeInt16BE(1, 0); glyf.writeInt16BE(100, 6); glyf.writeInt16BE(100, 8); glyf.writeUInt16BE(2, 10);
    glyf.set([49, 51, 39, 100, 100, 100], 14);
    if (twoGlyphs) { glyf.copy(glyf, 20, 0, 20); glyf[37] = 80; }
    const tables = { cmap, glyf, head, hhea, hmtx, loca, maxp };
    const names = Object.keys(tables); let size = 12 + 16 * names.length;
    for (const name of names) size += (tables[name].length + 3) & ~3;
    const font = Buffer.alloc(size); font.writeUInt32BE(0x00010000, 0); font.writeUInt16BE(names.length, 4);
    let offset = 12 + names.length * 16;
    names.forEach((name, index) => {
        const record = 12 + index * 16; font.write(name, record, 4, 'ascii');
        font.writeUInt32BE(offset, record + 8); font.writeUInt32BE(tables[name].length, record + 12);
        tables[name].copy(font, offset); offset += (tables[name].length + 3) & ~3;
    });
    return font;
}

function fixture(mapping) {
    const dom = new JSDOM('<body></body>', { url: 'https://mooc1.chaoxing.com/work/doHomeWorkNew', runScripts: 'outside-only' });
    const w = dom.window, calls = [], resourceCalls = [];
    const sentinelTypr = {}, sentinelMd5 = () => 'page-value', sentinelExports = {};
    w.Typr = sentinelTypr; w.md5 = sentinelMd5;
    w.define = () => { throw new Error('Page AMD loader must not be called'); }; w.define.amd = true;
    w.module = { exports: sentinelExports };
    w.GM_getValue = (_key, fallback) => fallback; w.GM_setValue = () => {};
    w.GM_xmlhttpRequest = request => { calls.push(request); throw new Error('Unexpected network request'); };
    w.GM_getResourceText = name => { resourceCalls.push(name); throw new Error('External font resources are unavailable'); };
    // Inject a synthetic table only into this evaluated test copy. Production keeps its private, pinned literal.
    const testSource = mapping === undefined ? source : source.replace(tableDeclaration, () => `const BUNDLED_FONT_TABLE_JSON = ${JSON.stringify(JSON.stringify(mapping))};`);
    w.eval(testSource.replace(entry, 'globalThis.fontAPI = { Typr, md5, ensureFontDecoded, tableJSON:BUNDLED_FONT_TABLE_JSON };'));
    return { w, api:w.fontAPI, calls, resourceCalls, sentinelTypr, sentinelMd5, sentinelExports,
        close() { w.dispatchEvent(new w.Event('pagehide')); w.close(); } };
}
function attachFont(f, bytes, html) {
    const style = f.w.document.createElement('style');
    style.textContent = `@font-face{font-family:font-cxsecret;src:url('data:font/ttf;base64,${bytes.toString('base64')}')}`;
    f.w.document.head.append(style); f.w.document.body.innerHTML = html;
}
const results = [];
async function test(name, action) { await action(); results.push(name); console.log('PASS ' + name); }
(async () => {
    await test('Pinned 355427-byte table is embedded verbatim with all 20906 entries', () => {
        assert.equal(tableBytes.length, 355427); assert.equal(sha(tableBytes), pinnedTableSha);
        assert.equal(tableJSON, tableBytes.toString('utf8'));
        const actual = JSON.parse(tableJSON), expected = JSON.parse(tableBytes);
        assert.equal(Object.keys(actual).length, 20906); assert.deepEqual(actual, expected);
        assert.equal(sha(Buffer.from(tableJSON, 'utf8')), pinnedTableSha);
        assert(!/^\/\/ @require\b/m.test(source));
        assert(!/^\/\/ @resource\s+Table\b/m.test(source));
        assert(!/^\/\/ @grant\s+GM_getResourceText\b/m.test(source));
        const manifest = JSON.parse(fs.readFileSync(path.join(root, 'vendor/font/manifest.json'), 'utf8'));
        for (const item of manifest.files) assert.equal(sha(fs.readFileSync(path.join(root, 'vendor/font', item.file))), item.sha256);
    });
    let shapeHash;
    await test('Pinned Typr/MD5 parse synthetic TTF and keep page AMD/CommonJS globals private', () => {
      const f = fixture(); const { api, w } = f;
      try {
        assert.equal(api.tableJSON, tableBytes.toString('utf8'));
        assert.equal(typeof api.Typr.parse, 'function'); assert.equal(typeof api.Typr.U.codeToGlyph, 'function'); assert.equal(typeof api.Typr.U.glyphToPath, 'function');
        for (const text of ['', 'Hi', 'abc', '汉字', JSON.stringify({ cmds: ['M'], crds: [0, 1] })]) assert.equal(api.md5(text), digest(text));
        assert.equal(w.Typr, f.sentinelTypr); assert.equal(w.md5, f.sentinelMd5); assert.equal(w.module.exports, f.sentinelExports);
        const bytes = triangleFont(); const font = api.Typr.parse(w.Uint8Array.from(bytes))[0];
        assert.equal(api.Typr.U.codeToGlyph(font, 19968), 1);
        const shape = api.Typr.U.glyphToPath(font, 1); assert(shape.cmds.length > 0 && shape.crds.includes(100));
        shapeHash = digest(JSON.stringify(shape)).slice(24);
        assert.equal(f.calls.length, 0); assert.equal(f.resourceCalls.length, 0);
      } finally { f.close(); }
    });
    await test('Synthetic table decodes mixed plaintext while external resources throw and networking stays unused', async () => {
      const f = fixture({[shapeHash]:20057});
      try {
        attachFont(f, triangleFont(), '<div class="font-cxsecret">【单选题】一，普通中文 ABC 123</div><p>原有明文一</p>');
        await f.api.ensureFontDecoded();
        assert.equal(f.w.document.querySelector('div').textContent, '【单选题】乙，普通中文 ABC 123');
        assert.equal(f.w.document.querySelector('p').textContent, '原有明文一');
        assert.equal(f.w.document.querySelectorAll('.font-cxsecret').length, 0);
        assert.equal(f.calls.length, 0); assert.equal(f.resourceCalls.length, 0);
      } finally { f.close(); }
    });
    await test('Nested roots, simultaneous calls and repeated decoding share one font parse and decode once', async () => {
      const f = fixture({[shapeHash]:20057});
      try {
        attachFont(f, triangleFont(), '<div class="font-cxsecret">一<span class="font-cxsecret">一</span></div>');
        let parses = 0; const parse = f.api.Typr.parse;
        f.api.Typr.parse = (...args) => { parses++; return parse(...args); };
        await Promise.all([f.api.ensureFontDecoded(), f.api.ensureFontDecoded()]);
        await f.api.ensureFontDecoded();
        assert.equal(f.w.document.body.textContent, '乙乙'); assert.equal(parses, 1);
        assert.equal(f.w.document.querySelectorAll('.font-cxsecret').length, 0);
        assert.equal(f.calls.length, 0); assert.equal(f.resourceCalls.length, 0);
      } finally { f.close(); }
    });
    await test('Missing glyph mapping fails atomically and preserves original text, nodes and classes', async () => {
      const f = fixture({[shapeHash]:20057});
      try {
        const bytes = triangleFont(true), font = f.api.Typr.parse(f.w.Uint8Array.from(bytes))[0];
        assert.equal(f.api.Typr.U.codeToGlyph(font, 19969), 2);
        assert.notEqual(digest(JSON.stringify(f.api.Typr.U.glyphToPath(font, 2))).slice(24), shapeHash);
        attachFont(f, bytes, '<div class="font-cxsecret">一</div><div class="font-cxsecret">丁</div>');
        const nodes = [...f.w.document.querySelectorAll('div')], before = f.w.document.body.innerHTML;
        await assert.rejects(f.api.ensureFontDecoded(), error => error.cxCode === 'CX-PAR-005');
        assert.equal(f.w.document.body.innerHTML, before);
        assert(nodes.every(node => node.isConnected && node.classList.contains('font-cxsecret')));
        assert.equal(f.calls.length, 0); assert.equal(f.resourceCalls.length, 0);
      } finally { f.close(); }
    });
    console.log(`PASS ${results.length} font dependency checks; no remote fonts, resources or model requests`);
})().catch(error => { console.error(error); process.exitCode = 1; });
