    // 助手窗口共享状态、标题入口、可见性及所属文档。
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
            clearAssistantControlFeedback();
            panelView?.cancelFloatingDrag?.();
            panelView?.clearStopConfirmation?.();
            panelView?.clearRetryConfirmation?.();
            panelView?.cancelAccountProfile?.();
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
            const quiz = owner && findStudyQuizPanel(owner, panelView?.returnQuizDoc);
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
    const settingsButton = () => studyOwnerDocument()?.getElementById('cx-ai-study-toolbar')?.shadowRoot?.getElementById('settings') || (toolbarView || studyToolbarView)?.shadow.getElementById('settings') || document.getElementById('cx-ai-course-home-toolbar')?.shadowRoot?.querySelector('button');

    function findQuizPanel(doc, depth = 0, preferredDoc = null) {
        if (!doc || depth > 12) return null;
        let found = hasQuestionNodes(doc) && doc.getElementById(ROOT_ID) ? doc : null;
        if (found && (!preferredDoc || found === preferredDoc)) return found;
        for (const frame of doc.querySelectorAll('iframe')) {
            if (frame.hidden || frame.closest('[hidden]') || doc.defaultView.getComputedStyle(frame).display === 'none') continue;
            try {
                const candidate = findQuizPanel(frame.contentDocument, depth + 1, preferredDoc);
                if (candidate && (!preferredDoc || candidate === preferredDoc)) return candidate;
                found ||= candidate;
            } catch { /* 不访问跨域子文档。 */ }
        }
        return found;
    }
    function findStudyQuizPanel(owner, preferredDoc = null) {
        try {
            const frame = owner?.querySelector('#mainid #iframe');
            if (!frame || frame.hidden || frame.closest('[hidden]') || owner.defaultView.getComputedStyle(frame).display === 'none') return null;
            // 只在当前课程的实际 iframe 树中查找，旧文档引用不授予返回资格。
            return findQuizPanel(frame.contentDocument, 0, preferredDoc);
        } catch { return null; /* 跨域或尚未就绪时保留当前窗口。 */ }
    }
    function assistantWindowHandoff({ focus = false } = {}) {
        const rect = panelView.shadow.getElementById('panel').getBoundingClientRect();
        return {
            sourceDoc: panelView.sourceDoc,
            placement: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
            focus: focus === true
        };
    }
    const PROJECT_GITHUB_URL = 'https://github.com/zhu-hailin/chaoxing-ai-assistant';
