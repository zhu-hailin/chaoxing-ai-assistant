// Targeted synthetic fixtures. These are not captures of a real course page.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const {withModelFixture}=require('./model-fixture.cjs');
const source=fs.readFileSync(path.join(__dirname,'..','学习通AI助手.user.js'),'utf8');
const entry="    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startQuizObserver, { once: true });\n    else startQuizObserver();";
const exported='globalThis.blankAPI={parseQuestionGraph,createQuestionSnapshot,assertQuestionSnapshot,questionAnswerSnapshot,splitQuestionBatches,normalize,toAIQuestion,buildAnswerPayload,questionResultProjection,renderAnalysisProgress,setController(value){controller=value;},planQuestionActions,executeQuestionActions};';
const plain=value=>JSON.parse(JSON.stringify(value));

function fixture({brokenSync=0,single=false,count=3,nativeEntry=false,collapsed=false,openOnClick=true}={}) {
    // Deliberately unrelated numeric suffixes and reversed registry order: no guessed ordering.
    const keys=single?['answerEditor987']:count===3?['answerEditor987','answerEditor456','answerEditor321']
        :Array.from({length:count},(_,i)=>`answerEditor${987001+i}`);
    const rows=keys.map((key,i)=>`<div class="blankItemDiv"><span class="blankNumber font14 tiankong fl" tabindex="0" role="option">第${i+1}空：</span><div class="XztiHover1 fl blankItemInp">${nativeEntry?`<div class="InpDIV" id="inpDiv${key.replace('answerEditor','')}" style="${collapsed?'':'display:none'}"></div>`:''}<div class="textDIV" style="${collapsed?'display:none':''}"><textarea id="${key}" name="${key}" style="display:none"></textarea><div class="edui-editor"><iframe></iframe></div></div></div></div>`).join('');
    const html=`<form id="form1"><div class="singleQuesId" id="question123" data="123"><div class="Zy_TItle">【填空题】按顺序填写本题的${keys.length}个空。</div>${rows}</div><div class="singleQuesId" id="question124" data="124"><div class="Zy_TItle">【简答题】后续题</div><textarea id="later"></textarea></div><button type="button" id="submit">提交</button></form>`;
    const errors=[],virtualConsole=new VirtualConsole();
    virtualConsole.on('jsdomError',e=>errors.push(e.message));
    const dom=new JSDOM(html,{url:'https://mooc1.xuexitong.com/mooc-ans/work/doHomeWorkNew',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole});
    const w=dom.window,d=w.document,events=[],storage=new Map();
    w.GM_getValue=withModelFixture((key,fallback)=>storage.has(key)?storage.get(key):fallback);
    w.GM_setValue=(key,value)=>storage.set(key,value);
    w.GM_getResourceText=()=>'{}';
    w.GM_xmlhttpRequest=()=>{throw new Error('Unexpected network request');};
    d.getElementById('submit').onclick=()=>{throw new Error('Unexpected submit');};
    const editors=keys.map((key,i)=>{
        const input=d.getElementById(key),row=input.closest('.blankItemDiv'),iframe=row.querySelector('iframe'),body=iframe.contentDocument.body;
        body.contentEditable='true';
        return {key,textarea:input,form:input.form,iframe,body,container:iframe.closest('.edui-editor'),document:iframe.contentDocument,isReady:1,options:{},
            setContent(html){events.push(`set:${i+1}`);body.innerHTML=html;},getContent(){return body.innerHTML;},
            sync(){events.push(`sync:${i+1}`);if(brokenSync!==i+1)input.value=body.innerHTML;}};
    });
    if(nativeEntry)for(const [i,editor] of editors.entries()) {
        const row=editor.textarea.closest('.blankItemDiv'),entry=row.querySelector('.InpDIV'),shell=row.querySelector('.textDIV');
        entry.onclick=()=>{events.push(`activate:${i+1}`);if(openOnClick){shell.style.display='';entry.style.display='none';}};
    }
    w.UE={instants:Object.fromEntries([...editors].reverse().map((e,i)=>[`native${i}`,e])),getEditor(){throw new Error('Unexpected editor creation');}};
    assert(source.includes(entry));w.eval(source.replace(entry,exported));
    const api=w.blankAPI;
    const snapshot=()=>api.createQuestionSnapshot(api.parseQuestionGraph(d),{doc:d});
    const answers=s=>api.questionAnswerSnapshot(s).questions.filter(q=>q.parentQuestionId==='123'||q.id==='123')
        .map((q,i)=>({id:q.id,answer:[['无','无穷多','唯一'][i]],reason:'synthetic fixture'}));
    return {w,d,api,editors,events,snapshot,answers,close(){dom.window.close();assert.deepEqual(errors,[]);}};
}
function addSingleNativeBlank(f,id,key) {
    const q=f.d.createElement('div');q.className='singleQuesId';q.id=`question${id}`;q.setAttribute('data',id);
    q.innerHTML=`<div class="Zy_TItle">【填空题】后续单空题____。</div><div class="blankItemDiv"><span class="blankNumber font14 tiankong fl">第1空：</span><div class="XztiHover1 fl blankItemInp"><div class="InpDIV" id="inpDiv${key.replace('answerEditor','')}"></div><div class="textDIV" style="display:none"><textarea id="${key}" name="${key}" style="display:none"></textarea><div class="edui-editor"><iframe></iframe></div></div></div></div>`;
    const existing=f.d.getElementById(`question${id}`);
    if(existing)existing.replaceWith(q);else f.d.getElementById('form1').append(q);
    const input=q.querySelector('textarea'),iframe=q.querySelector('iframe'),body=iframe.contentDocument.body;
    body.contentEditable='true';
    const index=f.editors.length+1;
    const editor={key,textarea:input,form:input.form,iframe,body,container:iframe.closest('.edui-editor'),document:iframe.contentDocument,isReady:1,options:{},
        setContent(html){f.events.push(`set:${index}`);body.innerHTML=html;},getContent(){return body.innerHTML;},
        sync(){f.events.push(`sync:${index}`);input.value=body.innerHTML;}};
    f.editors.push(editor);f.w.UE.instants[`single${id}`]=editor;
}
function exclusiveNativeEntries(f) {
    // Synthetic native behavior: opening any editor collapses the other editors.
    for(const [i,editor] of f.editors.entries()) {
        const row=editor.textarea.closest('.blankItemDiv'),entry=row.querySelector('.InpDIV');
        entry.onclick=()=>{
            f.events.push(`activate:${i+1}`);
            for(const other of f.editors) {
                const otherRow=other.textarea.closest('.blankItemDiv'),active=other===editor;
                otherRow.querySelector('.textDIV').style.display=active?'':'none';
                otherRow.querySelector('.InpDIV').style.display=active?'none':'';
            }
        };
    }
}
async function run() {
    const tests=[];
    const test=async(name,body)=>{await body();tests.push(name);console.log('PASS '+name);};
    const withFixture=async(fn,options)=>{const f=fixture(options);try{await fn(f);}finally{f.close();}};
    await test('Three native blank numbers bind three independent editors and one solve batch',()=>withFixture(async f=>{
        const s=f.snapshot(),request=f.api.questionAnswerSnapshot(s),parent=s.questions.find(q=>q.id==='123');
        assert.equal(parent.capabilities.prefill,true);assert.equal(parent.responseUnits.length,3);
        const batches=f.api.splitQuestionBatches(request.questions);
        assert.equal(batches.length,2);assert.equal(batches[0].length,3);assert.equal(batches[1].length,1);
        assert.deepEqual(plain(batches[0].map(q=>f.api.toAIQuestion(q).blankSlotNumber)),[1,2,3]);
        for(const [i,q] of batches[0].entries())assert.equal(request.requestUnits.bindings.get(q.id).ueditor.editor,f.editors[i]);
        const answers=f.answers(s);
        assert.equal(f.api.normalize({answers},batches[0]).length,3);
        assert.throws(()=>f.api.normalize({answers:answers.slice(1)},batches[0]));
        assert.throws(()=>f.api.normalize({answers:[answers[0],answers[0],answers[2]]},batches[0]));
        const payload=f.api.buildAnswerPayload('fixture-model',batches[0],false,'',{});
        assert(payload.messages[0].content.includes('blankSlotNumber'));
    }));
    await test('All slots write through their own editor and report one completed question',()=>withFixture(async f=>{
        const s=f.snapshot(),summary=await f.api.executeQuestionActions(f.api.planQuestionActions(s,f.answers(s)));
        assert.equal(summary.filled,3);assert.equal(summary.questionCounts.filled,1);assert.equal(summary.perUnit.length,3);assert.equal(summary.perQuestion[0].status,'filled');
        assert.equal(summary.requiresManualSave,true);
        assert.deepEqual(f.events,['set:1','sync:1','set:2','sync:2','set:3','sync:3']);
        assert.deepEqual(f.editors.map(e=>e.body.textContent),['无','无穷多','唯一']);
        assert(f.editors.every(e=>e.textarea.value===e.body.innerHTML));assert.equal(f.d.getElementById('later').value,'');
    }));
    await test('Missing any slot answer prevents every write to that parent',()=>withFixture(async f=>{
        const s=f.snapshot(),summary=await f.api.executeQuestionActions(f.api.planQuestionActions(s,f.answers(s).slice(1)));
        assert.equal(summary.filled,0);assert.equal(summary.skipped,3);assert.equal(summary.questionCounts.skipped,1);assert.equal(summary.perUnit.length,3);assert.deepEqual(f.events,[]);
    }));
    await test('A different human answer is preserved and the parent cannot count as fully filled',()=>withFixture(async f=>{
        f.editors[1].body.innerHTML='<p>人工内容</p>';f.editors[1].sync();f.events.length=0;
        const s=f.snapshot(),summary=await f.api.executeQuestionActions(f.api.planQuestionActions(s,f.answers(s)));
        assert.equal(f.editors[1].body.textContent,'人工内容');assert(!f.events.includes('set:2'));
        assert.equal(summary.filled,2);assert.equal(summary.skipped,1);assert.equal(summary.questionCounts.filled,0);assert.equal(summary.questionCounts.skipped,1);assert(summary.perQuestion[0].reason.includes('第2空'));
    }));
    await test('Failed second-slot sync preserves partial writes and stops third slot and following question',()=>withFixture(async f=>{
        const s=f.snapshot(),answers=[...f.answers(s),{id:'124',answer:['后续答案']}];
        const summary=await f.api.executeQuestionActions(f.api.planQuestionActions(s,answers));
        assert.equal(summary.filled,1);assert.equal(summary.unverified,1);assert.equal(summary.questionCounts.filled,0);assert.equal(summary.questionCounts.unverified,1);assert.equal(summary.perQuestion[0].status,'unverified');
        assert(summary.perQuestion[0].reason.includes('第2空'));assert(summary.perQuestion[0].reason.includes('第3空未执行'));
        assert.deepEqual(f.events,['set:1','sync:1','set:2','sync:2']);assert.equal(f.editors[2].textarea.value,'');assert.equal(f.d.getElementById('later').value,'');
    },{brokenSync:2}));
    for(const [name,mutate] of Object.entries({
        'missing native number':f=>f.d.querySelector('.blankNumber').remove(),
        'duplicate native number':f=>f.d.querySelectorAll('.blankNumber')[1].textContent='第1空：',
        'hidden native number':f=>f.d.querySelector('.blankNumber').hidden=true,
        'duplicate field':f=>f.editors[0].textarea.after(f.editors[0].textarea.cloneNode()),
        'shared editor document':f=>{f.editors[1].document=f.editors[0].document;},
        'readonly editor':f=>{f.editors[1].body.contentEditable='false';},
        'unready editor':f=>{f.editors[1].isReady=0;}
    }))await test(name+' remains analyze-only',()=>withFixture(async f=>{
        mutate(f);const graph=f.api.parseQuestionGraph(f.d),q=graph.questions.find(q=>q.id==='123');
        assert.equal(q.capabilities.analyze,true);assert.equal(q.capabilities.prefill,false);assert.deepEqual(f.events,[]);
    }));
    for(const [name,mutate] of Object.entries({
        'replaced editor':f=>{f.w.UE.instants.native1={...f.editors[1]};},
        'replaced method':f=>{f.editors[1].sync=function(){};},
        'reordered blanks':f=>{const rows=f.d.querySelectorAll('.blankItemDiv');rows[0].before(rows[1]);},
        'changed native number':f=>f.d.querySelectorAll('.blankNumber')[1].textContent='第9空：'
    }))await test(name+' invalidates frozen actions before writes',()=>withFixture(async f=>{
        const s=f.snapshot(),plan=f.api.planQuestionActions(s,f.answers(s));mutate(f);
        await assert.rejects(()=>f.api.executeQuestionActions(plan));assert.deepEqual(f.events,[]);
    }));
    await test('Three slot results display as one analyzed question',()=>withFixture(async f=>{
        const s=f.snapshot(),answers=f.answers(s),analysisStates=Object.fromEntries(answers.map(a=>[a.id,{status:'success'}]));
        const result=f.api.questionResultProjection(s,{answers,analysisStates,analysisProgress:{total:4,completed:3}});
        assert.equal(result.analyzedCount,1);assert.equal(result.analysisProgress.total,2);
        assert.equal(result.questionAnswers.length,1);assert(result.questionAnswers[0].answer[0].includes('第3空 唯一'));
    }));
    await test('Skipped multi-blank parent keeps progress counts nonnegative before and after batching',()=>withFixture(async f=>{
        const s=f.snapshot(),request=f.api.questionAnswerSnapshot(s),slots=request.questions.filter(q=>q.ueditorBlankGroup);
        const skippedQuestions=slots.map(q=>({id:q.id,reason:'fixture image capability',answerPolicy:{status:'uncertain',category:'images'}}));
        const task={snapshot:s,requestSnapshot:request,batches:[],skippedQuestions,answerPolicies:new Map(),resultsByQuestion:new Map(),preparedMedia:new Map(),configuration:{},status:'preparing'};
        let output;f.api.setController({task,output(data){output=data;}});
        f.api.renderAnalysisProgress(task);
        assert.equal(output.analysisProgress.total,2);assert.equal(output.analysisProgress.skipped,1);assert.equal(output.analysisProgress.waiting,1);
        task.batches=f.api.splitQuestionBatches(request.questions).map((questions,i)=>({questions,status:i?'pending':'skipped',error:i?null:'fixture image capability'}));
        f.api.renderAnalysisProgress(task);
        assert.equal(output.analysisProgress.total,2);assert.equal(output.analysisProgress.skipped,1);assert.equal(output.analysisProgress.waiting,1);
    }));
    await test('Search references merge to the displayed parent without losing per-slot evidence',()=>withFixture(async f=>{
        const s=f.snapshot(),answers=f.answers(s),link={url:'https://example.org/reference',title:'fixture source',snippet:'fixture'};
        const evidence=Object.fromEntries(answers.map(a=>[a.id,[link]]));
        const result=f.api.questionResultProjection(s,{answers,evidence,analysisStates:{},analysisProgress:{}});
        assert.deepEqual(plain(result.evidence['123']),[link]);
        for(const a of answers)assert.deepEqual(plain(result.evidence[a.id]),[link]);
    }));
    await test('Collapsed native entries expand before each editor write without changing binding identity',()=>withFixture(async f=>{
        const s=f.snapshot();assert.equal(s.questions[0].capabilities.prefill,true);
        const plan=f.api.planQuestionActions(s,f.answers(s));
        assert.equal(plan.actions.filter(action=>action.type==='activate-richtext').length,3);
        const summary=await f.api.executeQuestionActions(plan);
        assert.equal(summary.filled,3);assert.equal(summary.questionCounts.filled,1);
        assert.deepEqual(f.events,['activate:1','set:1','sync:1','activate:2','set:2','sync:2','activate:3','set:3','sync:3']);
        assert(f.editors.every(e=>e.textarea.value===e.body.innerHTML));
    },{nativeEntry:true,collapsed:true}));
    await test('Expanded native editors do not receive unnecessary activation clicks',()=>withFixture(async f=>{
        const s=f.snapshot(),summary=await f.api.executeQuestionActions(f.api.planQuestionActions(s,f.answers(s)));
        assert.equal(summary.filled,3);assert.deepEqual(f.events,['set:1','sync:1','set:2','sync:2','set:3','sync:3']);
    },{nativeEntry:true}));
    await test('A native entry that does not expand stops all writes with a slot-specific reason',()=>withFixture(async f=>{
        const s=f.snapshot(),summary=await f.api.executeQuestionActions(f.api.planQuestionActions(s,f.answers(s)));
        assert.equal(summary.filled,0);assert.equal(summary.questionCounts.skipped,1);
        assert.deepEqual(f.events,['activate:1']);assert(summary.perQuestion[0].reason.includes('第1空'));
        assert(f.editors.every(e=>!e.textarea.value&&!e.body.textContent));
    },{nativeEntry:true,collapsed:true,openOnClick:false}));
    await test('A native editor collapsed after planning still activates through the same frozen entry',()=>withFixture(async f=>{
        const s=f.snapshot(),plan=f.api.planQuestionActions(s,f.answers(s)),row=f.editors[0].textarea.closest('.blankItemDiv');
        row.querySelector('.textDIV').style.display='none';row.querySelector('.InpDIV').style.display='';
        const summary=await f.api.executeQuestionActions(plan);
        assert.equal(summary.filled,3);assert.equal(f.events.filter(event=>event.startsWith('activate:')).length,1);
    },{nativeEntry:true}));
    for(const [name,mutate] of Object.entries({
        'missing entry':f=>f.d.querySelector('.InpDIV').remove(),
        'wrong entry ID':f=>{f.d.querySelector('.InpDIV').id='unrelated';},
        'disabled entry':f=>f.d.querySelector('.InpDIV').setAttribute('aria-disabled','true'),
        'hidden entry':f=>{f.d.querySelector('.InpDIV').style.display='none';},
        'inert entry':f=>f.d.querySelector('.InpDIV').setAttribute('inert',''),
        'collapsed visibility entry':f=>{f.d.querySelector('.InpDIV').style.visibility='collapse';},
        'extra hidden ancestor':f=>{f.d.querySelector('.edui-editor').style.display='none';},
        'readonly collapsed editor':f=>{f.editors[0].options.readonly=true;}
    }))await test(name+' cannot bypass collapsed-editor protection',()=>withFixture(async f=>{
        mutate(f);const graph=f.api.parseQuestionGraph(f.d);assert.equal(graph.questions[0].capabilities.prefill,false);assert.deepEqual(f.events,[]);
    },{nativeEntry:true,collapsed:true}));
    await test('Replacing the native entry after planning invalidates actions before activation',()=>withFixture(async f=>{
        const s=f.snapshot(),plan=f.api.planQuestionActions(s,f.answers(s)),entry=f.d.querySelector('.InpDIV');entry.replaceWith(entry.cloneNode());
        await assert.rejects(()=>f.api.executeQuestionActions(plan));assert.deepEqual(f.events,[]);
    },{nativeEntry:true,collapsed:true}));
    await test('Instance replacement during native activation stops before writing any answer',()=>withFixture(async f=>{
        const entry=f.d.querySelector('.InpDIV'),open=entry.onclick;
        entry.onclick=function(){open.call(this);f.w.UE.instants.native2={...f.editors[0]};};
        const s=f.snapshot(),plan=f.api.planQuestionActions(s,f.answers(s));
        await assert.rejects(()=>f.api.executeQuestionActions(plan));assert.deepEqual(f.events,['activate:1']);
        assert(f.editors.every(e=>!e.textarea.value&&!e.body.textContent));
    },{nativeEntry:true,collapsed:true}));
    await test('Content changed by native activation is preserved rather than overwritten',()=>withFixture(async f=>{
        const entry=f.d.querySelector('.InpDIV'),open=entry.onclick;
        entry.onclick=function(){open.call(this);f.editors[0].body.innerHTML='<p>原生恢复内容</p>';f.editors[0].textarea.value=f.editors[0].body.innerHTML;};
        const s=f.snapshot(),plan=f.api.planQuestionActions(s,f.answers(s));
        await assert.rejects(()=>f.api.executeQuestionActions(plan));assert.deepEqual(f.events,['activate:1']);
        assert.equal(f.editors[0].body.textContent,'原生恢复内容');
    },{nativeEntry:true,collapsed:true}));
    await test('A native single-blank editor uses its original question ID and activates before writing',()=>withFixture(async f=>{
        const s=f.snapshot(),request=f.api.questionAnswerSnapshot(s);
        assert.equal(s.questions[0].capabilities.prefill,true);assert.equal(request.questions[0].id,'123');
        assert.equal(request.questions[0].ueditorBlankGroup,undefined);
        const summary=await f.api.executeQuestionActions(f.api.planQuestionActions(s,f.answers(s)));
        assert.equal(summary.filled,1);assert.deepEqual(f.events,['activate:1','set:1','sync:1']);
    },{single:true,nativeEntry:true,collapsed:true}));
    await test('A single-blank editor collapsed after planning retains its native activation binding',()=>withFixture(async f=>{
        const s=f.snapshot(),plan=f.api.planQuestionActions(s,f.answers(s)),row=f.editors[0].textarea.closest('.blankItemDiv');
        row.querySelector('.textDIV').style.display='none';row.querySelector('.InpDIV').style.display='';
        const summary=await f.api.executeQuestionActions(plan);
        assert.equal(summary.filled,1);assert.deepEqual(f.events,['activate:1','set:1','sync:1']);
    },{single:true,nativeEntry:true}));
    await test('One three-blank question plus two single-blank questions activate and fill independently',()=>withFixture(async f=>{
        addSingleNativeBlank(f,'124','answerEditor654');addSingleNativeBlank(f,'125','answerEditor852');exclusiveNativeEntries(f);
        const s=f.snapshot(),request=f.api.questionAnswerSnapshot(s);
        assert.deepEqual(plain(f.api.splitQuestionBatches(request.questions).map(batch=>batch.length)),[3,1,1]);
        const values=['无','无穷多','唯一','<','1'];
        const answers=request.questions.map((q,i)=>({id:q.id,answer:[values[i]]}));
        const summary=await f.api.executeQuestionActions(f.api.planQuestionActions(s,answers));
        assert.equal(summary.filled,5);assert.equal(summary.questionCounts.filled,3);assert.equal(summary.skipped,0);
        assert.deepEqual(f.editors.map(e=>e.body.textContent),values);
        assert.deepEqual(f.events,['activate:1','set:1','sync:1','activate:2','set:2','sync:2','activate:3','set:3','sync:3','activate:4','set:4','sync:4','activate:5','set:5','sync:5']);
    },{nativeEntry:true,collapsed:true}));
    await test('Previously filled three-blank question is preserved while both later single blanks fill',()=>withFixture(async f=>{
        addSingleNativeBlank(f,'124','answerEditor654');addSingleNativeBlank(f,'125','answerEditor852');exclusiveNativeEntries(f);
        const values=['无','无穷多','唯一','<','1'];
        f.editors.slice(0,3).forEach((e,i)=>{e.body.textContent=values[i];e.textarea.value=e.body.innerHTML;});
        const s=f.snapshot(),request=f.api.questionAnswerSnapshot(s),answers=request.questions.map((q,i)=>({id:q.id,answer:[values[i]]}));
        const summary=await f.api.executeQuestionActions(f.api.planQuestionActions(s,answers));
        assert.equal(summary.already,3);assert.equal(summary.filled,2);
        assert.equal(summary.questionCounts.already,1);assert.equal(summary.questionCounts.filled,2);
        assert.deepEqual(f.events,['activate:4','set:4','sync:4','activate:5','set:5','sync:5']);
        assert.deepEqual(f.editors.map(e=>e.body.textContent),values);
    },{nativeEntry:true,collapsed:true}));
    await test('Single blank with an unknown hidden wrapper still cannot prefill',()=>withFixture(async f=>{
        const graph=f.api.parseQuestionGraph(f.d);assert.equal(graph.questions[0].capabilities.prefill,false);assert.deepEqual(f.events,[]);
    },{single:true,collapsed:true}));
    for(const count of [1,2,5,8])await test(`Automatically discovers ${count} native blanks without a fixed count`,()=>withFixture(async f=>{
        const s=f.snapshot(),request=f.api.questionAnswerSnapshot(s),questions=request.questions.filter(q=>q.id==='123'||q.parentQuestionId==='123');
        assert.equal(questions.length,count);assert.equal(s.questions[0].capabilities.prefill,true);
        assert.equal(f.api.splitQuestionBatches(questions).length,1);
        if(count===1){assert.equal(questions[0].id,'123');assert.equal(s.bindings.get('123').ueditor.nativeBlank.number,1);}
        else assert.deepEqual(plain(questions.map(q=>q.blankSlotNumber)),Array.from({length:count},(_,i)=>i+1));
        const answers=questions.map((q,i)=>({id:q.id,answer:[`答案${i+1}；标点仍属于同一空`]})).reverse();
        const summary=await f.api.executeQuestionActions(f.api.planQuestionActions(s,answers));
        assert.equal(summary.filled,count);assert.equal(summary.questionCounts?.filled??summary.filled,1);
        assert.deepEqual(f.editors.map(e=>e.body.textContent),Array.from({length:count},(_,i)=>`答案${i+1}；标点仍属于同一空`));
        assert.deepEqual(f.events,Array.from({length:count},(_,i)=>[`activate:${i+1}`,`set:${i+1}`,`sync:${i+1}`]).flat());
    },{count,nativeEntry:true,collapsed:true}));
    await test('Explicit native blank numbers determine initial order even if DOM rows and supplied answers are reversed',()=>withFixture(async f=>{
        const q=f.d.getElementById('question123'),rows=[...q.querySelectorAll('.blankItemDiv')];
        for(const row of rows.reverse())q.append(row);
        const s=f.snapshot(),request=f.api.questionAnswerSnapshot(s),questions=request.questions.filter(q=>q.parentQuestionId==='123');
        assert.deepEqual(plain(questions.map(q=>q.blankSlotNumber)),[1,2,3,4]);
        const answers=questions.map((q,i)=>({id:q.id,answer:[`顺序${i+1}`]})).reverse();
        const summary=await f.api.executeQuestionActions(f.api.planQuestionActions(s,answers));
        assert.equal(summary.filled,4);assert.equal(summary.questionCounts.filled,1);
        assert.deepEqual(f.editors.map(e=>e.body.textContent),['顺序1','顺序2','顺序3','顺序4']);
        assert.deepEqual(f.events,['activate:1','set:1','sync:1','activate:2','set:2','sync:2','activate:3','set:3','sync:3','activate:4','set:4','sync:4']);
    },{count:4,nativeEntry:true,collapsed:true}));
    await test('Entry recognition failures identify the actual missing relation',()=>withFixture(async f=>{
        f.d.querySelector('.InpDIV').id='unrelated';
        const q=f.api.parseQuestionGraph(f.d).questions.find(q=>q.id==='123');
        assert.equal(q.capabilities.prefill,false);assert(q.diagnostics.some(reason=>reason.includes('原生入口 ID 与答案字段不一致')));
    },{nativeEntry:true,collapsed:true}));
    await test('Single editor keeps its original whole-question binding and write path',()=>withFixture(async f=>{
        const s=f.snapshot(),request=f.api.questionAnswerSnapshot(s);
        assert.equal(request.questions[0].id,'123');assert.equal(request.questions[0].ueditorBlankGroup,undefined);
        const summary=await f.api.executeQuestionActions(f.api.planQuestionActions(s,f.answers(s)));
        assert.equal(summary.filled,1);assert.deepEqual(f.events,['set:1','sync:1']);
    },{single:true}));
    console.log(JSON.stringify({passed:tests.length,tests}));
}
run().catch(error=>{console.error(error);process.exitCode=1;});
