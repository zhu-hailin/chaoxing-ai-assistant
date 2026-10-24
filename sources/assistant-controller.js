    // Controller state and user commands. The owner supplies live panel access and existing feature commands.
    // Keep asynchronous callbacks bound to the current panel instead of a captured panel instance.
    function createController({
        getPanel, getUiHidden,
        renderRunState, movePanelToStudyPage, refreshQuestionNavigation, get, KEY_ANALYSIS_CACHE_ENABLED,
        refreshCourseSidebar, setAssistantWindowMode, switchSettingsView, switchPanelView, positionAssistantPanel, settingsButton,
        renderResultList, runAnswerFlow, courseRunActive, invalidateAnalysisTask, ensureFontDecoded, extract, assistantErrorMessage,
        verifyRestoredAnalysis, questionPrefillCandidates, prefillChecked, summaryText, renderAnalysisProgress,
        readModelConfiguration, newAssistantDiagnosticTaskId, modelConnectionSignature, clean, detectConfiguredModelConnection,
        throwIfAborted, requestFailure, recordCxDiagnostic, fetchConfiguredModels, cancelledError, renderModelSettings, analysisSettingsChanged
    }) {
        const ctl = {
            state: { busy: false, phase: 'idle', message: '' }, last: null, result: null, task: null,
            report(message, phase = ctl.state.phase, busy = ctl.state.busy) {
                Object.assign(ctl.state, { message, phase, busy }); renderRunState(ctl.state);
            },
            openPanel(view, { placement, focus = false } = {}) {
                if (getUiHidden()) return;
                if (!getPanel()) return;
                movePanelToStudyPage();
                const questionsAvailable = refreshQuestionNavigation();
                getPanel().shadow.getElementById('analysis-cache-enabled').checked=get(KEY_ANALYSIS_CACHE_ENABLED,false)===true;
                if (placement && [placement.left, placement.top, placement.width, placement.height].every(Number.isFinite) && placement.width > 0 && placement.height > 0) {
                    getPanel().userPosition = { left: placement.left, top: placement.top };
                    getPanel().userSize = { width: placement.width, height: placement.height };
                }
                refreshCourseSidebar();
                setAssistantWindowMode('open');
                if (view === 'model') switchSettingsView('model');
                if (typeof view === 'string') switchPanelView(view, { focus: focus === true });
                else if (!questionsAvailable && getPanel().activeView === 'questions') switchPanelView('chapters');
                positionAssistantPanel();
                settingsButton()?.setAttribute('aria-expanded', 'true');
            },
            togglePanel() {
                if (!getPanel()) return;
                const panel = getPanel().shadow.getElementById('panel');
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
                if (ctl.state.busy || courseRunActive())return;
                if(ctl.task?.restoredReadOnly) {
                    const restoredTask=ctl.task;
                    if(!await verifyRestoredAnalysis({quiet:true}) || ctl.task!==restoredTask)return;
                }
                if (ctl.result?.analysisComplete===false || !questionPrefillCandidates(ctl.last,ctl.last?.answers).length) return;
                const task=ctl.task;
                if(task){task.active=true;task.operation='prefill';task.abortController=new AbortController();}
                ctl.report('正在校验并预填…', 'prefilling', true);
                try {
                    const summary = await prefillChecked(ctl.last, ctl.last.answers);
                    ctl.output({ ...ctl.result, prefill: summary });
                    ctl.report(summaryText(summary), 'done');
                }
                catch (e) {
                    ctl.last = null;
                    if(task){task.status=task.abortController.signal.aborted?'stopped':'stale';task.preparedMedia.clear();renderAnalysisProgress(task,true);}
                    if(e.prefillSummary)ctl.output({...ctl.result,prefill:e.prefillSummary});
                    ctl.report(`预填中止：${assistantErrorMessage(e,{module:'actions',operation:'prefill'})}${e.prefillSummary ? `；已确认填写 ${e.prefillSummary.filled} 道，已写入内容保留，请核对停止时的题目` : ''}`,task?.abortController.signal.aborted?'stopped':'error');
                }
                finally { if(task){task.active=false;task.operation=null;}ctl.state.busy = false; renderRunState(ctl.state); }
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
                    if(!getPanel()?.host.isConnected || modelConnectionSignature(readModelConfiguration())!==signature)
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
                const owner=getPanel()?.host.ownerDocument,body=owner?.body,abort=new AbortController();
                ctl.modelListTest=abort;
                const cancel=()=>abort.abort();window.addEventListener('pagehide',cancel,{once:true});
                ctl.report('正在获取模型列表…', 'idle', true);
                try {
                    const models = await fetchConfiguredModels(configuration,abort.signal);
                    throwIfAborted(abort.signal);
                    if(!owner || owner.body!==body || owner.defaultView?.document!==owner || !getPanel()?.host.isConnected || getPanel().host.ownerDocument!==owner)
                        throw cancelledError();
                    if (!models.length) throw new Error('模型列表没有有效条目');
                    const current=readModelConfiguration();
                    if(current.provider!==configuration.provider || current.baseURL!==configuration.baseURL || current.key!==configuration.key)
                        throw requestFailure('','CONFIG_CHANGED');
                    renderModelSettings(ctl, models);
                    analysisSettingsChanged('分析配置已变化，请重新分析');
                    ctl.report(`获取成功：${models.length} 个模型`, 'done');
                } catch (e) { ctl.report(`获取模型失败：${e.code==='CONFIG_CHANGED'?'配置已变化，请重新获取模型列表；':''}${assistantErrorMessage(e,{module:'model',operation:'list'})}`, 'error'); }
                finally {
                    window.removeEventListener('pagehide',cancel);
                    if(ctl.modelListTest===abort)ctl.modelListTest=null;
                    ctl.state.busy = false;
                    if(getPanel()?.host.isConnected && owner?.defaultView?.document===owner)renderRunState(ctl.state);
                }
            }
        };
        document.defaultView.addEventListener('pagehide', () => {
            ctl.modelListTest?.abort();
            if(ctl.task){clearTimeout(ctl.task.cacheTimer);ctl.task.abortController.abort();ctl.task.preparedMedia.clear();ctl.task.contentCache?.clear();ctl.task=null;ctl.last=null;}
        });
        return ctl;
    }

