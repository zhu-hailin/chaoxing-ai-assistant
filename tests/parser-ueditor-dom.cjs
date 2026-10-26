const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {JSDOM, VirtualConsole} = require('jsdom');
const {withModelFixture} = require('./model-fixture.cjs');
const {parser, reference, referenceMode} = require('./parser-index-dom.cjs');
const root = path.join(__dirname, '..');
const normalize = text => text.replace(/\r\n?/g,'\n').split('\n').map(line=>line.trimEnd()).join('\n');
const built = fs.readFileSync(path.join(root,'学习通AI助手.user.js'),'utf8');
const saved = path.join(root,'work/conservative-three-20261025/baseline/学习通AI助手.user.js');
const useSaved = fs.existsSync(saved) && !process.argv.includes('--portable-reference');
const entry = "    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startQuizObserver, { once: true });\n    else startQuizObserver();";
assert(built.includes(normalize(parser)), 'Build the main userscript after changing the parser before running this test.');
const scripts = {optimized:built,reference:useSaved ? fs.readFileSync(saved,'utf8')
    : built.replace(normalize(parser),normalize(reference))};
const apiExport = 'globalThis.api={parseQuestionGraph,createQuestionSnapshot,assertQuestionSnapshot,planQuestionActions,executeQuestionActions};';
const answer = (id, value) => ({id,answer:[value],answerPolicy:{status:'auto',category:'knowledge',reason:'local fixture'}});

function fixture(source=scripts.optimized, {mode='answerEditor',brokenSync=false}={}) {
    const field=mode==='answer'?'answer123':'answerEditor123';
    const html=`<form id="form1"><div class="singleQuesId" id="question123" data="123" data-questionid="123">
      <div class="Zy_TItle">【简答题】解释课程概念</div><textarea id="${field}" name="${field}"></textarea>
      <div class="edui-editor"><iframe></iframe></div></div>
      <div class="singleQuesId" data-questionid="later"><div class="Zy_TItle">【简答题】解释另一个概念</div><textarea id="later"></textarea></div>
      <button id="submit" type="button">提交</button></form>`;
    const errors=[], console=new VirtualConsole();console.on('jsdomError',error=>errors.push(error.message));
    const dom=new JSDOM(html,{url:'https://mooc1.chaoxing.com/work/doHomeWorkNew',
        runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:console});
    const w=dom.window,d=w.document,events=[],storage=new Map();let getEditorCalls=0,submits=0,requests=0;
    w.GM_getValue=withModelFixture((key,fallback)=>storage.has(key)?storage.get(key):fallback);
    w.GM_setValue=(key,value)=>storage.set(key,value);w.GM_getResourceText=()=> '{}';
    w.GM_xmlhttpRequest=()=>{requests++;throw new Error('A parser/action fixture must not request an API.');};
    const input=d.getElementById(field),iframe=d.querySelector('iframe'),body=iframe.contentDocument.body;
    body.contentEditable='true';
    const editor={key:field,isReady:true,textarea:input,form:d.getElementById('form1'),
        iframe,container:d.querySelector('.edui-editor'),document:iframe.contentDocument,body,options:{},
        setContent(html){events.push('setContent');body.innerHTML=html;},getContent(){return body.innerHTML;},
        sync(){events.push('sync');if(!brokenSync)input.value=body.innerHTML;}};
    w.UE={instants:{existing:editor},getEditor(){getEditorCalls++;throw new Error('Do not create an editor.');}};
    d.getElementById('submit').onclick=()=>submits++;
    assert(source.includes(entry));w.eval(source.replace(entry,apiExport));
    return {w,d,api:w.api,input,iframe,body,editor,events,
        snapshot(){const graph=w.api.parseQuestionGraph(d);assert.equal(graph.bindings.get('123').writer,'ueditor');
            assert.equal(graph.bindings.get('123').ueditor.valid,true);return w.api.createQuestionSnapshot(graph,{doc:d});},
        close(){dom.window.close();assert.deepEqual(errors,[]);assert.equal(getEditorCalls,0);assert.equal(submits,0);assert.equal(requests,0);}};
}
async function compare(run,options) {
    const results=[];
    for (const source of [scripts.reference,scripts.optimized]) {
        const f=fixture(source,options);
        try{results.push(JSON.parse(JSON.stringify(await run(f))));}finally{f.close();}
    }
    assert.deepEqual(results[1],results[0]);
}

async function main() {
    const passed=[],failed=[];
    const test=async(name,run)=>{try{await run();passed.push(name);console.log('PASS '+name);}
        catch(error){failed.push({name,error:error.stack});console.log('FAIL '+name+' '+error.message);}};
    for (const mode of ['answerEditor','answer']) await test('Existing UEditor '+mode+' uses setContent and sync, verifies all views and preserves native save flow',async()=>{
        await compare(async f=>{
            const summary=await f.api.executeQuestionActions(f.api.planQuestionActions(f.snapshot(),[answer('123','第一行\n第二行')]));
            assert.equal(summary.filled,1);assert.equal(summary.requiresManualSave,true);
            assert.deepEqual(f.events,['setContent','sync']);
            assert.equal(f.editor.getContent(),f.body.innerHTML);assert.equal(f.input.value,f.body.innerHTML);
            assert.equal(f.d.getElementById('later').value,'');
            return {summary,html:f.body.innerHTML,saved:f.input.value,events:f.events};
        },{mode});
    });
    const mutations={
        registry:f=>{f.w.UE.instants={existing:f.editor};},
        instance:f=>{f.w.UE.instants.existing={...f.editor};},
        textarea:f=>f.input.replaceWith(f.input.cloneNode(true)),
        iframe:f=>f.iframe.replaceWith(f.iframe.cloneNode(true)),
        body:f=>f.body.replaceWith(f.body.cloneNode(true)),
        sync:f=>{f.editor.sync=function(){};},
        setContent:f=>{f.editor.setContent=function(){};},
        getContent:f=>{f.editor.getContent=function(){return '';};},
        readonly:f=>{f.input.readOnly=true;},
        disabled:f=>{f.input.disabled=true;}
    };
    for (const [name,mutate] of Object.entries(mutations)) await test('A replaced or disabled UEditor '+name+' blocks the whole plan before writes',async()=>{
        await compare(async f=>{
            const plan=f.api.planQuestionActions(f.snapshot(),[answer('123','编辑器答案'),answer('later','后续答案')]);
            mutate(f);let caught;
            try{await f.api.executeQuestionActions(plan);}catch(error){caught=error;}
            assert(caught,'Changed editor identity must reject execution.');
            assert(['CX-CTL-006','CX-PAR-008','CX-CTL-004'].includes(caught.cxCode));
            assert.deepEqual(f.events,[]);assert.equal(f.input.value,'');assert.equal(f.d.getElementById('later').value,'');
            return {code:caught.cxCode,summary:caught.prefillSummary,events:f.events};
        });
    });
    await test('Existing user content remains intact and does not invoke editor writes',async()=>{
        await compare(async f=>{
            f.body.innerHTML='<p>人工内容</p>';f.input.value=f.body.innerHTML;
            const summary=await f.api.executeQuestionActions(f.api.planQuestionActions(f.snapshot(),[answer('123','AI答案')]));
            assert.equal(summary.skipped,1);assert.deepEqual(f.events,[]);assert.equal(f.body.textContent,'人工内容');
            return {summary,html:f.body.innerHTML,saved:f.input.value};
        });
    });
    await test('An unchanged sync function that fails to save cannot report success or fill the following question',async()=>{
        await compare(async f=>{
            const summary=await f.api.executeQuestionActions(f.api.planQuestionActions(f.snapshot(),[answer('123','编辑器答案'),answer('later','后续答案')]));
            assert.equal(summary.filled,0);assert.equal(summary.unverified,1);
            assert.equal(f.input.value,'');assert.equal(f.d.getElementById('later').value,'');
            assert.deepEqual(f.events,['setContent','sync']);
            return {summary,html:f.body.innerHTML,saved:f.input.value,events:f.events};
        },{brokenSync:true});
    });
    await test('A sync replacement during setContent preserves the partial write and blocks subsequent actions',async()=>{
        await compare(async f=>{
            const setter=f.editor.setContent;
            f.editor.setContent=function(html){setter.call(this,html);this.sync=function(){};};
            const plan=f.api.planQuestionActions(f.snapshot(),[answer('123','部分答案'),answer('later','后续答案')]);
            let caught;try{await f.api.executeQuestionActions(plan);}catch(error){caught=error;}
            assert(caught);assert.equal(caught.cxCode,'CX-CTL-006');assert.equal(caught.prefillSummary.unverified,1);
            assert.deepEqual(f.events,['setContent']);assert(f.body.textContent.includes('部分答案'));
            assert.equal(f.input.value,'');assert.equal(f.d.getElementById('later').value,'');
            return {code:caught.cxCode,summary:caught.prefillSummary,html:f.body.innerHTML,events:f.events};
        });
    });
    console.log(JSON.stringify({referenceMode:useSaved?'saved pre-change complete userscript':referenceMode,
        passed:passed.length,failed:failed.length,tests:passed,failures:failed}));
    process.exitCode=failed.length?1:0;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
