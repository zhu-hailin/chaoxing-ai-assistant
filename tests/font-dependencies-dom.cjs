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
const instrumented = source.replace(entry, 'globalThis.fontAPI = { Typr, md5, ensureFontDecoded };');
const digest = value => crypto.createHash('md5').update(value, 'utf8').digest('hex');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

// Construct a minimal TTF from scratch: glyph 1 maps U+4E00 to a triangle.
// No third-party font sample, installed system font or remote sample is used.
function triangleFont() {
    const head = Buffer.alloc(54); head.writeUInt32BE(0x00010000, 0); head.writeUInt16BE(1000, 18);
    const hhea = Buffer.alloc(36); hhea.writeUInt32BE(0x00010000, 0); hhea.writeUInt16BE(2, 34);
    const maxp = Buffer.alloc(32); maxp.writeUInt32BE(0x00010000, 0); maxp.writeUInt16BE(2, 4);
    const hmtx = Buffer.alloc(8); hmtx.writeUInt16BE(500, 0); hmtx.writeUInt16BE(500, 4);
    const cmap = Buffer.alloc(44); cmap.writeUInt16BE(1, 2); cmap.writeUInt16BE(3, 4); cmap.writeUInt16BE(1, 6); cmap.writeUInt32BE(12, 8);
    const f = cmap.subarray(12); f.writeUInt16BE(4, 0); f.writeUInt16BE(32, 2); f.writeUInt16BE(4, 6); f.writeUInt16BE(4, 8); f.writeUInt16BE(1, 10);
    f.writeUInt16BE(19968, 14); f.writeUInt16BE(65535, 16); f.writeUInt16BE(19968, 20); f.writeUInt16BE(65535, 22);
    f.writeInt16BE(1 - 19968, 24); f.writeUInt16BE(1, 26);
    const loca = Buffer.alloc(6); loca.writeUInt16BE(10, 4);
    const glyf = Buffer.alloc(20); glyf.writeInt16BE(1, 0); glyf.writeInt16BE(100, 6); glyf.writeInt16BE(100, 8); glyf.writeUInt16BE(2, 10);
    glyf.set([49, 51, 39, 100, 100, 100], 14);
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

const dom = new JSDOM('<body></body>', { url: 'https://mooc1.chaoxing.com/work/doHomeWorkNew', runScripts: 'outside-only' });
const w = dom.window, calls = [];
const sentinelTypr = {}, sentinelMd5 = () => 'page-value', sentinelExports = {};
w.Typr = sentinelTypr; w.md5 = sentinelMd5;
w.define = () => { throw new Error('Page AMD loader must not be called'); }; w.define.amd = true;
w.module = { exports: sentinelExports };
w.GM_getValue = (_key, fallback) => fallback; w.GM_setValue = () => {};
w.GM_xmlhttpRequest = request => { calls.push(request); throw new Error('Unexpected network request'); };
let mapping = {}; w.GM_getResourceText = name => { assert.equal(name, 'Table'); return JSON.stringify(mapping); };
(async () => {
    try {
        assert(!/^\/\/ @require\b/m.test(source));
        const manifest = JSON.parse(fs.readFileSync(path.join(root, 'vendor/font/manifest.json'), 'utf8'));
        for (const item of manifest.files) assert.equal(sha(fs.readFileSync(path.join(root, 'vendor/font', item.file))), item.sha256);
        w.eval(instrumented);
        const api = w.fontAPI;
        assert.equal(typeof api.Typr.parse, 'function'); assert.equal(typeof api.Typr.U.codeToGlyph, 'function'); assert.equal(typeof api.Typr.U.glyphToPath, 'function');
        for (const text of ['', 'Hi', 'abc', '汉字', JSON.stringify({ cmds: ['M'], crds: [0, 1] })]) assert.equal(api.md5(text), digest(text));
        assert.equal(w.Typr, sentinelTypr); assert.equal(w.md5, sentinelMd5); assert.equal(w.module.exports, sentinelExports);
        const bytes = triangleFont(); const font = api.Typr.parse(w.Uint8Array.from(bytes))[0];
        assert.equal(api.Typr.U.codeToGlyph(font, 19968), 1);
        const shape = api.Typr.U.glyphToPath(font, 1); assert(shape.cmds.length > 0 && shape.crds.includes(100));
        mapping[digest(JSON.stringify(shape)).slice(24)] = 20057;
        const style = w.document.createElement('style'); style.textContent = `@font-face{font-family:font-cxsecret;src:url('data:font/ttf;base64,${bytes.toString('base64')}')}`;
        w.document.head.append(style);
        const node = w.document.createElement('div'); node.className = 'font-cxsecret'; node.textContent = '一'; w.document.body.append(node);
        await api.ensureFontDecoded(); assert.equal(node.textContent, '乙'); assert(!node.classList.contains('font-cxsecret'));
        await api.ensureFontDecoded(); assert.equal(node.textContent, '乙'); assert.equal(calls.length, 0);
        console.log('PASS pinned real Typr/MD5, private exports and synthetic-font decoding without JS network requests');
    } finally { w.dispatchEvent(new w.Event('pagehide')); w.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
