    // 题目快照、预填资格与受保护预填入口。
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

    function questionPrefillCandidates(snapshot,answers) {
        if(!snapshot?.graph)return [];
        const projection=snapshot.requestUnits || buildQuestionRequestUnits(snapshot.graph);
        const questions=new Map(projection.questions.map(question=>[question.id,question]));
        return (answers || []).filter(entry=>{
            const question=questions.get(entry.id);
            return question && entry.answer?.length && question.capabilities.prefill===true
                && projection.bindings.get(entry.id)?.canPrefill===true
                && questionPrefillPolicy(question,entry).status==='auto';
        });
    }
    function extractQuestionSnapshot(doc = document, parseContext = {}, runtime = {}) {
        const graph = parseQuestionGraph(doc,parseContext);
        if (graph.questions.some(q=>GARBLED.test(q.question) || q.options.some(o=>GARBLED.test(o.text))))
            throw createCxError('CX-PAR-005',{module:'parser',operation:'font'});
        const observations=new Map();
        for(const question of graph.questions) {
            const recognition=question.recognition || {},kinds=[...new Set((question.blocks || []).map(block=>block.type).filter(type=>['image','math','table','code'].includes(type)))];
            const facts={adapterId:question.source?.adapter,questionType:question.type,writer:graph.bindings.get(question.id)?.writer,
                recognitionType:recognition.type,materialState:recognition.materials,sharing:recognition.sharing,slotState:recognition.slots,
                materialKind:kinds.length>1?'mixed':kinds[0] || 'text',recognized:question.type!=='unknown',writable:question.capabilities.prefill===true};
            const key=JSON.stringify(facts),entry=observations.get(key);
            if(entry)entry.questionCount++;else observations.set(key,{...facts,questionCount:1});
        }
        for(const facts of [...observations.values()].slice(0,20))recordCxDiagnostic(createCxError('CX-OBS-001',
            {module:'parser',operation:'extract',...facts},{severity:'info'}));
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
                reason:ids.flatMap((id,i)=>byId.get(id)?.reason?[`${i+1}. ${byId.get(id).reason}`]:[]).join('\n\n') || restricted?.answerPolicy?.reason || '按作答区域分别分析',
                ...((restricted || entries[0])?.answerPolicy?{answerPolicy:(restricted || entries[0]).answerPolicy}:{}),responseUnitIds:ids};
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
        const counts=[[s.filled,'已填'],[s.already,'已有答案'],[s.skipped,'跳过'],[s.unverified,'待检查']]
            .filter(([count])=>count>0).map(([count,label])=>`${label} ${count} 题`);
        return (counts.join('，') || '未填写答案')+(s.requiresManualSave?'，请手动保存或提交':'')
            +(s.details.length?'\n'+s.details.slice(0,5).join('\n'):'');
    }
