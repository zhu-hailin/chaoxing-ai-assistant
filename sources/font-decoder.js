    // 字体映射缓存、字符还原与原生文本更新。
    const fontCache = new Map();
    const BUNDLED_FONT_TABLE_JSON = /* BUNDLED_FONT_TABLE */;
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
    function secretFontFaces(doc) {
        const faces=[],seen=new Set(),view=doc.defaultView;
        const visitSheet=sheet=>{
            if(!sheet || sheet.disabled || seen.has(sheet))return;
            seen.add(sheet);
            if(sheet.media?.mediaText && view?.matchMedia && !view.matchMedia(sheet.media.mediaText).matches)return;
            let rules;
            // 跨域样式不可读时，只有实际使用混淆字体的正文会因缺少资源报错。
            try {rules=sheet.cssRules;} catch {return;}
            visitRules(rules);
        };
        const visitRules=rules=>{
            for(const rule of rules || []) {
                if(rule.type===5) {
                    const family=rule.style.getPropertyValue('font-family').trim().replace(/^(['"])(.*)\1$/,'$2').toLowerCase();
                    if(family!=='font-cxsecret')continue;
                    const range=rule.style.getPropertyValue('unicode-range') || 'U+0-10FFFF';
                    const ranges=range.split(',').map(part=>{
                        const match=part.trim().match(/^U\+([0-9a-f?]+)(?:-([0-9a-f]+))?$/i);
                        return match?[parseInt(match[1].replace(/\?/g,'0'),16),parseInt((match[2] || match[1]).replace(/\?/g,'f'),16)]:null;
                    }).filter(Boolean);
                    const src=rule.style.getPropertyValue('src');
                    const base64=src.match(/url\(\s*(['"]?)data:[^,]*;base64,([A-Za-z0-9+/=\s]+)\1\s*\)/i)?.[2].replace(/\s/g,'');
                    faces.push({ranges,base64});
                } else if(rule.type===3) {
                    if(!rule.media?.mediaText || !view?.matchMedia || view.matchMedia(rule.media.mediaText).matches)visitSheet(rule.styleSheet);
                } else if(rule.cssRules) {
                    if(rule.type===4 && view?.matchMedia && !view.matchMedia(rule.conditionText).matches)continue;
                    if(rule.type===12 && view?.CSS?.supports && !view.CSS.supports(rule.conditionText))continue;
                    visitRules(rule.cssRules);
                }
            }
        };
        for(const sheet of doc.styleSheets)visitSheet(sheet);
        return faces;
    }
    function loadSecretFont(base64) {
        if (!fontCache.has(base64)) {
            const pending = Promise.resolve().then(() => {
                if (typeof Typr === 'undefined' || typeof md5 !== 'function') throw createCxError('CX-CFG-006',{module:'parser',operation:'font'});
                if (!fontTable) fontTable = JSON.parse(BUNDLED_FONT_TABLE_JSON);
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
        return fontCache.get(base64);
    }
    async function ensureFontDecoded(doc = document, parseContext = {}) {
        const roots = [...(parseContext.root?.matches('.font-cxsecret')?[parseContext.root]:[]),...(parseContext.root || doc).querySelectorAll('.font-cxsecret')].filter(fontRootNeedsDecoding);
        if (!roots.length) return;
        const faces=secretFontFaces(doc),nodes=new Map(),decodedRoots=new Set(),resources=new Set();
        const failure=()=>createCxError('CX-PAR-005',{module:'parser',operation:'font'});
        for(const root of roots) {
            const walker=doc.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
            while((node=walker.nextNode())) {
                if(node.parentElement?.closest('script,style,noscript,template'))continue;
                if(nodes.has(node)){if(nodes.get(node).size)decodedRoots.add(root);continue;}
                const font=doc.defaultView?.getComputedStyle(node.parentElement).fontFamily || '';
                const usesSecret=/(?:^|,)\s*(?:"font-cxsecret"|'font-cxsecret'|font-cxsecret)\s*(?:,|$)/i.test(font);
                const codes=new Map();nodes.set(node,codes);
                if(usesSecret)for(const char of new Set(node.data.match(/[\u4e00-\u9fa5]/g) || [])) {
                    const code=char.charCodeAt(0);
                    if(!faces.length)throw failure();
                    const matching=faces.filter(face=>face.ranges.some(([start,end])=>code>=start && code<=end));
                    if(!matching.length)continue;
                    const sources=new Set(matching.map(face=>face.base64));
                    if(sources.size!==1 || sources.has(undefined))throw failure();
                    const base64=matching[0].base64;codes.set(code,base64);resources.add(base64);
                }
                if(!codes.size && GARBLED.test(node.data))throw failure();
                if(codes.size)decodedRoots.add(root);
            }
        }
        if(!resources.size)return;
        const fonts=new Map(await Promise.all([...resources].map(async base64=>[base64,await loadSecretFont(base64)])));
        const activeRoots=[...decodedRoots].filter(root=>root.classList.contains('font-cxsecret'));
        // 先验证全部文本，再一次性替换，避免失败后重试二次解密已转换的字符。
        const edits = new Map();
        for (const [node,codes] of nodes) {
            if(!codes.size || !activeRoots.some(root=>root.contains(node)))continue;
            const next = node.data.replace(/[\u4e00-\u9fa5]/g, char => {
                const code = char.charCodeAt(0);
                if(!codes.has(code))return char;
                const {mapping,encodedCodes}=fonts.get(codes.get(code));
                // 容器会同时包含题型标签和普通中文。没有自定义字形的字符
                // 使用系统回退字体显示，必须原样保留，不能当作缺失映射。
                if (!encodedCodes.has(code)) return char;
                const decoded = mapping.get(code);
                if (decoded === undefined) throw createCxError('CX-PAR-005',{module:'parser',operation:'font'});
                return decoded;
            });
            edits.set(node, next);
        }
        for (const [node, text] of edits) node.data = text;
        activeRoots.forEach(root => root.classList.remove('font-cxsecret'));
    }

