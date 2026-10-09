const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const entry = "    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startQuizObserver, { once: true });\n    else startQuizObserver();";
const source = fs.readFileSync(path.join(__dirname, '../学习通AI助手.user.js'), 'utf8');
assert(source.includes(entry));
const instrumented = source.replace(entry, 'globalThis.parserAPI={extract,normalize,prefill,signature,initQuizAssistant,runAnswerFlow,parseQuestionDocument,registerPageAdapter,registerQuestionParser,get controller(){return controller}};');
const logs = [], failures = [];
async function test(name, run) { try { await run(); logs.push(`PASS ${name}`); } catch(error) { failures.push(`${name}: ${error.stack}`); } }
function fixture(html) {
 const dom = new JSDOM(html, {url:'https://mooc1.chaoxing.com/work/doHomeWorkNew',runScripts:'outside-only',pretendToBeVisual:true});
 const w = dom.window, requests=[];
 w.GM_getValue=(key,fallback)=>key==='deepseek_api_key'?'mock-key':fallback;
 w.GM_setValue=()=>{};w.GM_getResourceText=()=> '{}';w.GM_xmlhttpRequest=request=>requests.push(request);
 w.eval(instrumented);
 return {w,d:w.document,api:w.parserAPI,requests,close(){w.dispatchEvent(new w.Event('pagehide'));w.close();}};
}
const radio = (id,label='【单选题】选择甲') => `<div class="TiMu" questionid="${id}"><div class="question-stem">${label}</div><label><input type="radio" name="r${id}" value="A">A、甲</label><label><input type="radio" name="r${id}" value="B">B、乙</label></div>`;
const multi = `<div class="question-item" data-question-id="multi"><h3 class="stem">【多选题】请选择甲乙</h3><label><input type="checkbox" value="A">A.甲</label><label><input type="checkbox" value="B">B.乙</label></div>`;
const essay = `<div class="TiMu" questionid="essay"><div class="mark_name">【简答题】解释概念</div><textarea></textarea></div>`;
const custom = `<div class="TiMu" questionid="custom"><div class="stem">【教师自创题】特殊作答</div><textarea></textarea></div>`;
(async()=>{
 await test('作业页面与章节适配器产生统一模型，DOM及隐藏答案不序列化',async()=>{
  const f=fixture(radio('1')+multi+essay+custom+'<input type="hidden" value="private-secret">');
  try {const data=f.api.extract();assert.equal(data.total,4);assert.deepEqual(Array.from(data.questions,q=>q.type),['single','multiple','essay','unknown']);assert.equal(data.questions[0].id,'1');assert.equal(data.questions[0].options[0].text,'甲');const json=JSON.stringify(data);assert(!json.includes('private-secret')&&!json.includes('optionTargets')&&!json.includes('textarea'));assert.equal(f.api.parseQuestionDocument().bindings.size,4);assert(!data.questions[3].capabilities.prefill);} finally{f.close();}
 });
 await test('未知类型不连带阻止整卷解析，也不能被模型答案强行预填',async()=>{
  const f=fixture(radio('1')+custom);try{const q=f.api.extract().questions;const answers=f.api.normalize({answers:[{id:'1',answer:['A']},{id:'custom',answer:['恶意覆盖']}]},q);assert.equal(answers[1].answer.length,0);const result=await f.api.prefill(q,[{id:'1',number:1,answer:['A']},{id:'custom',number:2,answer:['强行写入']}]);assert.equal(result.filled,1);assert.equal(result.skipped,1);assert.equal(f.d.querySelector('textarea').value,'');}finally{f.close();}
 });
 await test('原生单选多选简答异步预填，已有不同答案保护且不提交',async()=>{
  const f=fixture('<form>'+radio('1')+multi+essay+'<button type="submit">提交</button></form>');try{let submits=0;f.d.querySelector('form').addEventListener('submit',e=>{submits++;e.preventDefault();});const q=f.api.extract().questions;const a=f.api.normalize({answers:[{id:'1',answer:['A']},{id:'multi',answer:['A','B']},{id:'essay',answer:['定义解释']}]},q);let result=await f.api.prefill(q,a);assert.equal(result.filled,3);assert.equal(submits,0);assert.equal(f.d.querySelector('textarea').value,'定义解释');f.d.querySelector('input[value=B]').click();result=await f.api.prefill(q,a);assert.equal(result.skipped,2);assert.equal(f.d.querySelector('input[value=B]').checked,true);}finally{f.close();}
 });
 await test('结构推断只用于无题型标签的明确原生选择控件',async()=>{
  const f=fixture(radio('1','选择甲')+radio('2','【教师自创题】选择甲'));try{const q=f.api.extract().questions;assert.equal(q[0].type,'single');assert(q[0].source.inferred);assert.equal(q[1].type,'unknown');assert(!q[1].capabilities.prefill);}finally{f.close();}
 });
 await test('多空、富文本和控件矛盾只分析展示，不自动填写',async()=>{
  const f=fixture('<div class="TiMu" questionid="a"><div class="stem">【填空题】两个空</div><input type="text"><input type="text"></div><div class="TiMu" questionid="b"><div class="stem">【论述题】富文本</div><div contenteditable="true"></div></div>'+radio('c','【多选题】错误控件'));try{const q=f.api.extract().questions;assert(q.every(item=>!item.capabilities.prefill));const result=await f.api.prefill(q,[{id:'a',answer:['答案']},{id:'b',answer:['答案']},{id:'c',answer:['A']}]);assert.equal(result.skipped,3);assert(!f.d.querySelector('input[type=text]').value);assert(!f.d.querySelector('input[type=radio]').checked);}finally{f.close();}
 });
 await test('新增适配器和题型插件可扩展，不需要修改主提取流程',async()=>{
  const f=fixture('<section class="custom-source">扩展题干</section>');try{f.api.registerPageAdapter({id:'test-adapter',collect:doc=>doc.querySelectorAll('.custom-source'),read:(node,index)=>({id:'plug',number:index+1,adapter:'test-adapter',question:node.textContent,typeLabel:'插件题',options:[],controls:{textInputs:0},binding:{node,inputs:[],optionTargets:new Map(),writer:'none'}})});f.api.registerQuestionParser({id:'test-parser',match:raw=>raw.typeLabel==='插件题',parse:raw=>({question:{id:raw.id,number:raw.number,type:'unknown',question:raw.question,options:[],source:{adapter:raw.adapter,parser:'test-parser'},controls:raw.controls,capabilities:{analyze:false,prefill:false},diagnostics:['插件已识别']},binding:{...raw.binding,canPrefill:false}})});assert.equal(f.api.extract().questions[0].source.parser,'test-parser');assert.throws(()=>f.api.registerPageAdapter({id:'test-adapter',collect(){},read(){}}));}finally{f.close();}
 });
 await test('混合题卷仅上传已识别题，保持全卷结果顺序',async()=>{
  const f=fixture(radio('1')+custom);try{f.api.initQuizAssistant();const pending=f.api.runAnswerFlow({autoPrefill:false});await new Promise(r=>setTimeout(r,60));assert.equal(f.requests.length,1);const payload=JSON.parse(f.requests[0].data);const sent=JSON.parse(payload.messages[1].content).questions;assert.equal(sent.length,1);assert.equal(sent[0].id,'1');f.requests[0].onload({status:200,responseText:JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({answers:[{id:'1',answer:['A'],reason:'模拟'}]})}}]})});await pending;const result=f.api.controller.result;assert.equal(result.questions.length,2);assert.equal(result.answers[1].id,'custom');assert.equal(result.answers[1].answer.length,0);assert.equal(f.api.controller.state.phase,'done');}finally{f.close();}
 });
 await test('全部未知题可展示诊断，不调用 API、不错误预填',async()=>{
  const f=fixture(custom);try{f.api.initQuizAssistant();await f.api.runAnswerFlow();assert.equal(f.requests.length,0);assert.equal(f.api.controller.result.questions[0].type,'unknown');assert.equal(f.api.controller.state.phase,'done');}finally{f.close();}
 });
 await test('嵌套题容器去重、重复 ID 阻止、控件变化影响签名',async()=>{
  const f=fixture('<div class="TiMu"><div class="stem">容器</div>'+radio('1')+'</div>');try{assert.equal(f.api.extract().total,1);const before=f.api.signature(f.api.extract().questions);f.d.querySelector('input').disabled=true;assert.notEqual(f.api.signature(f.api.extract().questions),before);f.d.body.insertAdjacentHTML('beforeend',radio('1'));assert.throws(()=>f.api.extract(),/ID 重复/);}finally{f.close();}
 });
 await test('跨题共享单选组和重复选项键禁止预填，避免影响其他题目',async()=>{
  const html=(radio('1')+radio('2')).replaceAll('name="r1"','name="shared"').replaceAll('name="r2"','name="shared"');
  const f=fixture(html);try{const q=f.api.extract().questions;assert(q.every(item=>!item.capabilities.prefill));const result=await f.api.prefill(q,[{id:'1',answer:['A']},{id:'2',answer:['B']}]);assert.equal(result.skipped,2);assert(!f.d.querySelector('input:checked'));}finally{f.close();}
  const duplicate=fixture(radio('3').replace('value="B"','value="A"').replace('B、乙','A、乙'));try{assert.equal(duplicate.api.extract().questions[0].capabilities.prefill,false);}finally{duplicate.close();}
 });
 const result={total:logs.length+failures.length,failures,logs};fs.writeFileSync(path.join(__dirname,'parser-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exitCode=failures.length?1:0;
})();
