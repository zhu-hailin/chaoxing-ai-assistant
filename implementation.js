    // 字体解密部分源自 wyn665817 的 MIT 脚本；改为文本节点转换和可重入模块。
    function initBackgroundPlayback() {
        if (window.top !== window.self || !isCourseStudyURL(location)) return null;
        if (initBackgroundPlayback.instance) return initBackgroundPlayback.instance;
        let active = null, closed = false;
        const onMouseExit = event => {
            if (closed || event.relatedTarget !== null || !active) return;
            const context = active;
            try {
                if (!context.video.isConnected || context.video.paused || context.video.ended
                    || !context.canProtect()) return;
                event.stopImmediatePropagation();
                event.stopPropagation();
                context.onSuppressed();
            } catch { /* 状态无法确认时不拦截，也不在页面事件中抛错。 */ }
        };
        const manager = {
            installedAt: Date.now(), installedReadyState: document.readyState,
            activate(context) {
                if (closed || !context?.video || typeof context.canProtect !== 'function'
                    || typeof context.onSuppressed !== 'function') return () => {};
                active = context;
                return () => { if (active === context) active = null; };
            },
            close() {
                if (closed) return;
                closed = true; active = null;
                window.removeEventListener('mouseout', onMouseExit, true);
                window.removeEventListener('pagehide', manager.close);
            }
        };
        window.addEventListener('mouseout', onMouseExit, true);
        window.addEventListener('pagehide', manager.close, { once: true });
        initBackgroundPlayback.instance = manager;
        return manager;
    }

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

    function questionId(el, index) {
        return String(el.getAttribute('data-question-id') || el.getAttribute('data-questionid') || el.getAttribute('questionid') || el.getAttribute('data') || el.id || `local-${index + 1}`);
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
    function resolveHomeworkHeader(doc = document) {
        const header = doc.querySelector('.fanyaMarking_left > .detailsHead');
        return header?.querySelector('h2.mark_title') ? header : null;
    }
    function resolveToolbarTarget(doc = document) {
        const homework = resolveHomeworkHeader(doc);
        if (homework) return { kind:'homework', header:homework, title:homework.querySelector('h2.mark_title') };
        const quiz = resolveQuizHeader(doc);
        return quiz ? { kind:'quiz', header:quiz, title:quiz.querySelector('h3') } : { kind:'fallback' };
    }
    function placeQuizToolbar(doc, host, target) {
        host.style.marginBottom = target.kind === 'fallback' ? '16px' : '0';
        if (target.kind === 'fallback') {
            const first = collectRawQuestions(doc)[0]?.binding?.node;
            if (first && first.previousElementSibling !== host) first.before(host);
            return;
        }
        const { header, title } = target;
        let row = header.querySelector(':scope > .cx-ai-title-row');
        if (!row) {
            row = doc.createElement('div'); row.className = 'cx-ai-title-row';
            row.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;width:100%;box-sizing:border-box';
            if (target.kind === 'homework') {
                const style = doc.defaultView.getComputedStyle(title);
                row.style.padding = `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`;
                title.style.padding = '0'; title.style.width = 'auto'; title.style.margin = '0';
            }
            title.before(row); row.append(title);
            title.style.flex = '1 1 220px'; title.style.minWidth = '0'; title.style.overflowWrap = 'anywhere';
        }
        let destination = row;
        if (target.kind === 'homework') {
            destination = row.querySelector('.cx-ai-homework-actions');
            if (!destination) {
                destination = doc.createElement('div'); destination.className = 'cx-ai-homework-actions';
                destination.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:6px;min-width:0;max-width:100%;margin-left:auto';
                row.append(destination);
            }
            const score = header.querySelector('.resultNum');
            if (score && score.parentElement !== destination) {
                score.style.position = 'static'; score.style.top = 'auto'; score.style.right = 'auto'; score.style.margin = '0';
                destination.append(score);
            }
        }
        if (host.parentElement !== destination) {
            if (target.kind === 'homework') destination.prepend(host);
            else destination.append(host);
        }
    }

    let controller;
    let panelView;
    let assistantUiHidden = false, visibilityInitialized = false, visibilityMenusRegistered = false, visibilityListener = null;
    const assistantUiHosts = new Map();
    function initAssistantVisibility() {
        if (visibilityInitialized) return;
        visibilityInitialized = true;
        assistantUiHidden = get(UI_HIDDEN_KEY, false) === true;
        if (window === window.top && !visibilityMenusRegistered && typeof GM_registerMenuCommand === 'function') {
            GM_registerMenuCommand('隐藏助手全部界面', () => setAssistantUiHidden(true));
            GM_registerMenuCommand('显示助手界面', () => setAssistantUiHidden(false));
            visibilityMenusRegistered = true;
        }
        if (typeof GM_addValueChangeListener === 'function') {
            visibilityListener = GM_addValueChangeListener(UI_HIDDEN_KEY, (_key, _old, value) => {
                assistantUiHidden = value === true;
                applyAssistantVisibility();
            });
        }
        applyAssistantVisibility();
    }
    function registerAssistantUiHost(host) {
        initAssistantVisibility();
        if (!assistantUiHosts.has(host)) {
            assistantUiHosts.set(host, { display: null });
            // 可见性与业务状态分离；隐藏宿主上的合成点击也不能重新打开窗口。
            for (const type of ['click', 'pointerdown', 'keydown']) host.addEventListener(type, event => {
                if (assistantUiHidden) { event.preventDefault(); event.stopImmediatePropagation(); }
            }, true);
        }
        applyAssistantVisibility();
        return host;
    }
    function applyAssistantVisibility() {
        if (assistantUiHidden) clearCredentialInput();
        if (assistantUiHidden) {
            panelView?.cancelFloatingDrag?.();
            panelView?.clearStopConfirmation?.();
            panelView?.clearRetryConfirmation?.();
        }
        for (const [host, state] of assistantUiHosts) {
            if (assistantUiHidden) {
                if (state.display === null) state.display = { value: host.style.getPropertyValue('display'), priority: host.style.getPropertyPriority('display') };
                host.style.setProperty('display', 'none', 'important');
            } else if (state.display !== null) {
                if (state.display.value) host.style.setProperty('display', state.display.value, state.display.priority);
                else host.style.removeProperty('display');
                state.display = null;
            }
        }
    }
    function setAssistantUiHidden(hidden) {
        assistantUiHidden = hidden === true;
        set(UI_HIDDEN_KEY, assistantUiHidden);
        applyAssistantVisibility();
        if (!assistantUiHidden) {
            const owner = studyOwnerDocument(document);
            const quiz = owner && findQuizPanel(owner.querySelector('#mainid #iframe')?.contentDocument);
            if (quiz && quiz !== document) quiz.dispatchEvent(new quiz.defaultView.Event('cx-ai-show-quiz-panel'));
            else controller?.openPanel();
        }
    }
    window.addEventListener('pagehide', () => {
        if (visibilityListener !== null && typeof GM_removeValueChangeListener === 'function') GM_removeValueChangeListener(visibilityListener);
        visibilityListener = null; visibilityInitialized = false;
    });
    window.addEventListener('pageshow', () => initAssistantVisibility());
    let toolbarView;
    let studyToolbarView;
    const PANEL_WIDTH = 640;
    function studyOwnerDocument(doc = document) {
        let view = doc?.defaultView;
        try {
            for (let depth = 0; view && depth < 12; depth++) {
                const candidate = view.document;
                const url = new URL(pageURL(candidate));
                if (view === view.top && isCourseStudyURL(url) && candidate.querySelector('#mainid #iframe')) return candidate;
                if (view === view.parent) break;
                view = view.parent;
            }
        } catch { /* 独立或跨域测验保留自身入口。 */ }
        return null;
    }
    const settingsButton = () => studyOwnerDocument()?.getElementById('cx-ai-study-toolbar')?.shadowRoot?.getElementById('settings') || (toolbarView || studyToolbarView)?.shadow.getElementById('settings');

    function findQuizPanel(doc, depth = 0) {
        if (!doc || depth > 12) return null;
        if (hasQuestionNodes(doc) && doc.getElementById(ROOT_ID)) return doc;
        for (const frame of doc.querySelectorAll('iframe')) {
            if (frame.hidden || frame.closest('[hidden]') || doc.defaultView.getComputedStyle(frame).display === 'none') continue;
            try {
                const found = findQuizPanel(frame.contentDocument, depth + 1);
                if (found) return found;
            } catch { /* 不访问跨域子文档。 */ }
        }
        return null;
    }
    const PROJECT_GITHUB_URL = 'https://github.com/zhu-hailin/chaoxing-ai-assistant';
    const QUESTION_TYPE_LABELS = { single: '单选题', multiple: '多选题', judge: '判断题', blank: '填空题', essay: '简答题', unknown: '未识别题型' };

    function readableAnswer(question, entry) {
        if (!entry?.answer?.length) return '暂无有效答案，请人工核对';
        return entry.answer.map(key => {
            if (['blank','essay'].includes(question.type)) return key;
            const option = question.options.find(item => item.key === key);
            if (question.type === 'judge') return option?.text || ({ true: '正确', false: '错误' }[key] || key);
            return option ? `${key}. ${option.text || (option.imageIds?.length ? '图片选项' : '')}` : key;
        }).join('；');
    }

    function validResultSources(data, question) {
        return (data.evidence?.[question.id] || []).filter(item => /^https?:\/\//i.test(item.url || ''));
    }

    function formatResultText(data) {
        if (!data?.questions?.length) return '';
        const answers = new Map((data.questionAnswers || data.answers || []).map(entry => [entry.id, entry]));
        const lines = [`题目列表（共 ${data.questions.length} 题）`];
        const appendImages = ids => {
            for (const id of ids) {
                const image = data.media?.find(item => item.id === id);
                if (!image) continue;
                lines.push(`图片：来自第 ${image.sourceQuestionNumber} 题${image.optionKey ? '，选项 ' + image.optionKey : ''}`);
                const analysis = data.mediaAnalysis?.find(item => item.imageIds.includes(id));
                if (analysis) {
                    if (analysis.summary) lines.push(analysis.summary);
                    if (analysis.columns.length) lines.push(analysis.columns.join(' | '));
                    for (const row of analysis.rows) lines.push(row.join(' | '));
                    for (const item of analysis.items) lines.push(`- ${item}`);
                }
            }
        };
        if (data.analysisProgress) lines.push(analysisProgressText(data.analysisProgress));
        if (data.prefill) lines.push(summaryText(data.prefill));
        for (const question of data.questions) {
            const entry = answers.get(question.id);
            lines.push('', `${question.number}. 【${(question.type === 'unknown' ? question.source?.typeLabel || '未识别题型' : QUESTION_TYPE_LABELS[question.type]) || '题目'}】${question.question.replace(/^【[^】]+】\s*/, '')}`);
            const optionImages = new Set();
            for (const option of question.options) {
                lines.push(`${option.key}. ${option.text}`);
                const ids = questionImageIds(question).filter(id => data.media?.some(image => image.id === id && image.location === 'option' && image.optionKey === option.key && image.sourceQuestionId === question.id));
                ids.forEach(id => optionImages.add(id));appendImages(ids);
            }
            appendImages(questionImageIds(question).filter(id => !optionImages.has(id)));
            const skipped = data.skippedQuestions?.find(item => item.id === question.id);
            if (skipped) lines.push(skipped.reason);
            if (entry && !skipped && question.capabilities?.analyze !== false) {
                lines.push(`答案：${readableAnswer(question, entry)}`);
                if (entry.reason) lines.push(`解析：${entry.reason}`);
            }
            for (const source of validResultSources(data, question)) lines.push(`参考来源：${source.title || source.url} ${source.url}`);
        }
        return lines.join('\n');
    }

    function renderResultList(data) {
        const output = panelView.shadow.getElementById('output');
        const doc = output.ownerDocument;
        const fragment = doc.createDocumentFragment();
        const hasAnswers = Array.isArray(data?.answers) && (data.analyzedCount ?? data.answers.length) > 0;
        output.setAttribute('aria-label', hasAnswers ? '题目与答案列表' : '题目列表');
        const node = (tag, className, text) => {
            const element = doc.createElement(tag);
            element.className = className;
            if (text !== undefined) element.textContent = text;
            return element;
        };
        const renderImages = (question, ids) => {
            const images = node('ul', 'media-list');
            for (const id of ids) {
                const descriptor = data.media?.find(item => item.id === id);
                if (!descriptor) continue;
                const item = node('li', 'media-item');
                item.dataset.imageId = id;
                item.append(node('p', 'media-caption', `${question.contextImageIds?.includes(id) ? '共用材料 · ' : ''}来自第 ${descriptor.sourceQuestionNumber} 题${descriptor.optionKey ? ' · 选项 ' + descriptor.optionKey : ' · 题干图片'}`));
                if (mediaAddressAllowed(descriptor.src, panelView.sourceDoc)) {
                    const image = node('img', 'question-image');
                    image.alt = descriptor.alt || `第 ${descriptor.sourceQuestionNumber} 题${descriptor.optionKey ? '选项 ' + descriptor.optionKey : ''}图片`;
                    image.loading = 'lazy'; image.src = descriptor.src;
                    image.addEventListener('error', () => image.replaceWith(node('p','note','图片预览加载失败，分析时将重新读取并校验')), { once:true });
                    item.append(image);
                } else item.append(node('p','note','图片地址缺失或暂不支持'));
                const analysis = data.mediaAnalysis?.find(entry => entry.imageIds.includes(id));
                if (analysis) {
                    if (analysis.summary) item.append(node('p','image-summary',analysis.summary));
                    if (analysis.columns.length && analysis.rows.length) {
                        const wrap = node('div','image-table-wrap'), table = node('table','image-table'), heading = node('tr','');
                        for (const text of analysis.columns) heading.append(node('th','',text));
                        const thead = node('thead',''); thead.append(heading); table.append(thead);
                        const tbody = node('tbody','');
                        for (const values of analysis.rows) { const tr = node('tr',''); for (const text of values) tr.append(node('td','',text)); tbody.append(tr); }
                        table.append(tbody); wrap.append(table); item.append(wrap);
                    }
                    if (analysis.items.length) { const list = node('ul','image-details'); for (const text of analysis.items) list.append(node('li','',text)); item.append(list); }
                }
                images.append(item);
            }
            return images.childElementCount ? images : null;
        };
        if (!data?.questions?.length) {
            fragment.append(node('p', 'result-empty', '提取后将在这里显示题目列表'));
        } else {
            const answers = new Map((data.questionAnswers || data.answers || []).map(entry => [entry.id, entry]));
            fragment.append(node('p', 'result-summary', `${hasAnswers ? '题目与答案' : '题目列表'} · 共 ${data.questions.length} 题${data.responseUnitCount && data.responseUnitCount!==data.questions.length ? ` · ${data.responseUnitCount} 个作答区域` : ''}${data.analysisProgress ? ' · ' + analysisProgressText(data.analysisProgress) : hasAnswers ? ' · AI 分析完成' : ''}${data.prefill ? ' · ' + summaryText(data.prefill) : ''}${data.manualCount || data.uncertainCount ? ` · ${data.manualCount || 0} 题需人工处理，${data.uncertainCount || 0} 题需人工确认` : ''}`));
            const list = node('ol', 'question-list');
            for (const question of data.questions) {
                const entry = answers.get(question.id);
                const card = node('li', 'question-card');
                card.dataset.questionId = question.id;
                const heading = node('div', 'question-heading');
                heading.append(node('span', 'question-number', `第 ${question.number} 题`), node('span', 'question-type', (question.type === 'unknown' ? question.source?.typeLabel || '未识别题型' : QUESTION_TYPE_LABELS[question.type]) || '题目'));
                card.append(heading, node('p', 'question-text', question.question.replace(/^【[^】]+】\s*/, '')));
                const policy=entry?.answerPolicy || data.answerPolicies?.[question.id] || question.answerPolicy;
                if(policy)card.append(node('p','note answer-policy',policy.status==='auto'?'可一键答题':
                    `${policy.status==='manual'?'需人工处理':policy.status==='needs-classification'?'待判断作答要求':'需人工确认'}：${policy.reason || '请核对作答要求'}`));
                if (question.diagnostics?.length) card.append(node('p', 'note', question.diagnostics.join('；')));
                const skipped = data.skippedQuestions?.find(item => item.id === question.id);
                if (skipped) card.append(node('p', 'note', skipped.reason));
                const optionImages = new Set();
                if (question.options.length) {
                    const options = node('ul', 'option-list');
                    for (const option of question.options) {
                        const item = node('li', `option-item${entry?.answer.includes(option.key) ? ' is-answer' : ''}`);
                        item.dataset.optionKey = option.key;
                        const content = node('div', 'option-content');content.append(node('span', 'option-text', option.text));
                        const ids = questionImageIds(question).filter(id => data.media?.some(image => image.id === id && image.location === 'option' && image.optionKey === option.key && image.sourceQuestionId === question.id));
                        ids.forEach(id => optionImages.add(id));
                        const images = renderImages(question, ids);if(images) content.append(images);
                        item.append(node('span', 'option-key', question.type === 'judge' ? '·' : option.key), content);
                        options.append(item);
                    }
                    card.append(options);
                }
                const images = renderImages(question, questionImageIds(question).filter(id => !optionImages.has(id)));
                if (images) card.append(images);
                if (entry && !skipped && question.capabilities?.analyze !== false) {
                    card.append(node('p', `ai-answer${entry.answer.length ? '' : ' needs-review'}`, readableAnswer(question, entry)));
                    if (entry.reason) card.append(node('p', 'answer-reason', `解析：${entry.reason}`));
                }
                const sources = node('div', 'answer-sources');
                for (const source of validResultSources(data, question)) {
                    const link = node('a', '', source.title || '参考来源');
                    link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
                    sources.append(link);
                }
                if (sources.childElementCount) card.append(sources);
                list.append(card);
            }
            fragment.append(list);
        }
        // 题干、选项、AI 解析均作为文本插入，避免把模型或页面内容解释成 HTML。
        output.replaceChildren(fragment);
        output.scrollTop = 0;
    }

    function mountQuizToolbar(doc, ctl) {
        const existing = doc.getElementById('cx-ai-toolbar') || (toolbarView?.host.ownerDocument === doc ? toolbarView.host : null);
        if (existing) { placeQuizToolbar(doc, existing, resolveToolbarTarget(doc)); return; }
        const host = doc.createElement('div');
        host.id = 'cx-ai-toolbar';
        host.style.cssText = 'display:block;min-width:0;max-width:100%;margin-left:auto';
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `<style>
          :host{font:14px/1.5 system-ui,sans-serif;color:#415168}
          *{box-sizing:border-box}.buttons{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}
          button{font:inherit;border:0;border-radius:7px;min-height:34px;padding:6px 12px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;max-width:100%}
          #generate{background:#5b80fa;color:white}#settings{background:#edf2ff;color:#355dcc}
          button[hidden]{display:none}button:disabled{opacity:.65;cursor:wait}button:focus-visible{outline:2px solid #3268df;outline-offset:2px}
          .spinner{width:15px;height:15px;flex:none;border:2px solid #ffffff66;border-top-color:white;border-radius:50%;animation:cx-spin .8s linear infinite}
          .spinner[hidden]{display:none}@keyframes cx-spin{to{transform:rotate(360deg)}}
          @media(prefers-reduced-motion:reduce){.spinner{animation:none}}
          #status{font-size:12px;text-align:right;overflow-wrap:anywhere;max-width:360px;margin-top:4px}
          #status:empty{display:none}
        </style><div class="buttons"><button type="button" id="generate"><span class="spinner" hidden aria-hidden="true"></span><span id="label">一键生成答案</span></button><button type="button" id="settings">学习通AI助手</button></div><div id="status" role="status" aria-live="polite"></div>`;
        registerAssistantUiHost(host);
        placeQuizToolbar(doc, host, resolveToolbarTarget(doc));
        toolbarView = { host, shadow };
        shadow.getElementById('generate').onclick = event => { if (trustedAssistantActivation(event, shadow.getElementById('generate'))) ctl.runAnswerFlow({ autoPrefill: true }); };
        shadow.getElementById('settings').hidden = Boolean(studyOwnerDocument(doc));
        shadow.getElementById('settings').onclick = () => ctl.togglePanel();
    }

    function switchPanelView(view, { focus = false } = {}) {
        if (!panelView || !['model','questions','chapters','other'].includes(view)) return;
        const { shadow } = panelView;
        for (const button of shadow.querySelectorAll('[data-panel-view]')) {
            const selected = button.dataset.panelView === view;
            button.setAttribute('aria-selected', String(selected));
            button.tabIndex = selected ? 0 : -1;
            shadow.getElementById(button.getAttribute('aria-controls')).hidden = !selected;
        }
        shadow.getElementById('course-nav').hidden = view !== 'chapters';
        shadow.getElementById('panel').dataset.activeView = view;
        shadow.getElementById('about').hidden = true;
        shadow.getElementById('about-toggle').setAttribute('aria-expanded','false');
        panelView.activeView = view;
        if (view === 'chapters') refreshCourseSidebar();
        if (focus) shadow.getElementById(`nav-${view}`).focus();
    }
    function switchChapterView(view, { focus = false } = {}) {
        if (!panelView || !['run','catalog'].includes(view)) return;
        const { shadow } = panelView;
        for (const button of shadow.querySelectorAll('[data-chapter-view]')) {
            const selected = button.dataset.chapterView === view;
            button.setAttribute('aria-selected',String(selected));
            button.tabIndex = selected ? 0 : -1;
            shadow.getElementById(button.getAttribute('aria-controls')).hidden = !selected;
        }
        shadow.getElementById('catalog-refresh').hidden = view !== 'catalog';
        shadow.getElementById('course-nav').dataset.activeView = view;
        // 只改变显示与目录读取，不启动/停止 runner，不重置搜索、报告或配置。
        if (view === 'catalog') refreshCourseSidebar();
        if (focus) shadow.getElementById(`chapter-tab-${view}`).focus();
    }
    function switchSettingsView(view, { focus = false } = {}) {
        if (!panelView || !['model','learning','developer'].includes(view)) return;
        const { shadow } = panelView;
        for (const button of shadow.querySelectorAll('[data-settings-view]')) {
            const selected = button.dataset.settingsView === view;
            button.setAttribute('aria-selected',String(selected));
            button.tabIndex = selected ? 0 : -1;
            shadow.getElementById(button.getAttribute('aria-controls')).hidden = !selected;
        }
        shadow.getElementById('view-model').dataset.activeSettingsView = view;
        if (focus) shadow.getElementById(`settings-tab-${view}`).focus();
    }
    function initPanelNavigation() {
        const buttons = [...panelView.shadow.querySelectorAll('[data-panel-view]')];
        const activate=(view,options={})=>{
            const owner=studyOwnerDocument(panelView.sourceDoc);
            if(view==='chapters' && owner && owner!==panelView.sourceDoc && owner.getElementById('cx-ai-study-toolbar')) {
                owner.dispatchEvent(new owner.defaultView.Event('cx-ai-show-study-panel'));
                return;
            }
            switchPanelView(view,options);
        };

        buttons.forEach((button, index) => {
            button.onclick = () => activate(button.dataset.panelView);
            button.addEventListener('keydown', event => {
                let next;
                if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
                else if (event.key === 'ArrowUp') next = (index + buttons.length - 1) % buttons.length;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = buttons.length - 1;
                else return;
                event.preventDefault(); event.stopPropagation();
                activate(buttons[next].dataset.panelView, {focus:true});
            });
        });
        const chapterButtons = [...panelView.shadow.querySelectorAll('[data-chapter-view]')];
        chapterButtons.forEach((button,index) => {
            button.onclick = () => switchChapterView(button.dataset.chapterView);
            button.addEventListener('keydown',event => {
                let next;
                if(event.key==='ArrowRight') next=(index+1)%chapterButtons.length;
                else if(event.key==='ArrowLeft') next=(index+chapterButtons.length-1)%chapterButtons.length;
                else if(event.key==='Home') next=0;
                else if(event.key==='End') next=chapterButtons.length-1;
                else return;
                event.preventDefault();event.stopPropagation();
                switchChapterView(chapterButtons[next].dataset.chapterView,{focus:true});
            });
        });
        const settingsButtons = [...panelView.shadow.querySelectorAll('[data-settings-view]')];
        settingsButtons.forEach((button,index) => {
            button.onclick = () => switchSettingsView(button.dataset.settingsView);
            button.addEventListener('keydown',event => {
                let next;
                if(event.key==='ArrowRight') next=(index+1)%settingsButtons.length;
                else if(event.key==='ArrowLeft') next=(index+settingsButtons.length-1)%settingsButtons.length;
                else if(event.key==='Home') next=0;
                else if(event.key==='End') next=settingsButtons.length-1;
                else return;
                event.preventDefault();event.stopPropagation();
                switchSettingsView(settingsButtons[next].dataset.settingsView,{focus:true});
            });
        });
        switchSettingsView('model');
        switchChapterView('run');
        switchPanelView('questions');
    }
    const chapterContextCache = new WeakMap();
    function chapterContextIdentity(doc) {
        const owner=studyOwnerDocument(doc),chapterId=owner?.querySelector('#curChapterId')?.value;
        const scope=owner && courseScoreKey(owner);
        return owner && scope && chapterId ? {owner,chapterId:String(chapterId),id:`${scope}:${chapterId}`} : null;
    }
    function chapterContextStore(doc) {
        const identity=chapterContextIdentity(doc);if(!identity)return null;
        let store=chapterContextCache.get(identity.owner);
        if(store?.chapterId!==identity.id){store=createCourseContext(identity.id);chapterContextCache.set(identity.owner,store);}
        return {identity,store};
    }
    function captureCurrentCourseContext(doc, options={}) {
        const currentIdentity=chapterContextIdentity(doc);
        if(!currentIdentity || options.expectedIdentity && options.expectedIdentity!==currentIdentity.id)return [];
        const documents=courseFrameTree(currentIdentity.owner).documents;
        if(options.video && (!options.video.isConnected || !documents.includes(options.video.ownerDocument)))return [];
        if(options.reader && (!options.reader.node?.isConnected || !documents.includes(options.reader.doc)))return [];
        const record=chapterContextStore(doc);if(!record)return [];
        const {identity,store}=record;
        const append=values=>mergeCourseContext(store,identity.id,collectCourseContext({chapterId:identity.id,...values}));
        if(options.video)append({video:options.video});
        if(options.reader)append({reader:options.reader});
        if(!options.video && !options.reader)for(const current of documents) {
            for(const video of current.querySelectorAll('video'))append({video});
            const reader=courseDocumentReader(current);if(reader)append({reader});
        }
        // 仅采集带明确章节身份的资料区域，不扫描答案区或任意页面正文。
        const notesRoots=documents.flatMap(current=>[...current.querySelectorAll('[data-course-notes][data-chapter-id]')])
            .filter(root=>root.getAttribute('data-chapter-id')===identity.chapterId);
        if(notesRoots.length)append({notesRoots});
        return courseContextForPrompt(store,identity.id);
    }
    function readModelConfiguration() {
        const cfg=readProviderConfiguration();
        return {...cfg,videoInfoEnabled:get(KEY_AUTO_CONTEXT,true)!==false};
    }
    function refreshModelCapabilities(shadow, busy = false) {
        const cfg = readModelConfiguration();
        const caps = providerModelCapabilities(cfg.provider, cfg.model);
        shadow.getElementById('thinking').checked = cfg.thinking;
        shadow.getElementById('thinking').disabled = busy || !caps.thinking || caps.thinkingRequired;
        shadow.getElementById('effort').disabled = busy || !caps.effort || !cfg.thinking;
        shadow.getElementById('search').checked = cfg.search;
        shadow.getElementById('search').disabled = busy || !caps.search;
        const tested=cfg.provider==='custom' ? typeof verifiedModelImages==='function' && verifiedModelImages(cfg.provider,cfg.model,cfg.baseURL) : caps.imageEvidence==='image-test';
        const label = tested ? '视觉（已通过图片识别测试）' : cfg.provider === 'custom' ? (cfg.images ? '视觉（自定义声明）' : '文本（自定义声明）')
            : caps.known ? (cfg.images ? '视觉：可分析题干和选项中的图片' : '文本：图片题将保留待核对') : '图片能力未确认：图片题将保留待核对';
        shadow.getElementById('auto-context').checked = cfg.videoInfoEnabled;
        shadow.getElementById('info-model').disabled = busy || !cfg.videoInfoEnabled || cfg.provider === 'custom';
        shadow.getElementById('info-interval').disabled = busy || !cfg.videoInfoEnabled;
        shadow.getElementById('model-capability').textContent = label + (caps.thinkingRequired ? '；此模型始终开启深度思考。' : '。');
        refreshBrandedModelPickers(shadow);
    }
    function renderModelSettings(ctl, fetchedModels) {
        if (!panelView) return;
        const shadow = panelView.shadow;let cfg = readModelConfiguration();
        refreshCredentialEditor(cfg);
        if(fetchedModels){rememberProviderModelList(cfg,fetchedModels);cfg=readModelConfiguration();}
        const provider = getModelProvider(cfg.provider);
        const el = id => shadow.getElementById(id), doc = panelView.host.ownerDocument;
        el('provider').value = cfg.provider;
        el('api-key-status').textContent = cfg.credentialNeedsApproval ? '自定义接口地址尚未授权，请重新输入并保存 API Key' : cfg.key ? `${provider.name} Key 已保存` : `${provider.name} 尚未配置 API Key`;
        el('preset-model-block').hidden = cfg.provider === 'custom';
        el('custom-model-block').hidden = cfg.provider !== 'custom';
        el('custom-base').value = readProviderSetting('custom', 'baseURL', '');
        el('custom-model').value = readProviderSetting('custom', 'model', '');
        el('custom-images').checked = Boolean(readProviderSetting('custom', 'images', false));
        const available=currentProviderModelList(cfg),models=available || [];
        el('model').replaceChildren();
        const placeholder=doc.createElement('option');placeholder.value=available?'':cfg.model;placeholder.disabled=true;
        placeholder.textContent=available?'请选择模型':cfg.model?modelOptionLabel(cfg.provider,cfg.model)+'（已保存，待获取列表校验）':'请先获取模型列表';
        el('model').append(placeholder);
        for (const model of models) {
            const option = doc.createElement('option'); option.value = model.id;
            option.textContent = modelOptionLabel(cfg.provider, model.id, model.name); el('model').append(option);
        }
        el('model').value = cfg.model;
        const visionModels = cfg.provider==='custom' || !available ? (cfg.images && cfg.model ? [{id:cfg.model,name:cfg.model}] : []) : models.filter(item=>providerModelCapabilities(cfg.provider,item.id).images);
        el('info-model').replaceChildren();
        for (const model of visionModels) { const option=doc.createElement('option');option.value=model.id;option.textContent=model.name;el('info-model').append(option); }
        if (!visionModels.length) { const option=doc.createElement('option');option.value='';option.textContent='当前接口未确认图片能力';el('info-model').append(option); }
        el('info-model').value=cfg.infoModel;
        el('info-interval').value=cfg.videoInfoIntervalSeconds;
        el('effort').value = cfg.effort;
        refreshModelCapabilities(shadow, ctl.state.busy || courseRunActive());
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
        registerAssistantUiHost(host);
        doc.body.append(host);
        panelView = { host, shadow, sourceDoc: doc, userPosition: null, windowMode: 'closed', floatingPosition: null };
        initAssistantWindowCoordination(doc);
        initPanelDragging();
        initPanelResizing();
        initFloatingLauncher(ctl);
        const toggleFromStudy = () => ctl.togglePanel();
        const showFromStudy = () => ctl.openPanel();
        doc.addEventListener('cx-ai-toggle-quiz-panel', toggleFromStudy);
        doc.addEventListener('cx-ai-show-quiz-panel', showFromStudy);
        window.addEventListener('pagehide', () => {
            doc.removeEventListener('cx-ai-toggle-quiz-panel', toggleFromStudy);
            doc.removeEventListener('cx-ai-show-quiz-panel', showFromStudy);
        }, { once: true });
        initCourseSidebar();
        initPanelNavigation();
        initOtherFeatureControls(shadow,doc);
        initCourseRunControls(doc, ctl);
        const el = id => shadow.getElementById(id);
        el('copy-error-report').onclick = async () => {
            try {await navigator.clipboard.writeText(exportCxDiagnostics());ctl.report('错误安全报告已复制');}
            catch {ctl.report('无法访问剪贴板，请检查浏览器复制权限');}
        };
        initAssistantUpdates(shadow);
        initCredentialEditor(el('api-key-editor'));
        el('model-setup-open').onclick = () => {
            switchSettingsView('model');
            switchPanelView('model');
            el('provider-picker').focus();
        };
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
        el('panel').setAttribute('aria-label', '学习通AI助手');
        const closePanel = () => {
            setAssistantWindowMode('closed');
            settingsButton()?.focus();
        };
        el('minimize').onclick = () => {
            if (el('panel').hidden) return;
            setAssistantWindowMode('minimized');
            el('floating-launcher').focus();
        };
        el('close').onclick = closePanel;
        shadow.addEventListener('keydown', event => {
            if (event.key === 'Escape' && panelView.windowMode !== 'closed') { event.stopPropagation(); closePanel(); }
        });
        const reposition = repositionAssistantWindow;
        window.addEventListener('resize', reposition);
        window.addEventListener('scroll', reposition, { passive: true });
        window.addEventListener('pagehide', () => {
            window.removeEventListener('resize', reposition);
            window.removeEventListener('scroll', reposition);
            panelView.cancelFloatingDrag?.();
            for (const [owner, listener] of panelView.windowListeners) owner.removeEventListener('cx-ai-assistant-window-activate', listener);
            panelView.windowListeners.clear();
        }, {once:true});
        const changedModelSettings = () => {
            invalidateAnalysisTask('分析配置已变化，请重新分析');
            ctl.last = null; renderRunState(ctl.state);
        };
        el('provider').onchange = () => {
            if (ctl.state.busy || courseRunActive()) return;
            set(KEY_PROVIDER, getModelProvider(el('provider').value).id);
            renderModelSettings(ctl); changedModelSettings();
        };
        el('save-custom').onclick = event => {
            if (!trustedAssistantActivation(event, el('save-custom'))) return;
            if (ctl.state.busy || courseRunActive() || readModelConfiguration().provider !== 'custom') return;
            try {
                const baseURL = normalizeModelBaseURL(el('custom-base').value), model = clean(el('custom-model').value);
                if (!model || model.length > 200) throw new Error('请输入有效模型 ID');
                saveProviderSetting('baseURL', baseURL, 'custom'); saveProviderSetting('model', model, 'custom');
                saveProviderSetting('images', el('custom-images').checked, 'custom');
                renderModelSettings(ctl); changedModelSettings(); ctl.report('自定义接口已保存');
            } catch (error) { ctl.report(error.message, 'error'); }
        };
        for (const [id, checkbox] of [['model', false], ['thinking', true], ['effort', false], ['search', true]]) {
            el(id).onchange = () => {
                if (ctl.state.busy || courseRunActive()) return;
                saveProviderSetting(id, checkbox ? el(id).checked : el(id).value);
                refreshModelCapabilities(shadow); changedModelSettings();
            };
        }
        el('auto-context').onchange = () => {
            if (ctl.state.busy || courseRunActive()) return;
            set(KEY_AUTO_CONTEXT,el('auto-context').checked); changedModelSettings();
        };
        for (const [id,field] of [['info-model','infoModel'],['info-interval','videoInfoIntervalSeconds']]) el(id).onchange=()=>{
            if (ctl.state.busy || courseRunActive()) return;
            try {saveProviderSetting(field,el(id).value);changedModelSettings();}
            catch(error){renderModelSettings(ctl);ctl.report(error.message,'error');}
        };
        renderModelSettings(ctl);
        el('detect-images').onclick=async event=>{
            if (!trustedAssistantActivation(event, el('detect-images'))) return;
            if(ctl.state.busy || courseRunActive())return;
            const cfg=readModelConfiguration();
            if(!cfg.configured)return ctl.report('请先保存当前平台的 Key、接口与模型','error');
            const caps=providerModelCapabilities(cfg.provider,cfg.model);

            const abort=new AbortController();ctl.capabilityTest=abort;
            const cancel=()=>abort.abort();window.addEventListener('pagehide',cancel,{once:true});
            ctl.report('正在测试当前模型的图片识别能力…','capability-check',true);
            try {
                const result=await detectModelImageCapability(cfg,{signal:abort.signal,guard:()=>{
                    const current=readModelConfiguration();
                    if(abort.signal.aborted || !host.isConnected || current.provider!==cfg.provider || current.model!==cfg.model || current.baseURL!==cfg.baseURL || current.key!==cfg.key)throw new Error('图片能力检测已取消');
                }});
                if(abort.signal.aborted)return;
                if(result.images===true){renderModelSettings(ctl);invalidateAnalysisTask('模型图片能力已更新，请重新分析');ctl.last=null;ctl.report('当前模型已通过图片识别测试','capability-check',true);}
                else ctl.report(result.reason || '图片能力尚未确认，请稍后重试','capability-check',true);
            } catch {if(!abort.signal.aborted)ctl.report('图片能力尚未确认，请检查接口与模型','error',true);}
            finally {
                window.removeEventListener('pagehide',cancel);if(ctl.capabilityTest===abort){ctl.capabilityTest=null;ctl.state.busy=false;renderRunState(ctl.state);}
                if(abort.signal.aborted)ctl.report('图片能力检测已取消','idle');
            }
        };
        el('cancel-images').onclick=event=>{ if (trustedAssistantActivation(event, el('cancel-images'))) ctl.capabilityTest?.abort(); };
        el('detect-model').onclick = event => { if (trustedAssistantActivation(event, el('detect-model'))) ctl.testModelConnection(); };
        el('cancel-model-test').onclick = event => { if (trustedAssistantActivation(event, el('cancel-model-test'))) ctl.connectionTest?.abort(); };
        el('models').onclick = event => { if (trustedAssistantActivation(event, el('models'))) ctl.loadModels(); };
        el('extract').onclick = () => ctl.extractOnly();
        el('solve').onclick = event => { if (trustedAssistantActivation(event, el('solve'))) ctl.runAnswerFlow({ autoPrefill: false }); };
        el('prefill').onclick = event => { if (trustedAssistantActivation(event, el('prefill'))) ctl.prefillLast(); };
        el('analysis-stop').onclick = event => { if (trustedAssistantActivation(event, el('analysis-stop'))) stopAnalysisTask(); };
        el('analysis-resume').onclick = event => { if (trustedAssistantActivation(event, el('analysis-resume'))) resumeAnalysisTask(); };
        el('copy').onclick = async () => {
            const text = formatResultText(ctl.result);
            if (!text) return ctl.report('尚无题目列表');
            try { await navigator.clipboard.writeText(text); ctl.report('列表复制成功'); }
            catch {
                el('output').focus();
                const range = doc.createRange(); range.selectNodeContents(el('output'));
                const selection = typeof shadow.getSelection === 'function' ? shadow.getSelection() : doc.getSelection();
                selection?.removeAllRanges(); selection?.addRange(range);
                ctl.report('请选中列表并按 Ctrl+C 复制');
            }
        };
    }

    function movePanelToStudyPage() {
        if (!panelView) return;
        const source = panelView.sourceDoc;
        const owner = studyOwnerDocument(source);
        if (!owner || owner === source || panelView.host.ownerDocument === owner) return;
        // 原文档保留入口标记和控制器；只移动显示容器，不复制题目或设置。
        const marker = source.createElement('div');
        marker.id = ROOT_ID; marker.hidden = true;
        panelView.host.before(marker);
        panelView.host.id = 'cx-ai-quiz-panel';
        owner.body.append(panelView.host);
        initAssistantWindowCoordination(owner);
        const reposition = repositionAssistantWindow;
        owner.defaultView.addEventListener('resize', reposition);
        owner.defaultView.addEventListener('scroll', reposition, { passive: true });
        window.addEventListener('pagehide', () => {
            owner.defaultView.removeEventListener('resize', reposition);
            owner.defaultView.removeEventListener('scroll', reposition);
            panelView.cancelFloatingDrag?.();
            panelView.host.remove();
        }, { once: true });
    }

    function initAssistantWindowCoordination(doc) {
        if (!panelView) return;
        panelView.windowListeners ??= new Map();
        if (panelView.windowListeners.has(doc)) return;
        const listener = event => {
            const activeHost = event.detail?.host;
            if (panelView.host.ownerDocument !== doc || !activeHost || activeHost === panelView.host || activeHost.ownerDocument !== doc) return;
            // 顶层课程与嵌套测验各自保留任务和内容，只互斥可见窗口。
            setAssistantWindowMode('closed');
        };
        panelView.windowListeners.set(doc, listener);
        doc.addEventListener('cx-ai-assistant-window-activate', listener);
    }

    function setAssistantWindowMode(mode) {
        if (!panelView || !['open','minimized','closed'].includes(mode)) return;
        if (assistantUiHidden) return;
        if(mode!=='open')panelView.clearRetryConfirmation?.();
        if(mode==='closed')clearCredentialInput();
        panelView.cancelFloatingDrag?.();
        const {host} = panelView;
        if (mode === 'minimized' && panelView.windowMode !== 'minimized') {
            if(panelView.launcherRestorePosition)panelView.floatingPosition={...panelView.launcherRestorePosition};
            else {
                // 隐藏面板和重置 host 原点前，记录缩小按钮在所属视口中的中心。
                // 首次缩小使用按钮位置；展开过悬浮球后只使用保存的展开前位置。
                const buttonRect = panelView.shadow.getElementById('minimize').getBoundingClientRect();
                const launcherRect = panelView.shadow.getElementById('floating-launcher').getBoundingClientRect();
                const width = launcherRect.width || 44, height = launcherRect.height || 44;
                if ([buttonRect.left, buttonRect.top, buttonRect.width, buttonRect.height].every(Number.isFinite) && buttonRect.width > 0 && buttonRect.height > 0) {
                    panelView.floatingPosition = {left:buttonRect.left + (buttonRect.width - width) / 2, top:buttonRect.top + (buttonRect.height - height) / 2};
                } else {
                    const panelRect = panelView.shadow.getElementById('panel').getBoundingClientRect();
                    panelView.floatingPosition = [panelRect.left, panelRect.top, panelRect.width, panelRect.height].every(Number.isFinite) && panelRect.width > 0 && panelRect.height > 0
                        ? {left:panelRect.left + panelRect.width - width, top:panelRect.top} : null;
                }
            }
            panelView.windowPlacement = {left:host.style.left, top:host.style.top, transform:host.style.transform};
            // transform 会成为 fixed 子元素的包含块；悬浮入口以真实视口为坐标原点。
            host.style.left = '0px'; host.style.top = '0px'; host.style.transform = 'none';
        } else if (mode !== 'minimized' && panelView.windowMode === 'minimized' && panelView.windowPlacement) {
            Object.assign(host.style, panelView.windowPlacement);
            panelView.windowPlacement = null;
        }
        panelView.windowMode = mode;
        panelView.shadow.getElementById('panel').hidden = mode !== 'open';
        const launcher = panelView.shadow.getElementById('floating-launcher');
        launcher.hidden = mode !== 'minimized';
        launcher.setAttribute('aria-expanded', String(mode === 'open'));
        settingsButton()?.setAttribute('aria-expanded', String(mode === 'open'));
        if (mode === 'minimized') positionFloatingLauncher();
        if (mode !== 'closed') {
            const owner = host.ownerDocument;
            owner.dispatchEvent(new owner.defaultView.CustomEvent('cx-ai-assistant-window-activate', {detail:{host}}));
        }
    }

    function repositionAssistantWindow() {
        if (!panelView) return;
        if (panelView.windowMode === 'minimized') positionFloatingLauncher();
        else if (!panelView.shadow.getElementById('panel').hidden) positionAssistantPanel();
    }

    function positionFloatingLauncher(position = panelView?.floatingPosition) {
        if (!panelView) return;
        const launcher = panelView.shadow.getElementById('floating-launcher');
        const view = panelView.host.ownerDocument.defaultView;
        const width = launcher.getBoundingClientRect().width || 44;
        const height = launcher.getBoundingClientRect().height || 44;
        const left = Math.max(0, Math.min(position?.left ?? view.innerWidth - width - 20, Math.max(0, view.innerWidth - width)));
        const top = Math.max(0, Math.min(position?.top ?? view.innerHeight - height - 24, Math.max(0, view.innerHeight - height)));
        panelView.floatingPosition = {left, top};
        launcher.style.left = `${left}px`; launcher.style.top = `${top}px`;
        return panelView.floatingPosition;
    }

    function initFloatingLauncher(ctl) {
        const launcher = panelView.shadow.getElementById('floating-launcher');
        let drag = null, suppressClick = false;
        const finish = event => {
            if (!drag || event.pointerId !== drag.id) return;
            suppressClick = drag.moved;
            const id = drag.id;
            drag = null;
            try { if (launcher.hasPointerCapture?.(id)) launcher.releasePointerCapture(id); } catch { /* 页面变更时捕获可能已经释放。 */ }
        };
        panelView.cancelFloatingDrag = () => {
            if (drag) finish({pointerId:drag.id});
            suppressClick = false;
        };
        launcher.addEventListener('pointerdown', event => {
            if (event.button !== 0 || panelView.windowMode !== 'minimized') return;
            // 新的一次点击可以正常恢复，不继承上次拖动的点击抑制。
            suppressClick = false;
            const point = positionFloatingLauncher();
            drag = {id:event.pointerId, x:event.clientX, y:event.clientY, ...point, moved:false};
            try { launcher.setPointerCapture(event.pointerId); } catch { /* 旧浏览器继续使用按钮事件。 */ }
        });
        launcher.addEventListener('pointermove', event => {
            if (!drag || event.pointerId !== drag.id) return;
            const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
            if (!drag.moved && Math.hypot(dx, dy) < 4) return;
            drag.moved = true;
            positionFloatingLauncher({left:drag.left + dx, top:drag.top + dy});
            event.preventDefault();
        });
        launcher.addEventListener('pointerup', finish);
        launcher.addEventListener('pointercancel', finish);
        launcher.addEventListener('lostpointercapture', finish);
        launcher.addEventListener('click', event => {
            if (suppressClick && event.detail !== 0) { suppressClick = false; event.preventDefault(); return; }
            suppressClick = false;
            if (panelView.windowMode !== 'minimized') return;
            panelView.launcherRestorePosition={...positionFloatingLauncher()};
            ctl.openPanel();
            if(event.detail>0 && Number.isFinite(event.clientX) && Number.isFinite(event.clientY))
                panelView.userPosition=setPanelPosition(event.clientX,event.clientY);
            panelView.shadow.getElementById('minimize').focus();
        });
        launcher.addEventListener('keydown', event => {
            const delta = {ArrowLeft:[-10,0],ArrowRight:[10,0],ArrowUp:[0,-10],ArrowDown:[0,10]}[event.key];
            if (!delta || panelView.windowMode !== 'minimized') return;
            event.preventDefault();event.stopPropagation();
            const point = positionFloatingLauncher();
            positionFloatingLauncher({left:point.left + delta[0], top:point.top + delta[1]});
        });
    }

    function updatePanelHeight(top) {
        const { host, shadow } = panelView;
        const panel = shadow.getElementById('panel');
        const view = host.ownerDocument.defaultView;
        if (panelView.userSize) panel.style.width = `${Math.min(panelView.userSize.width, Math.max(0, view.innerWidth - 26))}px`;
        const available = Math.max(0, Math.min(panelView.userSize?.height ?? 540, view.innerHeight - top - 16));
        if (panelView.userSize) panel.style.height = `${available}px`;
        panel.style.maxHeight = `${available}px`;
        const head = shadow.querySelector('.head');
        const footer = shadow.querySelector('.panel-status');
        const reserved = (head.getBoundingClientRect().height || 48) + (footer.getBoundingClientRect().height || 34);
        panel.style.setProperty('--content-height', `${Math.max(0, available - reserved)}px`);
    }

    function setPanelPosition(left, top) {
        const { host, shadow } = panelView;
        const view = host.ownerDocument.defaultView;
        const width = host.getBoundingClientRect().width || Math.min(PANEL_WIDTH, view.innerWidth - 26);
        const headerHeight = shadow.querySelector('.head').getBoundingClientRect().height || 40;
        left = Math.max(0, Math.min(left, Math.max(0, view.innerWidth - width)));
        top = Math.max(0, Math.min(top, Math.max(0, view.innerHeight - headerHeight - 16)));
        host.style.transform = 'none';
        host.style.left = `${left}px`; host.style.top = `${top}px`;
        updatePanelHeight(top);
        return { left, top };
    }

    function initPanelDragging() {
        const head = panelView.shadow.querySelector('.head');
        let drag = null;
        head.addEventListener('pointerdown', event => {
            if (event.button !== 0 || event.target.closest('button,a,input,select')) return;
            const rect = panelView.host.getBoundingClientRect();
            drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
            try { head.setPointerCapture(event.pointerId); } catch { /* 不支持捕获时仍处理标题栏事件。 */ }
            event.preventDefault();
        });
        head.addEventListener('pointermove', event => {
            if (!drag || event.pointerId !== drag.id) return;
            panelView.userPosition = setPanelPosition(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
        });
        const end = event => { if (drag && event.pointerId === drag.id) drag = null; };
        head.addEventListener('pointerup', end);
        head.addEventListener('pointercancel', end);
        head.addEventListener('lostpointercapture', () => { drag = null; });
    }

    function initPanelResizing() {
        const {host, shadow} = panelView, view = host.ownerDocument.defaultView;
        const panel = shadow.getElementById('panel');
        let resizing = null;
        const resize = (rect, dx, dy, direction) => {
            const left = Math.max(0, rect.left), top = Math.max(0, rect.top);
            const maxWidth = Math.max(0, Math.min(view.innerWidth - 26, view.innerWidth - left - 8));
            const maxHeight = Math.max(0, view.innerHeight - top - 16);
            panelView.userSize = {
                width: Math.min(maxWidth, Math.max(Math.min(320, maxWidth), rect.width + (direction === 'bottom' ? 0 : dx))),
                height: Math.min(maxHeight, Math.max(Math.min(260, maxHeight), rect.height + (direction === 'right' ? 0 : dy)))
            };
            panel.style.width = `${panelView.userSize.width}px`;
            panelView.userPosition = setPanelPosition(left, top);
        };
        for (const handle of shadow.querySelectorAll('[data-resize]')) {
            handle.addEventListener('pointerdown', event => {
                if (event.button !== 0) return;
                resizing = {id:event.pointerId, x:event.clientX, y:event.clientY, rect:panel.getBoundingClientRect(), direction:handle.dataset.resize};
                try { handle.setPointerCapture(event.pointerId); } catch { /* 旧浏览器继续使用本地事件。 */ }
                event.preventDefault();
            });
            handle.addEventListener('pointermove', event => {
                if (resizing?.id === event.pointerId) resize(resizing.rect, event.clientX - resizing.x, event.clientY - resizing.y, resizing.direction);
            });
            for (const type of ['pointerup','pointercancel','lostpointercapture']) handle.addEventListener(type, () => {resizing=null;});
            handle.addEventListener('keydown', event => {
                const delta = {ArrowLeft:[-10,0],ArrowRight:[10,0],ArrowUp:[0,-10],ArrowDown:[0,10]}[event.key];
                if (!delta) return;
                event.preventDefault();event.stopPropagation();resize(panel.getBoundingClientRect(),...delta,handle.dataset.resize);
            });
        }
    }

    function positionAssistantPanel() {
        if (!panelView) return;
        if (panelView.userSize) updatePanelHeight(panelView.userPosition?.top ?? 12);
        if (panelView.userPosition) {
            panelView.userPosition = setPanelPosition(panelView.userPosition.left, panelView.userPosition.top);
            return;
        }
        const doc = panelView.host.ownerDocument;
        const title = resolveToolbarTarget(doc).header;
        const anchor = settingsButton();
        const inStudyPage = Boolean(studyOwnerDocument(doc));
        const desired = inStudyPage ? anchor?.getBoundingClientRect().top ?? 24 : title?.getBoundingClientRect().top ?? 24;
        const top = Math.max(12, Math.min(inStudyPage ? Math.max(12, doc.defaultView.innerHeight - 216) : 140, desired));
        if (inStudyPage) {
            const content = doc.querySelector('#mainid #iframe').getBoundingClientRect();
            const width = Math.min(PANEL_WIDTH, doc.defaultView.innerWidth - 26);
            setPanelPosition((content.left + content.right - width) / 2, top);
        } else {
            panelView.host.style.top = `${top}px`;
            updatePanelHeight(top);
        }
    }

    function renderRunState(state) {
        if (!document?.defaultView || document.defaultView.document !== document) return;
        const busy = state.busy || courseRunActive();
        const errorCode=panelView?.shadow.getElementById('last-error-code');
        if(errorCode)errorCode.textContent=state.lastErrorCode || '';
        if (toolbarView) {
            const s = toolbarView.shadow;
            s.getElementById('generate').disabled = busy;
            s.querySelector('.spinner').hidden = !busy;
            s.getElementById('generate').setAttribute('aria-busy', String(busy));
            const labels = { decoding: '解密中…', extracting: '提取中…', 'preparing-images':'读取图片…', classifying:'判断作答要求…', searching: '检索中…', generating: '生成中…', prefilling: '预填中…' };
            s.getElementById('label').textContent = state.busy ? (labels[state.phase] || '处理中…') : '一键生成答案';
            s.getElementById('status').textContent = '';
            s.getElementById('status').hidden = true;
        }
        if (panelView) {
            const s = panelView.shadow;
            const configuration = readModelConfiguration();
            refreshCredentialEditor(configuration, busy);
            s.getElementById('model-setup-notice').hidden = configuration.configured;
            s.getElementById('model-setup-message').textContent = !configuration.key
                ? '请先配置模型：保存 API Key 并选择模型后即可分析。'
                : '请先配置模型：选择模型后即可分析。';
            s.getElementById('status').textContent = coursePanelStatusMessage(state);
            s.getElementById('status-spinner').hidden = !busy;
            s.getElementById('panel').dataset.phase = state.phase;
            s.getElementById('panel').setAttribute('aria-busy',String(busy));
            const launcher = s.getElementById('floating-launcher');
            launcher.dataset.busy = String(busy);
            launcher.dataset.phase = state.phase;
            launcher.setAttribute('aria-busy', String(busy));
            launcher.title = busy ? '任务运行中，点击恢复助手；拖动调整位置' : '恢复学习通AI助手；拖动调整位置';
            for (const id of ['extract', 'solve', 'models', 'detect-model', 'detect-images', 'provider', 'model', 'thinking', 'effort', 'search', 'custom-base', 'custom-model', 'custom-images', 'save-custom', 'auto-context', 'info-model', 'info-interval']) s.getElementById(id).disabled = busy;
            s.getElementById('cancel-images').hidden=!controller?.capabilityTest;
            s.getElementById('cancel-images').disabled=controller?.capabilityTest?.signal.aborted===true;
            s.getElementById('cancel-model-test').hidden=!controller?.connectionTest;
            s.getElementById('cancel-model-test').disabled=controller?.connectionTest?.signal.aborted===true;
            const connection=controller?.connectionResult;
            const currentConnection=connection?.signature===modelConnectionSignature(configuration)?connection:null;
            s.getElementById('model-test-status').textContent=currentConnection?.message||'尚未检测';
            s.getElementById('model-test-status').dataset.state=currentConnection?.state||'idle';
            refreshModelCapabilities(s, busy);
            s.getElementById('prefill').disabled = busy || !controller?.last;
            const task=controller?.task;
            s.getElementById('analysis-stop').hidden = !state.busy || !task?.active;
            s.getElementById('analysis-stop').disabled = !state.busy || !task?.active || task.abortController.signal.aborted;
            s.getElementById('analysis-stop').textContent = task?.abortController.signal.aborted ? '正在停止…' : '停止分析';
            s.getElementById('analysis-resume').hidden = !task?.snapshot || !['failed','stopped'].includes(task.status);
            s.getElementById('analysis-resume').disabled = busy;
            const hasQuestions = hasQuestionNodes(document);
            for (const id of ['extract', 'solve']) s.getElementById(id).disabled = busy || !hasQuestions;
            s.getElementById('catalog-refresh').disabled = busy;
            for (const button of s.querySelectorAll('[data-chapter-button]')) button.disabled = busy;
            panelView.renderCourseRunControls?.();
        }
    }

    function extractQuestionSnapshot(doc = document, parseContext = {}, runtime = {}) {
        const graph = parseQuestionGraph(doc,parseContext);
        if (graph.questions.some(q=>GARBLED.test(q.question) || q.options.some(o=>GARBLED.test(o.text))))
            throw createCxError('CX-PAR-005',{module:'parser',operation:'font'});
        return createQuestionSnapshot(graph,{...runtime,doc,parseContext});
    }
    function checkSnapshot(snapshot) {
        if(snapshot.graph) return assertQuestionSnapshot(snapshot.rootSnapshot || snapshot);
        snapshot.checkCurrent?.();
        const current = extract(snapshot.doc || document, snapshot.parseContext);
        if (signature(current.questions, current.media) !== snapshot.signature)
            throw createCxError('CX-PAR-008',{module:'parser',operation:'snapshot'},{legacyCode:'SNAPSHOT_CHANGED'});
    }
    function questionAnswerSnapshot(snapshot) {
        if(snapshot.requestUnits)return snapshot;
        checkSnapshot(snapshot);
        const rootSnapshot=snapshot.graph?snapshot:extractQuestionSnapshot(snapshot.doc||document,snapshot.parseContext,{checkCurrent:snapshot.checkCurrent,signal:snapshot.signal,taskId:snapshot.taskId});
        const requestUnits=buildQuestionRequestUnits(rootSnapshot.graph);
        return {...rootSnapshot,rootSnapshot,courseContext:snapshot.courseContext,
            sourceQuestions:rootSnapshot.questions,questions:requestUnits.questions,media:requestUnits.media,requestUnits};
    }
    function questionResultProjection(snapshot,result) {
        const working=questionAnswerSnapshot(snapshot), byId=new Map(result.answers.map(a=>[a.id,a]));
        const questionAnswers=(working.sourceQuestions||snapshot.questions).map(q=>{
            const ids=working.requestUnits.unitsByQuestion.get(q.id)||[q.id],entries=ids.map(id=>byId.get(id)).filter(Boolean);
            if(ids.length===1&&ids[0]===q.id)return entries[0];
            if(!entries.length)return null;
            const restricted=entries.find(a=>a.answerPolicy?.status==='manual')||entries.find(a=>a.answerPolicy?.status==='uncertain');
            return {id:q.id,number:q.number,type:q.type,
                answer:entries.some(a=>a.answer.length)?[ids.flatMap((id,i)=>byId.get(id)?.answer.length?[`${i+1}. ${byId.get(id).answer.join('；')}`]:[]).join('\n')]:[],
                reason:restricted?.answerPolicy?.reason||'按已确认的作答区域分别分析',
                ...(restricted?{answerPolicy:restricted.answerPolicy}:{}),responseUnitIds:ids};
        }).filter(Boolean);
        return {...result,questionAnswers,responseUnitCount:working.questions.length};
    }
    function assistantErrorMessage(error,context={}) {
        const batchIndex=error?.batchIndex,batchCount=error?.batchCount;
        const hasBatch=Number.isSafeInteger(batchIndex)&&Number.isSafeInteger(batchCount)&&batchIndex>0&&batchIndex<=batchCount;
        const diagnostic=recordCxDiagnostic(error,{...context,...(hasBatch?{batchIndex,batchCount}:{})});
        if(controller)controller.state.lastErrorCode=diagnostic.code;
        return `${hasBatch?`第 ${batchIndex}/${batchCount} 批：`:''}${diagnostic.message}（${diagnostic.code}）`;
    }
    function safeCourseDiagnosticReport(report) {
        // Strict projection: no title/reason/question/answer/history, URL or account fields.
        const states=new Set(['running','done','stopped','timed-out','manual-pending','unvisited','already','no-tasks','skipped']);
        const counts={};
        for(const chapter of report?.chapters||[])if(states.has(chapter.status))counts[chapter.status]=(counts[chapter.status]||0)+1;
        const count=value=>Number.isSafeInteger(value)&&value>=0?value:0;
        return JSON.stringify({schemaVersion:1,summary:{status:states.has(report?.status)?report.status:'unknown',
            chapters:counts,videos:count(report?.videos),documents:count(report?.documents),quizzes:count(report?.quizzes)},
            diagnostics:JSON.parse(exportCxDiagnostics())},null,2);
    }
    async function prefillChecked(snapshot, answers, options = {}) {
        await ensureFontDecoded(snapshot.doc || document, snapshot.parseContext);
        checkSnapshot(snapshot);
        if (!answers.some(a => a.answer.length)) throw new Error('没有有效答案可以预填');
        return prefill(snapshot.questions, answers, () => checkSnapshot(snapshot), snapshot.doc || document, {...options,snapshot:snapshot.rootSnapshot || snapshot,parseContext:snapshot.parseContext});
    }
    function summaryText(s) {
        return `预填完成：${s.filled} 道已填，${s.already} 道已有相同答案，${s.skipped} 道跳过，${s.unverified} 道需检查。${s.details.length ? '\n' + s.details.slice(0, 5).join('\n') : ''}`;
    }
    const MAX_BATCH_QUESTIONS = 10;
    const MAX_BATCH_CHARACTERS = 12000;
    function splitQuestionBatches(questions, settings = {}, preparedMedia = new Map()) {
        const batches = [];
        let batch = [], size = 2;
        for (const question of questions) {
            const weight = JSON.stringify(toAIQuestion(question)).length + 1;
            if (batch.length && (batch.length >= MAX_BATCH_QUESTIONS || size + weight > MAX_BATCH_CHARACTERS)) {
                batches.push(batch); batch = []; size = 2;
            }
            const model = resolveQuestionModel(settings.model, question);
            if (batch.length && model !== resolveQuestionModel(settings.model, batch[0])) { batches.push(batch); batch = []; size = 2; }
            const fits = candidate => {
                const placeholderEvidence = settings.search ? Object.fromEntries(candidate.map(q => [q.id, Array.from({length:3}, () => ({title:'占'.repeat(120),url:'u'.repeat(500),excerpt:'摘'.repeat(650)}))])) : {};
                assertConfiguredRequestSize(settings, buildConfiguredAnswerPayload({...settings,model},candidate,placeholderEvidence,preparedMedia));
            };
            try { fits([...batch,question]); }
            catch (error) {
                if (batch.length) { batches.push(batch); batch = []; size = 2; }
                try { fits([question]); } catch (singleError) { throw new Error(`第 ${question.number} 题材料超限或不完整：${singleError.message}`); }
            }
            // 单道长题保持完整；不切断题干或选项，也不把批大小当总题数限制。
            batch.push(question); size += weight;
        }
        if (batch.length) batches.push(batch);
        return batches;
    }
    function analysisConfiguration(settings) {
        return modelConfigurationSignature(settings);
    }
    function currentAnalysisSettings() {
        return readModelConfiguration();
    }
    let assistantTaskSequence=0;
    function newAssistantDiagnosticTaskId() {return `cx-task-${++assistantTaskSequence}`;}
    function createAnalysisTask(snapshot, settings, autoPrefill) {
        return {id:Symbol('analysis'),diagnosticTaskId:newAssistantDiagnosticTaskId(),snapshot,configuration:analysisConfiguration(settings),settings,
            autoPrefill,status:'preparing',abortController:new AbortController(),preparedMedia:new Map(),answerPolicies:new Map(),batches:[],skippedQuestions:[]};
    }
    function checkAnalysisTask(task) {
        throwIfAborted(task.abortController.signal);
        if(controller?.task!==task)throw cancelledError();
        if(JSON.stringify(task.configuration)!==JSON.stringify(analysisConfiguration(currentAnalysisSettings()))) {
            const error=new Error('分析配置已变化，请重新分析');error.code='ANALYSIS_CONFIG_CHANGED';throw error;
        }
    }
    function analysisProgressText(progress) {
        const state={preparing:'正在准备',classifying:'判断作答要求',running:'分析中',failed:'已暂停，等待重试',stopped:'已停止',stale:'题目或配置已变化',complete:'AI 分析完成'}[progress.status] || progress.status;
        return `${state} · 已分析 ${progress.completed}/${progress.total} 题`;
    }
    function analysisSkipped(snapshot, settings, policies=new Map()) {
        return snapshot.questions.flatMap(q=>{
            const policy=policies.get(q.id) || questionLocalAnswerPolicy(q);
            if(policy.status==='manual' || policy.status==='uncertain')return [{id:q.id,reason:policy.reason,answerPolicy:policy}];
            if(questionImageIds(q).length && !modelSupportsImages(settings.model,settings))
                return [{id:q.id,reason:'所选模型不支持图片，此题需人工确认；请选择支持图片的模型',answerPolicy:{status:'uncertain',category:'images',reason:'所选模型不支持图片，此题需人工确认',evidence:''}}];
            return [];
        });
    }
    async function prepareAnswerPolicies(snapshot,settings,preparedMedia,{signal,progress,report=()=>{},check=()=>{},retry=action=>action()}={}) {
        const policies=progress?.answerPolicies || new Map();
        for(const q of snapshot.questions) {
            const local=questionLocalAnswerPolicy(q);
            if(local.status==='manual' || local.status==='auto')policies.set(q.id,local);
            else if(questionImageIds(q).length && !modelSupportsImages(settings.model,settings))
                policies.set(q.id,{status:'uncertain',category:'images',reason:'所选模型不支持图片，此题需人工确认',evidence:''});
        }
        const pending=snapshot.questions.filter(q=>!policies.has(q.id));
        // 按题准备材料：单题图片失败只降级该题，成功材料仍复用；取消及快照变化必须退出。
        for(const q of snapshot.questions.filter(q=>!policies.has(q.id) || policies.get(q.id).status==='auto')) {
            check();throwIfAborted(signal);
            const ids=new Set(questionImageIds(q));
            try {await retry(()=>prepareQuestionMedia((snapshot.media || []).filter(item=>ids.has(item.id)),report,check,snapshot.doc || document,{signal,prepared:preparedMedia}),'preparing-images');}
            catch(error){check();throwIfAborted(signal);policies.set(q.id,{status:'uncertain',category:'images',reason:`图片材料无法读取，需人工确认：${error.message}`,evidence:''});}
        }
        const classify=pending.filter(q=>!policies.has(q.id));
        for(const batch of splitQuestionBatches(classify,{...settings,search:false,courseContext:[]},preparedMedia)) {
            check();report(`正在判断第 ${batch[0].number}–${batch.at(-1).number} 题的作答要求…`,'classifying');
            const model=resolveQuestionModel(settings.model,batch[0]);
            const result=await retry(()=>classifyQuestionAnswerPolicies({...settings,model,courseContext:[]},batch,preparedMedia,signal),'classifying');
            check();throwIfAborted(signal);
            for(const [id,policy] of result)policies.set(id,policy);
        }
        return policies;
    }
    function collectBatchResults(snapshot, records, skippedQuestions, complete=false, policies=new Map()) {
        const answers=[],evidence={},modelsByQuestion={},mediaAnalysis=new Map();
        for(const record of records.filter(item=>item.status==='success')) {
            for(const entry of record.result.answers) {
                const policy=entry.answerPolicy || policies.get(entry.id);
                answers.push({...entry,...(policy?{answerPolicy:policy}:{})});
            }
            Object.assign(evidence,record.evidence);
            for(const q of record.questions)modelsByQuestion[q.id]=record.model;
            for(const entry of record.result.mediaAnalysis)if(!mediaAnalysis.has(entry.imageIds[0]))mediaAnalysis.set(entry.imageIds[0],entry);
        }
        const byId=new Map(answers.map(answer=>[answer.id,answer]));
        const ordered=snapshot.questions.flatMap(q=>byId.has(q.id)?[byId.get(q.id)]:complete?[{id:q.id,number:q.number,type:q.type,answer:[],answerPolicy:policies.get(q.id) || questionLocalAnswerPolicy(q),reason:skippedQuestions.find(item=>item.id===q.id)?.reason || q.diagnostics?.join('；') || '题型未适配，需人工核对'}]:[]);
        const answerPolicies=Object.fromEntries(policies);
        for(const entry of answers)if(entry.answerPolicy)answerPolicies[entry.id]=entry.answerPolicy;
        return {answers:ordered,answerPolicies,evidence,modelsByQuestion,mediaAnalysis:[...mediaAnalysis.values()],skippedQuestions,
            manualCount:Object.values(answerPolicies).filter(p=>p.status==='manual').length,
            uncertainCount:Object.values(answerPolicies).filter(p=>p.status==='uncertain').length,
            analyzedCount:answers.filter(a=>a.answer.length).length,batchCount:records.length};
    }
    function renderAnalysisProgress(task, complete=false) {
        if(controller?.task!==task || !task.snapshot)return;
        const result=questionResultProjection(task.requestSnapshot||task.snapshot,collectBatchResults(task.requestSnapshot||task.snapshot,task.batches,task.skippedQuestions,complete,task.answerPolicies));
        const {answers,...details}=result;
        const skipped=new Set(task.skippedQuestions.map(item=>item.id));
        const total=(task.requestSnapshot||task.snapshot).questions.filter(q=>q.capabilities?.analyze!==false&&!skipped.has(q.id)).length;
        controller.output({version: '1.24',schemaVersion:task.snapshot.schemaVersion,questions:task.snapshot.questions,media:task.snapshot.media,
            model:task.configuration.model,thinking:task.configuration.thinking,searchEnabled:task.configuration.search,total:task.snapshot.questions.length,
            ...details,...(answers.length || complete ? {answers} : {}),analysisProgress:{status:task.status,completed:result.analyzedCount,total}});
    }
    function retryWait(signal) {
        return new Promise((resolve,reject)=>{
            let timer;
            const cancel=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);reject(cancelledError());};
            if(signal?.aborted){cancel();return;}
            signal?.addEventListener('abort',cancel,{once:true});
            timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},2000);
        });
    }
    async function withAnalysisRetry(action, {signal,enabled=false,report=()=>{},onRetry=()=>{}}={}) {
        for(let attempt=0;;attempt++) {
            throwIfAborted(signal);
            try {const value=await action();throwIfAborted(signal);return value;}
            catch(error) {
                throwIfAborted(signal);
                const transient=['NETWORK','TIMEOUT'].includes(error.code) || (error.code==='HTTP' && [502,503,504].includes(error.status));
                if(!enabled || attempt!==0 || !transient)throw error;
                report(`请求暂时失败：${error.message}；2 秒后自动重试一次`);
                await retryWait(signal);onRetry();
            }
        }
    }
    async function solveQuestionBatches(snapshot, settings, report, {progress,onBatchComplete=()=>{},retryTransient=false}={}) {
        snapshot=questionAnswerSnapshot(snapshot);
        if(progress)progress.requestSnapshot=snapshot;
        const check=()=>{throwIfAborted(settings.signal);checkSnapshot(snapshot);};
        const retry=(action,phase)=>withAnalysisRetry(action,{signal:settings.signal,enabled:retryTransient,onRetry:()=>settings.onModelRetry?.(),report:message=>{check();report(message,phase);}});
        const prepared=progress?.preparedMedia || new Map();
        let records,policies,skippedQuestions;
        try {
            policies=await prepareAnswerPolicies(snapshot,settings,prepared,{signal:settings.signal,progress,report,check,retry});
            check();
            skippedQuestions=analysisSkipped(snapshot,settings,policies);
            if(progress){progress.skippedQuestions=skippedQuestions;progress.status='running';}
            const analyzable=snapshot.questions.filter(q=>questionCanAutoAnswer(q,policies.get(q.id)));
            records=progress?.batches.length?progress.batches:splitQuestionBatches(analyzable,settings,prepared)
                .map(questions=>({questions,status:'pending',evidence:{},result:null,error:null}));
            if(progress){progress.batches=records;progress.status='running';}
            for(let i=0;i<records.length;i++) {
                const record=records[i];if(record.status==='success')continue;
                check();record.status='running';record.error=null;
                const batch=record.questions,model=resolveQuestionModel(settings.model,batch[0]);record.model=model;
                const count=records.filter(item=>item.status==='success').reduce((n,item)=>n+item.questions.length,0);
                const prefix=`第 ${i+1}/${records.length} 批（第 ${batch[0].number}–${batch.at(-1).number} 题，已分析 ${count}/${snapshot.questions.length} 题）`;
                try {
                    if(settings.search) {
                        if(progress) {
                            for(const question of batch) {
                                if(record.evidence[question.id])continue;
                                report(`${prefix}：正在联网检索第 ${question.number} 题…`,'searching');
                                const found=await retry(()=>getWebEvidence([question],settings.key,model,message=>{check();report(`${prefix}：${message}`,'searching');},prepared,settings.signal),'searching');
                                check();Object.assign(record.evidence,found);
                            }
                        } else {
                            report(`${prefix}：正在联网检索…`,'searching');
                            record.evidence=await getWebEvidence(batch,settings.key,model,message=>{check();report(`${prefix}：${message}`,'searching');},prepared,settings.signal);
                            check();
                        }
                    }
                    report(`${prefix}：正在请求 ${model}…`,'generating');
                    const result=await retry(()=>askConfiguredModel({...settings,model},batch,record.evidence,prepared,settings.signal),'generating');
                    check();record.result=result;record.status='success';
                    onBatchComplete(record,i);
                } catch(error) {
                    record.status=settings.signal?.aborted?'pending':'failed';record.error=error.message;
                    error.batchIndex=i+1;error.batchCount=records.length;
                    error.message=`第 ${i+1}/${records.length} 批未完成：${error.message}；本次尚未预填`;throw error;
                }
            }
            return questionResultProjection(snapshot,collectBatchResults(snapshot,records,skippedQuestions,true,policies));
        } finally {if(!progress)prepared.clear();}
    }
    function invalidateAnalysisTask(reason) {
        const task=controller?.task;if(!task)return;
        task.status='stale';task.error=reason;task.preparedMedia.clear();controller.last=null;
        renderAnalysisProgress(task);
    }
    function stopAnalysisTask() {
        const task=controller?.task;
        if(!task?.active || !controller.state.busy || task.abortController.signal.aborted)return;
        task.abortController.abort();controller.report('正在停止分析…','stopping');
    }
    async function resumeAnalysisTask() {
        const ctl=controller,task=ctl?.task;
        if(!task?.snapshot || ctl.state.busy || courseRunActive() || !['failed','stopped'].includes(task.status))return;
        const settings=currentAnalysisSettings();
        if(!settings.key){ctl.openPanel('model');ctl.report('请先保存 API Key，再重试未完成批次','error');return;}
        // Explicit retry replaces the cancelled signal before validating the same frozen content.
        task.abortController=new AbortController();
        try {
            if(JSON.stringify(task.configuration)!==JSON.stringify(analysisConfiguration(settings)))throw new Error('分析配置已变化，请重新分析');
            checkSnapshot(task.snapshot);
        } catch(error) {invalidateAnalysisTask(error.message);ctl.report(error.message,'error');return;}
        task.settings=settings;task.abortController=new AbortController();
        await executeAnalysisTask(task);
    }
    async function executeAnalysisTask(task) {
        const ctl=controller;
        task.active=true;
        ctl.last=null;ctl.report('正在还原题目字体…','decoding',true);switchPanelView('questions');
        try {
            checkAnalysisTask(task);await ensureFontDecoded(task.snapshot?.doc || document);checkAnalysisTask(task);
            if(!task.snapshot) {
                ctl.report('正在提取题目…','extracting');
                task.snapshot=extractQuestionSnapshot(document,{}, {taskId:task.diagnosticTaskId,checkCurrent:()=>checkAnalysisTask(task)});
                task.snapshot.courseContext=task.settings.videoInfoEnabled?captureCurrentCourseContext(document):[];
            }
            task.snapshot.checkCurrent=()=>checkAnalysisTask(task);
            checkSnapshot(task.snapshot);task.requestSnapshot=questionAnswerSnapshot(task.snapshot);task.status='preparing';task.skippedQuestions=analysisSkipped(task.requestSnapshot,task.settings);renderAnalysisProgress(task);
            if(!task.snapshot.questions.some(q=>q.capabilities.analyze)) {
                task.status='complete';renderAnalysisProgress(task);ctl.report('已保留原始题目：当前题型尚未适配，请查看题目列表','done');return;
            }
            const result=await solveQuestionBatches(task.snapshot,{...task.settings,diagnosticTaskId:task.diagnosticTaskId,courseContext:task.snapshot.courseContext || [],signal:task.abortController.signal},
                (message,phase)=>{checkAnalysisTask(task);ctl.report(message,phase);if(ctl.result?.analysisProgress?.status!==task.status)renderAnalysisProgress(task);},
                {progress:task,onBatchComplete:()=>renderAnalysisProgress(task),retryTransient:true});
            checkSnapshot(task.snapshot);task.status='complete';renderAnalysisProgress(task,true);
            if(!result.analyzedCount){if(!result.manualCount && !result.uncertainCount)throw new Error('没有有效答案可以预填，请核对题目与模型结果');ctl.report(`没有可自动填写的答案；${result.manualCount} 道需人工处理，${result.uncertainCount} 道需人工确认。`+(result.skippedQuestions.some(q=>q.answerPolicy?.category==='images')?'所选模型不支持图片或图片材料未能读取，请核对。':''),'done');return;}
            ctl.last={...task.snapshot,rootSnapshot:task.snapshot,answers:result.answers};
            if(task.autoPrefill) {
                ctl.report('正在校验并预填…','prefilling');
                const summary=await prefillChecked(ctl.last,result.answers);checkAnalysisTask(task);
                ctl.output({...ctl.result,prefill:summary});
                ctl.report(summaryText(summary)+(result.skippedQuestions.length?`\n${result.skippedQuestions.length} 道题需人工处理或确认，已跳过。`:''),'done');
            } else ctl.report(`AI 已分析 ${result.analyzedCount} 道题${result.skippedQuestions.length?`，${result.skippedQuestions.length} 道题需人工处理或确认，已跳过`:''}，请核对结果后点击预填。`,'done');
        } catch(error) {
            if(ctl.task!==task)return;
            ctl.last=null;task.error=error.message;
            const changed=error.code==='ANALYSIS_CONFIG_CHANGED' || task.snapshot && (()=>{try{checkSnapshot(task.snapshot);return false;}catch(e){return e.code!=='ABORTED';}})();
            task.status=changed?'stale':task.abortController.signal.aborted?'stopped':'failed';
            if(changed)task.preparedMedia.clear();
            renderAnalysisProgress(task);
            const completed=task.batches.filter(item=>item.status==='success').reduce((n,item)=>n+item.questions.length,0);
            const prefill=error.prefillSummary?`；已确认填写 ${error.prefillSummary.filled} 道，停止时正在处理的题目请核对，已写入内容保留`:'';
            ctl.report(`${task.status==='stopped'?'已停止分析':task.status==='stale'?'题目或图片已变化，请重新分析':'操作中止：'+assistantErrorMessage(error,{module:'analysis',operation:'solve',taskId:task.diagnosticTaskId})}；保留 ${completed} 道已分析结果${prefill}`,
                task.status==='stopped'?'stopped':'error');
        } finally {
            task.active=false;
            if(task.status==='complete' || task.status==='stale')task.preparedMedia.clear();
            if(ctl.task===task){ctl.state.busy=false;renderRunState(ctl.state);}
        }
    }
    async function runAnswerFlow({autoPrefill=true}={}) {
        const ctl=controller;if(ctl.state.busy || courseRunActive())return;
        const configuration=readModelConfiguration();
        if(!configuration.configured){ctl.openPanel('model');ctl.report('请先配置模型：保存 API Key 并选择模型','error');return;}
        if(ctl.task){ctl.task.abortController.abort();ctl.task.preparedMedia.clear();}
        ctl.last=null;ctl.clearOutput();
        const task=createAnalysisTask(null,currentAnalysisSettings(),autoPrefill);ctl.task=task;
        await executeAnalysisTask(task);
    }

    function createController() {
        const ctl = {
            state: { busy: false, phase: 'idle', message: '' }, last: null, result: null, task: null,
            report(message, phase = ctl.state.phase, busy = ctl.state.busy) {
                Object.assign(ctl.state, { message, phase, busy }); renderRunState(ctl.state);
            },
            openPanel(view) {
                if (assistantUiHidden) return;
                if (!panelView) return;
                movePanelToStudyPage();
                refreshCourseSidebar();
                setAssistantWindowMode('open');
                if (view === 'model') switchSettingsView('model');
                if (typeof view === 'string') switchPanelView(view);
                positionAssistantPanel();
                settingsButton()?.setAttribute('aria-expanded', 'true');
            },
            togglePanel() {
                if (!panelView) return;
                const panel = panelView.shadow.getElementById('panel');
                if (panel.hidden) ctl.openPanel();
                else {
                    setAssistantWindowMode('closed');
                }
            },
            output(data) { ctl.result = data; renderResultList(data); },
            clearOutput() { ctl.result = null; renderResultList(null); },
            runAnswerFlow,
            async extractOnly() {
                if (ctl.state.busy || courseRunActive()) return;
                switchPanelView('questions');
                invalidateAnalysisTask('已重新提取题目'); ctl.task = null; ctl.last = null; ctl.clearOutput(); ctl.report('正在还原字体并提取…', 'decoding', true);
                try { await ensureFontDecoded(); const data = extract(); ctl.output(data); ctl.report(`已提取 ${data.total} 道题`, 'done'); }
                catch (e) { ctl.report(`提取失败：${assistantErrorMessage(e,{module:'parser',operation:'extract'})}`, 'error'); }
                finally { ctl.state.busy = false; renderRunState(ctl.state); }
            },
            async prefillLast() {
                if (ctl.state.busy || courseRunActive() || !ctl.last) return;
                const task=ctl.task;
                if(task){task.active=true;task.abortController=new AbortController();}
                ctl.report('正在校验并预填…', 'prefilling', true);
                try {
                    const summary = await prefillChecked(ctl.last, ctl.last.answers);
                    ctl.output({ ...ctl.result, prefill: summary });
                    ctl.report(summaryText(summary), 'done');
                }
                catch (e) {
                    ctl.last = null;
                    if(task){task.status=task.abortController.signal.aborted?'stopped':'stale';task.preparedMedia.clear();renderAnalysisProgress(task,true);}
                    ctl.report(`预填中止：${assistantErrorMessage(e,{module:'actions',operation:'prefill'})}${e.prefillSummary ? `；已确认填写 ${e.prefillSummary.filled} 道，已写入内容保留，请核对停止时的题目` : ''}`,task?.abortController.signal.aborted?'stopped':'error');
                }
                finally { if(task)task.active=false;ctl.state.busy = false; renderRunState(ctl.state); }
            },
            async testModelConnection() {
                if(ctl.state.busy || courseRunActive())return;
                const cfg={...readModelConfiguration(),diagnosticTaskId:newAssistantDiagnosticTaskId()},signature=modelConnectionSignature(cfg),abort=new AbortController();
                ctl.connectionTest=abort;ctl.connectionResult={signature,state:'checking',message:'检测中…'};
                const cancel=()=>abort.abort();window.addEventListener('pagehide',cancel,{once:true});
                ctl.report('正在向当前模型发送 Hi…','model-check',true);
                const redact=value=>clean(String(value??'').split(cfg.key||'\u0000').join('[已隐藏]')).slice(0,260);
                try {
                    const reply=await detectConfiguredModelConnection(cfg,abort.signal);
                    throwIfAborted(abort.signal);
                    if(!panelView?.host.isConnected || modelConnectionSignature(readModelConfiguration())!==signature)
                        throw requestFailure('模型配置已变化，请重新检测','CONFIG_CHANGED');
                    ctl.connectionResult={signature,state:'ok',message:`可用 · 回复：${redact(reply)}`};
                    ctl.report('当前模型可用（已收到文本回复）','done',true);
                } catch(error) {
                    const diagnostic=recordCxDiagnostic(error,{module:'model',operation:'detect'});
                    ctl.connectionResult={signature,state:'error',message:`${abort.signal.aborted?'检测已取消':'检测失败'} · ${diagnostic.code} · ${diagnostic.message}`};
                    ctl.report(ctl.connectionResult.message,'error',true);
                } finally {
                    window.removeEventListener('pagehide',cancel);
                    if(ctl.connectionTest===abort){ctl.connectionTest=null;ctl.state.busy=false;renderRunState(ctl.state);}
                }
            },
            async loadModels() {
                if (ctl.state.busy || courseRunActive()) return;
                const configuration = {...readModelConfiguration(),diagnosticTaskId:newAssistantDiagnosticTaskId()};
                if (!configuration.key) return ctl.report('请先保存 API Key');
                if (!configuration.baseURL) return ctl.report('请先保存有效接口地址');
                const owner=panelView?.host.ownerDocument,body=owner?.body,abort=new AbortController();
                ctl.modelListTest=abort;
                const cancel=()=>abort.abort();window.addEventListener('pagehide',cancel,{once:true});
                ctl.report('正在获取模型列表…', 'idle', true);
                try {
                    const models = await fetchConfiguredModels(configuration,abort.signal);
                    throwIfAborted(abort.signal);
                    if(!owner || owner.body!==body || owner.defaultView?.document!==owner || !panelView?.host.isConnected || panelView.host.ownerDocument!==owner)
                        throw cancelledError();
                    if (!models.length) throw new Error('模型列表没有有效条目');
                    const current=readModelConfiguration();
                    if(current.provider!==configuration.provider || current.baseURL!==configuration.baseURL || current.key!==configuration.key)
                        throw requestFailure('','CONFIG_CHANGED');
                    renderModelSettings(ctl, models);
                    invalidateAnalysisTask('分析配置已变化，请重新分析'); ctl.last = null;
                    ctl.report(`获取成功：${models.length} 个模型`, 'done');
                } catch (e) { ctl.report(`获取模型失败：${e.code==='CONFIG_CHANGED'?'配置已变化，请重新获取模型列表；':''}${assistantErrorMessage(e,{module:'model',operation:'list'})}`, 'error'); }
                finally {
                    window.removeEventListener('pagehide',cancel);
                    if(ctl.modelListTest===abort)ctl.modelListTest=null;
                    ctl.state.busy = false;
                    if(panelView?.host.isConnected && owner?.defaultView?.document===owner)renderRunState(ctl.state);
                }
            }
        };
        document.defaultView.addEventListener('pagehide', () => {
            ctl.modelListTest?.abort();
            if(ctl.task){ctl.task.abortController.abort();ctl.task.preparedMedia.clear();ctl.task=null;ctl.last=null;}
        });
        return ctl;
    }

    function initQuizAssistant(doc = document) {
        if (!doc.body || !hasQuestionNodes(doc)) return;
        initCredentialSettings();
        if (!controller) controller = createController();
        createAssistantPanel(doc, controller);
        mountQuizToolbar(doc, controller);
        refreshCourseSidebar();
        renderRunState(controller.state);
    }
    function alignStudyToolbar(doc = document) {
        if (!studyToolbarView) return;
        // 与章节页签共用页面提供的响应式内边距，避免贴到目录栏边缘。
        const tabs = doc.querySelector('#mainid #prev_tab');
        const style = tabs ? doc.defaultView.getComputedStyle(tabs) : null;
        studyToolbarView.host.style.paddingLeft = style?.paddingLeft || '0px';
        studyToolbarView.host.style.paddingRight = style?.paddingRight || '0px';
    }

    function initStudyAssistant(doc = document) {
        const view = doc.defaultView;
        if (!view || view !== view.top || !doc.body) return;
        const url = new URL(pageURL(doc));
        if (!isCourseStudyURL(url)) return;
        const content = doc.querySelector('#mainid #iframe');
        if (!content) return;
        if (!controller) controller = createController();
        createAssistantPanel(doc, controller);
        if (!studyToolbarView) {
            const host = doc.createElement('div');
            host.id = 'cx-ai-study-toolbar';
            host.style.cssText = 'display:flex;justify-content:flex-end;width:100%;max-width:100%;box-sizing:border-box;margin:8px 0 12px;clear:both';
            registerAssistantUiHost(host);
            const shadow = host.attachShadow({ mode: 'open' });
            shadow.innerHTML = `<style>button{font:14px/1.5 system-ui,sans-serif;border:0;border-radius:7px;min-height:34px;padding:6px 12px;background:#edf2ff;color:#355dcc;cursor:pointer}button+button{margin-left:8px}button:focus-visible{outline:2px solid #3268df;outline-offset:2px}</style><button type="button" id="settings" aria-expanded="false">学习通AI助手</button>`;
            studyToolbarView = { host, shadow };
            // 只有统一助手入口；测验侧边“自动刷课”导航打开顶层课程面板，不执行课程动作。
            const showCoursePanel=()=>controller.openPanel('chapters');
            doc.addEventListener('cx-ai-show-study-panel',showCoursePanel);
            view.addEventListener('pagehide',()=>doc.removeEventListener('cx-ai-show-study-panel',showCoursePanel),{once:true});
            shadow.getElementById('settings').onclick = () => {
                const quizDoc = findQuizPanel(doc.querySelector('#mainid #iframe')?.contentDocument);
                if (quizDoc) {
                    setAssistantWindowMode('closed');
                    quizDoc.dispatchEvent(new quizDoc.defaultView.Event('cx-ai-toggle-quiz-panel'));
                } else controller.togglePanel();
            };
            const realign = () => alignStudyToolbar(doc);
            view.addEventListener('resize', realign);
            view.addEventListener('pagehide', () => view.removeEventListener('resize', realign), { once: true });
        }
        if (content.previousElementSibling !== studyToolbarView.host) content.before(studyToolbarView.host);
        alignStudyToolbar(doc);
        renderRunState(controller.state);
    }
    function startQuizObserver() {
        initOtherFeatures(document);
        startAssistantUpdateCheck();
        let scheduled = false;
        const refresh = () => {
            if (scheduled) return;
            scheduled = true;
            setTimeout(() => {
                scheduled = false;
                initQuizAssistant();
                initStudyAssistant();
                ensureFontDecoded().catch(error => {
                    if (controller && !controller.state.busy) controller.report(`字体解密失败：${assistantErrorMessage(error,{module:'parser',operation:'font'})}`, 'error');
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
    initCredentialSettings();
    initCourseDocumentBridge();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startQuizObserver, { once: true });
    else startQuizObserver();
