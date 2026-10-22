    const KEY_ANALYSIS_CACHE_ENABLED='cx_analysis_cache_enabled';
    const KEY_ANALYSIS_CACHE='cx_analysis_cache_v1';
    const ANALYSIS_CACHE_AGE=24*60*60*1000;
    let analysisCacheEpoch=0;
    async function analysisCacheHash(value,doc=document) {
        const subtle=doc.defaultView?.crypto?.subtle;
        if(!subtle)return null;
        return [...new Uint8Array(await subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
    }
    async function analysisCacheIdentity(snapshot) {
        const doc=snapshot.doc || document,owner=studyOwnerDocument(doc) || doc;
        const context=courseStudyContext(owner);
        if(!context.complete)return null;
        const url=new URL(pageURL(doc)),names=new Set(['workid','workanswerid','examid','knowledgeid','chapterid']);
        const fields=[...url.searchParams].filter(([key,value])=>names.has(key.toLowerCase()) && /^[\w-]{1,120}$/.test(value));
        for(const input of doc.querySelectorAll('input[name],input[id]')) {
            const name=(input.name || input.id).toLowerCase();
            if(names.has(name) && /^[\w-]{1,120}$/.test(input.value))fields.push([name,input.value]);
        }
        if(!fields.length && context.chapterId)fields.push(['chapterid',context.chapterId]);
        if(!fields.length)return null;
        for(const name of new Set(fields.map(([key])=>key.toLowerCase())))if(new Set(fields.filter(([key])=>key.toLowerCase()===name).map(([,value])=>String(value))).size!==1)return null;
        const key=await analysisCacheHash(JSON.stringify([url.origin,url.pathname,context.course,context.classroom,context.student,
            [...new Set(fields.map(([key,value])=>key.toLowerCase()+':'+value))].sort(),snapshot.questions.map(q=>q.id)]),doc);
        const questions=snapshot.questions.map(q=>({id:q.id,type:q.type,question:q.question,instructions:q.instructions,
            options:q.options,blocks:q.blocks,imageIds:q.imageIds,contextImageIds:q.contextImageIds,responseUnits:q.responseUnits}));
        const media=snapshot.media.map(item=>({id:item.id,src:item.src,kind:item.kind,contentSignature:item.contentSignature,
            groupId:item.groupId,sourceQuestionId:item.sourceQuestionId,sourceMaterialId:item.sourceMaterialId,location:item.location,optionKey:item.optionKey}));
        const fingerprint=await analysisCacheHash(JSON.stringify({questions,media}),doc);
        return key && fingerprint ? {key,fingerprint} : null;
    }
    function recentAnalysisCache() {
        const stored=get(KEY_ANALYSIS_CACHE,[]),now=Date.now();
        return Array.isArray(stored)?stored.filter(item=>item?.schema===1 && /^[a-f0-9]{64}$/.test(item.key || '') &&
            /^[a-f0-9]{64}$/.test(item.fingerprint || '') && Number.isSafeInteger(item.savedAt) && item.savedAt<=now && now-item.savedAt<ANALYSIS_CACHE_AGE &&
            Array.isArray(item.answers) && item.answers.length<=1000).slice(0,3):[];
    }
    function scheduleAnalysisCacheWrite(task) {
        if(get(KEY_ANALYSIS_CACHE_ENABLED,false)!==true || task.restoredReadOnly)return;
        clearTimeout(task.cacheTimer);
        task.cacheTimer=setTimeout(()=>{task.cacheTimer=null;saveAnalysisCache(task).catch(()=>{});},250);
    }
    async function saveAnalysisCache(task) {
        clearTimeout(task.cacheTimer);task.cacheTimer=null;
        if(get(KEY_ANALYSIS_CACHE_ENABLED,false)!==true || task.restoredReadOnly || controller?.task!==task || !task.originCourseIdentity || !task.snapshot || !task.resultsByQuestion.size || task.status==='stale')return;
        const revision=task.cacheRevision=(task.cacheRevision || 0)+1,epoch=analysisCacheEpoch;
        const snapshot=task.requestSnapshot || questionAnswerSnapshot(task.snapshot);
        const answers=[...task.resultsByQuestion.values()].map(entry=>({id:entry.id,answer:[...entry.answer],reason:entry.reason || ''}));
        const usage=Object.fromEntries(task.batches.filter(record=>record.status==='success').map(record=>[record.questions[0].id,record.restoredUsage || analysisRequestUsage(record)]));
        const digests=Object.fromEntries(task.imageDigests || []);
        const identity=await analysisCacheIdentity(snapshot);
        if(!identity || revision!==task.cacheRevision || epoch!==analysisCacheEpoch || get(KEY_ANALYSIS_CACHE_ENABLED,false)!==true || controller?.task!==task || task.status==='stale')return;
        checkSnapshot(task.snapshot);
        const item={schema:1,...identity,savedAt:Date.now(),answers,usage,digests};
        if(new TextEncoder().encode(JSON.stringify(item)).length>500000)return;
        set(KEY_ANALYSIS_CACHE,[item,...recentAnalysisCache().filter(old=>old.key!==item.key)].slice(0,3));
    }
    async function restoreAnalysisCache() {
        const ctl=controller;
        if(!ctl || ctl.state.busy || courseRunActive())return;
        if(get(KEY_ANALYSIS_CACHE_ENABLED,false)!==true){ctl.report('请先开启结果暂存','done');return;}
        const previous=ctl.task;
        ctl.report('正在读取暂存结果…','extracting',true);
        try {
            await ensureFontDecoded();
            if(ctl!==controller || ctl.task!==previous)throw cancelledError();
            let restoredTask;
            const root=extractQuestionSnapshot(document,{}, {checkCurrent:()=>{if(restoredTask)checkAnalysisTask(restoredTask);}}),snapshot=questionAnswerSnapshot(root),identity=await analysisCacheIdentity(snapshot);
            const saved=identity && recentAnalysisCache().find(item=>item.key===identity.key && item.fingerprint===identity.fingerprint);
            if(!saved){ctl.report(identity?'没有匹配的暂存结果':'当前页面缺少可靠的课程或测验身份','done');return;}
            const ids=new Set(saved.answers.map(entry=>entry?.id)),questions=snapshot.questions.filter(q=>ids.has(q.id));
            if(!questions.length)throw createCxError('CX-RES-005',{module:'analysis',operation:'answers'});
            const answers=normalize({answers:saved.answers},questions);
            if(answers.some(entry=>!entry.answer.length))throw createCxError('CX-RES-005',{module:'analysis',operation:'answers'});
            checkSnapshot(root);
            if(ctl.task!==previous)throw cancelledError();
            previous?.abortController.abort();previous?.preparedMedia.clear();previous?.contentCache?.clear();
            const task=createAnalysisTask(root,currentAnalysisSettings(),false);
            restoredTask=task;
            task.requestSnapshot=snapshot;task.status='restored';task.restoredReadOnly=true;task.restoredIdentity=identity;
            task.restoredMediaDigests=saved.digests && typeof saved.digests==='object'?saved.digests:{};
            task.resultsByQuestion=new Map(answers.map(entry=>[entry.id,entry]));
            task.batches=snapshot.questions.map(q=>{
                const answer=task.resultsByQuestion.get(q.id),storedUsage=saved.usage?.[q.id],restoredUsage={model:typeof storedUsage?.model==='string'?storedUsage.model.slice(0,300):''};
                for(const field of ['attempts','promptTokens','completionTokens','totalTokens','reasoningTokens'])
                    if(Number.isSafeInteger(storedUsage?.[field])&&storedUsage[field]>=0)restoredUsage[field]=storedUsage[field];
                return {questions:[q],status:answer?'success':'failed',evidence:{},result:answer?{answers:[answer],mediaAnalysis:[]}:null,
                    model:typeof restoredUsage?.model==='string'?restoredUsage.model:'',restoredUsage:restoredUsage && typeof restoredUsage==='object'?restoredUsage:null,
                    error:answer?null:'尚未分析',errorCode:answer?null:'CX-RES-003'};
            });
            ctl.task=task;ctl.last=null;root.checkCurrent=()=>checkAnalysisTask(task);
            renderAnalysisProgress(task,true);ctl.report('已恢复结果（只读）','done');
        } catch(error){ctl.report(`恢复失败：${assistantErrorMessage(error,{module:'analysis',operation:'snapshot'})}`,'error');}
        finally {ctl.state.busy=false;renderRunState(ctl.state);}
    }
    async function verifyRestoredAnalysis({quiet=false}={}) {
        const ctl=controller,task=ctl?.task;
        if(!task?.restoredReadOnly || ctl.state.busy || courseRunActive())return;
        const abort=new AbortController();task.abortController=abort;
        task.configuration=analysisConfiguration(currentAnalysisSettings());task.settings=Object.freeze({...currentAnalysisSettings()});task.active=true;task.operation='restore-check';
        ctl.report(quiet?'正在预填…':'正在校验恢复结果…',quiet?'prefilling':'preparing-images',true);
        const leaving=()=>abort.abort();window.addEventListener('pagehide',leaving,{once:true});
        try {
            const check=()=>{throwIfAborted(abort.signal);if(ctl.task!==task)throw cancelledError();checkSnapshot(task.snapshot);};
            check();
            if(task.batches.some(record=>record.status!=='success'))throw new Error('请先重试未完成题目');
            const snapshot=task.requestSnapshot,identity=await analysisCacheIdentity(snapshot);check();
            if(!identity || identity.key!==task.restoredIdentity.key || identity.fingerprint!==task.restoredIdentity.fingerprint)throw createCxError('CX-PAR-008',{module:'analysis',operation:'snapshot'});
            const nodes=new Map([...(snapshot.bindings?.values() || [])].flatMap(binding=>[...(binding.imageNodes || [])]));
            const ids=new Set(snapshot.questions.flatMap(questionImageIds));
            await prepareQuestionMedia(snapshot.media.filter(item=>ids.has(item.id)),()=>{},check,snapshot.doc,{signal:abort.signal,
                prepared:task.preparedMedia,contentCache:task.contentCache,imageNodes:nodes,concurrency:1});check();
            for(const id of ids) {
                const expected=task.restoredMediaDigests[id];
                if(!/^[a-f0-9]{64}$/.test(expected || '') || task.preparedMedia.get(id)?.digest!==expected)throw new Error('图片材料已变化或缺少原始签名，请重新分析');
                task.imageDigests.set(id,expected);
            }
            const current=await analysisCacheIdentity(snapshot);check();
            if(!current || current.key!==identity.key || current.fingerprint!==identity.fingerprint)throw createCxError('CX-PAR-008',{module:'analysis',operation:'snapshot'});
            task.restoredReadOnly=false;task.status='complete';task.configurationChanged=false;task.configuration=analysisConfiguration(currentAnalysisSettings());
            task.settings=Object.freeze({...currentAnalysisSettings()});
            renderAnalysisProgress(task,true);ctl.last={...task.snapshot,rootSnapshot:task.snapshot,answers:[...task.resultsByQuestion.values()]};
            if(!quiet)ctl.report('结果已恢复，可预填','done');
            return true;
        } catch(error){ctl.last=null;ctl.report(`预填未执行：${error.message}`,'error');return false;}
        finally {window.removeEventListener('pagehide',leaving);task.active=false;task.operation=null;ctl.state.busy=false;renderRunState(ctl.state);}
    }
    function clearAnalysisCache() {
        analysisCacheEpoch++;
        if(controller?.task)clearTimeout(controller.task.cacheTimer);
        set(KEY_ANALYSIS_CACHE,[]);controller?.report('已清除暂存结果','done');
    }
