    // 宿主组合入口：控制器通过参数使用已有功能，面板引用在使用时读取。
    function createAssistantController() {
        return createController({
            getPanel: () => panelView, getUiHidden: () => assistantUiHidden,
            renderRunState, movePanelToStudyPage, refreshQuestionNavigation, get, KEY_ANALYSIS_CACHE_ENABLED,
            refreshCourseSidebar, setAssistantWindowMode, switchSettingsView, switchPanelView,
            positionAssistantPanel, settingsButton, renderResultList, runAnswerFlow, courseRunActive,
            invalidateAnalysisTask, ensureFontDecoded, extract, assistantErrorMessage, verifyRestoredAnalysis,
            questionPrefillCandidates, prefillChecked, summaryText, renderAnalysisProgress, readModelConfiguration,
            newAssistantDiagnosticTaskId, modelConnectionSignature, clean, detectConfiguredModelConnection,
            throwIfAborted, requestFailure, recordCxDiagnostic, fetchConfiguredModels, cancelledError,
            renderModelSettings, analysisSettingsChanged
        });
    }

    function initQuizAssistant(doc = document) {
        if (!doc.body || !hasQuestionNodes(doc)) return;
        initCredentialSettings();
        if (!controller) controller = createAssistantController();
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
        if (!controller) controller = createAssistantController();
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
            const showCoursePanel = event => {
                const handoff = event.detail;
                if (handoff) {
                    const quizDoc = findStudyQuizPanel(doc, handoff.sourceDoc);
                    if (!quizDoc || quizDoc !== handoff.sourceDoc) return;
                    panelView.returnQuizDoc = quizDoc;
                }
                controller.openPanel('chapters', handoff || {});
            };
            doc.addEventListener('cx-ai-show-study-panel',showCoursePanel);
            doc.addEventListener('cx-ai-quiz-navigation-refresh', refreshQuestionNavigation);
            view.addEventListener('pagehide',()=>{
                doc.removeEventListener('cx-ai-show-study-panel',showCoursePanel);
                doc.removeEventListener('cx-ai-quiz-navigation-refresh', refreshQuestionNavigation);
            },{once:true});
            shadow.getElementById('settings').onclick = () => {
                const quizDoc = findStudyQuizPanel(doc, panelView.returnQuizDoc);
                panelView.returnQuizDoc = quizDoc;
                if (quizDoc) {
                    if (panelView.windowMode === 'open') quizDoc.dispatchEvent(new quizDoc.defaultView.CustomEvent('cx-ai-show-quiz-panel', {detail:assistantWindowHandoff()}));
                    else quizDoc.dispatchEvent(new quizDoc.defaultView.Event('cx-ai-toggle-quiz-panel'));
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
    function initCourseHomeAssistant(doc = document) {
        if(isCourseHomeURL(pageURL(doc),true)){
            const context=resolveCourseHomeCatalog(doc);if(context)readCourseHomeCatalog(context);
            mountCourseHomeChapterEntry(doc);return;
        }
        if(doc.defaultView!==doc.defaultView?.top || !isCourseHomeURL(pageURL(doc)) || !doc.body)return;
        const titles=doc.querySelectorAll('.classDl'),title=titles.length===1?titles[0]:null;
        if(!title)return;
        if(!controller)controller=createAssistantController();
        createAssistantPanel(doc,controller);
        doc.getElementById('cx-ai-course-home-toolbar')?.remove();
        mountCourseHomeChapterEntry(doc);
        refreshCourseSidebar();renderRunState(controller.state);
    }
    function startQuizObserver() {
        initOtherFeatures(document);
        startAssistantUpdateCheck();
        let scheduled = false;
        const refreshNavigation = () => {
            refreshQuestionNavigation();
            const owner=studyOwnerDocument(document);
            if(owner && owner!==document)owner.dispatchEvent(new owner.defaultView.Event('cx-ai-quiz-navigation-refresh'));
        };
        const refresh = () => {
            if (scheduled) return;
            scheduled = true;
            setTimeout(() => {
                scheduled = false;
                initQuizAssistant();
                initStudyAssistant();
                initCourseHomeAssistant();
                initCourseListAssistant();
                refreshNavigation();
                ensureFontDecoded().catch(error => {
                    if (controller && !controller.state.busy) controller.report(`字体解密失败：${assistantErrorMessage(error,{module:'parser',operation:'font'})}`, 'error');
                });
            }, 40);
        };
        const observer = new MutationObserver(records => {
            // Shadow DOM 不在观察范围内；显隐变化只刷新轻量导航，不重新解密整页。
            if (records.some(r => [...r.addedNodes, ...r.removedNodes].some(n =>
                n.nodeType === 1 && !n.id?.startsWith('cx-ai-') && n.className !== 'cx-ai-title-row'))) refresh();
            else if(records.some(record=>record.type==='attributes' &&
                (record.target.matches(QUESTION_SELECTOR+',iframe') || record.target.querySelector(QUESTION_SELECTOR)))) {
                if(!controller && hasQuestionNodes(document))refresh();else refreshNavigation();
            }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true,attributes:true,attributeFilter:['hidden','inert','style','class','src'] });
        const frameLoaded = event => { if (event.target?.tagName === 'IFRAME') refresh(); };
        document.addEventListener('load', frameLoaded, true);
        refresh();
        window.addEventListener('pagehide', () => {
            observer.disconnect();
            document.removeEventListener('load', frameLoaded, true);
            const owner = studyOwnerDocument(document);
            if (owner && owner !== document) owner.defaultView.setTimeout(() => owner.dispatchEvent(new owner.defaultView.Event('cx-ai-quiz-navigation-refresh')), 0);
        }, { once: true });
    }
    initCredentialSettings();
    initCourseDocumentBridge();
    initCourseHomeLaunchTransport();
    initCourseListTransport();
    initCourseQueueTransport();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startQuizObserver, { once: true });
    else startQuizObserver();
