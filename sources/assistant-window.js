    // 面板创建、跨文档窗口交接、拖动、缩放与最小化。
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
        initAssistantControlFeedback(shadow);
        initAssistantWindowCoordination(doc);
        initPanelDragging();
        initPanelResizing();
        initFloatingLauncher(ctl);
        const toggleFromStudy = () => ctl.togglePanel();
        const showFromStudy = event => {
            const handoff = event.detail;
            if (!handoff) { ctl.openPanel(); return; }
            const owner = studyOwnerDocument(doc);
            if (!owner || handoff.sourceDoc !== owner || findStudyQuizPanel(owner, doc) !== doc) return;
            // 接收方只切换本地视图，避免再次触发跨控制器导航。
            ctl.openPanel('questions', handoff);
        };
        doc.addEventListener('cx-ai-toggle-quiz-panel', toggleFromStudy);
        doc.addEventListener('cx-ai-show-quiz-panel', showFromStudy);
        window.addEventListener('pagehide', () => {
            doc.removeEventListener('cx-ai-toggle-quiz-panel', toggleFromStudy);
            doc.removeEventListener('cx-ai-show-quiz-panel', showFromStudy);
        }, { once: true });
        initCourseSidebar();
        initPanelNavigation();
        initOtherFeatureControls(shadow,doc);
        initCourseRunControls(doc, ctl, panelView);
        initResultControls(ctl);
        const el = id => shadow.getElementById(id);
        el('analysis-cache-enabled').checked=get(KEY_ANALYSIS_CACHE_ENABLED,false)===true;
        el('analysis-cache-enabled').onchange=()=>{
            set(KEY_ANALYSIS_CACHE_ENABLED,el('analysis-cache-enabled').checked);
            if(!el('analysis-cache-enabled').checked)clearAnalysisCache();
            else if(ctl.task)saveAnalysisCache(ctl.task).catch(()=>{});
        };
        el('analysis-cache-restore').onclick=event=>{if(trustedAssistantActivation(event,el('analysis-cache-restore')))restoreAnalysisCache();};
        el('analysis-cache-clear').onclick=event=>{if(trustedAssistantActivation(event,el('analysis-cache-clear')))clearAnalysisCache();};
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
        const about = el('about');
        initProjectIntroDragging();
        const showProjectIntro = () => {
            if (!about.open) about.showModal();
            panelView.repositionProjectIntro();
            el('about-toggle').setAttribute('aria-expanded', 'true');
            el('about-close').focus();
        };
        el('about-toggle').onclick = showProjectIntro;
        el('about-close').onclick = closeProjectIntro;
        about.addEventListener('click', event => { if (event.target === about) closeProjectIntro(); });
        about.addEventListener('keydown', event => { if (event.key === 'Escape') event.stopPropagation(); });
        about.addEventListener('close', () => {
            panelView.cancelProjectIntroDrag();
            el('about-toggle').setAttribute('aria-expanded', String(about.open));
            if (!about.open && panelView.windowMode === 'open') el('about-toggle').focus();
        });
        el('github').onclick = () => {
            if (/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(PROJECT_GITHUB_URL)) {
                window.open(PROJECT_GITHUB_URL, '_blank', 'noopener,noreferrer');
            } else {
                showProjectIntro();
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
            analysisSettingsChanged('分析配置已变化，请重新分析');
            renderRunState(ctl.state);
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
        el('analysis-concurrency').onchange = () => {
            const value = el('analysis-concurrency').value;
            if (!/^[1-7]$/.test(value)) { el('analysis-concurrency').value = readModelConfiguration().analysisConcurrency; return; }
            set(KEY_ANALYSIS_CONCURRENCY,Number(value));
        };
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
                if(result.images===true){renderModelSettings(ctl);analysisSettingsChanged('模型图片能力已更新，请重新分析');ctl.report('当前模型已通过图片识别测试','capability-check',true);}
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

    function initProjectIntroDragging() {
        const { shadow, host } = panelView, view = host.ownerDocument.defaultView;
        const dialog = shadow.getElementById('about'), heading = dialog.querySelector('.about-heading');
        let drag = null, positioned = false;
        const position = (left, top) => {
            const rect = dialog.getBoundingClientRect();
            left = Math.max(0, Math.min(left, view.innerWidth - rect.width));
            top = Math.max(0, Math.min(top, view.innerHeight - rect.height));
            Object.assign(dialog.style, { inset: 'auto', margin: '0', left: `${left}px`, top: `${top}px` });
            positioned = true;
        };
        const cancel = () => {
            const id = drag?.id;
            drag = null;
            if (id !== undefined && heading.hasPointerCapture(id)) heading.releasePointerCapture(id);
        };
        const reposition = () => {
            cancel();
            if (!dialog.open || !positioned) return;
            const rect = dialog.getBoundingClientRect();
            position(rect.left, rect.top);
        };
        heading.addEventListener('pointerdown', event => {
            if (event.button !== 0 || event.target.closest('button,a')) return;
            const rect = dialog.getBoundingClientRect();
            drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
            heading.setPointerCapture(event.pointerId);
            event.preventDefault();
        });
        heading.addEventListener('pointermove', event => {
            if (drag?.id === event.pointerId) position(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
        });
        for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) heading.addEventListener(type, cancel);
        panelView.cancelProjectIntroDrag = cancel;
        panelView.repositionProjectIntro = reposition;
        view.addEventListener('resize', reposition);
        view.addEventListener('pagehide', () => { cancel(); view.removeEventListener('resize', reposition); }, { once: true });
    }

    function closeProjectIntro() {
        panelView?.cancelProjectIntroDrag?.();
        const dialog = panelView?.shadow.getElementById('about');
        if (dialog?.open) dialog.close();
        panelView?.shadow.getElementById('about-toggle').setAttribute('aria-expanded', 'false');
    }

    function setAssistantWindowMode(mode) {
        if (!panelView || !['open','minimized','closed'].includes(mode)) return;
        if (assistantUiHidden) return;
        clearAssistantControlFeedback();
        if(mode!=='open')closeProjectIntro();
        if(mode!=='open')closeResultImage();
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

