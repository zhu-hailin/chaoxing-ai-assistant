    // 字体解密部分源自 wyn665817 的 MIT 脚本；改为文本节点转换和可重入模块。
    function initBackgroundPlayback() {
        if (window.top !== window.self || location.hostname !== 'mooc1.chaoxing.com'
            || !location.pathname.startsWith('/mycourse/studentstudy')) return;
        window.addEventListener('mouseout', event => {
            if (event.relatedTarget === null) {
                event.stopImmediatePropagation();
                event.stopPropagation();
            }
        }, true);
    }

    const fontCache = new Map();
    let fontTable;
    async function ensureFontDecoded(doc = document) {
        const roots = [...doc.querySelectorAll('.font-cxsecret')];
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
        if (!base64) throw new Error('存在加密题目，但未找到可解析的 Base64 字体');
        if (!fontCache.has(base64)) {
            const pending = Promise.resolve().then(() => {
                if (typeof Typr === 'undefined' || typeof md5 !== 'function') throw new Error('字体解析依赖未加载，请检查油猴外部资源');
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
            });
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
                    if (decoded === undefined) throw new Error(`字体表缺少字形映射（U+${code.toString(16).toUpperCase()}），已保留原文并停止分析`);
                    return decoded;
                });
                edits.set(node, next);
            }
        }
        for (const [node, text] of edits) node.data = text;
        roots.forEach(root => root.classList.remove('font-cxsecret'));
    }

    function questionId(el, index) {
        return String(el.getAttribute('data') || el.id || `local-${index + 1}`);
    }
    function savedKeys(saved, optionMap) {
        if (optionMap.has(saved)) return [saved];
        const keys = saved.split(/[,;|\s]+/).filter(Boolean);
        if (keys.length === 1 && /^[A-Z]+$/.test(saved)) return [...saved];
        return keys;
    }
    async function waitFor(test, timeout = 450) {
        const end = Date.now() + timeout;
        // 至少等一个任务周期，允许页面自己的 change/click 处理结束。
        await new Promise(resolve => setTimeout(resolve, 25));
        while (!test() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 25));
    }

    const HEADER_SELECTOR = '#RightCon .CeYan > .ceyan_name, .CeYan > .ceyan_name';
    function resolveQuizHeader(doc = document) {
        const header = doc.querySelector(HEADER_SELECTOR);
        return header?.querySelector('h3') && !header.closest(QUESTION_SELECTOR) ? header : null;
    }

    let controller;
    let panelView;
    let toolbarView;
    const PROJECT_GITHUB_URL = 'https://github.com/zhu-hailin/chaoxing-ai-assistant';
    function mountQuizToolbar(doc, ctl) {
        if (doc.getElementById('cx-ai-toolbar')) return;
        const host = doc.createElement('div');
        host.id = 'cx-ai-toolbar';
        host.style.cssText = 'display:block;min-width:0;max-width:100%;margin-left:auto';
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `<style>
          :host{font:14px/1.5 system-ui,sans-serif;color:#415168}
          *{box-sizing:border-box}.buttons{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}
          button{font:inherit;border:0;border-radius:7px;min-height:34px;padding:6px 12px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;max-width:100%}
          #generate{background:#5b80fa;color:white}#settings{background:#edf2ff;color:#355dcc}
          button:disabled{opacity:.65;cursor:wait}button:focus-visible{outline:2px solid #3268df;outline-offset:2px}
          .spinner{width:15px;height:15px;flex:none;border:2px solid #ffffff66;border-top-color:white;border-radius:50%;animation:cx-spin .8s linear infinite}
          .spinner[hidden]{display:none}@keyframes cx-spin{to{transform:rotate(360deg)}}
          @media(prefers-reduced-motion:reduce){.spinner{animation:none}}
          #status{font-size:12px;text-align:right;overflow-wrap:anywhere;max-width:360px;margin-top:4px}
          #status:empty{display:none}
        </style><div class="buttons"><button type="button" id="generate"><span class="spinner" hidden aria-hidden="true"></span><span id="label">一键生成答案</span></button><button type="button" id="settings">学习通AI助手</button></div><div id="status" role="status" aria-live="polite"></div>`;
        const header = resolveQuizHeader(doc);
        if (header) {
            const title = header.querySelector('h3');
            let row = header.querySelector('.cx-ai-title-row');
            if (!row) {
                row = doc.createElement('div');
                row.className = 'cx-ai-title-row';
                row.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;width:100%;box-sizing:border-box';
                title.before(row);
                row.append(title);
                title.style.flex = '1 1 220px';
                title.style.minWidth = '0';
                title.style.overflowWrap = 'anywhere';
            }
            row.append(host);
        } else {
            const first = doc.querySelector(QUESTION_SELECTOR);
            if (!first) return;
            host.style.marginBottom = '16px';
            first.before(host);
        }
        toolbarView = { host, shadow };
        shadow.getElementById('generate').onclick = () => ctl.runAnswerFlow({ autoPrefill: true });
        shadow.getElementById('settings').onclick = () => ctl.togglePanel();
    }

    function createAssistantPanel(doc, ctl) {
        if (doc.getElementById(ROOT_ID)) return;
        const host = doc.createElement('div');
        host.id = ROOT_ID;
        // 题目 iframe 的高度可能覆盖整份测验；bottom 会把面板放到页面底部。
        // 改为水平居中、按标题的 top 定位，直接出现在用户点击的位置附近。
        host.style.cssText = 'position:fixed;left:50%;top:24px;transform:translateX(-50%);z-index:2147483647;max-width:calc(100vw - 26px)';
        const shadow = host.attachShadow({ mode: 'open' });
        /* PANEL_TEMPLATE */
        doc.body.append(host);
        panelView = { host, shadow };
        const el = id => shadow.getElementById(id);
        const setAboutVisible = visible => {
            el('about').hidden = !visible;
            el('about-toggle').setAttribute('aria-expanded', String(visible));
        };
        el('about-toggle').onclick = () => setAboutVisible(el('about').hidden);
        el('about-close').onclick = () => { setAboutVisible(false); el('about-toggle').focus(); };
        el('github').onclick = () => {
            if (/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(PROJECT_GITHUB_URL)) {
                window.open(PROJECT_GITHUB_URL, '_blank', 'noopener,noreferrer');
            } else {
                setAboutVisible(true);
                el('github-note').textContent = 'GitHub 仓库尚未创建，项目暂未发布；当前没有可访问的项目链接。';
            }
        };
        el('panel').setAttribute('role', 'dialog');
        el('panel').setAttribute('aria-label', '学习通AI助手设置与结果');
        const closePanel = () => {
            el('panel').hidden = true;
            toolbarView?.shadow.getElementById('settings').setAttribute('aria-expanded', 'false');
            toolbarView?.shadow.getElementById('settings').focus();
        };
        el('close').onclick = closePanel;
        shadow.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !el('panel').hidden) { event.stopPropagation(); closePanel(); }
        });
        const reposition = () => { if (!el('panel').hidden) positionAssistantPanel(); };
        window.addEventListener('resize', reposition);
        window.addEventListener('scroll', reposition, { passive: true });
        el('save-ds').onclick = () => {
            if (ctl.state.busy) return;
            const key = clean(el('ds-key').value);
            if (!key) return ctl.report('请输入 API Key');
            set(KEY_DS, key);
            el('ds-key').value = '';
            ctl.report('Key 已保存到油猴存储；不会输出到 JSON');
        };
        el('clear-ds').onclick = () => {
            if (ctl.state.busy) return;
            set(KEY_DS, ''); el('ds-key').value = ''; ctl.last = null;
            ctl.report('DeepSeek Key 已清除');
        };
        const savedModel = get(KEY_MODEL, 'deepseek-flash');
        if (![...el('model').options].some(o => o.value === savedModel)) {
            const option = doc.createElement('option'); option.value = savedModel; option.textContent = savedModel; el('model').append(option);
        }
        el('model').value = savedModel;
        el('thinking').checked = Boolean(get(KEY_THINKING, false));
        el('effort').value = get(KEY_EFFORT, 'high');
        if (!el('effort').value) el('effort').value = 'high';
        el('search').checked = Boolean(get(KEY_SEARCH, false));
        for (const [id, key, checkbox] of [['model', KEY_MODEL, false], ['thinking', KEY_THINKING, true], ['effort', KEY_EFFORT, false], ['search', KEY_SEARCH, true]]) {
            el(id).onchange = () => {
                if (ctl.state.busy) return;
                set(key, checkbox ? el(id).checked : el(id).value);
                ctl.last = null;
                renderRunState(ctl.state);
            };
        }
        el('models').onclick = () => ctl.loadModels();
        el('extract').onclick = () => ctl.extractOnly();
        el('solve').onclick = () => ctl.runAnswerFlow({ autoPrefill: false });
        el('prefill').onclick = () => ctl.prefillLast();
        el('copy').onclick = async () => {
            if (!el('output').value) return ctl.report('尚无 JSON');
            try { await navigator.clipboard.writeText(el('output').value); ctl.report('JSON 复制成功'); }
            catch { el('output').focus(); el('output').select(); ctl.report('请按 Ctrl+C 复制'); }
        };
    }

    function positionAssistantPanel() {
        if (!panelView) return;
        const doc = panelView.host.ownerDocument;
        const title = resolveQuizHeader(doc);
        const top = Math.max(12, Math.min(140, title?.getBoundingClientRect().top ?? 24));
        panelView.host.style.top = `${top}px`;
        // 上限固定，避免长 iframe 的 vh 使面板纵向撑到页面下方。
        panelView.shadow.getElementById('panel').style.maxHeight = `min(580px, calc(100vh - ${top + 16}px))`;
    }

    function renderRunState(state) {
        if (toolbarView) {
            const s = toolbarView.shadow;
            s.getElementById('generate').disabled = state.busy;
            s.querySelector('.spinner').hidden = !state.busy;
            s.getElementById('generate').setAttribute('aria-busy', String(state.busy));
            const labels = { decoding: '解密中…', extracting: '提取中…', searching: '检索中…', generating: '生成中…', prefilling: '预填中…' };
            s.getElementById('label').textContent = state.busy ? (labels[state.phase] || '处理中…') : '一键生成答案';
            s.getElementById('status').textContent = state.message;
        }
        if (panelView) {
            const s = panelView.shadow;
            s.getElementById('status').textContent = state.message;
            for (const id of ['extract', 'solve', 'models', 'save-ds', 'clear-ds', 'ds-key', 'model', 'thinking', 'effort', 'search']) s.getElementById(id).disabled = state.busy;
            s.getElementById('effort').disabled = state.busy || !s.getElementById('thinking').checked;
            s.getElementById('prefill').disabled = state.busy || !controller?.last;
        }
    }

    function checkSnapshot(snapshot) {
        if (signature(extract().questions) !== snapshot.signature) throw new Error('题目与分析时不一致，已中止预填，请重新生成');
    }
    async function prefillChecked(snapshot, answers) {
        await ensureFontDecoded();
        checkSnapshot(snapshot);
        if (!answers.some(a => a.answer.length)) throw new Error('没有有效答案可以预填');
        return prefill(snapshot.questions, answers, () => checkSnapshot(snapshot));
    }
    function summaryText(s) {
        return `预填完成：${s.filled} 道已填，${s.already} 道已有相同答案，${s.skipped} 道跳过，${s.unverified} 道需检查。${s.details.length ? '\n' + s.details.slice(0, 5).join('\n') : ''}`;
    }
    async function runAnswerFlow({ autoPrefill = true } = {}) {
        const ctl = controller;
        if (ctl.state.busy) return;
        ctl.last = null;
        ctl.report('正在检查配置…', 'decoding', true);
        try {
            const settings = { key: get(KEY_DS), model: get(KEY_MODEL, 'deepseek-flash'), thinking: Boolean(get(KEY_THINKING, false)), effort: get(KEY_EFFORT, 'high'), search: Boolean(get(KEY_SEARCH, false)) };
            if (!settings.key) { ctl.openPanel(); throw new Error('请先保存 DeepSeek API Key'); }
            ctl.report('正在还原题目字体…', 'decoding');
            await ensureFontDecoded();
            ctl.report('正在提取题目…', 'extracting');
            const data = extract();
            const snapshot = { questions: data.questions, signature: signature(data.questions) };
            ctl.report('正在联网检索…', 'searching');
            const evidence = settings.search ? await getWebEvidence(data.questions, settings.key, settings.model, text => ctl.report(text, 'searching')) : {};
            checkSnapshot(snapshot);
            ctl.report(`正在请求 ${settings.model}…`, 'generating');
            const result = await askDeepSeek(settings.key, settings.model, data.questions, settings.thinking, settings.effort, evidence);
            checkSnapshot(snapshot);
            const payload = { version: '0.7.0', model: settings.model, thinking: settings.thinking, searchEnabled: settings.search, total: result.answers.length, answers: result.answers, ...(settings.search ? { evidence } : {}) };
            ctl.output(payload);
            ctl.last = { ...snapshot, answers: result.answers };
            if (autoPrefill) {
                ctl.report('正在校验并预填…', 'prefilling');
                const summary = await prefillChecked(ctl.last, result.answers);
                ctl.output({ ...payload, prefill: summary });
                ctl.report(summaryText(summary), 'done');
            } else ctl.report(`AI 已分析 ${result.answers.length} 道题，请核对结果后点击预填。`, 'done');
        } catch (error) {
            ctl.last = null;
            ctl.report(`操作中止：${error.message}`, 'error');
        } finally { ctl.state.busy = false; renderRunState(ctl.state); }
    }

    function createController() {
        const ctl = {
            state: { busy: false, phase: 'idle', message: '' }, last: null,
            report(message, phase = ctl.state.phase, busy = ctl.state.busy) {
                Object.assign(ctl.state, { message, phase, busy }); renderRunState(ctl.state);
            },
            openPanel() {
                if (!panelView) return;
                positionAssistantPanel();
                panelView.shadow.getElementById('panel').hidden = false;
                toolbarView?.shadow.getElementById('settings').setAttribute('aria-expanded', 'true');
            },
            togglePanel() {
                if (!panelView) return;
                const panel = panelView.shadow.getElementById('panel');
                if (panel.hidden) ctl.openPanel();
                else {
                    panel.hidden = true;
                    toolbarView?.shadow.getElementById('settings').setAttribute('aria-expanded', 'false');
                }
            },
            output(data) { panelView.shadow.getElementById('output').value = JSON.stringify(data, null, 2); },
            runAnswerFlow,
            async extractOnly() {
                if (ctl.state.busy) return;
                ctl.last = null; ctl.report('正在还原字体并提取…', 'decoding', true);
                try { await ensureFontDecoded(); const data = extract(); ctl.output(data); ctl.report(`已提取 ${data.total} 道题`, 'done'); }
                catch (e) { ctl.report(`提取失败：${e.message}`, 'error'); }
                finally { ctl.state.busy = false; renderRunState(ctl.state); }
            },
            async prefillLast() {
                if (ctl.state.busy || !ctl.last) return;
                ctl.report('正在校验并预填…', 'prefilling', true);
                try { ctl.report(summaryText(await prefillChecked(ctl.last, ctl.last.answers)), 'done'); }
                catch (e) { ctl.last = null; ctl.report(`预填中止：${e.message}`, 'error'); }
                finally { ctl.state.busy = false; renderRunState(ctl.state); }
            },
            async loadModels() {
                if (ctl.state.busy) return;
                const key = get(KEY_DS);
                if (!key) return ctl.report('请先保存 DeepSeek API Key');
                ctl.report('正在获取模型列表…', 'idle', true);
                try {
                    const models = await fetchModels(key);
                    if (!models.length) throw new Error('模型列表没有有效条目');
                    const select = panelView.shadow.getElementById('model');
                    const previous = select.value; select.replaceChildren();
                    for (const m of models) { const o = document.createElement('option'); o.value = m.id; o.textContent = m.name; select.append(o); }
                    select.value = models.some(m => m.id === previous) ? previous : models[0].id;
                    set(KEY_MODEL, select.value); ctl.last = null;
                    ctl.report(`获取成功：${models.length} 个模型`, 'done');
                } catch (e) { ctl.report(`获取模型失败：${e.message}`, 'error'); }
                finally { ctl.state.busy = false; renderRunState(ctl.state); }
            }
        };
        return ctl;
    }

    function initQuizAssistant(doc = document) {
        if (!doc.body || !doc.querySelector(QUESTION_SELECTOR)) return;
        if (!controller) controller = createController();
        createAssistantPanel(doc, controller);
        mountQuizToolbar(doc, controller);
        renderRunState(controller.state);
    }
    function startQuizObserver() {
        let scheduled = false;
        const refresh = () => {
            if (scheduled) return;
            scheduled = true;
            setTimeout(() => {
                scheduled = false;
                initQuizAssistant();
                ensureFontDecoded().catch(error => {
                    if (controller && !controller.state.busy) controller.report(`字体解密失败：${error.message}`, 'error');
                });
            }, 40);
        };
        const observer = new MutationObserver(records => {
            // Shadow DOM 不在观察范围内；只处理页面增加/删除的节点。
            if (records.some(r => [...r.addedNodes, ...r.removedNodes].some(n =>
                n.nodeType === 1 && !n.id?.startsWith('cx-ai-') && n.className !== 'cx-ai-title-row'))) refresh();
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
        refresh();
        window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startQuizObserver, { once: true });
    else startQuizObserver();
