    // 题目、章节、设置与跨面板导航。
    // Only move existing controls; their handlers, disabled reasons and trust checks stay attached.
    function initQuestionPresentation() {
        const { shadow } = panelView;
        const more = shadow.getElementById('question-more');
        const summary = more.querySelector('summary');
        const menu = shadow.getElementById('question-more-menu');
        panelView.questionCommands = ['extract','solve','prefill','analysis-stop','analysis-resume','copy']
            .map(id => shadow.getElementById(id));
        const close = (focus = false) => {
            more.open = false;
            if (focus) summary.focus({ preventScroll:true });
        };
        more.addEventListener('toggle', () => summary.setAttribute('aria-expanded', String(more.open)));
        shadow.addEventListener('pointerdown', event => {
            if (more.open && !event.composedPath().includes(more)) close();
        });
        more.addEventListener('focusout', event => {
            if (event.relatedTarget && !more.contains(event.relatedTarget)) close();
        });
        more.addEventListener('keydown', event => {
            if (event.key === 'Escape' && more.open) {
                event.preventDefault(); event.stopPropagation(); close(true);
            }
        });
        menu.addEventListener('click', event => {
            const button = event.target.closest('button');
            if (button && !button.disabled) close(true);
        });
        refreshQuestionPresentation();
    }
    function refreshQuestionPresentation() {
        if (!panelView?.questionCommands) return;
        const { shadow, questionCommands } = panelView;
        const getControl = id => shadow.getElementById(id);
        const primary = getControl('question-primary-actions'), menu = getControl('question-more-menu');
        const stop = getControl('analysis-stop'), resume = getControl('analysis-resume'), prefill = getControl('prefill');
        const selected = !stop.hidden ? stop : !resume.hidden ? resume : !prefill.disabled ? prefill
            : panelView.resultView?.data?.questions?.length ? getControl('solve') : getControl('extract');
        const focused = shadow.activeElement;
        for (const button of questionCommands) {
            const parent = button === selected ? primary : menu;
            if (button.parentElement !== parent) parent.append(button);
        }
        if (focused && !getControl('question-more').open && menu.contains(focused)) {
            (selected.disabled ? getControl('question-more').querySelector('summary') : selected).focus({ preventScroll:true });
        }
    }

    function mountQuizToolbar(doc, ctl) {
        const existing = doc.getElementById('cx-ai-toolbar') || (toolbarView?.host.ownerDocument === doc ? toolbarView.host : null);
        if (existing) { placeQuizToolbar(doc, existing, resolveToolbarTarget(doc)); return; }
        const host = doc.createElement('div');
        host.id = 'cx-ai-toolbar';
        host.style.cssText = 'display:block;min-width:0;max-width:100%;margin-left:auto';
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `<style>
          :host{font:14px/1.5 system-ui,sans-serif;color:#646d72}
          *{box-sizing:border-box}.buttons{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}
          button{font:inherit;border:0;border-radius:7px;min-height:34px;padding:6px 12px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;max-width:100%}
          #generate{background:#3569d4;color:white}#settings{background:#f5f6f8;color:#3569d4}
          button[hidden]{display:none}button:disabled{opacity:.65;cursor:wait}button:focus-visible{outline:2px solid #3569d4;outline-offset:2px}
          .spinner{width:15px;height:15px;flex:none;border:2px solid #ffffff66;border-top-color:white;border-radius:50%;animation:cx-spin .8s linear infinite}
          .spinner[hidden]{display:none}@keyframes cx-spin{to{transform:rotate(360deg)}}
          @media(prefers-reduced-motion:reduce){.spinner{animation:none}}
          #status{font-size:12px;text-align:right;overflow-wrap:anywhere;max-width:360px;margin-top:4px}
          #status:empty{display:none}
        </style><div class="buttons"><button type="button" id="generate"><span class="spinner" hidden aria-hidden="true"></span><span id="label">一键生成答案</span></button><button type="button" id="settings">学习通AI助手</button></div><div id="status" role="status" aria-live="polite"></div>`;
        registerAssistantUiHost(host);
        placeQuizToolbar(doc, host, resolveToolbarTarget(doc));
        toolbarView = { host, shadow };
        initAssistantControlFeedback(shadow);
        shadow.getElementById('generate').onclick = event => { if (trustedAssistantActivation(event, shadow.getElementById('generate'))) ctl.runAnswerFlow({ autoPrefill: true }); };
        shadow.getElementById('settings').hidden = Boolean(studyOwnerDocument(doc));
        shadow.getElementById('settings').onclick = () => ctl.togglePanel();
    }

    function refreshQuestionNavigation() {
        if (!panelView) return false;
        const { sourceDoc, shadow } = panelView;
        const owner = studyOwnerDocument(sourceDoc);
        let available = hasQuestionNodes(sourceDoc);
        if (owner) {
            const quizDoc = findStudyQuizPanel(owner, owner === sourceDoc ? panelView.returnQuizDoc : sourceDoc);
            available = owner === sourceDoc ? Boolean(quizDoc) : quizDoc === sourceDoc;
            if (owner === sourceDoc) panelView.returnQuizDoc = quizDoc;
        }
        const button = shadow.getElementById('nav-questions');
        setAssistantControlDisabled(button,!available,'当前页面暂无可用题目');
        button.title = available ? '题目' : '当前页面暂无可用题目';
        button.tabIndex = available && button.getAttribute('aria-selected') === 'true' ? 0 : -1;
        return available;
    }
    function switchPanelView(view, { focus = false, accountAuthorized = false } = {}) {
        if (!panelView || !['model','questions','chapters','other','account'].includes(view)) return;
        clearAssistantControlFeedback();
        if (!refreshQuestionNavigation() && view === 'questions') view = 'chapters';
        const { shadow } = panelView;
        shadow.getElementById('question-more').open = false;
        for (const button of shadow.querySelectorAll('[data-panel-view]')) {
            const selected = button.dataset.panelView === view;
            button.setAttribute('aria-selected', String(selected));
            button.tabIndex = selected && !button.disabled ? 0 : -1;
            shadow.getElementById(button.getAttribute('aria-controls')).hidden = !selected;
        }
        shadow.getElementById('course-nav').hidden = view !== 'chapters';
        shadow.getElementById('panel').dataset.activeView = view;
        closeProjectIntro();
        panelView.activeView = view;
        if(view==='account')panelView.loadAccountProfile?.({allowRemote:accountAuthorized});
        else panelView.cancelAccountProfile?.();
        if (view === 'chapters') refreshCourseSidebar();
        if (focus) shadow.getElementById(`nav-${view}`).focus();
    }
    function switchChapterView(view, { focus = false } = {}) {
        if (!panelView || !['queue','run','catalog'].includes(view)) return;
        if(view==='catalog'&&isCourseListPage(panelView.sourceDoc))return;
        clearAssistantControlFeedback();
        const { shadow } = panelView;
        for (const button of shadow.querySelectorAll('[data-chapter-view]')) {
            const selected = button.dataset.chapterView === view;
            button.setAttribute('aria-selected',String(selected));
            button.tabIndex = selected ? 0 : -1;
            shadow.getElementById(button.getAttribute('aria-controls')).hidden = !selected;
        }
        shadow.getElementById('catalog-refresh').hidden = view !== 'catalog';
        shadow.getElementById('catalog-locate').hidden = view !== 'catalog';
        shadow.getElementById('catalog-heading-actions').hidden = view !== 'catalog';
        shadow.getElementById('course-nav').dataset.activeView = view;
        // 只改变显示与目录读取，不启动/停止 runner，不重置搜索、报告或配置。
        if (view === 'catalog') refreshCourseSidebar();
        if (view === 'queue') panelView.refreshCourseWheel?.();
        if (focus) shadow.getElementById(`chapter-tab-${view}`).focus();
    }
    function switchSettingsView(view, { focus = false } = {}) {
        if (!panelView || !['model','learning','developer'].includes(view)) return;
        clearAssistantControlFeedback();
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
            if (!refreshQuestionNavigation() && view === 'questions') return;
            const owner=studyOwnerDocument(panelView.sourceDoc);
            if(view==='chapters' && owner && owner!==panelView.sourceDoc && owner.getElementById('cx-ai-study-toolbar')) {
                owner.dispatchEvent(new owner.defaultView.CustomEvent('cx-ai-show-study-panel', {detail:assistantWindowHandoff(options)}));
                return;
            }
            if(view==='questions' && owner===panelView.sourceDoc) {
                const quizDoc = findStudyQuizPanel(owner, panelView.returnQuizDoc);
                panelView.returnQuizDoc = quizDoc;
                if (quizDoc) quizDoc.dispatchEvent(new quizDoc.defaultView.CustomEvent('cx-ai-show-quiz-panel', {detail:assistantWindowHandoff(options)}));
                return;
            }
            switchPanelView(view,options);
        };

        buttons.forEach(button => {
            button.onclick = event => activate(button.dataset.panelView,button.dataset.panelView==='account'?{accountAuthorized:trustedAssistantActivation(event,button)}:{});
            button.addEventListener('keydown', event => {
                refreshQuestionNavigation();
                const available = buttons.filter(item => !item.disabled);
                const index = available.indexOf(button);
                if (index < 0) return;
                let next;
                if (event.key === 'ArrowDown') next = (index + 1) % available.length;
                else if (event.key === 'ArrowUp') next = (index + available.length - 1) % available.length;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = available.length - 1;
                else return;
                event.preventDefault(); event.stopPropagation();
                activate(available[next].dataset.panelView, {focus:true,accountAuthorized:available[next].dataset.panelView==='account'&&trustedAssistantActivation(event,button,'keydown')});
            });
        });
        const chapterButtons = [...panelView.shadow.querySelectorAll('[data-chapter-view]')];
        chapterButtons.forEach(button => {
            button.onclick = () => switchChapterView(button.dataset.chapterView);
            button.addEventListener('keydown',event => {
                const available=chapterButtons.filter(item=>!item.disabled),index=available.indexOf(button);
                if(index<0)return;
                let next;
                if(event.key==='ArrowRight') next=(index+1)%available.length;
                else if(event.key==='ArrowLeft') next=(index+available.length-1)%available.length;
                else if(event.key==='Home') next=0;
                else if(event.key==='End') next=available.length-1;
                else return;
                event.preventDefault();event.stopPropagation();
                switchChapterView(available[next].dataset.chapterView,{focus:true});
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
        switchSettingsView('learning');
        switchChapterView('queue');
        switchPanelView('questions');
    }
