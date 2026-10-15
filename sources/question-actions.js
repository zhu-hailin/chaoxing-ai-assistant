    // Plans are inert data. Live DOM bindings and answer ownership stay private to this page.
    const questionActionRuntime = new WeakMap();
    function questionActionError(code, message, legacyCode) {
        if (typeof createCxError === 'function') return createCxError(code, {module:'actions',operation:'prefill'}, {legacyCode});
        const error=new Error(message);error.cxCode=code;error.code=legacyCode || code;return error;
    }
    function questionActionDisabled(node) {
        return !node || node.disabled || node.readOnly || node.hasAttribute('disabled') || node.matches('.disabled,.x-item-disabled') || node.getAttribute('aria-disabled')==='true';
    }
    function questionActionState(binding, question, parseContext) {
        const keys=[...binding.optionTargets].filter(([,node])=>selected(node)).map(([key])=>key);
        // This saved value protects ordinary existing answers. Never read video hidden answers.
        const hidden=parseContext?.scope==='video-quiz'?null:[...binding.node.querySelectorAll('input[type="hidden"]')].find(node=>node.name===`answer${question.id}`);
        const saved=clean(hidden?.value),savedParts=saved?savedKeys(saved,binding.optionTargets):[],unknownSaved=Boolean(saved && (!savedParts.length || !savedParts.every(key=>binding.optionTargets.has(key))));
        if(saved && !keys.length && !unknownSaved) keys.push(...savedParts);
        return {keys:[...new Set(keys)].sort(),values:binding.inputs.map(input=>String(input.value)),saved,unknownSaved};
    }
    function questionActionSameState(a,b) {
        return JSON.stringify(a)===JSON.stringify(b);
    }
    function planQuestionActions(snapshot, answers, options={}) {
        const doc=snapshot?.doc || document,parseContext=options.parseContext || snapshot?.parseContext || {};
        const graph=snapshot?.graph || (snapshot?.schemaVersion===3 && snapshot.bindings?snapshot:parseQuestionGraph(doc,parseContext));
        const projection=buildQuestionRequestUnits(graph);
        const fence=snapshot?.graph?snapshot:createQuestionSnapshot(graph,{doc,parseContext,signal:options.signal});
        assertQuestionSnapshot(fence);
        const questions=new Map((snapshot?.questions || projection.questions).map(question=>[question.id,question]));
        const liveQuestions=new Map(projection.questions.map(question=>[question.id,question]));
        const supplied=new Map(),summary={filled:0,already:0,skipped:0,unverified:0,details:[],perUnit:[],perQuestion:[]};
        const plan={snapshotId:fence.snapshotId || fence.lifecycle?.snapshotId,actions:[]},units=[];
        const failUnit=(question,entry,reason)=>{
            summary.skipped++;summary.details.push(`第${question?.number || entry?.number || '?'}题：${reason}`);
            summary.perUnit.push({responseUnitId:String(entry?.id || ''),questionId:projection.parentByUnit.get(entry?.id) || entry?.id,status:'skipped'});
        };
        for(const entry of answers || []) {
            if(!entry || supplied.has(entry.id))throw questionActionError('CX-RES-006','答案编号重复或缺失');
            supplied.set(entry.id,entry);
        }
        for(const entry of supplied.values()) {
            const current=liveQuestions.get(entry.id),question=questions.get(entry.id) || current,binding=projection.bindings.get(entry.id);
            if(!question || !current || !binding?.node){failUnit(question,entry,'无有效答案或题目不存在');continue;}
            const policy=questionPrefillPolicy(current,entry);
            if(!questionCanAutoAnswer(current,policy)){failUnit(question,entry,`${policy.reason || '需人工处理'}，跳过`);continue;}
            if(!Array.isArray(entry.answer) || !entry.answer.length){failUnit(question,entry,`${entry.reason || '无有效答案，需人工核对'}`);continue;}
            if(!binding.canPrefill || current.capabilities?.prefill===false){failUnit(question,entry,`${current.diagnostics?.join('；') || '控件映射不可靠'}，跳过`);continue;}
            const responseUnit=graph.questions.flatMap(item=>item.responseUnits).find(item=>item.id===entry.id);
            if(!responseUnit || !graph.relations.some(relation=>relation.responseUnitId===entry.id&&relation.status==='confirmed')){failUnit(question,entry,'题目与控件缺少已确认的关联，跳过');continue;}
            const state=questionActionState(binding,current,parseContext),text=['blank','essay'].includes(current.type);
            const original=parseContext.scope==='video-quiz'?options.ownedAnswers?.get(entry.id):null;
            const previous=original?{node:original.node,input:original.input,value:original.value,keys:original.keys?[...original.keys]:null}:null;
            const owns=Boolean(previous && previous.node===binding.node);
            const unit={id:entry.id,parentId:projection.parentByUnit.get(entry.id)||entry.id,question:current,binding,text,previous,owns,state,actions:[],targets:new Map()};
            if(text) {
                const inputs=binding.inputs.filter(input=>!questionActionDisabled(input));
                if(inputs.length!==1 || entry.answer.length!==1 || typeof entry.answer[0]!=='string'){failUnit(question,entry,'填空结构或答案不确定，跳过');continue;}
                const input=inputs[0];
                if(owns && (previous.input!==input || String(input.value)!==previous.value))throw questionActionError('CX-EXE-004','用户已修改弹题答案，等待人工处理');
                if(clean(input.value) && !owns){failUnit(question,entry,'已有填写内容，跳过');continue;}
                unit.input=input;unit.value=entry.answer[0];
                unit.actions.push({responseUnitId:unit.id,targetId:responseUnit.controlIds[0],type:'fill',value:entry.answer[0],expectedState:'unchanged'});
            } else {
                const keys=[...new Set(entry.answer)],targetKeys=new Set(keys);
                if(entry.answer.some(key=>typeof key!=='string') || keys.length!==entry.answer.length || keys.some(key=>!binding.optionTargets.has(key)) || (['single','judge'].includes(current.type)&&keys.length!==1)) {failUnit(question,entry,'选项无法对应，跳过');continue;}
                if(state.unknownSaved){failUnit(question,entry,'已有无法识别的手工答案，跳过');continue;}
                if(owns && (!previous.keys || previous.keys.length!==state.keys.length || previous.keys.some(key=>!state.keys.includes(key))))throw questionActionError('CX-EXE-004','用户已修改弹题答案，等待人工处理');
                if(parseContext.scope==='video-quiz' && state.keys.length && !owns){failUnit(question,entry,'已有手工作答，等待人工处理');continue;}
                if(!owns && state.keys.some(key=>!targetKeys.has(key))){failUnit(question,entry,'已有不同选项，未覆盖');continue;}
                unit.targetKeys=targetKeys;
                const choiceAction=(key,type)=>{
                    const target=graph.controls.find(control=>responseUnit.controlIds.includes(control.id)&&control.optionKey===key);
                    if(!target)throw questionActionError('CX-MAT-005','选项与控件关联已变化');
                    unit.targets.set(target.id,binding.optionTargets.get(key));
                    return {responseUnitId:unit.id,targetId:target.id,type,value:key,expectedState:type==='select'?'unselected':'selected'};
                };
                if(owns && current.type==='multiple')for(const key of state.keys)if(!targetKeys.has(key))unit.actions.push(choiceAction(key,'unselect'));
                for(const key of keys)if(!state.keys.includes(key))unit.actions.push(choiceAction(key,'select'));
                if(unit.actions.some(action=>questionActionDisabled(unit.targets.get(action.targetId)))){failUnit(question,entry,'控件不可用，跳过');continue;}
            }
            units.push(unit);plan.actions.push(...unit.actions);
        }
        plan.actions.forEach(Object.freeze);Object.freeze(plan.actions);
        questionActionRuntime.set(plan,{snapshot:fence,graph,projection,doc,parseContext,units,summary,options:{...options},used:false});
        return Object.freeze(plan);
    }
    async function executeQuestionActions(plan,runtime={}) {
        const live=questionActionRuntime.get(plan);
        if(!live || live.used)throw questionActionError('CX-PAR-008','执行计划已失效，请重新分析');
        live.used=true;
        const options={...live.options,...runtime},summary={...live.summary,details:[...live.summary.details],perUnit:[...live.summary.perUnit],perQuestion:[]};
        const signal=options.signal;
        let userEdited=false,writing=false,activeUnit=null,activeWrites=0,activeRecorded=false;
        const onEdit=event=>{if(event.isTrusted && !writing)userEdited=true;};
        const validate=()=>{
            if(signal?.aborted)throw questionActionError('CX-EXE-005','操作已取消','ABORTED');
            options.checkCurrent?.();
            assertQuestionSnapshot(live.snapshot);
            if(userEdited)throw questionActionError('CX-EXE-004','用户已介入作答，已停止自动填写');
        };
        const validateUnit=(unit,state=true)=>{
            validate();
            const {binding}=unit,nodes=[binding.node,...binding.inputs,...binding.optionTargets.values()];
            if(nodes.some(node=>!node?.isConnected || node.ownerDocument!==live.doc || node!==binding.node&&!binding.node.contains(node)))throw questionActionError('CX-CTL-006','作答控件已替换，请重新分析');
            if(state && !questionActionSameState(questionActionState(binding,unit.question,live.parseContext),unit.state))throw questionActionError('CX-EXE-004','用户已修改作答内容，已停止自动填写');
            if(unit.text?questionActionDisabled(unit.input):[...binding.optionTargets.values()].some(questionActionDisabled))throw questionActionError('CX-CTL-004','作答控件不可编辑');
        };
        const write=action=>{writing=true;options.onWrite?.(true);try{action();}finally{options.onWrite?.(false);writing=false;}};
        const result=(unit,status)=>{summary[status]++;summary.perUnit.push({responseUnitId:unit.id,questionId:unit.parentId,status});if(unit===activeUnit)activeRecorded=true;};
        for(const unit of live.units)for(const type of ['input','change','click'])unit.binding.node.addEventListener(type,onEdit,true);
        try {
            // Check the complete plan before the first side effect, then each parent before its write.
            for(const unit of live.units)validateUnit(unit);
            unitLoop:for(const unit of live.units) {
                activeUnit=unit;activeWrites=0;activeRecorded=false;
                validateUnit(unit);
                if(!unit.actions.length){result(unit,'already');continue;}
                if(unit.text) {
                    const input=unit.input;
                    write(()=>{
                        input.focus();
                        // focus handlers may replace a node or update another answer.
                        validateUnit(unit);
                        const realm=input.ownerDocument.defaultView,proto=input instanceof realm.HTMLTextAreaElement?realm.HTMLTextAreaElement.prototype:realm.HTMLInputElement.prototype;
                        const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;
                        if(setter)setter.call(input,unit.value);else input.value=unit.value;
                        activeWrites++;
                        input.dispatchEvent(new realm.Event('input',{bubbles:true}));
                        input.dispatchEvent(new realm.Event('change',{bubbles:true}));
                    });
                    await waitFor(()=>input.value===unit.value);
                    validateUnit(unit,false);
                    if(input.value===unit.value)result(unit,'filled');else{result(unit,'unverified');summary.details.push(`第${unit.question.number}题：已填写，请核对控件状态`);break;}
                } else {
                    for(const action of unit.actions) {
                        validateUnit(unit);
                        const target=unit.targets.get(action.targetId);
                        if(questionActionDisabled(target))throw questionActionError('CX-CTL-004','作答控件不可编辑');
                        write(()=>target.click());
                        activeWrites++;
                        await waitFor(()=>selected(target)===(action.type==='select'));
                        validateUnit(unit,false);
                        if(selected(target)!==(action.type==='select')){result(unit,'unverified');summary.details.push(`第${unit.question.number}题：控件状态未确认，已停止后续填写`);break unitLoop;}
                        // Capture only after the script-owned native action; trusted user events still cancel.
                        unit.state=questionActionState(unit.binding,unit.question,live.parseContext);
                    }
                    const verified=()=>{const state=questionActionState(unit.binding,unit.question,live.parseContext);return !state.unknownSaved && state.keys.length===unit.targetKeys.size && state.keys.every(key=>unit.targetKeys.has(key));};
                    await waitFor(verified);validateUnit(unit,false);
                    if(verified())result(unit,'filled');else{result(unit,'unverified');summary.details.push(`第${unit.question.number}题：已触发点击，请手动检查是否选中`);break;}
                }
            }
            for(const id of new Set(summary.perUnit.map(item=>item.questionId))) {
                const statuses=summary.perUnit.filter(item=>item.questionId===id).map(item=>item.status);
                summary.perQuestion.push({questionId:id,status:statuses.includes('skipped')?'skipped':statuses.includes('unverified')?'unverified':statuses.every(value=>value==='already')?'already':'filled'});
            }
            return summary;
        } catch(error) {
            if(activeUnit&&activeWrites&&!activeRecorded){result(activeUnit,'unverified');summary.details.push(`第${activeUnit.question.number}题：已发生部分填写，后续动作已停止，请核对`);}
            error.prefillSummary={...summary,details:[...summary.details]};
            if(typeof recordCxDiagnostic==='function')recordCxDiagnostic(error,{module:'actions',operation:'prefill',taskId:live.snapshot.lifecycle?.taskId});
            throw error;
        } finally {
            for(const unit of live.units)for(const type of ['input','change','click'])unit.binding.node.removeEventListener(type,onEdit,true);
            questionActionRuntime.delete(plan);
        }
    }
