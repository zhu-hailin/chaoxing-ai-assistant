// Integration evidence only: mocked HTTP/model responses and synthetic page DOM.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'../学习通AI助手.user.js'),'utf8');
const entry="    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startQuizObserver, { once: true });\n    else startQuizObserver();";
assert(source.includes(entry));
const code=source.replace(entry,'globalThis.api={requestJSON,normalize,exportCxDiagnostics,recordCxDiagnostic,safeCourseDiagnosticReport,initQuizAssistant,runAnswerFlow,extractQuestionSnapshot,solveQuestionBatches,prefillChecked,get controller(){return controller}};');
const results=[];
async function test(name,action){try{await action();results.push({name,passed:true});}catch(error){results.push({name,passed:false,error:error.stack});}}
function fixture(html='<body></body>',handler=()=>{}){
 const dom=new JSDOM(html,{url:'https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,requests=[],writes=[];
 w.GM_getValue=(key,fallback)=>key==='deepseek_api_key'?'mock-key':key==='cx_model'?'mock-model':fallback;
 w.GM_setValue=(key,value)=>writes.push([key,value]);w.GM_getResourceText=()=>'{}';
 w.GM_xmlhttpRequest=request=>{requests.push(request);queueMicrotask(()=>handler(request));return {abort(){request.onabort?.();}};};
 w.eval(code);return {w,doc:w.document,api:w.api,requests,writes,close(){w.dispatchEvent(new w.Event('pagehide'));w.close();}};
}
const text='<div class="singleQuesId" data="q1"><div class="Zy_TItle"><div class="fontLabel">【填空题】请填写下列常识名称</div></div><label for="province">首都名称</label><input id="province" type="text"><label for="language">官方语言名称</label><textarea id="language"></textarea></div>';
(async()=>{
 await test('非JSON HTTP401保留HTTP语义，不复制响应或地址',async()=>{const f=fixture('',r=>r.onload({status:401,responseText:'private-partial-key-account<html>'}));try{await assert.rejects(f.api.requestJSON({method:'POST',url:'https://example.com/v1?token=secret',key:'private-key'}),e=>{assert.equal(e.code,'HTTP');assert.equal(e.cxCode,'CX-HTTP-401');f.api.recordCxDiagnostic(e);return true;});assert(!/private|secret|example.com/.test(f.api.exportCxDiagnostics()));}finally{f.close();}});
 await test('HTTP200非法JSON单独报告RES001',async()=>{const f=fixture('',r=>r.onload({status:200,responseText:'<html>'}));try{await assert.rejects(f.api.requestJSON({method:'GET',url:'https://example.com'}),e=>e.code==='BAD_JSON'&&e.cxCode==='CX-RES-001');}finally{f.close();}});
 await test('同步GM异常保留未知网络语义，不透出部分Key',async()=>{const f=fixture();try{f.w.GM_xmlhttpRequest=()=>{throw Error('Authorization partial-private-key');};await assert.rejects(f.api.requestJSON({method:'GET',url:'https://example.com'}),e=>{f.api.recordCxDiagnostic(e);return e.code==='NETWORK'&&e.cxCode==='CX-NET-001';});assert(!f.api.exportCxDiagnostics().includes('partial-private'));}finally{f.close();}});
 await test('答案遗漏、重复与未知ID全部拒绝',async()=>{const f=fixture();try{const q=[{id:'q1',type:'single',options:[{key:'A'}]}];for(const answers of [[],[{id:'q1',answer:['A']},{id:'q1',answer:['A']}],[{id:'foreign',answer:['A']}]])assert.throws(()=>f.api.normalize({answers},q),e=>e.cxCode==='CX-RES-006');}finally{f.close();}});
 await test('安全错误报告携带本地任务和请求关联ID',async()=>{const f=fixture('',r=>r.onload({status:503,responseText:'private'}));try{await assert.rejects(f.api.requestJSON({method:'POST',url:'https://example.com',diagnosticTaskId:'cx-task-test1'}),e=>{f.api.recordCxDiagnostic(e);return true;});const item=JSON.parse(f.api.exportCxDiagnostics()).diagnostics[0];assert.equal(item.taskId,'cx-task-test1');assert.match(item.requestId,/^cx-request-\d+$/);}finally{f.close();}});
 await test('模型列表页面离开后取消，迟到列表不更新模型配置',async()=>{let pending;const f=fixture(text,r=>{pending=r;});try{f.api.initQuizAssistant();const load=f.api.controller.loadModels();await Promise.resolve();assert(pending);f.w.dispatchEvent(new f.w.Event('pagehide'));await load;const before=f.writes.length;pending.onload({status:200,responseText:JSON.stringify({data:[{id:'late-model'}]})});await Promise.resolve();assert.equal(f.writes.length,before);assert(!f.writes.some(([,value])=>JSON.stringify(value).includes('late-model')));}finally{f.close();}});
 await test('选择题额外存在未适配作答区时仍填写选项且保留人工区域',async()=>{
  const html='<div class="singleQuesId" data="mixed"><div class="Zy_TItle"><div class="fontLabel">【单选题】选择概念</div></div><label><input type="radio" name="mix" value="A">A、甲</label><label><input type="radio" name="mix" value="B">B、乙</label><select><option>人工选择</option></select></div>';
  const f=fixture(html,r=>{
   const input=JSON.parse(JSON.parse(r.data).messages[1].content);
   const answers=input.questions.map(q=>({id:q.id,answer:['A']}));
   r.onload({status:200,responseText:JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({answers})}}]})});
  });
  try{f.api.initQuizAssistant();await f.api.runAnswerFlow();assert(f.doc.querySelector('input[value=A]').checked,f.api.controller.state.message);assert.equal(f.api.controller.result.prefill.filled,1);assert.equal(f.api.controller.result.prefill.skipped,1);assert.equal(f.doc.querySelector('select').selectedIndex,0);assert.equal(f.api.controller.result.responseUnitCount,2);assert(f.api.controller.result.questionAnswers[0].answer[0].includes('A'));assert.match(f.doc.getElementById('cx-ai-study-root').shadowRoot.querySelector('.answer-policy').textContent,/需人工/);}finally{f.close();}
 });
 await test('课程复制摘要排除标题、原因、题目、答案和视频弹题历史',async()=>{const f=fixture();try{const report={status:'stopped',reason:'secret-reason',videos:1,documents:2,quizzes:3,chapters:[{title:'secret-title',status:'manual-pending',tasks:[{videoQuiz:[{answer:'secret-answer'}]}]}]};const result=f.api.safeCourseDiagnosticReport(report);assert(!/secret|videoQuiz|title|reason|answer/.test(result));assert.equal(JSON.parse(result).summary.chapters['manual-pending'],1);}finally{f.close();}});
 await test('自定义模型旁提示配置篡改猴请求域名白名单且默认不显示',async()=>{const f=fixture(text);try{f.api.initQuizAssistant();const shadow=f.doc.getElementById('cx-ai-study-root').shadowRoot;const block=shadow.getElementById('custom-model-block');assert(block.hidden);assert.match(block.textContent,/篡改猴.*用户域名白名单/);assert(!/^\/\/ @connect\s+\*/m.test(source));}finally{f.close();}});
 await test('明确label多作答区域经分类、模型请求、统一预填完整贯通',async()=>{const f=fixture(text,r=>{const payload=JSON.parse(r.data),input=JSON.parse(payload.messages[1].content);const isPolicy=input.task==='answer-policy';const data=isPolicy?{classifications:input.questions.map(q=>({id:q.id,status:'auto',category:'text-blank',reason:'文字名称',evidence:'填写名称'}))}:{answers:input.questions.map((q,i)=>({id:q.id,answer:[i?'汉语':'北京'],reason:'常识'}))};r.onload({status:200,responseText:JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(data)}}]})});});try{f.api.initQuizAssistant();await f.api.runAnswerFlow();assert.equal(f.api.controller.task.status,'complete',f.api.controller.state.message);assert.equal(f.doc.querySelector('input').value,'北京');assert.equal(f.doc.querySelector('textarea').value,'汉语');assert.equal(f.api.controller.result.responseUnitCount,2);assert.equal(f.api.controller.result.questions.length,1);assert.equal(f.api.controller.result.prefill.filled,2);assert.equal(f.requests.length,2);assert.equal(f.api.controller.result.questionAnswers.length,1);}finally{f.close();}});
 const summary={total:results.length,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results};
 fs.writeFileSync(path.join(__dirname,'architecture-integration-results.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));process.exitCode=summary.failed?1:0;
})().catch(error=>{console.error(error);process.exitCode=1;});
