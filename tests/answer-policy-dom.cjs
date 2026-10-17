const {withModelFixture}=require('./model-fixture.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),{webcrypto}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const {JSDOM}=createRequire(path.join(root,'package.json'))('jsdom');
const source=fs.readFileSync(path.join(root,'学习通AI助手.user.js'),'utf8').replace('/* TRUSTED_ASSISTANT_ACTIVATION */','return true; /* test harness only: jsdom cannot generate user activation */');
const entry="    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startQuizObserver, { once: true });\n    else startQuizObserver();";
assert(source.includes(entry));
const code=source.replace(entry,'globalThis.policyAPI={extract,signature,normalize,prefill,questionLocalAnswerPolicy,questionPrefillPolicy,questionCanAutoAnswer,normalizeAnswerPolicies,classifyQuestionAnswerPolicies,buildConfiguredClassificationPayload,initQuizAssistant,runAnswerFlow,resumeAnalysisTask,stopAnalysisTask,get controller(){return controller}};');
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+XGnQAAAAASUVORK5CYII=';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const logs=[],failures=[];
async function test(name,fn){try{await fn();logs.push('PASS '+name);}catch(e){failures.push(name+': '+e.stack);}}
const text=(id,stem,type='简答题')=>`<div class="TiMu" questionid="${id}"><div class="stem">【${type}】${stem}</div><textarea></textarea></div>`;
const choice=(id,stem='数学：请选择正确结论',multiple=false)=>`<div class="TiMu" questionid="${id}"><div class="stem">【${multiple?'多选题':'单选题'}】${stem}</div><label><input type="${multiple?'checkbox':'radio'}" name="${id}" value="A">甲</label><label><input type="${multiple?'checkbox':'radio'}" name="${id}" value="B">乙</label></div>`;
function input(request){const p=JSON.parse(request.data),c=p.messages[1].content;return JSON.parse(Array.isArray(c)?c[0].text:c);}
function jsonReply(request,data){request.onload({status:200,responseText:JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(data)}}]})});}
function autoPolicies(qs){return qs.map(q=>({id:q.id,status:'auto',category:['single','multiple','judge'].includes(q.type)?'objective':q.type==='blank'?'text-blank':/SQL|代码|程序/.test(q.question)?'code':'knowledge',reason:'已确认文字或选项作答',evidence:q.question || '图片中的作答要求'}));}
function defaultReply(request){const d=input(request);jsonReply(request,d.task==='answer-policy'?{classifications:autoPolicies(d.questions)}:{answers:d.questions.map(q=>({id:q.id,answer:[['single','multiple','judge'].includes(q.type)?'A':'模拟文字答案'],reason:'模拟依据'}))});}
function fixture(html,opts={}){
 const dom=new JSDOM(html,{url:'https://mooc1.chaoxing.com/work/doHomeWorkNew',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,requests=[];
 const storage=new Map([['deepseek_api_key','mock-key'],['cx_model',opts.model||'deepseek-flash'],['cx_search',!!opts.search]]);
 w.GM_getValue=withModelFixture((k,v)=>storage.has(k)?storage.get(k):v);w.GM_setValue=(k,v)=>storage.set(k,v);w.GM_getResourceText=()=>'{}';
 Object.defineProperty(w.crypto,'subtle',{value:webcrypto.subtle});
 w.Image=class{set src(v){if(v)queueMicrotask(()=>{this.naturalWidth=this.naturalHeight=1;this.onload?.();});}};
 const timeout=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>timeout(fn,ms===2000?5:ms,...args);
 w.GM_xmlhttpRequest=request=>{requests.push(request);queueMicrotask(()=>opts.handle?opts.handle(request):defaultReply(request));return {abort(){request.onabort?.();}};};
 w.eval(code);w.policyAPI.initQuizAssistant();
 return {w,d:w.document,api:w.policyAPI,requests,storage,get shadow(){return w.document.getElementById('cx-ai-study-root').shadowRoot;},close(){w.dispatchEvent(new w.Event('pagehide'));w.close();}};
}
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await delay(5);}throw Error('等待超时');}
(async()=>{
 for(const stem of ['请手写作答并拍照上传','请抄写以下英文句子','绘制一张思维导图','画出电路示意图','请标注下图各部位'])await test('本地明确人工要求不请求模型：'+stem,async()=>{
  const f=fixture(text('m',stem),{search:true});try{await f.api.runAnswerFlow();assert.equal(f.requests.length,0);assert.equal(f.api.controller.result.manualCount,1);assert(!f.d.querySelector('textarea').value);assert.match(f.shadow.textContent,/需人工处理/);}finally{f.close();}
 });
 for(const stem of ['说明思维导图的作用','解释行列式的定义','说明抄写对记忆的作用','请说明手写笔记的作用'])await test('概念提及不等于要求执行：'+stem,async()=>{
  const f=fixture(text('k',stem));try{assert.equal(f.api.extract().questions[0].answerPolicy.status,'needs-classification');await f.api.runAnswerFlow();assert.equal(f.requests.length,2);assert.equal(input(f.requests[0]).task,'answer-policy');assert.equal(input(f.requests[1]).task,undefined);assert.equal(f.d.querySelector('textarea').value,'模拟文字答案');}finally{f.close();}
 });
 await test('单选多选判断包含数学物理科目无需额外分类',async()=>{
  const f=fixture(choice('s')+choice('m','物理：请选择',true)+choice('j','【判断题】物理概念').replace('【单选题】',''));try{await f.api.runAnswerFlow();assert.equal(f.requests.length,1);assert.equal(f.d.querySelectorAll('input:checked').length,3);}finally{f.close();}
 });
 await test('文字填空、政治知识、SQL代码分别通过分类后填写',async()=>{
  const f=fixture(text('b','填写国家名称','填空题')+text('p','解释人民民主的含义')+text('sql','编写创建 goods 表的 SQL 代码'));try{await f.api.runAnswerFlow();assert.equal(f.requests.length,2);const c=input(f.requests[0]);assert.equal(c.questions.length,3);assert(!JSON.stringify(c).includes('courseContext'));assert(!JSON.stringify(c).includes('mock-key'));assert.equal(f.d.querySelectorAll('textarea').length,3);assert([...f.d.querySelectorAll('textarea')].every(e=>e.value==='模拟文字答案'));}finally{f.close();}
 });
 await test('计算推导分类为人工，答案请求只含支持题',async()=>{
  const f=fixture(choice('a')+text('calc','计算下列行列式')+text('physics','推导牛顿运动方程')+text('formula','求加速度公式','填空题'),{handle:r=>{const d=input(r);if(d.task==='answer-policy')jsonReply(r,{classifications:d.questions.map(q=>({id:q.id,status:'manual',category:'calculation',reason:'需要计算或公式推导',evidence:q.question}))});else defaultReply(r);}});
  try{await f.api.runAnswerFlow();assert.equal(f.requests.length,2);assert.deepEqual(input(f.requests[1]).questions.map(q=>q.id),['a']);assert.equal(f.api.controller.result.manualCount,3);assert.equal(f.api.controller.result.analyzedCount,1);assert([...f.d.querySelectorAll('textarea')].every(e=>!e.value));assert(f.d.querySelector('input:checked'));}finally{f.close();}
 });
 await test('图片手写要求与普通图片知识问答分开处理',async()=>{
  const f=fixture(text('img-manual',`<img src="${PNG}">`)+text('img-auto',`图片知识题<img src="${PNG}">`),{handle:r=>{const d=input(r);if(d.task==='answer-policy')jsonReply(r,{classifications:autoPolicies(d.questions).map(p=>p.id==='img-manual'?{...p,status:'manual',category:'handwriting',reason:'图片要求手写拍照上传'}:p)});else defaultReply(r);}});
  try{await f.api.runAnswerFlow();assert.equal(f.requests.length,2);assert.equal(input(f.requests[1]).questions.length,1);assert.equal(input(f.requests[1]).questions[0].id,'img-auto');assert(!f.d.querySelector('textarea').value);assert.equal(f.d.querySelectorAll('textarea')[1].value,'模拟文字答案');assert.equal(f.api.controller.result.manualCount,1);}finally{f.close();}
 });
 for(const scenario of ['missing','duplicate','invalid-status','no-reason','invalid-category'])await test('无效分类不能放行：'+scenario,async()=>{
  const f=fixture(text('q','解释概念'),{handle:r=>{let p=autoPolicies(input(r).questions)[0];const entries=scenario==='missing'?[]:scenario==='duplicate'?[p,p]:[{...p,...(scenario==='invalid-status'?{status:'yes'}:scenario==='no-reason'?{reason:''}:{category:'calculation'})}];jsonReply(r,{classifications:entries});}});
  try{await f.api.runAnswerFlow();assert.equal(f.requests.length,1);assert.equal(f.api.controller.result.uncertainCount,1);assert(!f.d.querySelector('textarea').value);}finally{f.close();}
 });
 await test('分类超时只重试分类，成功后才生成答案',async()=>{
  let attempts=0;const f=fixture(text('q','解释概念'),{handle:r=>{if(input(r).task==='answer-policy' && attempts++===0)r.ontimeout();else defaultReply(r);}});
  try{await f.api.runAnswerFlow();assert.equal(f.requests.length,3);assert.equal(input(f.requests[0]).task,'answer-policy');assert.equal(input(f.requests[1]).task,'answer-policy');assert.equal(f.d.querySelector('textarea').value,'模拟文字答案');}finally{f.close();}
 });
 await test('分类网络失败不可进入求解或预填',async()=>{
  const f=fixture(text('q','解释概念'),{handle:r=>r.onerror()});try{await f.api.runAnswerFlow();assert.equal(f.requests.length,2);assert(f.requests.every(r=>input(r).task==='answer-policy'));assert.equal(f.api.controller.task.status,'failed');assert(!f.api.controller.last);assert(!f.d.querySelector('textarea').value);}finally{f.close();}
 });
 await test('部分分类失败恢复时不重发成功分类',async()=>{
  let fail=true;const f=fixture(Array.from({length:11},(_,i)=>text('q'+i,'解释概念')).join(''),{handle:r=>{const d=input(r);if(d.task==='answer-policy' && d.questions[0].id==='q10' && fail)r.onload({status:401,responseText:'{}'});else defaultReply(r);}});
  try{await f.api.runAnswerFlow({autoPrefill:false});assert.equal(f.requests.length,2);assert.equal(f.api.controller.task.answerPolicies.size,10);assert.equal(f.api.controller.result.analyzedCount,0);fail=false;await f.api.resumeAnalysisTask();assert.equal(f.requests.length,5);assert.deepEqual(f.requests.filter(r=>input(r).task==='answer-policy').map(r=>input(r).questions.length),[10,1,1]);assert.equal(f.api.controller.result.analyzedCount,11);}finally{f.close();}
 });
 await test('答案批次失败恢复复用已成功分类',async()=>{
  let fail=true;const f=fixture(text('q','解释概念'),{handle:r=>{if(!input(r).task && fail)r.onload({status:401,responseText:'{}'});else defaultReply(r);}});
  try{await f.api.runAnswerFlow({autoPrefill:false});fail=false;await f.api.resumeAnalysisTask();assert.equal(f.requests.length,3);assert.equal(f.requests.filter(r=>input(r).task==='answer-policy').length,1);}finally{f.close();}
 });
 await test('分类等待停止，迟到响应不能恢复结果',async()=>{
  let held;const f=fixture(text('q','解释概念'),{handle:r=>{held=r;}});try{const p=f.api.runAnswerFlow();await until(()=>held);f.api.stopAnalysisTask();await p;const before=f.api.controller.result;defaultReply(held);await delay(10);assert.equal(f.requests.length,1);assert.equal(f.api.controller.result,before);assert(!f.d.querySelector('textarea').value);}finally{f.close();}
 });
 await test('分类等待题目改变，返回后作废而非写入',async()=>{
  let held;const f=fixture(text('q','解释概念'),{handle:r=>{held=r;}});try{const p=f.api.runAnswerFlow();await until(()=>held);f.d.querySelector('.stem').textContent='【简答题】另一道题';defaultReply(held);await p;assert.equal(f.requests.length,1);assert.equal(f.api.controller.task.status,'stale');assert(!f.d.querySelector('textarea').value);}finally{f.close();}
 });
 await test('缺少旧策略及错误人工题答案不能从统一预填入口绕过',async()=>{
  const f=fixture(text('old','解释概念')+text('m','请手写并上传')+choice('s'));try{const qs=f.api.extract().questions;const entries=qs.map(q=>({id:q.id,number:q.number,answer:[q.type==='single'?'A':'绕过答案'],...(q.id==='m'?{answerPolicy:{status:'auto',category:'knowledge',reason:'错误放行'}}:{})}));const result=await f.api.prefill(qs,entries);assert.equal(result.filled,1);assert.equal(result.skipped,2);assert([...f.d.querySelectorAll('textarea')].every(e=>!e.value));}finally{f.close();}
 });
 await test('解答阶段降级人工，非空模型答案仍被清空并禁止手动预填',async()=>{
  const f=fixture(text('q','解释概念'),{handle:r=>{if(input(r).task)defaultReply(r);else jsonReply(r,{answers:[{id:'q',answer:['不得填写'],reason:'实际要求绘图',answerPolicy:{status:'manual',reason:'实际要求绘图'}}]});}});
  try{await f.api.runAnswerFlow();assert.equal(f.api.controller.result.answers[0].answer.length,0);assert.equal(f.api.controller.result.manualCount,1);assert(!f.d.querySelector('textarea').value);}finally{f.close();}
 });
 await test('组内作答说明拦截，其他题和工具栏及手工答案不能污染判断',async()=>{
  const f=fixture(`<section class="mark_item"><h2 class="type_tit">简答题：请手写作答</h2>${text('m','解释概念')}</section>`+text('k','解释概念')+`<div class="editor-toolbar">请手写拍照</div>`);
  try{f.d.querySelectorAll('textarea')[1].value='请手写拍照';const d=f.api.extract();assert.equal(d.questions[0].answerPolicy.status,'manual');assert.equal(d.questions[1].answerPolicy.status,'needs-classification');await f.api.runAnswerFlow();assert.equal(input(f.requests[0]).questions.length,1);assert.equal(f.d.querySelectorAll('textarea')[1].value,'请手写拍照');}finally{f.close();}
 });
 await test('无视觉模型保留人工清单，不发送图片分类或答案',async()=>{
  const f=fixture(text('q',`<img src="${PNG}">`),{model:'deepseek-v4-pro'});try{await f.api.runAnswerFlow();assert.equal(f.requests.length,0);assert.equal(f.api.controller.result.uncertainCount,1);assert.match(f.api.controller.state.message,/不支持图片/);}finally{f.close();}
 });
 await test('原始签名不被分类改变，已有手工文字保留',async()=>{
  const f=fixture(text('q','解释概念'));try{f.d.querySelector('textarea').value='手工内容';const before=f.api.signature(f.api.extract().questions);await f.api.runAnswerFlow();assert.equal(f.api.signature(f.api.extract().questions),before);assert.equal(f.d.querySelector('textarea').value,'手工内容');assert.equal(f.api.controller.result.prefill.skipped,1);}finally{f.close();}
 });
 for(const [provider,model,url] of [
  ['deepseek','deepseek-flash','https://api.deepseek.com/chat/completions'],
  ['openai','gpt-4.1-mini','https://api.openai.com/v1/chat/completions'],
  ['qwen','qwen-plus','https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'],
  ['kimi','kimi-k2.6','https://api.moonshot.cn/v1/chat/completions'],
  ['glm','glm-5.3-flash','https://open.bigmodel.cn/api/paas/v4/chat/completions'],
  ['custom','text-model','https://gateway.example/v1/chat/completions']])await test('分类请求复用平台适配：'+provider,async()=>{
  const f=fixture(text('q','解释概念'));try{const qs=f.api.extract().questions;const result=await f.api.classifyQuestionAnswerPolicies({provider,model,key:'mock-key',thinking:false,baseURL:'https://gateway.example/v1',courseContext:[{text:'不应进入分类的课程资料'}]},qs,new Map());assert.equal(result.get('q').status,'auto');assert.equal(f.requests[0].url,url);assert(!JSON.stringify(input(f.requests[0])).includes('courseContext'));const p=JSON.parse(f.requests[0].data);if(provider==='qwen')assert.equal(p.enable_thinking,undefined);if(provider==='openai')assert.equal(p.thinking,undefined);}finally{f.close();}
 });
 await test('新鲜作答要求阻止旧快照直接预填',async()=>{
  const f=fixture(choice('q'));try{const qs=f.api.extract().questions;f.d.querySelector('.stem').textContent='【单选题】请手写后拍照上传';const summary=await f.api.prefill(qs,[{id:'q',number:1,answer:['A'],answerPolicy:{status:'auto',reason:'旧的白名单'}}]);assert.equal(summary.skipped,1);assert(!f.d.querySelector('input:checked'));}finally{f.close();}
 });
 await test('模型配置在分类等待期间变化，迟到分类作废',async()=>{
  let held;const f=fixture(text('q','解释概念'),{handle:r=>{held=r;}});try{const p=f.api.runAnswerFlow();await until(()=>held);f.storage.set('cx_model','deepseek-v4-pro');defaultReply(held);await p;assert.equal(f.requests.length,1);assert.equal(f.api.controller.task.status,'stale');assert(!f.api.controller.last);assert(!f.d.querySelector('textarea').value);}finally{f.close();}
 });
 await test('人工判断原因以纯文本展示，不执行HTML',async()=>{
  const f=fixture(text('q','解释概念'),{handle:r=>jsonReply(r,{classifications:[{id:'q',status:'manual',category:'drawing',reason:'<img src=x onerror=alert(1)>需绘图'}]})});try{await f.api.runAnswerFlow();assert.equal(f.shadow.querySelectorAll('.answer-policy img').length,0);assert(f.shadow.textContent.includes('<img src=x'));assert.equal(f.requests.length,1);}finally{f.close();}
 });
 await test('分类返回答案旧协议时转人工，不把答案作为放行依据',async()=>{
  const f=fixture(text('q','解释概念'),{handle:r=>jsonReply(r,{answers:[{id:'q',answer:['旧协议答案']}]})});try{await f.api.runAnswerFlow();assert.equal(f.api.controller.result.uncertainCount,1);assert.equal(f.requests.length,1);assert(!f.d.querySelector('textarea').value);}finally{f.close();}
 });
 await test('分类非法JSON停止，不重复当作答案请求',async()=>{
  const f=fixture(text('q','解释概念'),{handle:r=>r.onload({status:200,responseText:JSON.stringify({choices:[{finish_reason:'stop',message:{content:'not json'}}]})})});try{await f.api.runAnswerFlow();assert.equal(f.requests.length,1);assert.equal(f.api.controller.task.status,'failed');assert(!f.d.querySelector('textarea').value);}finally{f.close();}
 });

 const result={total:logs.length+failures.length,failures,logs};console.log(JSON.stringify(result,null,2));fs.writeFileSync(path.join(root,'tests/answer-policy-results.json'),JSON.stringify(result,null,2));process.exitCode=failures.length?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
