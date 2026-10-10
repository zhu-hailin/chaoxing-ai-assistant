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
    let toolbarView;
    let studyToolbarView;
    const PANEL_WIDTH = 720;
    function studyOwnerDocument(doc = document) {
        let view = doc?.defaultView;
        try {
            for (let depth = 0; view && depth < 12; depth++) {
                const candidate = view.document;
                const url = new URL(pageURL(candidate));
                if (view === view.top && url.hostname === 'mooc1.chaoxing.com' && url.pathname.startsWith('/mycourse/studentstudy') && candidate.querySelector('#mainid #iframe')) return candidate;
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
        const answers = new Map((data.answers || []).map(entry => [entry.id, entry]));
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
            const answers = new Map((data.answers || []).map(entry => [entry.id, entry]));
            fragment.append(node('p', 'result-summary', `${hasAnswers ? '题目与答案' : '题目列表'} · 共 ${data.questions.length} 题${data.analysisProgress ? ' · ' + analysisProgressText(data.analysisProgress) : hasAnswers ? ' · AI 分析完成' : ''}${data.prefill ? ' · ' + summaryText(data.prefill) : ''}`));
            const list = node('ol', 'question-list');
            for (const question of data.questions) {
                const entry = answers.get(question.id);
                const card = node('li', 'question-card');
                card.dataset.questionId = question.id;
                const heading = node('div', 'question-heading');
                heading.append(node('span', 'question-number', `第 ${question.number} 题`), node('span', 'question-type', (question.type === 'unknown' ? question.source?.typeLabel || '未识别题型' : QUESTION_TYPE_LABELS[question.type]) || '题目'));
                card.append(heading, node('p', 'question-text', question.question.replace(/^【[^】]+】\s*/, '')));
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
        placeQuizToolbar(doc, host, resolveToolbarTarget(doc));
        toolbarView = { host, shadow };
        shadow.getElementById('generate').onclick = () => ctl.runAnswerFlow({ autoPrefill: true });
        shadow.getElementById('settings').hidden = Boolean(studyOwnerDocument(doc));
        shadow.getElementById('settings').onclick = () => ctl.togglePanel();
    }

    function switchPanelView(view, { focus = false } = {}) {
        if (!panelView || !['model','questions','chapters'].includes(view)) return;
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
        if (!panelView || !['model','developer'].includes(view)) return;
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
        buttons.forEach((button, index) => {
            button.onclick = () => switchPanelView(button.dataset.panelView);
            button.addEventListener('keydown', event => {
                let next;
                if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
                else if (event.key === 'ArrowUp') next = (index + buttons.length - 1) % buttons.length;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = buttons.length - 1;
                else return;
                event.preventDefault(); event.stopPropagation();
                switchPanelView(buttons[next].dataset.panelView, {focus:true});
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
    function readModelConfiguration() {
        const key = clean(get(KEY_DS));
        const model = clean(get(KEY_MODEL, 'deepseek-flash'));
        return { key, model, configured: Boolean(key && model) };
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
        panelView = { host, shadow, sourceDoc: doc, userPosition: null };
        initPanelDragging();
        initPanelResizing();
        const toggleFromStudy = () => ctl.togglePanel();
        doc.addEventListener('cx-ai-toggle-quiz-panel', toggleFromStudy);
        window.addEventListener('pagehide', () => doc.removeEventListener('cx-ai-toggle-quiz-panel', toggleFromStudy), { once: true });
        initCourseSidebar();
        initPanelNavigation();
        initCourseRunControls(doc, ctl);
        const el = id => shadow.getElementById(id);
        el('model-setup-open').onclick = () => {
            switchSettingsView('model');
            switchPanelView('model');
            el(readModelConfiguration().key ? 'model' : 'ds-key').focus();
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
            el('panel').hidden = true;
            settingsButton()?.setAttribute('aria-expanded', 'false');
            settingsButton()?.focus();
        };
        el('close').onclick = closePanel;
        shadow.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !el('panel').hidden) { event.stopPropagation(); closePanel(); }
        });
        const reposition = () => { if (!el('panel').hidden) positionAssistantPanel(); };
        window.addEventListener('resize', reposition);
        window.addEventListener('scroll', reposition, { passive: true });
        el('save-ds').onclick = () => {
            if (ctl.state.busy || courseRunActive()) return;
            const key = clean(el('ds-key').value);
            if (!key) return ctl.report('请输入 API Key');
            set(KEY_DS, key);
            el('ds-key').value = '';
            ctl.report(readModelConfiguration().configured ? '模型配置已保存' : 'Key 已保存，请先选择模型');
        };
        el('clear-ds').onclick = () => {
            if (ctl.state.busy || courseRunActive()) return;
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
                if (ctl.state.busy || courseRunActive()) return;
                set(key, checkbox ? el(id).checked : el(id).value);
                invalidateAnalysisTask('分析配置已变化，请重新分析');
                ctl.last = null;
                renderRunState(ctl.state);
            };
        }
        el('models').onclick = () => ctl.loadModels();
        el('extract').onclick = () => ctl.extractOnly();
        el('solve').onclick = () => ctl.runAnswerFlow({ autoPrefill: false });
        el('prefill').onclick = () => ctl.prefillLast();
        el('analysis-stop').onclick = stopAnalysisTask;
        el('analysis-resume').onclick = resumeAnalysisTask;
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
        const reposition = () => { if (!panelView.shadow.getElementById('panel').hidden) positionAssistantPanel(); };
        owner.defaultView.addEventListener('resize', reposition);
        owner.defaultView.addEventListener('scroll', reposition, { passive: true });
        window.addEventListener('pagehide', () => {
            owner.defaultView.removeEventListener('resize', reposition);
            owner.defaultView.removeEventListener('scroll', reposition);
            panelView.host.remove();
        }, { once: true });
    }

    function updatePanelHeight(top) {
        const { host, shadow } = panelView;
        const panel = shadow.getElementById('panel');
        const view = host.ownerDocument.defaultView;
        if (panelView.userSize) panel.style.width = `${Math.min(panelView.userSize.width, Math.max(0, view.innerWidth - 26))}px`;
        const available = Math.max(0, Math.min(panelView.userSize?.height ?? 580, view.innerHeight - top - 16));
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
        const busy = state.busy || courseRunActive();
        if (toolbarView) {
            const s = toolbarView.shadow;
            s.getElementById('generate').disabled = busy;
            s.querySelector('.spinner').hidden = !busy;
            s.getElementById('generate').setAttribute('aria-busy', String(busy));
            const labels = { decoding: '解密中…', extracting: '提取中…', 'preparing-images':'读取图片…', searching: '检索中…', generating: '生成中…', prefilling: '预填中…' };
            s.getElementById('label').textContent = state.busy ? (labels[state.phase] || '处理中…') : '一键生成答案';
            s.getElementById('status').textContent = state.message;
        }
        if (panelView) {
            const s = panelView.shadow;
            const configuration = readModelConfiguration();
            s.getElementById('model-setup-notice').hidden = configuration.configured;
            s.getElementById('model-setup-message').textContent = !configuration.key
                ? '请先配置模型：保存 API Key 并选择模型后即可分析。'
                : '请先配置模型：选择模型后即可分析。';
            s.getElementById('status').textContent = coursePanelStatusMessage(state);
            s.getElementById('status-spinner').hidden = !busy;
            s.getElementById('panel').dataset.phase = state.phase;
            s.getElementById('panel').setAttribute('aria-busy',String(busy));
            for (const id of ['extract', 'solve', 'models', 'save-ds', 'clear-ds', 'ds-key', 'model', 'thinking', 'effort', 'search']) s.getElementById(id).disabled = busy;
            s.getElementById('effort').disabled = busy || !s.getElementById('thinking').checked;
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

    function checkSnapshot(snapshot) {
        snapshot.checkCurrent?.();
        const current = extract(snapshot.doc || document);
        if (signature(current.questions, current.media) !== snapshot.signature) throw new Error('题目或图片与分析时不一致，已中止预填，请重新生成');
    }
    async function prefillChecked(snapshot, answers) {
        await ensureFontDecoded(snapshot.doc || document);
        checkSnapshot(snapshot);
        if (!answers.some(a => a.answer.length)) throw new Error('没有有效答案可以预填');
        return prefill(snapshot.questions, answers, () => checkSnapshot(snapshot), snapshot.doc || document);
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
            const model = resolveQuestionModel(settings.model || 'deepseek-flash', question);
            if (batch.length && model !== resolveQuestionModel(settings.model || 'deepseek-flash', batch[0])) { batches.push(batch); batch = []; size = 2; }
            const fits = candidate => {
                const placeholderEvidence = settings.search ? Object.fromEntries(candidate.map(q => [q.id, Array.from({length:3}, () => ({title:'占'.repeat(120),url:'u'.repeat(500),excerpt:'摘'.repeat(650)}))])) : {};
                assertRequestSize(buildAnswerPayload(model,candidate,settings.thinking,settings.effort,placeholderEvidence,preparedMedia));
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
        return {model:settings.model,thinking:settings.thinking,effort:settings.effort,search:settings.search};
    }
    function currentAnalysisSettings() {
        const configuration=readModelConfiguration();
        return {key:configuration.key,model:configuration.model,thinking:Boolean(get(KEY_THINKING,false)),effort:get(KEY_EFFORT,'high'),search:Boolean(get(KEY_SEARCH,false))};
    }
    function createAnalysisTask(snapshot, settings, autoPrefill) {
        return {id:Symbol('analysis'),snapshot,configuration:analysisConfiguration(settings),settings,
            autoPrefill,status:'preparing',abortController:new AbortController(),preparedMedia:new Map(),batches:[],skippedQuestions:[]};
    }
    function checkAnalysisTask(task) {
        throwIfAborted(task.abortController.signal);
        if(controller?.task!==task)throw cancelledError();
    }
    function analysisProgressText(progress) {
        const state={preparing:'正在准备',running:'分析中',failed:'已暂停，等待重试',stopped:'已停止',stale:'题目或配置已变化',complete:'AI 分析完成'}[progress.status] || progress.status;
        return `${state} · 已分析 ${progress.completed}/${progress.total} 题`;
    }
    function analysisSkipped(snapshot, settings) {
        return snapshot.questions.filter(q => q.capabilities?.analyze !== false && questionImageIds(q).length && !modelSupportsImages(settings.model))
            .map(q => ({id:q.id,reason:'所选模型不支持图片，此题暂不分析；请选择支持图片的模型'}));
    }
    function collectBatchResults(snapshot, records, skippedQuestions, complete=false) {
        const answers=[],evidence={},modelsByQuestion={},mediaAnalysis=new Map();
        for(const record of records.filter(item=>item.status==='success')) {
            answers.push(...record.result.answers);
            Object.assign(evidence,record.evidence);
            for(const q of record.questions)modelsByQuestion[q.id]=record.model;
            for(const entry of record.result.mediaAnalysis)if(!mediaAnalysis.has(entry.imageIds[0]))mediaAnalysis.set(entry.imageIds[0],entry);
        }
        const byId=new Map(answers.map(answer=>[answer.id,answer]));
        const ordered=snapshot.questions.flatMap(q=>byId.has(q.id)?[byId.get(q.id)]:complete?[{id:q.id,number:q.number,type:q.type,answer:[],reason:skippedQuestions.find(item=>item.id===q.id)?.reason || q.diagnostics?.join('；') || '题型未适配，需人工核对'}]:[]);
        return {answers:ordered,evidence,modelsByQuestion,mediaAnalysis:[...mediaAnalysis.values()],skippedQuestions,analyzedCount:answers.length,batchCount:records.length};
    }
    function renderAnalysisProgress(task, complete=false) {
        if(controller?.task!==task || !task.snapshot)return;
        const result=collectBatchResults(task.snapshot,task.batches,task.skippedQuestions,complete);
        const {answers,...details}=result;
        const skipped=new Set(task.skippedQuestions.map(item=>item.id));
        const total=task.snapshot.questions.filter(q=>q.capabilities?.analyze!==false&&!skipped.has(q.id)).length;
        controller.output({version: '1.07',schemaVersion:task.snapshot.schemaVersion,questions:task.snapshot.questions,media:task.snapshot.media,
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
    async function withAnalysisRetry(action, {signal,enabled=false,report=()=>{}}={}) {
        for(let attempt=0;;attempt++) {
            throwIfAborted(signal);
            try {const value=await action();throwIfAborted(signal);return value;}
            catch(error) {
                throwIfAborted(signal);
                const transient=['NETWORK','TIMEOUT'].includes(error.code) || (error.code==='HTTP' && [502,503,504].includes(error.status));
                if(!enabled || attempt!==0 || !transient)throw error;
                report(`请求暂时失败：${error.message}；2 秒后自动重试一次`);
                await retryWait(signal);
            }
        }
    }
    async function solveQuestionBatches(snapshot, settings, report, {progress,onBatchComplete=()=>{},retryTransient=false}={}) {
        const skippedQuestions=analysisSkipped(snapshot,settings),skipped=new Set(skippedQuestions.map(item=>item.id));
        const analyzable=snapshot.questions.filter(q=>q.capabilities?.analyze!==false&&!skipped.has(q.id));
        const needed=new Set(analyzable.flatMap(questionImageIds));
        const check=()=>{throwIfAborted(settings.signal);checkSnapshot(snapshot);};
        const retry=(action,phase)=>withAnalysisRetry(action,{signal:settings.signal,enabled:retryTransient,report:message=>{check();report(message,phase);}});
        const prepared=progress?.preparedMedia || new Map();
        if(progress)progress.skippedQuestions=skippedQuestions;
        let records;
        try {
            await retry(()=>prepareQuestionMedia((snapshot.media || []).filter(item=>needed.has(item.id)),report,check,snapshot.doc || document,{signal:settings.signal,prepared}),'preparing-images');
            check();
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
                    const result=await retry(()=>askDeepSeek(settings.key,model,batch,settings.thinking,settings.effort,record.evidence,prepared,settings.signal),'generating');
                    check();record.result=result;record.status='success';
                    onBatchComplete(record,i);
                } catch(error) {
                    record.status=settings.signal?.aborted?'pending':'failed';record.error=error.message;
                    error.message=`第 ${i+1}/${records.length} 批未完成：${error.message}；本次尚未预填`;throw error;
                }
            }
            return collectBatchResults(snapshot,records,skippedQuestions,true);
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
        try {
            if(JSON.stringify(task.configuration)!==JSON.stringify(analysisConfiguration(settings)))throw new Error('分析配置已变化，请重新分析');
            const data=extract(task.snapshot.doc);
            if(signature(data.questions,data.media)!==task.snapshot.signature)throw new Error('题目或图片已变化，请重新分析');
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
                const data=extract();
                task.snapshot={doc:document,schemaVersion:data.schemaVersion,questions:data.questions,media:data.media,signature:signature(data.questions,data.media)};
            }
            task.snapshot.checkCurrent=()=>checkAnalysisTask(task);
            checkSnapshot(task.snapshot);task.status='preparing';task.skippedQuestions=analysisSkipped(task.snapshot,task.settings);renderAnalysisProgress(task);
            if(!task.snapshot.questions.some(q=>q.capabilities.analyze)) {
                task.status='complete';renderAnalysisProgress(task);ctl.report('已保留原始题目：当前题型尚未适配，请查看题目列表','done');return;
            }
            const result=await solveQuestionBatches(task.snapshot,{...task.settings,signal:task.abortController.signal},
                (message,phase)=>{checkAnalysisTask(task);ctl.report(message,phase);if(ctl.result?.analysisProgress?.status!==task.status)renderAnalysisProgress(task);},
                {progress:task,onBatchComplete:()=>renderAnalysisProgress(task),retryTransient:true});
            checkSnapshot(task.snapshot);task.status='complete';renderAnalysisProgress(task,true);
            if(!result.analyzedCount){ctl.report('所选模型不支持图片，此类题目暂不能分析，请选择支持图片的模型','done');return;}
            ctl.last={...task.snapshot,answers:result.answers};
            if(task.autoPrefill) {
                ctl.report('正在校验并预填…','prefilling');
                const summary=await prefillChecked(ctl.last,result.answers);checkAnalysisTask(task);
                ctl.output({...ctl.result,prefill:summary});
                ctl.report(summaryText(summary)+(result.skippedQuestions.length?`\n${result.skippedQuestions.length} 道图片题因模型不支持而跳过。`:''),'done');
            } else ctl.report(`AI 已分析 ${result.analyzedCount} 道题${result.skippedQuestions.length?`，${result.skippedQuestions.length} 道图片题因模型不支持而跳过`:''}，请核对结果后点击预填。`,'done');
        } catch(error) {
            if(ctl.task!==task)return;
            ctl.last=null;task.error=error.message;
            const changed=task.snapshot && (()=>{try{const data=extract(task.snapshot.doc);return signature(data.questions,data.media)!==task.snapshot.signature;}catch{return true;}})();
            task.status=changed?'stale':task.abortController.signal.aborted?'stopped':'failed';
            if(changed)task.preparedMedia.clear();
            renderAnalysisProgress(task);
            const completed=task.batches.filter(item=>item.status==='success').reduce((n,item)=>n+item.questions.length,0);
            const prefill=error.prefillSummary?`；已确认填写 ${error.prefillSummary.filled} 道，停止时正在处理的题目请核对，已写入内容保留`:'';
            ctl.report(`${task.status==='stopped'?'已停止分析':task.status==='stale'?'题目或图片已变化，请重新分析':'操作中止：'+error.message}；保留 ${completed} 道已分析结果${prefill}`,
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
        if(!configuration.configured){ctl.openPanel('model');ctl.report('请先配置模型：保存 DeepSeek API Key 并选择模型','error');return;}
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
                if (!panelView) return;
                movePanelToStudyPage();
                refreshCourseSidebar();
                panelView.shadow.getElementById('panel').hidden = false;
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
                    panel.hidden = true;
                    settingsButton()?.setAttribute('aria-expanded', 'false');
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
                catch (e) { ctl.report(`提取失败：${e.message}`, 'error'); }
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
                    ctl.report(`预填中止：${e.message}${e.prefillSummary ? `；已确认填写 ${e.prefillSummary.filled} 道，已写入内容保留，请核对停止时的题目` : ''}`,task?.abortController.signal.aborted?'stopped':'error');
                }
                finally { if(task)task.active=false;ctl.state.busy = false; renderRunState(ctl.state); }
            },
            async loadModels() {
                if (ctl.state.busy || courseRunActive()) return;
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
                    set(KEY_MODEL, select.value); invalidateAnalysisTask('分析配置已变化，请重新分析'); ctl.last = null;
                    ctl.report(`获取成功：${models.length} 个模型`, 'done');
                } catch (e) { ctl.report(`获取模型失败：${e.message}`, 'error'); }
                finally { ctl.state.busy = false; renderRunState(ctl.state); }
            }
        };
        document.defaultView.addEventListener('pagehide', () => {
            if(ctl.task){ctl.task.abortController.abort();ctl.task.preparedMedia.clear();ctl.task=null;ctl.last=null;}
        });
        return ctl;
    }

    function initQuizAssistant(doc = document) {
        if (!doc.body || !hasQuestionNodes(doc)) return;
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
        if (url.hostname !== 'mooc1.chaoxing.com' || !url.pathname.startsWith('/mycourse/studentstudy')) return;
        const content = doc.querySelector('#mainid #iframe');
        if (!content) return;
        if (!controller) controller = createController();
        createAssistantPanel(doc, controller);
        if (!studyToolbarView) {
            const host = doc.createElement('div');
            host.id = 'cx-ai-study-toolbar';
            host.style.cssText = 'display:flex;justify-content:flex-end;width:100%;max-width:100%;box-sizing:border-box;margin:8px 0 12px;clear:both';
            const shadow = host.attachShadow({ mode: 'open' });
            shadow.innerHTML = `<style>button{font:14px/1.5 system-ui,sans-serif;border:0;border-radius:7px;min-height:34px;padding:6px 12px;background:#edf2ff;color:#355dcc;cursor:pointer}button:focus-visible{outline:2px solid #3268df;outline-offset:2px}</style><button type="button" id="settings" aria-expanded="false">学习通AI助手</button>`;
            studyToolbarView = { host, shadow };
            shadow.getElementById('settings').onclick = () => {
                const quizDoc = findQuizPanel(doc.querySelector('#mainid #iframe')?.contentDocument);
                if (quizDoc) {
                    panelView.shadow.getElementById('panel').hidden = true;
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
        let scheduled = false;
        const refresh = () => {
            if (scheduled) return;
            scheduled = true;
            setTimeout(() => {
                scheduled = false;
                initQuizAssistant();
                initStudyAssistant();
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
    initCourseDocumentBridge();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startQuizObserver, { once: true });
    else startQuizObserver();
