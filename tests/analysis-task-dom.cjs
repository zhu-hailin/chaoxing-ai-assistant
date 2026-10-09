const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'../学习通AI助手.user.js'),'utf8');
const entry="    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startQuizObserver, { once: true });\n    else startQuizObserver();";
assert(source.includes(entry));
const code=source.replace(entry,'globalThis.taskAPI={initQuizAssistant,runAnswerFlow,resumeAnalysisTask,stopAnalysisTask,readMediaBytes,decodeMediaSize,prepareQuestionMedia,withAnalysisRetry,solveQuestionBatches,extract,signature,get controller(){return controller}};');
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+XGnQAAAAASUVORK5CYII=';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const logs=[],failures=[];
async function test(name,action){try{await action();logs.push('PASS '+name);}catch(error){failures.push(name+': '+error.stack);}}
function choices(count=1){return Array.from({length:count},(_,i)=>`<div class="singleQuesId" data="q${i+1}"><div class="Zy_TItle"><div class="fontLabel">【单选题】模拟题目 ${i+1}</div></div><label><input type="radio" name="q${i+1}" value="A">A、甲</label><label><input type="radio" name="q${i+1}" value="B">B、乙</label></div>`).join('');}
function picture(src,id='1'){return `<div class="questionLi singleQuesId" id="e${id}"><h3 class="mark_name">${id}. (简答题)<span class="qtContent workTextWrap">说明图片<img src="${src}"></span></h3><textarea></textarea></div>`;}
function reply(request){
 const payload=JSON.parse(request.data),content=payload.messages[1].content;
 const data=JSON.parse(Array.isArray(content)?content[0].text:content);
 request.onload({status:200,responseText:JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({answers:data.questions.map(q=>({id:q.id,answer:[q.type==='essay'?'模拟图片解释':'B'],reason:'本地模拟答案'}))})}}]})});
}
function evidence(request){request.onload({status:200,responseText:JSON.stringify({content:[{type:'web_search_tool_result',content:[{type:'web_search_result',url:'https://example.org/reference',title:'模拟来源'}]}]})});}
function fixture(html=choices(),options={}) {
 const dom=new JSDOM(html,{url:'https://mooc1.chaoxing.com/mooc-ans/mooc2/work/view',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,requests=[],storage=new Map([['deepseek_api_key','mock-key'],['cx_model','deepseek-flash'],['cx_search',Boolean(options.search)]]),images=[];
 w.GM_getValue=(k,f)=>storage.has(k)?storage.get(k):f;w.GM_setValue=(k,v)=>storage.set(k,v);w.GM_getResourceText=()=>'{}';
 w.Image=class{constructor(){images.push(this);}set src(value){this.value=value;if(value&&!options.hangImage)queueMicrotask(()=>{this.naturalWidth=this.naturalHeight=1;this.onload?.();});}};
 const timeout=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>timeout(fn,ms===2000?8:ms,...args);
 w.GM_xmlhttpRequest=request=>{
   const record={request,aborted:false};requests.push(record);
   queueMicrotask(()=>options.handle?.(request,record,requests));
   return {abort(){record.aborted=true;request.onabort?.();}};
 };
 w.eval(code);w.taskAPI.initQuizAssistant();
 return {w,d:w.document,api:w.taskAPI,requests,storage,images,
   get shadow(){return w.document.getElementById('cx-ai-study-root').shadowRoot;},
   close(){w.dispatchEvent(new w.Event('pagehide'));w.close();}};
}
async function until(test){for(let i=0;i<200;i++){if(test())return;await pause(5);}throw new Error('等待模拟状态超时');}
const postCount=f=>f.requests.filter(r=>r.request.method==='POST').length;
const bodies=f=>f.requests.filter(r=>r.request.url.endsWith('/chat/completions')).map(r=>JSON.parse(r.request.data));
(async()=>{
 await test('25题保留第一批，失败只自动重试一次，恢复只请求未完成批次',async()=>{
  let failing=true;const f=fixture(choices(25),{handle:r=>{const body=JSON.parse(r.data),data=JSON.parse(body.messages[1].content);if(data.questions[0].id==='q11'&&failing)r.ontimeout();else reply(r);}});
  try{await f.api.runAnswerFlow({autoPrefill:false});assert.equal(postCount(f),3);assert.equal(f.api.controller.task.status,'failed');assert.equal(f.api.controller.result.answers.length,10);assert.equal(f.api.controller.last,null);assert(f.shadow.getElementById('prefill').disabled);assert(!f.shadow.getElementById('analysis-resume').hidden);assert(!f.api.controller.state.busy);assert(f.shadow.getElementById('output').textContent.includes('等待重试'));failing=false;await f.api.resumeAnalysisTask();assert.equal(postCount(f),5);assert.equal(f.api.controller.result.answers.length,25);assert.equal(f.api.controller.result.answers[24].id,'q25');assert.equal(f.api.controller.task.status,'complete');assert.equal(bodies(f).filter(b=>JSON.parse(b.messages[1].content).questions[0].id==='q1').length,1);assert(!f.shadow.getElementById('prefill').disabled);}finally{f.close();}
 });
 for(const failure of ['NETWORK','TIMEOUT',502,503,504])await test(`${failure} 自动重试一次后成功`,async()=>{
  let count=0;const f=fixture(choices(),{handle:r=>{if(count++===0){if(failure==='NETWORK')r.onerror();else if(failure==='TIMEOUT')r.ontimeout();else r.onload({status:failure,responseText:'{"error":{"message":"临时错误"}}'});}else reply(r);}});
  try{await f.api.runAnswerFlow({autoPrefill:false});assert.equal(postCount(f),2);assert.equal(f.api.controller.task.status,'complete');}finally{f.close();}
 });
 for(const failure of [401,403,429,'bad-json','empty-search'])await test(`${failure} 不自动重试，保留题目并恢复按钮`,async()=>{
  const f=fixture(choices(),{search:failure==='empty-search',handle:r=>r.onload({status:typeof failure==='number'?failure:200,responseText:failure==='bad-json'?'bad':failure==='empty-search'?'{}':'{"error":{"message":"拒绝"}}'})});
  try{await f.api.runAnswerFlow();assert.equal(postCount(f),1);assert.equal(f.api.controller.task.status,'failed');assert.equal(f.api.controller.result.questions.length,1);assert(f.shadow.getElementById('prefill').disabled);assert(!f.api.controller.state.busy);}finally{f.close();}
 });
 await test('修正Key后只恢复失败批次，改变模型不再复用旧任务',async()=>{
  let reject=true;const f=fixture(choices(11),{handle:r=>{const d=JSON.parse(JSON.parse(r.data).messages[1].content);if(d.questions[0].id==='q11'&&reject)r.onload({status:401,responseText:'{}'});else reply(r);}});
  try{await f.api.runAnswerFlow({autoPrefill:false});f.storage.set('deepseek_api_key','fixed-key');reject=false;await f.api.resumeAnalysisTask();assert.equal(postCount(f),3);assert.equal(f.requests.at(-1).request.headers.Authorization,'Bearer fixed-key');await f.api.runAnswerFlow({autoPrefill:false});f.api.controller.task.status='failed';f.storage.set('cx_model','deepseek-v4-pro');const n=postCount(f);await f.api.resumeAnalysisTask();assert.equal(postCount(f),n);assert.equal(f.api.controller.task.status,'stale');assert.equal(f.api.controller.last,null);}finally{f.close();}
 });
 await test('模型失败后恢复不重复已成功的逐题联网检索',async()=>{
  let fail=true;const f=fixture(choices(2),{search:true,handle:r=>{if(!r.url.endsWith('/chat/completions'))evidence(r);else if(fail)r.onload({status:401,responseText:'{}'});else reply(r);}});
  try{await f.api.runAnswerFlow({autoPrefill:false});assert.equal(postCount(f),3);fail=false;await f.api.resumeAnalysisTask();assert.equal(postCount(f),4);assert.equal(f.api.controller.result.analyzedCount,2);}finally{f.close();}
 });
 await test('成功图片缓存保留，恢复只下载失败图片，媒体GET不携带Key',async()=>{
  const one='https://p.ananas.chaoxing.com/one.png',two='https://p.ananas.chaoxing.com/two.png';let failing=true;
  const f=fixture(picture(one)+picture(two,'2'),{handle:r=>{if(r.method==='POST')reply(r);else if(r.url===two&&failing)r.onload({status:404,response:new ArrayBuffer(0)});else r.onload({status:200,response:Uint8Array.from(Buffer.from(PNG,'base64')).buffer});}});
  try{await f.api.runAnswerFlow({autoPrefill:false});assert.equal(f.api.controller.task.preparedMedia.size,1);failing=false;await f.api.resumeAnalysisTask();assert.equal(f.requests.filter(x=>x.request.url===one).length,1);assert.equal(f.requests.filter(x=>x.request.url===two).length,2);assert(f.requests.filter(x=>x.request.method==='GET').every(x=>!x.request.headers));assert.equal(f.api.controller.task.preparedMedia.size,0);assert.equal(f.api.controller.task.status,'complete');}finally{f.close();}
 });
 await test('停止模型请求，晚到响应不覆盖结果；恢复不重跑成功批次',async()=>{
  let held,hold=true;const f=fixture(choices(11),{handle:r=>{const d=JSON.parse(JSON.parse(r.data).messages[1].content);if(d.questions[0].id==='q11'&&hold)held=r;else reply(r);}});
  try{const run=f.api.runAnswerFlow({autoPrefill:false});await until(()=>held);f.api.stopAnalysisTask();f.api.stopAnalysisTask();await run;assert(f.requests.at(-1).aborted);assert.equal(f.api.controller.task.status,'stopped');assert.equal(f.api.controller.result.answers.length,10);const before=f.api.controller.result;reply(held);await pause(15);assert.equal(f.api.controller.result,before);hold=false;const a=f.api.resumeAnalysisTask(),b=f.api.resumeAnalysisTask();await Promise.all([a,b]);assert.equal(postCount(f),3);assert.equal(f.api.controller.task.status,'complete');}finally{f.close();}
 });
 await test('重试等待可停止，不再发送第二次请求',async()=>{
  const f=fixture(choices(),{handle:r=>r.onerror()});
  try{const run=f.api.runAnswerFlow();await until(()=>f.api.controller.state.message.includes('2 秒'));f.shadow.getElementById('analysis-stop').click();await run;await pause(20);assert.equal(postCount(f),1);assert.equal(f.api.controller.task.status,'stopped');assert(!f.api.controller.state.busy);assert(f.shadow.getElementById('status-spinner').hidden);}finally{f.close();}
 });
 await test('停止检索和跨域图片请求，不进入模型分析',async()=>{
  for(const html of [choices(),picture('https://p.ananas.chaoxing.com/held.png')]){
   const f=fixture(html,{search:html===choices()});
   try{const run=f.api.runAnswerFlow();await until(()=>f.requests.length);f.api.stopAnalysisTask();await run;assert(f.requests.every(r=>r.aborted));assert.equal(f.api.controller.task.status,'stopped');assert(!f.api.controller.state.busy);assert.equal(bodies(f).length,0);}finally{f.close();}
  }
 });
 await test('同源与blob读取信号传递到fetch并及时取消',async()=>{
  const f=fixture();
  try{for(const src of ['https://mooc1.chaoxing.com/image.png','blob:https://mooc1.chaoxing.com/mock']){
    let aborted=false;f.w.fetch=(_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>{aborted=true;reject(new f.w.DOMException('cancel','AbortError'));},{once:true}));
    const ac=new f.w.AbortController(),read=f.api.readMediaBytes(src,f.d,ac.signal);ac.abort();await assert.rejects(read,error=>error.code==='ABORTED');assert(aborted);
   }}finally{f.close();}
 });
 await test('停止图片解码清理回调，晚到load不触发模型请求',async()=>{
  const f=fixture(picture('data:image/png;base64,'+PNG),{hangImage:true});
  try{const run=f.api.runAnswerFlow();await until(()=>f.images.length);const image=f.images[0];f.api.stopAnalysisTask();await run;assert.equal(image.onload,null);assert.equal(image.onerror,null);assert.equal(image.value,'');assert.equal(postCount(f),0);assert.equal(f.api.controller.task.status,'stopped');}finally{f.close();}
 });
 await test('改变题干、选项、图片或分组，恢复拒绝旧进度',async()=>{
  for(const change of ['stem','option','image','group']){
   const f=fixture(change==='image'||change==='group'?`<section class="mark_item"><h2 class="type_tit">简答题</h2>${picture('data:image/png;base64,'+PNG)}</section>`:choices(),{handle:r=>r.onload({status:401,responseText:'{}'})});
   try{await f.api.runAnswerFlow();if(change==='stem')f.d.querySelector('.fontLabel').textContent='【单选题】变化题干';else if(change==='option')f.d.querySelector('label').append('新选项内容');else if(change==='image')f.d.querySelector('img').src+='change';else{const wrapper=f.d.createElement('section');wrapper.className='mark_item';f.d.querySelector('.mark_item').after(wrapper);wrapper.append(f.d.querySelector('.questionLi'));}const count=postCount(f);await f.api.resumeAnalysisTask();assert.equal(postCount(f),count);assert.equal(f.api.controller.task.status,'stale');assert.equal(f.api.controller.task.preparedMedia.size,0);}finally{f.close();}
  }
 });
 await test('全部批次成功前不预填，恢复后统一填且保留已有不同答案',async()=>{
  let failing=true;const f=fixture(choices(11),{handle:r=>{const d=JSON.parse(JSON.parse(r.data).messages[1].content);if(d.questions[0].id==='q11'&&failing)r.onload({status:401,responseText:'{}'});else reply(r);}});
  try{f.d.querySelector('input[name=q1][value=A]').checked=true;await f.api.runAnswerFlow();assert.equal(f.d.querySelectorAll('input:checked').length,1);failing=false;await f.api.resumeAnalysisTask();assert.equal(f.d.querySelectorAll('input:checked').length,11);assert(f.d.querySelector('input[name=q1][value=A]').checked);assert.equal(f.api.controller.result.prefill.filled,10);}finally{f.close();}
 });
 await test('预填中停止保留已写内容，恢复只继续预填不重发AI请求',async()=>{
  const f=fixture(choices(3),{handle:reply});
  try{const first=f.d.querySelector('input[name=q1][value=B]');first.addEventListener('change',()=>f.api.stopAnalysisTask(),{once:true});await f.api.runAnswerFlow();assert(first.checked);assert.equal(f.d.querySelectorAll('input:checked').length,1);assert.equal(f.api.controller.task.status,'stopped');assert(f.api.controller.state.message.includes('已写入内容保留'));await f.api.resumeAnalysisTask();assert.equal(postCount(f),1);assert.equal(f.d.querySelectorAll('input:checked').length,3);}finally{f.close();}
 });
 await test('关面板不停止，新提取清理进度，pagehide取消并释放任务',async()=>{
  const f=fixture();
  try{f.api.controller.openPanel();const run=f.api.runAnswerFlow({autoPrefill:false});await until(()=>f.requests.length);f.shadow.getElementById('close').click();assert(!f.requests[0].aborted);f.w.dispatchEvent(new f.w.Event('pagehide'));await run;assert(f.requests[0].aborted);assert.equal(f.api.controller.task,null);reply(f.requests[0].request);await pause(5);}finally{f.close();}
  const g=fixture(choices(),{handle:reply});try{await g.api.runAnswerFlow({autoPrefill:false});await g.api.controller.extractOnly();assert.equal(g.api.controller.task,null);assert.equal(g.api.controller.last,null);assert.equal(g.api.controller.result.answers,undefined);}finally{g.close();}
 });
 await test('手动预填可停止并恢复，获取模型期间不显示分析停止按钮',async()=>{
  const f=fixture(choices(2),{handle:r=>r.url.endsWith('/chat/completions')?reply(r):r.onload({status:200,responseText:'{"data":[{"id":"deepseek-flash"}]}'})});
  try{await f.api.runAnswerFlow({autoPrefill:false});f.d.querySelector('input[value=B]').addEventListener('change',()=>f.api.stopAnalysisTask(),{once:true});await f.api.controller.prefillLast();assert.equal(f.api.controller.task.status,'stopped');assert(!f.shadow.getElementById('analysis-resume').hidden);await f.api.resumeAnalysisTask();await f.api.controller.prefillLast();assert.equal(f.d.querySelectorAll('input:checked').length,2);assert.equal(bodies(f).length,1);const loading=f.api.controller.loadModels();assert(f.shadow.getElementById('analysis-stop').hidden);f.api.stopAnalysisTask();await loading;assert.equal(f.api.controller.state.phase,'done');}finally{f.close();}
 });
 const report={passed:logs.length,failures,logs};console.log(JSON.stringify(report,null,2));fs.writeFileSync(path.join(__dirname,'analysis-task-results.json'),JSON.stringify(report,null,2));process.exitCode=failures.length?1:0;
})().catch(error=>{console.error(error);process.exitCode=1;});
