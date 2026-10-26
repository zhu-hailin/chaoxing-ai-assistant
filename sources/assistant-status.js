    // 运行进度、操作按钮资格和配置状态展示。
    function renderRunState(state) {
        if (!document?.defaultView || document.defaultView.document !== document) return;
        const busy = state.busy || courseRunActive() || courseQueueActive();
        const busyReason = state.busy ? '当前操作进行中，请等待完成或先停止' : '自动学习运行中，请先停止再操作';
        const errorCode=panelView?.shadow.getElementById('last-error-code');
        if(errorCode)errorCode.textContent=state.lastErrorCode || '';
        if (toolbarView) {
            const s = toolbarView.shadow;
            setAssistantControlDisabled(s.getElementById('generate'),busy,busyReason);
            s.querySelector('.spinner').hidden = !busy;
            s.getElementById('generate').setAttribute('aria-busy', String(busy));
            const labels = { decoding: '解密中…', extracting: '提取中…', 'preparing-images':'读取图片…', classifying:'判断作答要求…', searching: '检索中…', generating: '生成中…', prefilling: '预填中…' };
            s.getElementById('label').textContent = state.busy ? (labels[state.phase] || '处理中…') : '一键生成答案';
            s.getElementById('status').textContent = '';
            s.getElementById('status').hidden = true;
        }
        if (panelView) {
            refreshQuestionNavigation();
            const s = panelView.shadow;
            const configuration = readModelConfiguration();
            s.getElementById('analysis-cache-enabled').checked=get(KEY_ANALYSIS_CACHE_ENABLED,false)===true;
            const storedTask=controller?.task;
            if(storedTask?.snapshot && !storedTask.active && storedTask.resultsByQuestion.size) {
                const changed=JSON.stringify(storedTask.configuration)!==JSON.stringify(analysisConfiguration(configuration));
                if(changed!==storedTask.configurationChanged) {
                    storedTask.configurationChanged=changed;
                    if(controller.result)renderResultList(controller.result);
                }
            }
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
            for (const id of ['extract', 'solve', 'models', 'detect-model', 'detect-images', 'provider', 'model', 'thinking', 'effort', 'search', 'custom-base', 'custom-model', 'custom-images', 'save-custom', 'auto-context', 'info-model', 'info-interval']) setAssistantControlDisabled(s.getElementById(id),busy,busyReason);
            s.getElementById('cancel-images').hidden=!controller?.capabilityTest;
            setAssistantControlDisabled(s.getElementById('cancel-images'),controller?.capabilityTest?.signal.aborted===true,'正在取消图片检测');
            s.getElementById('cancel-model-test').hidden=!controller?.connectionTest;
            setAssistantControlDisabled(s.getElementById('cancel-model-test'),controller?.connectionTest?.signal.aborted===true,'正在取消连接检测');
            const connection=controller?.connectionResult;
            const currentConnection=connection?.signature===modelConnectionSignature(configuration)?connection:null;
            s.getElementById('model-test-status').textContent=currentConnection?.message||'尚未检测';
            s.getElementById('model-test-status').dataset.state=currentConnection?.state||'idle';
            refreshModelCapabilities(s, busy);
            const restoredTask=controller?.task,restoredAnswers=restoredTask?.restoredReadOnly && restoredTask.batches.every(record=>record.status==='success')?[...restoredTask.resultsByQuestion.values()]:[];
            const prefillSource=restoredAnswers.length?{...restoredTask.snapshot,rootSnapshot:restoredTask.snapshot,answers:restoredAnswers}:controller?.last;
            const hasPrefill = !busy && controller?.result?.analysisComplete!==false && questionPrefillCandidates(prefillSource,prefillSource?.answers).length > 0;
            const prefillReason = busy ? busyReason : controller?.result?.analysisComplete===false ? '仍有题目未完成，请先重试未完成题目' : !prefillSource?.answers?.length ? '请先完成 AI 分析，再预填答案' : '当前答案暂无符合预填条件的控件，可查看各题预填状态';
            setAssistantControlDisabled(s.getElementById('prefill'),busy || controller?.result?.analysisComplete===false || !hasPrefill,prefillReason);
            setAssistantControlDisabled(s.getElementById('analysis-cache-restore'),busy,busyReason);
            setAssistantControlDisabled(s.getElementById('analysis-cache-clear'),busy,busyReason);
            const task=controller?.task;
            s.getElementById('analysis-stop').hidden = !state.busy || !task?.active;
            setAssistantControlDisabled(s.getElementById('analysis-stop'),!state.busy || !task?.active || task.abortController.signal.aborted,task?.abortController.signal.aborted ? '正在停止分析，请稍候' : '当前没有运行中的分析');
            s.getElementById('analysis-stop').textContent = task?.abortController.signal.aborted ? '正在停止…' : '停止分析';
            s.getElementById('analysis-resume').hidden = !task?.snapshot || !['failed','stopped','restored'].includes(task.status) || !task.batches.some(record=>['failed','cancelled'].includes(record.status));
            setAssistantControlDisabled(s.getElementById('analysis-resume'),busy,busyReason);
            for(const button of s.querySelectorAll('[data-analysis-retry]'))setAssistantControlDisabled(button,busy,busyReason);
            const hasQuestions = hasQuestionNodes(document);
            for (const id of ['extract', 'solve']) setAssistantControlDisabled(s.getElementById(id),busy || !hasQuestions,busy ? busyReason : '当前页面暂无可用题目');
            setAssistantControlDisabled(s.getElementById('catalog-refresh'),busy,busyReason);
            for (const button of s.querySelectorAll('[data-chapter-button]')) setAssistantControlDisabled(button,busy || button.dataset.navigationAvailable!=='true',busy ? busyReason : button.dataset.navigationReason);
            panelView.renderCourseRunControls?.();
            panelView.renderOtherFeatureControls?.();
            refreshQuestionPresentation();
        }
    }

