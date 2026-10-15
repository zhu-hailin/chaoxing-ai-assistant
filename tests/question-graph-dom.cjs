const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const modules = ['question-context.js','question-parser.js','question-media.js'].map(file => fs.readFileSync(path.join(__dirname,'../sources',file),'utf8')).join('\n');
const logs = [], failures = [];
function test(name, fn) {try {fn(); logs.push(`PASS ${name}`);} catch(error) {failures.push(`${name}: ${error.stack}`);}}
function fixture(html) {
 const dom = new JSDOM(html,{url:'https://mooc1.chaoxing.com/work/doHomeWorkNew',runScripts:'outside-only',pretendToBeVisual:true});
 const w = dom.window;
 w.eval(`function clean(value){return String(value || '').replace(/\\s+/g,' ').trim()}
 function questionId(node,index){return node.getAttribute('questionid') || node.getAttribute('data-question-id') || node.id || 'local-'+(index+1)}
 function courseElementVisible(node){return node.isConnected && !node.closest('[hidden]') && getComputedStyle(node).display!=='none'}
 ${modules}
 globalThis.api={parseQuestionDocument,parseQuestionGraph,toLegacyQuestionSnapshot,buildQuestionRequestUnits,createQuestionSnapshot,assertQuestionSnapshot,toAIQuestion,registerPageAdapter,rawQuestion};`);
 return {w,d:w.document,api:w.api,close:()=>w.close()};
}
const radio = `<div class="TiMu" questionid="one"><div class="question-stem">【单选题】哪个是甲？</div><label><input type="radio" name="r" value="A">A、甲</label><label><input type="radio" name="r" value="B">B、乙</label></div>`;
test('Schema2 compatibility and Schema3 confirmed native option relations',()=>{
 const f=fixture(radio);try {const old=f.api.parseQuestionDocument(),g=f.api.parseQuestionGraph();assert.equal(old.schemaVersion,2);assert.equal(g.schemaVersion,3);assert.equal(g.questions[0].id,old.questions[0].id);assert.equal(g.questions[0].type,'single');assert.equal(g.questions[0].responseUnits[0].id,'one');assert.equal(g.relations[0].status,'confirmed');assert.equal(g.questions[0].supportLevel,'Fully Supported');assert.equal(f.api.toLegacyQuestionSnapshot(g).schemaVersion,2);}finally{f.close();}
});
test('Content blocks retain reading order, images, readable formulas, tables and code',()=>{
 const f=fixture(`<div class="TiMu" questionid="content"><div class="stem">【简答题】前文<img src="/one.png">后文<math><mi>x</mi><mo>+</mo><mn>1</mn></math><table><tr><td>甲</td><td>乙</td></tr></table><pre>select 1;</pre></div><textarea></textarea></div>`);try {const g=f.api.parseQuestionGraph(),b=g.questions[0].blocks;assert.deepEqual(Array.from(b,x=>x.type),['text','image','text','math','table','code']);assert.equal(b[1].mediaId,g.media[0].id);assert.equal(b[3].expression,'x+1');assert.equal(b[4].rows[0][1],'乙');assert.equal(b[5].text,'select 1;');}finally{f.close();}
});
test('Only unique explicit label references produce multi-slot request units',()=>{
 const f=fixture(`<div class="TiMu" questionid="two"><div class="stem">【填空题】填写两个概念</div><label for="first">第1空</label><input id="first" type="text"><label for="second">第2空</label><input id="second" type="text"></div>`);try {const g=f.api.parseQuestionGraph(),p=f.api.buildQuestionRequestUnits(g);assert.equal(g.questions[0].structure,'composite');assert.equal(p.questions.length,2);assert.equal(p.questions[0].parentQuestionId,'two');assert(p.questions.every(q=>q.capabilities.prefill));assert(p.questions.every(q=>q.answerPolicy.status==='needs-classification'));assert.equal(p.bindings.get(p.questions[1].id).inputs[0],f.d.querySelector('#second'));assert.equal(p.parentByUnit.get(p.questions[0].id),'two');assert.equal(p.unitsByQuestion.get('two').length,2);}finally{f.close();}
});
test('Unlabelled multi-inputs and repeated label references do not receive writable mapping',()=>{
 const f=fixture(`<div class="TiMu" questionid="amb"><div class="stem">【填空题】两个空</div><input type="text"><input type="text"></div>`);try {const g=f.api.parseQuestionGraph(),p=f.api.buildQuestionRequestUnits(g);assert.equal(g.relations[0].status,'ambiguous');assert.equal(p.questions[0].capabilities.prefill,false);assert.equal(g.questions[0].supportLevel,'Analyze Only');}finally{f.close();}
 const duplicate=fixture(`<div class="TiMu" questionid="dup"><div class="stem">【填空题】概念</div><label for="x">甲</label><label for="x">乙</label><input id="x"><input></div>`);try {assert(!duplicate.api.buildQuestionRequestUnits(duplicate.api.parseQuestionGraph()).questions[0].capabilities.prefill);}finally{duplicate.close();}
});
test('Human handwriting rule remains independent of confirmed writable controls',()=>{
 const f=fixture(radio.replace('哪个是甲？','请手写并拍照上传答案'));try {const g=f.api.parseQuestionGraph();assert.equal(g.relations[0].status,'confirmed');assert.equal(g.questions[0].answerPolicy.status,'manual');assert.equal(g.questions[0].supportLevel,'Manual Required');}finally{f.close();}
});
test('Shared instructions require proven mark_item group boundary',()=>{
 const f=fixture(`<div class="mark_item"><div class="question-instructions">共享文字材料</div>${radio}${radio.replace('questionid="one"','questionid="other"').replaceAll('name="r"','name="other"')}</div><p>整页无关材料</p>`);try {const g=f.api.parseQuestionGraph();assert.equal(g.materials.length,1);assert.equal(g.materials[0].text,'共享文字材料');assert.equal(g.questions[0].sharedMaterialIds[0],g.questions[1].sharedMaterialIds[0]);assert(!JSON.stringify(g.materials).includes('无关'));}finally{f.close();}
});
test('Input values and selected state are excluded from content identity',()=>{
 const f=fixture(radio);try {const snapshot=f.api.createQuestionSnapshot(f.api.parseQuestionGraph(),{doc:f.d});f.d.querySelector('input').checked=true;assert.equal(f.api.assertQuestionSnapshot(snapshot),true);f.d.body.insertAdjacentHTML('beforeend','<div class="feedback">答对1题</div>');assert.equal(f.api.assertQuestionSnapshot(snapshot),true);const projected={...snapshot,rootSnapshot:snapshot,questions:[]};assert.equal(f.api.assertQuestionSnapshot(projected),true);}finally{f.close();}
});
test('Identical markup control replacement invalidates existing snapshot',()=>{
 const f=fixture(radio);try {const snapshot=f.api.createQuestionSnapshot(f.api.parseQuestionGraph(),{doc:f.d}),input=f.d.querySelector('input');input.replaceWith(input.cloneNode(true));assert.throws(()=>f.api.assertQuestionSnapshot(snapshot),e=>e.cxCode==='CX-CTL-006');}finally{f.close();}
});
test('Content changes, relation changes and cancellation invalidate snapshot',()=>{
 const f=fixture(radio);try {const abort=new f.w.AbortController(),snapshot=f.api.createQuestionSnapshot(f.api.parseQuestionGraph(),{doc:f.d,signal:abort.signal});f.d.querySelector('.question-stem').textContent='【单选题】改变题干';assert.throws(()=>f.api.assertQuestionSnapshot(snapshot),e=>e.cxCode==='CX-PAR-008');abort.abort();assert.throws(()=>f.api.assertQuestionSnapshot(snapshot),e=>e.code==='ABORTED');}finally{f.close();}
});
test('Graph and model block projection omit DOM, actual answers and media URLs',()=>{
 const f=fixture(`<div class="TiMu" questionid="essay"><div class="stem">【简答题】解释概念<img src="/secret.png"></div><textarea>private-written-answer</textarea></div>`);try {const g=f.api.parseQuestionGraph(),q=g.questions[0],data=f.api.toAIQuestion(q),json=JSON.stringify(data);assert(!json.includes('private-written-answer'));assert(!json.includes('secret.png'));assert(!json.includes('optionTargets'));assert(!JSON.stringify(g.controls).includes('private-written-answer'));assert(data.blocks.some(b=>b.type==='image'));}finally{f.close();}
});
test('Unsupported recognized controls have no writer',()=>{
 const f=fixture(`<div class="TiMu" questionid="manual"><div class="stem">【简答题】请选择</div><select><option>一</option></select><input type="file"><canvas></canvas></div>`);try {const g=f.api.parseQuestionGraph();assert.deepEqual(Array.from(g.controls,c=>c.kind),['select','upload','canvas']);assert(g.controls.every(c=>!c.writable));assert.equal(g.questions[0].supportLevel,'Analyze Only');}finally{f.close();}
});
test('Duplicate DOM ids and shared radio names cannot produce confirmed cross-question targets',()=>{
 const text=(id)=>`<div class="TiMu" questionid="${id}"><div class="stem">【填空题】两个概念</div><label for="dup">第一空</label><input id="dup"><label for="${id}-second">第二空</label><input id="${id}-second"></div>`;
 const f=fixture(text('left')+text('right'));try {const g=f.api.parseQuestionGraph();assert(g.questions.every(q=>q.responseUnits.some(unit=>unit.relationStatus!=='confirmed') || q.responseUnits.length===1 && !q.capabilities.prefill));}finally{f.close();}
 const duplicate=fixture(radio+radio.replace('questionid="one"','questionid="two"'));try {const g=duplicate.api.parseQuestionGraph();assert(g.relations.every(relation=>relation.status!=='confirmed'));}finally{duplicate.close();}
});
test('Snapshot detects semantic slot-label change and input reordering',()=>{
 const html=`<div class="TiMu" questionid="slots"><div class="stem">【填空题】概念</div><label for="one">第一空</label><input id="one"><label for="two">第二空</label><input id="two"></div>`;
 const f=fixture(html);try {let snapshot=f.api.createQuestionSnapshot(f.api.parseQuestionGraph(),{doc:f.d});f.d.querySelector('label').textContent='不同含义';assert.throws(()=>f.api.assertQuestionSnapshot(snapshot),e=>e.cxCode==='CX-PAR-008');snapshot=f.api.createQuestionSnapshot(f.api.parseQuestionGraph(),{doc:f.d});f.d.querySelector('.TiMu').append(f.d.querySelector('#one'));assert.throws(()=>f.api.assertQuestionSnapshot(snapshot),e=>['CX-PAR-008','CX-CTL-006'].includes(e.cxCode));}finally{f.close();}
});
test('Late lifecycle guards are honored through request clones without recursion',()=>{
 const f=fixture(radio);try {const snapshot=f.api.createQuestionSnapshot(f.api.parseQuestionGraph(),{doc:f.d});let checks=0;snapshot.checkCurrent=()=>{checks++;f.api.assertQuestionSnapshot(snapshot);};assert(f.api.assertQuestionSnapshot({...snapshot,rootSnapshot:snapshot}));assert.equal(checks,1);snapshot.checkCurrent=()=>{throw new Error('late user intervention');};assert.throws(()=>f.api.assertQuestionSnapshot({...snapshot,rootSnapshot:snapshot}),/late user intervention/);}finally{f.close();}
});
test('Stem tables and code never read nested actual answer controls',()=>{
 const f=fixture(`<div class="TiMu" questionid="private"><div class="stem">【简答题】解释<table><tr><td>材料<textarea>nested-private-answer</textarea></td></tr></table><pre>code<textarea>code-private-answer</textarea></pre></div><textarea></textarea></div>`);try {const g=f.api.parseQuestionGraph(),payload=JSON.stringify(f.api.toAIQuestion(g.questions[0]));assert(!payload.includes('nested-private-answer'));assert(!payload.includes('code-private-answer'));assert(payload.includes('材料'));assert(payload.includes('code'));}finally{f.close();}
});
test('Mixed writable text and unsupported response controls retain unresolved required units',()=>{
 const f=fixture(`<div class="TiMu" questionid="mixed"><div class="stem">【简答题】解释并选择类别</div><textarea></textarea><select><option>类别一</option></select></div>`);try {const g=f.api.parseQuestionGraph(),p=f.api.buildQuestionRequestUnits(g);assert.equal(g.questions[0].structure,'composite');assert.equal(g.questions[0].supportLevel,'Partial Support');assert.equal(p.questions.length,2);assert.equal(p.questions[0].capabilities.prefill,true);assert.equal(p.questions[1].capabilities.prefill,false);assert.equal(p.questions[1].type,'unknown');assert(g.questions[0].responseUnits.every(unit=>unit.required));}finally{f.close();}
});
test('Instructions and proven shared materials exclude nested answer control defaults',()=>{
 const f=fixture('<div class="mark_item"><div class="question-instructions">公共材料<textarea>private-student-answer</textarea></div><div class="TiMu" questionid="safe"><div class="stem">【简答题】解释概念</div><div class="question-instructions">作答要求<textarea>private-instruction-answer</textarea></div><textarea></textarea></div></div>');
 try{const graph=f.api.parseQuestionGraph();const payload=JSON.stringify({questions:graph.questions.map(f.api.toAIQuestion),materials:graph.materials});assert(!payload.includes('private-student-answer'));assert(!payload.includes('private-instruction-answer'));assert(payload.includes('作答要求'));assert(payload.includes('公共材料'));}finally{f.close();}
});
const result={total:logs.length+failures.length,failures,logs};fs.writeFileSync(path.join(__dirname,'question-graph-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exitCode=failures.length?1:0;
