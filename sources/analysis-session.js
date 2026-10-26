    // 分析任务、材料准备、并发调度接入、结果合并与恢复。
    // 保留调用入口；所有题目独立请求，不再按学科或题型共享输出预算。
    function splitQuestionBatches(questions) { return questions.map(question=>[question]); }
    function analysisConfiguration(settings) {
        return {...modelConfigurationSignature(settings),credentialFingerprint:endpointFingerprint(settings.key || '')};
    }
    function currentAnalysisSettings() {
        return readModelConfiguration();
    }
    let assistantTaskSequence=0;
    function newAssistantDiagnosticTaskId() {return `cx-task-${++assistantTaskSequence}`;}
    function analysisTaskCourseIdentity(doc=document) {
        try{return courseScoreKey(studyOwnerDocument(doc) || doc);}catch{return null;}
    }
    function createAnalysisTask(snapshot, settings, autoPrefill) {
        return {id:Symbol('analysis'),diagnosticTaskId:newAssistantDiagnosticTaskId(),snapshot,configuration:analysisConfiguration(settings),settings:Object.freeze({...settings}),
            originCourseIdentity:analysisTaskCourseIdentity(snapshot?.doc || document),
            concurrency:analysisConcurrency(settings.analysisConcurrency),execution:0,resultsByQuestion:new Map(),retryGate:{notBefore:0,failures:0,paused:false},
            autoPrefill,status:'preparing',operation:null,configurationChanged:false,abortController:new AbortController(),preparedMedia:new Map(),contentCache:new Map(),imageDigests:new Map(),answerPolicies:new Map(),batches:[],skippedQuestions:[]};
    }
    function checkAnalysisTask(task) {
        throwIfAborted(task.abortController.signal);
        if(controller?.task!==task)throw cancelledError();
        if(task.originCourseIdentity && task.originCourseIdentity!==analysisTaskCourseIdentity(task.snapshot?.doc || document))
            throw createCxError('CX-PAR-008',{module:'analysis',operation:'snapshot'});
        if(task.active && task.operation==='analysis' && JSON.stringify(task.configuration)!==JSON.stringify(analysisConfiguration(currentAnalysisSettings()))) {
            const error=new Error('分析配置已变化，请重新分析');error.code='ANALYSIS_CONFIG_CHANGED';throw error;
        }
    }
    function analysisProgressText(progress) {
        const state={preparing:'正在准备',running:'正在分析',failed:'分析结束',stopped:'已停止',stale:'题目或配置已变化',complete:'AI 分析完成',restored:'已恢复，只读查看'}[progress.status] || progress.status;
        return `${state}：已完成 ${progress.completed}/${progress.total}，运行中 ${progress.running || 0}，等待 ${progress.waiting || 0}，重试等待 ${progress.retryWaiting || 0}，失败 ${progress.failed || 0}`
            +(progress.skipped?`，跳过 ${progress.skipped}`:'')+(progress.cancelled?`，取消 ${progress.cancelled}`:'');
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
            if(local.status==='auto' && questionImageIds(q).length && !modelSupportsImages(settings.model,settings))
                policies.set(q.id,{status:'uncertain',category:'images',reason:'所选模型不支持图片，此题需人工确认',evidence:''});
            else policies.set(q.id,local);
        }
        return policies;
    }
    function analysisRequestUsage(record) {
        const usage=record.result?.usage || {},result={model:record.model || '',attempts:record.requestAttempts || 0};
        const fields={promptTokens:usage.prompt_tokens ?? usage.input_tokens,completionTokens:usage.completion_tokens ?? usage.output_tokens,
            totalTokens:usage.total_tokens,reasoningTokens:usage.completion_tokens_details?.reasoning_tokens ?? usage.output_tokens_details?.reasoning_tokens ?? usage.reasoning_tokens};
        for(const [key,value] of Object.entries(fields))if(Number.isSafeInteger(value)&&value>=0)result[key]=value;
        return result;
    }
    function collectBatchResults(snapshot, records, skippedQuestions, complete=false, policies=new Map(),resultsByQuestion) {
        const answers=[],evidence={},modelsByQuestion={},requestUsageByQuestion={},mediaAnalysis=new Map(),analysisStates=Object.create(null);
        for(const record of records)for(const q of record.questions)analysisStates[q.id]={status:record.status,attempts:record.attempts || 0,
            phase:record.phase || 'solve',...(record.error?{error:record.error,code:record.errorCode}:{}),...(record.status==='retry-wait'?{retryAt:record.retryAt}:{})};
        for(const record of records)for(const q of record.questions)requestUsageByQuestion[q.id]=record.restoredUsage || analysisRequestUsage(record);
        for(const record of records.filter(item=>item.status==='success')) {
            const entries=resultsByQuestion?record.questions.map(q=>resultsByQuestion.get(q.id)).filter(Boolean):record.result.answers;
            for(const entry of entries) {
                const policy=entry.answerPolicy || policies.get(entry.id);
                answers.push({...entry,...(policy?{answerPolicy:policy}:{})});
            }
            Object.assign(evidence,record.evidence);
            for(const q of record.questions)modelsByQuestion[q.id]=record.model;
            for(const entry of record.result.mediaAnalysis)for(const id of entry.imageIds)if(!mediaAnalysis.has(id))mediaAnalysis.set(id,{...entry,imageIds:[id]});
        }
        const byId=new Map(answers.map(answer=>[answer.id,answer]));
        const ordered=snapshot.questions.flatMap(q=>byId.has(q.id)?[byId.get(q.id)]:complete?[{id:q.id,number:q.number,type:q.type,answer:[],answerPolicy:policies.get(q.id) || questionLocalAnswerPolicy(q),reason:analysisStates[q.id]?.error || skippedQuestions.find(item=>item.id===q.id)?.reason || q.diagnostics?.join('；') || '尚未生成答案'}]:[]);
        const answerPolicies=Object.fromEntries(policies);
        for(const entry of answers)if(entry.answerPolicy)answerPolicies[entry.id]=entry.answerPolicy;
        const count=status=>records.filter(record=>record.status===status).length;
        const analysisComplete=records.every(record=>['success','skipped'].includes(record.status));
        return {answers:ordered,answerPolicies,evidence,modelsByQuestion,requestUsageByQuestion,mediaAnalysis:[...mediaAnalysis.values()],skippedQuestions,analysisStates,
            analysisComplete,
            analysisProgress:{status:analysisComplete?'complete':count('pending')+count('ready')+count('preparing')+count('running')+count('retry-wait')?'running':'failed',
                completed:answers.length,total:snapshot.questions.length,running:count('running'),waiting:count('pending')+count('ready')+count('preparing'),retryWaiting:count('retry-wait'),
                failed:count('failed'),cancelled:count('cancelled'),skipped:count('skipped')},
            analysisFailures:records.filter(record=>['failed','cancelled'].includes(record.status)).map(record=>({id:record.questions[0].id,code:record.errorCode,reason:record.error})),
            manualCount:Object.values(answerPolicies).filter(p=>p.status==='manual').length,
            uncertainCount:Object.values(answerPolicies).filter(p=>p.status==='uncertain').length,
            analyzedCount:answers.filter(a=>a.answer.length).length,batchCount:records.length};
    }
    function renderAnalysisProgress(task, complete=false) {
        if(controller?.task!==task || !task.snapshot)return;
        if(task.status==='stale'){controller.clearOutput();return;}
        const result=questionResultProjection(task.requestSnapshot||task.snapshot,collectBatchResults(task.requestSnapshot||task.snapshot,task.batches,task.skippedQuestions,complete,task.answerPolicies,task.resultsByQuestion));
        const {answers,...details}=result;
        const skipped=new Set(task.skippedQuestions.map(item=>item.id));
        const total=(task.requestSnapshot||task.snapshot).questions.length;
        const count=status=>task.batches.filter(record=>record.status===status).length;
        const mediaPreviews=Object.fromEntries([...task.preparedMedia].filter(([,value])=>['svg','canvas'].includes(value.kind) && /^data:image\/png;base64,/.test(value.dataUrl || '')).map(([id,value])=>[id,value.dataUrl]));
        controller.output({version: '1.32',schemaVersion:task.snapshot.schemaVersion,questions:task.snapshot.questions,media:task.snapshot.media,mediaPreviews,
            restoredReadOnly:task.restoredReadOnly===true,
            model:task.configuration.model,thinking:task.configuration.thinking,searchEnabled:task.configuration.search,total:task.snapshot.questions.length,
            ...details,...(answers.length || complete ? {answers} : {}),analysisProgress:{status:task.status,completed:result.analyzedCount,total,
                running:count('running'),waiting:task.batches.length?count('pending')+count('ready')+count('preparing'):total-skipped.size,retryWaiting:count('retry-wait'),
                failed:count('failed'),skipped:skipped.size,cancelled:count('cancelled')}});
    }
    function retryWait(signal) {
        return analysisDelay(2000,signal);
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
    async function solveQuestionBatches(snapshot, settings, report, {progress,onBatchComplete=()=>{},onProgress=()=>{},retryTransient=false,questionIds}={}) {
        snapshot=questionAnswerSnapshot(snapshot);
        if(progress)progress.requestSnapshot=snapshot;
        const parentSignal=settings.signal,abort=new AbortController(),configuration=analysisConfiguration(settings);
        const generation=progress?++progress.execution:0;
        let failureCause=null;
        const cancel=error=>{failureCause ||= error;abort.abort();};
        const parentAbort=()=>cancel(cancelledError());
        parentSignal?.addEventListener('abort',parentAbort,{once:true});
        if(parentSignal?.aborted)parentAbort();
        const check=()=>{
            if(failureCause)throw failureCause;
            throwIfAborted(abort.signal);
            try {
                if(progress && (controller?.task!==progress || progress.execution!==generation))throw cancelledError();
                if(JSON.stringify(configuration)!==JSON.stringify(analysisConfiguration(currentAnalysisSettings())))
                    throw Object.assign(new Error('分析配置已变化，请重新分析'),{code:'ANALYSIS_CONFIG_CHANGED'});
                checkSnapshot(snapshot);
            } catch(error){cancel(error);throw error;}
        };
        const guarded=()=>{try{check();}catch(error){cancel(error);}};
        const guardTimer=setInterval(guarded,500);
        const views=new Set([snapshot.doc?.defaultView,...[...(snapshot.bindings?.values() || [])].map(binding=>binding.node?.ownerDocument?.defaultView)].filter(Boolean));
        const leaving=()=>cancel(createCxError('CX-PAR-008',{module:'analysis',operation:'snapshot'},{legacyCode:'SNAPSHOT_CHANGED'}));
        for(const view of views)view.addEventListener('pagehide',leaving,{once:true});
        const retry=(action,phase)=>withAnalysisRetry(action,{signal:abort.signal,enabled:retryTransient,onRetry:()=>settings.onModelRetry?.(),report:message=>{check();report(message,phase);}});
        const prepared=progress?.preparedMedia || new Map();
        const contentCache=progress?.contentCache || new Map();
        const imageNodes=new Map([...(snapshot.bindings?.values() || [])].flatMap(binding=>[...(binding.imageNodes || [])]));
        const records=progress?.batches.length?progress.batches:splitQuestionBatches(snapshot.questions)
            .map(questions=>({questions,status:'pending',evidence:{},result:null,error:null}));
        const resultsByQuestion=progress?.resultsByQuestion || new Map();
        if(progress)progress.batches=records;
        const selected=records.filter(record=>record.status!=='success' && (!questionIds || questionIds.has(record.questions[0].id)));
        const gate=progress?.retryGate || {notBefore:0,failures:0,paused:false};
        let searchTail=Promise.resolve();
        try {
            const pending={...snapshot,questions:selected.flatMap(record=>record.questions)};
            const policies=await prepareAnswerPolicies(pending,settings,prepared,{signal:abort.signal,progress,report,check,retry});
            check();
            const skippedQuestions=analysisSkipped(snapshot,settings,policies),skipped=new Map(skippedQuestions.map(item=>[item.id,item]));
            for(const record of selected)if(skipped.has(record.questions[0].id)) {
                record.status='skipped';record.error=skipped.get(record.questions[0].id).reason;
            }
            if(progress){progress.skippedQuestions=skippedQuestions;progress.status='running';}
            for(const record of selected)record.materialReady=questionImageIds(record.questions[0]).every(id=>prepared.has(id));
            await runAnalysisQueue(selected.filter(record=>!skipped.has(record.questions[0].id)),{
                concurrency:progress?.concurrency ?? settings.analysisConcurrency,signal:abort.signal,check,gate,retryTransient,
                preparationConcurrency:2,prepare:async record=>{
                    const question=record.questions[0],ids=new Set(questionImageIds(question));
                    if([...ids].some(id=>snapshot.media.filter(item=>item.id===id).length!==1))throw createCxError('CX-PAR-004',{module:'media',operation:'prepare-media'});
                    await retry(()=>prepareQuestionMedia(snapshot.media.filter(item=>ids.has(item.id)),report,check,snapshot.doc || document,
                        {signal:abort.signal,prepared,contentCache,imageNodes,concurrency:1}),'preparing-images');
                    check();
                    if([...ids].some(id=>!prepared.get(id)?.dataUrl))throw createCxError('CX-PAR-004',{module:'media',operation:'prepare-media'});
                },
                onFatal:cancel,onRetry:()=>settings.onModelRetry?.(),onError:error=>recordCxDiagnostic(error,{module:'analysis',operation:'solve',taskId:settings.diagnosticTaskId}),onChange:()=>{
                    check();onBatchComplete();
                    if(!progress)onProgress(questionResultProjection(snapshot,collectBatchResults(snapshot,records,skippedQuestions,false,policies,resultsByQuestion)));
                },
                onSuccess:record=>{
                    check();
                    const answer=record.result.answers[0];
                    resultsByQuestion.set(answer.id,{...answer,answer:[...answer.answer]});
                    if(progress)for(const id of questionImageIds(record.questions[0])) {
                        const digest=prepared.get(id)?.digest;
                        if(/^[a-f0-9]{64}$/.test(digest || '')) {
                            progress.imageDigests.set(id,digest);
                            if(progress.restoredReadOnly)progress.restoredMediaDigests[id] ??= digest;
                        }
                    }
                    if(progress)scheduleAnalysisCacheWrite(progress);
                },
                execute:async record=>{
                    const question=record.questions[0],model=resolveQuestionModel(settings.model,question);record.model=model;
                    const config={...settings,model,signal:abort.signal};
                    record.phase='solve';record.restoredUsage=null;
                    assertConfiguredRequestSize(config,buildConfiguredAnswerPayload(config,[question],record.evidence,prepared));
                    if(settings.search && !record.evidence[question.id]) {
                        const previous=searchTail;let release;
                        searchTail=new Promise(resolve=>{release=resolve;});
                        try {
                            await previous;await waitAnalysisGate(gate,abort.signal,check);
                            report(`正在检索第 ${question.number} 题…`,'searching');
                            const found=await getWebEvidence([question],settings.key,model,message=>{check();report(message,'searching');},prepared,abort.signal);
                            check();record.evidence={[question.id]:found[question.id]};
                        } finally {release();}
                    }
                    await waitAnalysisGate(gate,abort.signal,check);
                    report(`正在分析第 ${question.number} 题…`,'generating');
                    record.requestAttempts=(record.requestAttempts || 0)+1;
                    const result=await askConfiguredModel(config,[question],record.evidence,prepared,abort.signal);
                    check();
                    if(result.answers.length!==1 || result.answers[0].id!==question.id)throw createCxError('CX-RES-006',{module:'analysis',operation:'answers'});
                    if(!result.answers[0].answer.length) {
                        const error=createCxError('CX-RES-003',{module:'analysis',operation:'answers'});
                        error.analysisReason=result.answers[0].reason || error.message;throw error;
                    }
                    return result;
                }
            });
            check();
            return questionResultProjection(snapshot,collectBatchResults(snapshot,records,skippedQuestions,true,policies,resultsByQuestion));
        } catch(error){throw failureCause || error;}
        finally {
            clearInterval(guardTimer);parentSignal?.removeEventListener('abort',parentAbort);
            for(const view of views)view.removeEventListener('pagehide',leaving);
            if(!progress){prepared.clear();contentCache.clear();}
        }
    }
    function invalidateAnalysisTask(reason) {
        const task=controller?.task;if(!task)return;
        clearTimeout(task.cacheTimer);
        task.abortController.abort();task.status='stale';task.error=reason;task.preparedMedia.clear();task.contentCache?.clear();task.resultsByQuestion.clear();task.batches=[];controller.last=null;
        renderAnalysisProgress(task);
    }
    function analysisSettingsChanged(reason='分析配置已变化') {
        const task=controller?.task;
        if(task?.snapshot && !task.active && task.resultsByQuestion.size) {
            try {checkSnapshot(task.snapshot);task.configurationChanged=JSON.stringify(task.configuration)!==JSON.stringify(analysisConfiguration(currentAnalysisSettings()));}
            catch {invalidateAnalysisTask('题目已变化，请重新分析');return;}
            if(controller.result)renderResultList(controller.result);renderRunState(controller.state);return;
        }
        invalidateAnalysisTask(reason);
    }
    function stopAnalysisTask() {
        const task=controller?.task;
        if(!task?.active || !controller.state.busy || task.abortController.signal.aborted)return;
        task.abortController.abort();controller.report('正在停止分析…','stopping');
    }
    async function resumeAnalysisTask(questionIds, {useCurrentSettings=false}={}) {
        const ctl=controller,task=ctl?.task;
        if(!task?.snapshot || ctl.state.busy || courseRunActive() || !['failed','stopped','restored'].includes(task.status))return;
        const settings=currentAnalysisSettings();
        if(!settings.key){ctl.openPanel('model');ctl.report('请先保存 API Key，再重试未完成题目','error');return;}
        // Explicit retry replaces the cancelled signal before validating the same frozen content.
        task.abortController=new AbortController();
        try {
            if(JSON.stringify(task.configuration)!==JSON.stringify(analysisConfiguration(settings)) && !useCurrentSettings) {
                ctl.report('配置已变化，请使用“用当前设置重试本题”','done');return;
            }
            checkSnapshot(task.snapshot);
        } catch(error) {invalidateAnalysisTask(error.message);ctl.report(error.message,'error');return;}
        if(useCurrentSettings) {
            if(!settings.configured){ctl.report('请先保存当前模型配置','error');return;}
            task.settings=Object.freeze({...settings});task.configuration=analysisConfiguration(settings);task.configurationChanged=false;
            task.autoPrefill=false;
            task.snapshot.courseContext=settings.videoInfoEnabled?captureCurrentCourseContext(task.snapshot.doc || document):[];
            for(const record of task.batches)if(record.status!=='success' && (!questionIds || questionIds.has(record.questions[0].id)))record.evidence={};
        }
        task.abortController=new AbortController();
        await executeAnalysisTask(task,{questionIds});
    }
    async function executeAnalysisTask(task,{questionIds}={}) {
        const ctl=controller;
        task.active=true;task.operation='analysis';
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
                {progress:task,onBatchComplete:()=>renderAnalysisProgress(task),retryTransient:true,questionIds});
            checkSnapshot(task.snapshot);task.status=result.analysisComplete?'complete':'failed';renderAnalysisProgress(task,true);
            if(!result.analysisComplete) {
                ctl.report(`已完成 ${result.analyzedCount}/${task.requestSnapshot.questions.length} 题，${result.analysisFailures.length} 道未完成，可重试未完成题目`,'done');return;
            }
            if(!result.analyzedCount){if(!result.manualCount && !result.uncertainCount)throw new Error('模型未返回有效答案，请核对题目与模型结果');ctl.report(`本次未生成有效答案；${result.manualCount} 道需人工处理，${result.uncertainCount} 道需人工确认。`+(result.skippedQuestions.some(q=>q.answerPolicy?.category==='images')?'所选模型不支持图片或图片材料未能读取，请核对。':''),'done');return;}
            if(task.restoredReadOnly){ctl.report('已保留恢复结果','done');return;}
            ctl.last={...task.snapshot,rootSnapshot:task.snapshot,answers:result.answers};
            const prefillable=questionPrefillCandidates(ctl.last,result.answers);
            if(!prefillable.length) {
                ctl.report(`已生成 ${result.analyzedCount} 道题的答案与解析`,'done');
            } else if(task.autoPrefill) {
                task.operation='prefill';
                ctl.report('正在校验并预填…','prefilling');
                const summary=await prefillChecked(ctl.last,result.answers);checkAnalysisTask(task);
                ctl.output({...ctl.result,prefill:summary});
                ctl.report(summaryText(summary)+(result.skippedQuestions.length?`\n${result.skippedQuestions.length} 道题需人工处理或确认，已跳过。`:''),'done');
            } else ctl.report(`AI 已分析 ${result.analyzedCount} 道题${result.skippedQuestions.length?`，${result.skippedQuestions.length} 道题已跳过`:''}，点击预填。`,'done');
        } catch(error) {
            if(ctl.task!==task)return;
            ctl.last=null;task.error=error.message;
            const changed=error.code==='ANALYSIS_CONFIG_CHANGED' || task.snapshot && (()=>{try{checkSnapshot(task.snapshot);return false;}catch(e){return e.code!=='ABORTED';}})();
            task.status=changed?'stale':task.abortController.signal.aborted?'stopped':'failed';
            for(const record of task.batches)if(['pending','ready','preparing','running','retry-wait'].includes(record.status))
                Object.assign(record,{status:'cancelled',error:error.message,errorCode:normalizeCxError(error).code});
            if(changed){task.preparedMedia.clear();task.resultsByQuestion.clear();task.batches=[];}
            renderAnalysisProgress(task);
            if(error.prefillSummary)ctl.output({...ctl.result,prefill:error.prefillSummary});
            const completed=task.batches.filter(item=>item.status==='success').reduce((n,item)=>n+item.questions.length,0);
            const prefill=error.prefillSummary?`；已确认填写 ${error.prefillSummary.filled} 道，停止时正在处理的题目请核对，已写入内容保留`:'';
            ctl.report(`${task.status==='stopped'?'已停止分析':task.status==='stale'?'题目或图片已变化，请重新分析':'操作中止：'+assistantErrorMessage(error,{module:'analysis',operation:'solve',taskId:task.diagnosticTaskId})}；保留 ${completed} 道已分析结果${prefill}`,
                task.status==='stopped'?'stopped':'error');
        } finally {
            task.active=false;task.operation=null;
            if(task.status==='complete')await saveAnalysisCache(task).catch(()=>{});
            if(task.status==='complete' || task.status==='stale'){task.preparedMedia.clear();task.contentCache?.clear();}
            if(ctl.task===task){ctl.state.busy=false;renderRunState(ctl.state);}
        }
    }
    async function runAnswerFlow({autoPrefill=true}={}) {
        const ctl=controller;if(ctl.state.busy || courseRunActive())return;
        const configuration=readModelConfiguration();
        if(!configuration.configured){ctl.openPanel('model');ctl.report('请先配置模型：保存 API Key 并选择模型','error');return;}
        if(ctl.task){clearTimeout(ctl.task.cacheTimer);ctl.task.abortController.abort();ctl.task.preparedMedia.clear();ctl.task.contentCache?.clear();}
        ctl.last=null;ctl.clearOutput();
        const task=createAnalysisTask(null,currentAnalysisSettings(),autoPrefill);ctl.task=task;
        await executeAnalysisTask(task);
    }

