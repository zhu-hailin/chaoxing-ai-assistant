    // Plans are inert data. Live DOM bindings and answer ownership stay private to this page.
    const questionActionRuntime = new WeakMap();
    function questionActionError(code, message, legacyCode) {
        if (typeof createCxError === 'function') return createCxError(code, {module:'actions',operation:'prefill'}, {legacyCode});
        const error=new Error(message);error.cxCode=code;error.code=legacyCode || code;return error;
    }
    function questionActionDisabled(node) {
        return !node || node.disabled || node.readOnly || node.hasAttribute('disabled') || node.matches('.disabled,.x-item-disabled') || node.getAttribute('aria-disabled')==='true';
    }
    function questionUEText(value) {
        return String(value??'').replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').replace(/[\u200b\ufeff]/g,'')
            .replace(/[\t\f\v ]+/g,' ').replace(/ *\n */g,'\n').trim();
    }
    function questionUEContent(html,doc) {
        if(typeof html!=='string')throw questionActionError('CX-CTL-004','无法读取 UEditor 内容');
        const template=doc.createElement('template');template.innerHTML=html;
        const nonText=Boolean(template.content.querySelector('img,svg,math,video,audio,canvas,object,embed,iframe,script,style,input,textarea,select,button,hr,table'));
        const walk=node=>node.nodeType===3?node.textContent:node.nodeType!==1&&node.nodeType!==11?'':node.nodeName==='BR'?'\n'
            :[...node.childNodes].map(walk).join('')+(/^(P|DIV|LI|BLOCKQUOTE|PRE|H[1-6])$/.test(node.nodeName)?'\n':'');
        const text=questionUEText(walk(template.content));
        return {text,nonText,empty:!text&&!nonText};
    }
    function questionUEAnswerHTML(text,doc) {
        // textContent/createTextNode 负责转义模型文本；只生成段落与换行，不注入模型 HTML。
        const paragraph=doc.createElement('p');
        String(text).replace(/\r\n?/g,'\n').split('\n').forEach((line,index)=>{
            if(index)paragraph.appendChild(doc.createElement('br'));
            paragraph.appendChild(doc.createTextNode(line));
        });
        return paragraph.outerHTML;
    }
    function questionUEState(binding) {
        const ue=binding.ueditor,doc=binding.node.ownerDocument;
        const content=questionUEContent(ue.editor.getContent(),doc),body=questionUEContent(ue.body.innerHTML,doc),saved=questionUEContent(ue.input.value,doc);
        return {keys:[],values:[content.text,body.text,saved.text],saved:'',
            unknownSaved:content.nonText||body.nonText||saved.nonText||content.text!==body.text||content.text!==saved.text,
            editorEmpty:content.empty&&body.empty,savedEmpty:saved.empty};
    }
    function questionUEVerified(unit) {
        const state=questionUEState(unit.binding);
        return !state.unknownSaved&&state.values.every(value=>value===unit.expectedText);
    }
    function questionActionChapterInputs(binding, question, parseContext) {
        if (parseContext?.scope==='video-quiz' || binding.writer!=='chapter-choice' || !['single','multiple','judge'].includes(question.type)) return null;
        const targets=new Map(),nativeTargets=new Map(),doc=binding.node.ownerDocument;
        for (const [key,row] of binding.optionTargets) {
            const inputs=[...row.querySelectorAll('input[type="radio"],input[type="checkbox"]')];
            if (!inputs.length) { targets.set(key,row);continue; } // Existing num_option/native row writer.
            const input=inputs[0],kind=question.type==='multiple'?'checkbox':'radio';
            if (inputs.length!==1 || input.closest('li')!==row || input.type!==kind)
                throw questionActionError('CX-MAT-005','选项与原生选择控件无法唯一对应');
            if (questionActionDisabled(row) || questionActionDisabled(input) || input.matches(':disabled'))
                throw questionActionError('CX-CTL-004','原生选择控件不可用');
            targets.set(key,input);nativeTargets.set(key,input);
        }
        if (!nativeTargets.size) return null;
        const radios=[...nativeTargets.values()].filter(input=>input.type==='radio');
        if (radios.some(input=>!input.name || input.name!==radios[0].name || input.form!==radios[0].form
            || [...doc.getElementsByName(input.name)].some(other=>other.type==='radio' && other.form===input.form && !radios.includes(other))))
            throw questionActionError('CX-MAT-005','原生单选控件组缺失或跨题共享');
        return {targets,nativeTargets};
    }
    function questionActionChapterCheckbox(binding, question, parseContext) {
        if (parseContext?.scope === 'video-quiz' || binding.writer !== 'chapter-choice' || question.type !== 'multiple'
            || ![...binding.optionTargets.values()].some(node => node.matches('li.before-after-checkbox'))) return null;
        // 相同 CSS 类也用于 addMultipleChoice(this) 的无 input 选项；仅原生 addcheck 模式进入此分支。
        if(![...binding.optionTargets.values()].some(row=>/^\s*addcheck\s*\(/.test(row.getAttribute('onclick')||'')
            ||row.querySelector('input[name^="answercheck"]')))return null;
        try { if (!/^\/(?:mooc-ans\/)?work\/doHomeWorkNew\/?$/.test(new URL(binding.node.ownerDocument.URL).pathname)) return null; }
        catch { return null; }
        const doc=binding.node.ownerDocument,id=String(question.id),controls=new Map();
        if (!/^\d+$/.test(id)) throw questionActionError('CX-MAT-005','旧版选项与题目编号无法可靠对应');
        for (const [key,row] of binding.optionTargets) {
            const inputs=[...row.querySelectorAll('input')],input=inputs[0];
            const call=/^\s*addcheck\(\s*(\d+)\s*\)\s*;?\s*$/.exec(row.getAttribute('onclick') || '');
            if (!row.matches('li.before-after-checkbox') || inputs.length!==1 || !input?.matches('input[type="checkbox"]')
                || input.closest('li')!==row || !input.closest('label.before') || input.name!==`answercheck${id}`
                || input.value!==key || !/^[A-Z]$/.test(key) || call?.[1]!==id)
                throw questionActionError('CX-MAT-005','旧版多选控件结构或关联已变化');
            if (questionActionDisabled(row) || questionActionDisabled(input) || input.matches(':disabled'))
                throw questionActionError('CX-CTL-004','旧版多选控件不可用');
            controls.set(key,input);
        }
        // addcheck reads the whole named group in document order; reject controls shared with another question.
        const order=[...doc.getElementsByName(`answercheck${id}`)],saved=[...doc.querySelectorAll(`[id="answer${id}"]`)];
        if (order.length!==controls.size || order.some(input=>![...controls.values()].includes(input)) || saved.length>1
            || saved.length===1 && (!saved[0].matches('input[type="hidden"]') || order.some(input=>input.form!==saved[0].form)))
            throw questionActionError('CX-MAT-005','旧版多选选项组或原生答案字段无法唯一对应');
        if (saved[0] && questionActionDisabled(saved[0])) throw questionActionError('CX-CTL-004','原生答案字段不可用');
        return {controls,order,savedInput:saved[0] || null};
    }
    function questionActionChapterRows(binding,question,parseContext) {
        if(parseContext?.scope==='video-quiz'||binding.writer!=='chapter-choice'||!binding.chapterRows)return null;
        const current=readChapterRowChoiceBindings(binding.node,question.id,question.type,[...binding.optionTargets.values()]);
        if(!current?.valid||!sameChapterRowChoiceBindings(binding.chapterRows,current)
            ||current.records.some(record=>binding.optionTargets.get(record.key)!==record.row))
            throw questionActionError('CX-MAT-005','旧版选项与字母、题目或原生处理函数无法唯一对应');
        if(current.savedInput&&questionActionDisabled(current.savedInput)||current.records.some(record=>questionActionDisabled(record.row)))
            throw questionActionError('CX-CTL-004','旧版选项或原生答案字段不可用');
        return current;
    }
    function questionActionRowChoiceState(binding,question) {
        const adapter=binding.chapterRows,keys=[];
        let consistent=adapter.valid;
        for(const record of adapter.records) {
            const signals=[record.row,record.label].flatMap(node=>['aria-checked','aria-pressed'].flatMap(name=>{
                const value=node.getAttribute(name);return value===null?[]:[value];
            }));
            const marked=selected(record.row)||[record.row,record.label].some(node=>node.matches('.check_answer,.check,.checked,.selected,.on,.active'));
            if(signals.some(value=>!['true','false'].includes(value))||signals.includes('true')&&signals.includes('false')
                ||marked&&signals.includes('false'))consistent=false;
            if(marked||signals.includes('true'))keys.push(record.key);
        }
        if(question.type!=='multiple'&&keys.length>1)consistent=false;
        const saved=clean(adapter.savedInput?.value),parts=saved?savedKeys(saved,binding.optionTargets):[];
        if(adapter.savedInput&&(new Set(parts).size!==parts.length||parts.some(key=>!binding.optionTargets.has(key))
            ||parts.length!==keys.length||parts.some(key=>!keys.includes(key))))consistent=false;
        return {keys:[...keys].sort(),values:[],saved,unknownSaved:!consistent};
    }
    function questionActionRowChoiceVerified(unit,expected=unit.targetKeys) {
        const state=questionActionRowChoiceState(unit.binding,unit.question);
        return !state.unknownSaved&&state.keys.length===expected.size&&state.keys.every(key=>expected.has(key));
    }
    function questionActionNativeChoiceVerified(unit) {
        const keys=[...unit.chapterInputs.targets].filter(([,node])=>selected(node)).map(([key])=>key);
        return keys.length===unit.targetKeys.size && keys.every(key=>unit.targetKeys.has(key));
    }
    function questionActionCheckboxVerified(unit,expected=unit.targetKeys) {
        const adapter=unit.chapterCheckbox,inputs=adapter.order.filter(input=>input.checked),keys=inputs.map(input=>input.value);
        return keys.length===expected.size && keys.every(key=>expected.has(key)) && (!adapter.savedInput || adapter.savedInput.value===keys.join(''));
    }
    function questionActionMooc2State(binding,question) {
        const adapter=binding.mooc2,keys=[],values=[];
        let consistent=adapter.valid;
        for (const record of adapter.records) {
            const checked=record.marker.classList.contains('check_answer'),aria=record.row.getAttribute('aria-checked');
            const pressed=record.row.getAttribute('aria-pressed');
            if ((aria!==null && !['true','false'].includes(aria)) || (checked ? aria!=='true' : aria==='true')) consistent=false;
            if (pressed!==null && pressed!==(checked?'true':'false')) consistent=false;
            if (checked) { keys.push(record.key);values.push(record.value); }
        }
        const saved=adapter.savedInput?.value || '';
        if (saved!==values.join('') || question.type!=='multiple' && keys.length>1) consistent=false;
        return {keys:[...keys].sort(),values:[],saved,unknownSaved:!consistent};
    }
    function questionActionMooc2Verified(unit,expected=unit.targetKeys) {
        const state=questionActionMooc2State(unit.binding,unit.question);
        return !state.unknownSaved && state.keys.length===expected.size && state.keys.every(key=>expected.has(key));
    }
    function questionActionState(binding, question, parseContext, chapterCheckbox = null, chapterInputs = null) {
        if(binding.writer==='ueditor'&&binding.ueditor?.valid)return questionUEState(binding);
        if (binding.mooc2) return questionActionMooc2State(binding,question);
        if(binding.chapterRows)return questionActionRowChoiceState(binding,question);
        const keys=chapterCheckbox ? chapterCheckbox.order.filter(input=>input.checked).map(input=>input.value)
            : [...binding.optionTargets].filter(([key,node])=>selected(chapterInputs?.targets.get(key) || node)).map(([key])=>key);
        // This saved value protects ordinary existing answers. Never read video hidden answers.
        const hidden=parseContext?.scope==='video-quiz'?null:chapterCheckbox?.savedInput || [...binding.node.querySelectorAll('input[type="hidden"]')].find(node=>node.name===`answer${question.id}`);
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
            summary.perUnit.push({responseUnitId:String(entry?.id || ''),questionId:projection.parentByUnit.get(entry?.id) || entry?.id,status:'skipped',reason});
        };
        for(const entry of answers || []) {
            if(!entry || supplied.has(entry.id))throw questionActionError('CX-RES-006','答案编号重复或缺失');
            supplied.set(entry.id,entry);
        }
        for(const entry of supplied.values()) {
            const current=liveQuestions.get(entry.id),question=questions.get(entry.id) || current,binding=projection.bindings.get(entry.id);
            if(!question || !current || !binding?.node){failUnit(question,entry,'无有效答案或题目不存在');continue;}
            const policy=questionPrefillPolicy(current,entry);
            if(policy.status!=='auto'){failUnit(question,entry,`${policy.reason || '需人工处理'}，跳过`);continue;}
            if(!Array.isArray(entry.answer) || !entry.answer.length){failUnit(question,entry,`${entry.reason || '无有效答案，需人工核对'}`);continue;}
            if(!binding.canPrefill || current.capabilities?.prefill===false){failUnit(question,entry,`${current.diagnostics?.join('；') || '控件映射不可靠'}，跳过`);continue;}
            const responseUnit=graph.questions.flatMap(item=>item.responseUnits).find(item=>item.id===entry.id);
            if(!responseUnit || !graph.relations.some(relation=>relation.responseUnitId===entry.id&&relation.status==='confirmed')){failUnit(question,entry,'题目与控件缺少已确认的关联，跳过');continue;}
            let chapterInputs,chapterCheckbox,chapterRows;
            try {
                chapterInputs=questionActionChapterInputs(binding,current,parseContext);
                chapterCheckbox=questionActionChapterCheckbox(binding,current,parseContext);
                chapterRows=questionActionChapterRows(binding,current,parseContext);
            }catch(error) {
                // 仅规划期的静态未适配可逐题跳过；任何快照变化仍立即终止整份计划。
                assertQuestionSnapshot(fence);
                if(binding.writer!=='chapter-choice'||parseContext.scope==='video-quiz'||error.cxCode!=='CX-MAT-005')throw error;
                failUnit(question,entry,'本题原生选项结构尚未适配（CX-MAT-005），已跳过并保留答案');continue;
            }
            let state;
            try {state=questionActionState(binding,current,parseContext,chapterCheckbox,chapterInputs);}
            catch(error) {
                if(binding.writer!=='ueditor')throw error;
                assertQuestionSnapshot(fence);
                failUnit(question,entry,'UEditor 内容读取失败，未写入，请人工处理');continue;
            }
            const text=['blank','essay'].includes(current.type);
            const original=parseContext.scope==='video-quiz'?options.ownedAnswers?.get(entry.id):null;
            const previous=original?{node:original.node,input:original.input,value:original.value,keys:original.keys?[...original.keys]:null}:null;
            const owns=Boolean(previous && previous.node===binding.node);
            const unit={id:entry.id,parentId:projection.parentByUnit.get(entry.id)||entry.id,question:current,binding,chapterInputs,chapterCheckbox,chapterRows,text,previous,owns,state,actions:[],targets:new Map()};
            if(text) {
                const inputs=binding.inputs.filter(input=>!questionActionDisabled(input));
                if(inputs.length!==1 || entry.answer.length!==1 || typeof entry.answer[0]!=='string'){failUnit(question,entry,'填空结构或答案不确定，跳过');continue;}
                const input=inputs[0];
                if(binding.writer==='ueditor') {
                    unit.input=input;unit.value=entry.answer[0];unit.expectedText=questionUEText(unit.value);
                    if(input!==binding.ueditor.input||!unit.expectedText||state.unknownSaved){failUnit(question,entry,'富文本内容或 textarea 同步状态不明确，未写入');continue;}
                    if(!state.editorEmpty||!state.savedEmpty) {
                        if(!questionUEVerified(unit)){failUnit(question,entry,'已有富文本作答，未覆盖');continue;}
                    }else {
                        unit.html=questionUEAnswerHTML(unit.value,doc);
                        unit.actions.push({responseUnitId:unit.id,targetId:responseUnit.controlIds[0],type:'fill-richtext',value:unit.value,expectedState:'empty'});
                    }
                    units.push(unit);plan.actions.push(...unit.actions);continue;
                }
                if(owns && (previous.input!==input || String(input.value)!==previous.value))throw questionActionError('CX-EXE-004','用户已修改弹题答案，等待人工处理');
                if(clean(input.value) && !owns){failUnit(question,entry,'已有填写内容，跳过');continue;}
                unit.input=input;unit.value=entry.answer[0];
                unit.actions.push({responseUnitId:unit.id,targetId:responseUnit.controlIds[0],type:'fill',value:entry.answer[0],expectedState:'unchanged'});
            } else {
                const keys=[...new Set(entry.answer)],targetKeys=new Set(keys);
                if(entry.answer.some(key=>typeof key!=='string') || keys.length!==entry.answer.length || keys.some(key=>!binding.optionTargets.has(key)) || (['single','judge'].includes(current.type)&&keys.length!==1)) {failUnit(question,entry,'选项无法对应，跳过');continue;}
                if(state.unknownSaved){failUnit(question,entry,'已有无法识别的手工答案，跳过');continue;}
                if((chapterCheckbox || chapterRows || binding.mooc2) && (state.keys.length || state.saved) && (state.keys.length!==targetKeys.size || state.keys.some(key=>!targetKeys.has(key)))) {failUnit(question,entry,'已有手工作答，未覆盖');continue;}
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
            const native=questionActionChapterInputs(binding,unit.question,live.parseContext);
            if(Boolean(native)!==Boolean(unit.chapterInputs) || native && (native.targets.size!==unit.chapterInputs.targets.size
                || [...unit.chapterInputs.targets].some(([key,node])=>native.targets.get(key)!==node)))
                throw questionActionError('CX-CTL-006','原生选项控件已替换');
            if(unit.chapterCheckbox) {
                const current=questionActionChapterCheckbox(binding,unit.question,live.parseContext),before=unit.chapterCheckbox;
                if(!current || current.savedInput!==before.savedInput || current.order.length!==before.order.length
                    || current.order.some((input,index)=>input!==before.order[index]) || [...before.controls].some(([key,input])=>current.controls.get(key)!==input))
                    throw questionActionError('CX-CTL-006','旧版多选原生控件已替换');
            }
            if(unit.chapterRows&&!sameChapterRowChoiceBindings(unit.chapterRows,questionActionChapterRows(binding,unit.question,live.parseContext)))
                throw questionActionError('CX-CTL-006','旧版无 input 选项关联已变化');
            if(binding.writer==='ueditor'&&!sameQuestionUEditor(binding.ueditor,readQuestionUEditor(binding.node,unit.question.parentQuestionId||unit.question.id)))
                throw questionActionError('CX-CTL-006','UEditor 实例或 DOM 关联已变化');
            if(state && !questionActionSameState(questionActionState(binding,unit.question,live.parseContext,unit.chapterCheckbox,unit.chapterInputs),unit.state))throw questionActionError('CX-EXE-004','用户已修改作答内容，已停止自动填写');
            if(binding.mooc2 && (questionActionDisabled(binding.mooc2.savedInput) || binding.mooc2.records.some(record=>questionActionDisabled(record.marker))))
                throw questionActionError('CX-CTL-004','mooc2 原生选项或答案字段不可用');
            if(unit.text?questionActionDisabled(unit.input):[...binding.optionTargets.values()].some(questionActionDisabled))throw questionActionError('CX-CTL-004','作答控件不可编辑');
        };
        const write=action=>{writing=true;options.onWrite?.(true);try{action();}finally{options.onWrite?.(false);writing=false;}};
        const result=(unit,status)=>{
            summary[status]++;summary.perUnit.push({responseUnitId:unit.id,questionId:unit.parentId,status});if(unit===activeUnit)activeRecorded=true;
            if(unit.binding.writer==='ueditor'&&['filled','already'].includes(status)) {
                summary.requiresManualSave=true;
            }
        };
        const finishSummary=()=>{
            summary.perQuestion=[...new Set(summary.perUnit.map(item=>item.questionId))].map(id=>{
                const items=summary.perUnit.filter(item=>item.questionId===id),statuses=items.map(item=>item.status);
                return {questionId:id,status:statuses.includes('skipped')?'skipped':statuses.includes('unverified')?'unverified':statuses.every(value=>value==='already')?'already':'filled',
                    reason:items.filter(item=>item.reason).map(item=>item.reason).join('；')};
            });
            return summary;
        };
        for(const unit of live.units)for(const type of ['input','change','click'])unit.binding.node.addEventListener(type,onEdit,true);
        const editorBodies=[...new Set(live.units.filter(unit=>unit.binding.writer==='ueditor').map(unit=>unit.binding.ueditor.body))];
        const editorEvents=['beforeinput','input','change','click','paste','cut','drop'];
        for(const body of editorBodies)for(const type of editorEvents)body.addEventListener(type,onEdit,true);
        try {
            // Check the complete plan before the first side effect, then each parent before its write.
            for(const unit of live.units)validateUnit(unit);
            unitLoop:for(const unit of live.units) {
                activeUnit=unit;activeWrites=0;activeRecorded=false;
                validateUnit(unit);
                if(unit.binding.writer==='ueditor') {
                    if(unit.actions.length) {
                        write(()=>{
                            validateUnit(unit);activeWrites++;
                            unit.binding.ueditor.editor.setContent(unit.html,false);
                            validateUnit(unit,false);
                            unit.binding.ueditor.editor.sync();
                        });
                    }
                    await waitFor(()=>{validateUnit(unit,false);return questionUEVerified(unit);},1000);
                    validateUnit(unit,false);
                    if(questionUEVerified(unit))result(unit,unit.actions.length?'filled':'already');
                    else {result(unit,'unverified');summary.details.push(`第${unit.question.number}题：富文本或 textarea 同步未确认，已停止后续填写，请人工检查`);break;}
                    continue;
                }
                if(!unit.actions.length){
                    if(unit.chapterInputs || unit.chapterRows || unit.binding.mooc2) {
                        const verified=()=>unit.binding.mooc2 ? questionActionMooc2Verified(unit) : unit.chapterRows ? questionActionRowChoiceVerified(unit) : unit.chapterCheckbox ? questionActionCheckboxVerified(unit) : questionActionNativeChoiceVerified(unit);
                        await waitFor(verified,unit.chapterCheckbox||unit.chapterRows?750:450);validateUnit(unit,false);
                        if(!verified()){result(unit,'unverified');summary.details.push(`第${unit.question.number}题：原生选中状态与已有答案不同步，已停止后续填写`);break;}
                    }
                    result(unit,'already');continue;
                }
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
                        const input=unit.chapterInputs?.targets.get(action.value),expected=new Set(unit.state.keys);
                        if(action.type==='select')expected.add(action.value);else expected.delete(action.value);
                        if(unit.chapterInputs && !input)throw questionActionError('CX-MAT-005','选项与原生点击目标的关联已变化');
                        const clickTarget=unit.chapterInputs ? input : target;
                        // A previous native action may already have produced the desired state; do not toggle it again.
                        if(unit.chapterInputs?.nativeTargets.has(action.value) && selected(clickTarget)===(action.type==='select'))continue;
                        // The input owns native selection; its click bubbles to the original row handler once.
                        write(()=>clickTarget.click());
                        activeWrites++;
                        const notBefore=Date.now()+200;
                        const nativeSync=unit.chapterCheckbox||unit.chapterRows;
                        const verifiedAction=()=>unit.binding.mooc2 ? questionActionMooc2Verified(unit,expected) : unit.chapterRows ? Date.now()>=notBefore&&questionActionRowChoiceVerified(unit,expected) : unit.chapterCheckbox ? Date.now()>=notBefore && questionActionCheckboxVerified(unit,expected) : selected(clickTarget)===(action.type==='select');
                        await waitFor(()=>{if(nativeSync && (signal?.aborted || userEdited))validate();return verifiedAction();},nativeSync?750:450);
                        validateUnit(unit,false);
                        if(!verifiedAction()){result(unit,'unverified');summary.details.push(`第${unit.question.number}题：${nativeSync?'原生选中状态或答案同步未确认':'控件状态未确认'}，已停止后续填写`);break unitLoop;}
                        // Capture after the platform's saved-answer timer; do not misclassify it as user input.
                        unit.state=questionActionState(unit.binding,unit.question,live.parseContext,unit.chapterCheckbox,unit.chapterInputs);
                    }
                    const verified=()=>{if(unit.binding.mooc2)return questionActionMooc2Verified(unit);if(unit.chapterRows)return questionActionRowChoiceVerified(unit);if(unit.chapterCheckbox)return questionActionCheckboxVerified(unit);const state=questionActionState(unit.binding,unit.question,live.parseContext,null,unit.chapterInputs);return !state.unknownSaved && state.keys.length===unit.targetKeys.size && state.keys.every(key=>unit.targetKeys.has(key)) && (!unit.chapterInputs || questionActionNativeChoiceVerified(unit));};
                    await waitFor(verified);validateUnit(unit,false);
                    if(verified())result(unit,'filled');else{result(unit,'unverified');summary.details.push(`第${unit.question.number}题：已触发点击，请手动检查是否选中`);break;}
                }
            }
            return finishSummary();
        } catch(error) {
            if(activeUnit&&activeWrites&&!activeRecorded){result(activeUnit,'unverified');summary.details.push(`第${activeUnit.question.number}题：已发生部分填写，后续动作已停止，请核对`);}
            error.prefillSummary={...finishSummary(),details:[...summary.details]};
            if(typeof recordCxDiagnostic==='function')recordCxDiagnostic(error,{module:'actions',operation:'prefill',taskId:live.snapshot.lifecycle?.taskId});
            throw error;
        } finally {
            for(const unit of live.units)for(const type of ['input','change','click'])unit.binding.node.removeEventListener(type,onEdit,true);
            for(const body of editorBodies)for(const type of editorEvents)body.removeEventListener(type,onEdit,true);
            questionActionRuntime.delete(plan);
        }
    }
