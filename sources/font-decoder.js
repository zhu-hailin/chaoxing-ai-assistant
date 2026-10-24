    // 字体映射缓存、字符还原与原生文本更新。
    const fontCache = new Map();
    let fontTable;
    function fontRootNeedsDecoding(root) {
        // 只检查实际文本；图片本身不依赖字体。保留平台节点、属性和事件。
        const copy = root.cloneNode(true);
        copy.querySelectorAll('script,style,noscript,template').forEach(node => node.remove());
        const text = clean(copy.textContent).replace(/[\u200b\ufeff]/g, '');
        if (!text) return false;
        const label = '(?:简答|问答|论述|单选|多选|判断|填空|单项选择|多项选择|是非)题?';
        const onlyType = new RegExp('^(?:\\d+\\s*[.．、]\\s*)?(?:【\\s*' + label + '\\s*】|\\[\\s*' + label + '\\s*\\]|（\\s*' + label + '\\s*）|\\(\\s*' + label + '\\s*\\))$');
        return !onlyType.test(text);
    }
    async function ensureFontDecoded(doc = document, parseContext = {}) {
        const roots = [...(parseContext.root?.matches('.font-cxsecret')?[parseContext.root]:[]),...(parseContext.root || doc).querySelectorAll('.font-cxsecret')].filter(fontRootNeedsDecoding);
        if (!roots.length) return;
        const styles = [...doc.querySelectorAll('style')];
        const style = styles.find(el =>
            /font-cxsecret/.test(el.textContent) && /base64,/.test(el.textContent));
        const base64 = style?.textContent.match(/base64,([A-Za-z0-9+/=\s]+)["']/)?.[1].replace(/\s/g, '');
        if (!base64) {
            // 已批改结果页仍给明文题干加 font-cxsecret 类，却不再提供字体。
            // 仅在已完成、没有字体声明且没有已知混淆字符时视为明文。
            const completed = clean(doc.querySelector('#RightCon .testTit_status, .testTit_status')?.textContent) === '已完成';
            const declaresSecretFont = styles.some(el => /@font-face[\s\S]*?font-cxsecret/.test(el.textContent));
            if (completed && !declaresSecretFont && roots.every(root => !GARBLED.test(root.textContent))) return;
        }
        if (!base64) throw createCxError('CX-PAR-005',{module:'parser',operation:'font'});
        if (!fontCache.has(base64)) {
            const pending = Promise.resolve().then(() => {
                if (typeof Typr === 'undefined' || typeof md5 !== 'function') throw createCxError('CX-CFG-006',{module:'parser',operation:'font'});
                if (!fontTable) fontTable = JSON.parse(GM_getResourceText('Table'));
                const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
                const font = Typr.parse(bytes)[0];
                const mapping = new Map();
                const encodedCodes = new Set();
                for (let code = 19968; code < 40870; code++) {
                    const glyph = Typr.U.codeToGlyph(font, code);
                    if (!glyph) continue;
                    encodedCodes.add(code);
                    const hash = md5(JSON.stringify(Typr.U.glyphToPath(font, glyph))).slice(24);
                    const target = fontTable[hash];
                    if (target !== undefined && Number.isInteger(Number(target)) && Number(target) > 0 && Number(target) <= 65535) {
                        mapping.set(code, String.fromCharCode(Number(target)));
                    }
                }
                return { mapping, encodedCodes };
            }).catch(error=>{throw error.cxCode?error:createCxError('CX-PAR-005',{module:'parser',operation:'font'},{cause:error});});
            fontCache.set(base64, pending);
            pending.catch(() => fontCache.delete(base64));
        }
        const { mapping, encodedCodes } = await fontCache.get(base64);
        // 先验证全部文本，再一次性替换，避免失败后重试二次解密已转换的字符。
        const edits = new Map();
        for (const root of roots.filter(root => root.classList.contains('font-cxsecret'))) {
            const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
                if (edits.has(node) || node.parentElement?.closest('script,style')) continue;
                const next = node.data.replace(/[\u4e00-\u9fa5]/g, char => {
                    const code = char.charCodeAt(0);
                    // 容器会同时包含题型标签和普通中文。没有自定义字形的字符
                    // 使用系统回退字体显示，必须原样保留，不能当作缺失映射。
                    if (!encodedCodes.has(code)) return char;
                    const decoded = mapping.get(code);
                    if (decoded === undefined) throw createCxError('CX-PAR-005',{module:'parser',operation:'font'});
                    return decoded;
                });
                edits.set(node, next);
            }
        }
        for (const [node, text] of edits) node.data = text;
        roots.forEach(root => root.classList.remove('font-cxsecret'));
    }

