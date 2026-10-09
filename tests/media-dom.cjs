const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { JSDOM } = require('jsdom');
const entry = "    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startQuizObserver, { once: true });\n    else startQuizObserver();";
const source = fs.readFileSync(path.join(__dirname,'../学习通AI助手.user.js'),'utf8');
assert(source.includes(entry));
const instrumented = source.replace(entry, 'globalThis.mediaAPI={extract,signature,parseQuestionDocument,prepareQuestionMedia,readMediaBytes,buildChatContent,buildSearchContent,askDeepSeek,getWebEvidence,splitQuestionBatches,buildAnswerPayload,assertRequestSize,modelSupportsImages,normalizeMediaAnalysis,initQuizAssistant,startQuizObserver,runAnswerFlow,formatResultText,get controller(){return controller}};');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+XGnQAAAAASUVORK5CYII=';
const DATA = `data:image/png;base64,${PNG}`;
const bytes = () => Uint8Array.from(Buffer.from(PNG,'base64'));
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
const logs=[],failures=[];
async function test(name,run) {try {await run();logs.push(`PASS ${name}`);}catch(error){failures.push(`${name}: ${error.stack}`);}}
function fixture(html, options={}) {
 const dom=new JSDOM(html,{url:options.url||'https://mooc1.chaoxing.com/mooc-ans/mooc2/work/view',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,requests=[],writes=[];
 w.GM_getValue=(key,fallback)=>({deepseek_api_key:'mock-key',cx_model:options.model||'deepseek-flash',cx_search:options.search||false}[key]??fallback);
 w.GM_setValue=(key,value)=>writes.push({key,value});w.GM_getResourceText=()=>'{}';
 w.GM_xmlhttpRequest=request=>{requests.push(request);if(options.mediaResponse && request.method==='GET')queueMicrotask(()=>options.mediaResponse(request));};
 Object.defineProperty(w.crypto,'subtle',{value:webcrypto.subtle});
 // jsdom 不解码图片：只模拟浏览器 Image 的完成事件，不请求真实网络。
 w.Image=class {set src(value){if(!value)return;queueMicrotask(()=>{if(options.decodeError)this.onerror?.();else{this.naturalWidth=options.width||1;this.naturalHeight=options.height||1;this.onload?.();}});}};
 w.eval(instrumented);
 return {w,d:w.document,api:w.mediaAPI,requests,writes,close(){w.dispatchEvent(new w.Event('pagehide'));w.close();}};
}
const essay=(id,body,extra='')=>`<div class="questionLi singleQuesId" id="${id}"><h3 class="mark_name">${id.replace(/\D/g,'')||1}. <span>(简答题)</span><span class="qtContent workTextWrap">${body}</span></h3>${extra}</div>`;
const group=body=>`<section class="mark_item"><h2 class="type_tit">一. 简答题（共7题，100分）</h2>${body}</section>`;
const homework=body=>`<div class="fanyaMarking TiMu"><div class="fanyaMarking_left whiteBg"><div class="detailsHead"><h2 class="mark_title" style="padding:30px 40px 0;width:575px">项目：数据表</h2><div class="infoHead">题量: 7 满分:100 作答时间:10-08</div><a class="analysisCard">智能分析</a><span class="resultNum" style="position:absolute;right:40px;top:40px">87.8分</span></div><div class="mark_table">${body}</div></div></div>`;
const imageChoice=(id,{multiple=false,legacy=false,external=false,nested=false,sibling=false}={})=>{
 const type=multiple?'多选题':'单选题',stem=`<div class="fontLabel">【${type}】选择正确的图片</div>`;
 const choices=legacy?`<ul class="Zy_ulTop">${['A','B','C','D'].map(key=>`<li><span class="num_option" data="${key}">${key}</span><a class="after"><img src="${DATA}"></a></li>`).join('')}</ul>`:['A','B','C','D'].map(key=>{
  const input=`<input id="${id}-${key}" type="${multiple?'checkbox':'radio'}" name="${id}" value="${key}">`,label=`${key}、<img src="${DATA}">`;
  return sibling?`<div class="option"><label>${input}${key}、</label><img src="${DATA}"></div>`:external?`${input}<label for="${id}-${key}">${label}</label>`:`<label>${input}${label}</label>`;
 }).join('');
 return `<div class="singleQuesId" data="${id}"><div class="Zy_TItle">${stem}${nested?choices:''}</div>${nested?'':choices}</div>`;
};
async function pending(f){for(let i=0;i<100;i++){const request=f.requests.find(r=>r.method==='POST');if(request)return request;if(!f.api.controller.state.busy)break;await pause(10);}throw new Error('没有产生预期模型请求');}
function answer(request, overrides={}){
 const payload=JSON.parse(request.data),content=payload.messages[1].content;
 const data=JSON.parse(Array.isArray(content)?content[0].text:content);
 const parsed={answers:data.questions.map(q=>({id:q.id,answer:q.type==='essay'?['CREATE TABLE goods (\n  id INT PRIMARY KEY\n);']:['A'],reason:'模拟分析'})),...overrides};
 request.onload({status:200,responseText:JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(parsed)}}]})});
 return {payload,data};
}
(async()=>{
 await test('四种简答标签、题号剥离和普通公式保护',async()=>{
  const forms=['【简答题】','[简答题]','(简答题)','（简答题）'];const f=fixture(forms.map((label,i)=>`<div class="TiMu" questionid="${i}"><h3 class="stem">${i+1}. ${label}解释概念</h3><textarea></textarea></div>`).join('')+'<div class="TiMu" questionid="formula"><h3 class="stem">(A+B) 求值</h3></div>');
  try{const d=f.api.extract();assert.equal(d.schemaVersion,2);assert(d.questions.slice(0,4).every(q=>q.type==='essay'&&q.question==='解释概念'));assert.equal(d.questions[4].type,'unknown');assert.equal(d.questions[4].question,'(A+B) 求值');}finally{f.close();}
 });
 await test('实际作业边界只提取表格图片，排除答案图片和批语',async()=>{
  const f=fixture(homework(group(essay('q1',`建表<img src="${DATA}">`,`<dl><dt>我的答案</dt><dd><img src="https://p.ananas.chaoxing.com/my-answer.png"></dd></dl><div class="teacher-comment"><img src="comment.png"></div>`)+essay('q2','根据表1查询'))));
  try{const d=f.api.extract();assert.equal(d.total,2);assert.equal(d.media.length,1);assert.equal(d.questions[0].source.adapter,'chaoxing-homework');assert(d.questions.every(q=>q.type==='essay'));assert.equal(d.questions[1].contextImageIds[0],d.media[0].id);assert(!JSON.stringify(d).includes('my-answer'));assert(!JSON.stringify(d).includes('imageNodes'));}finally{f.close();}
 });
 await test('提交后查看页使用状态提示，仍可分析但不预填；作答页不误判已提交',async()=>{
  const markup=homework(group(essay('q1','解释概念','<dl><dt>我的答案：</dt><dd>已交答案</dd></dl>')+essay('q2','解释概念','<textarea readonly>已交答案</textarea>')));
  const f=fixture(markup);
  try{const data=f.api.extract();assert(data.questions.every(q=>q.capabilities.analyze&&!q.capabilities.prefill));assert(data.questions.every(q=>q.diagnostics.join('；')==='答案已提交，当前页面仅供查看，暂不预填'));f.api.initQuizAssistant();const flow=f.api.runAnswerFlow();answer(await pending(f));await flow;assert.equal(f.api.controller.result.prefill.skipped,2);assert.equal(f.d.querySelector('textarea').value,'已交答案');assert(!f.d.getElementById('cx-ai-study-root').shadowRoot.getElementById('output').textContent.includes('多个或缺失文本框'));}finally{f.close();}
  const g=fixture(markup,{url:'https://mooc1.chaoxing.com/work/doHomeWorkNew'});
  try{const q=g.api.extract().questions;assert(q[0].diagnostics.includes('多个或缺失文本框，暂不自动预填'));assert(q[1].diagnostics.includes('文本控件不可编辑'));assert(q.every(item=>!item.diagnostics.some(text=>text.includes('答案已提交'))));}finally{g.close();}
 });
 await test('同题组共享、不同组隔离、纯图片简答可分析',async()=>{
  const f=fixture(homework(group(essay('q1',`<img src="${DATA}">`)+essay('q2','引用表格'))+group(essay('q3','独立问题'))));
  try{const q=f.api.extract().questions;assert(q[0].capabilities.analyze);assert.equal(q[0].question,'');assert.equal(q[1].contextImageIds.length,1);assert.equal(q[2].contextImageIds.length,0);}finally{f.close();}
 });
 await test('缺少可靠题组时不跨题共享；未知图片题不推断题型',async()=>{
  const f=fixture(homework(essay('q1',`建表<img src="${DATA}">`)+essay('q2','其他问题'))+`<div class="TiMu" questionid="x"><h3 class="stem">【自创题】<img src="${DATA}"></h3></div>`);
  try{const d=f.api.extract();assert.equal(d.questions[1].contextImageIds.length,0);assert.equal(d.questions[2].type,'unknown');assert(!d.questions[2].capabilities.analyze);}finally{f.close();}
 });
 await test('选项图片只属于自身选项，不共享给题组其他题',async()=>{
  const f=fixture(`<section class="mark_item"><h2 class="type_tit">单选题</h2><div class="TiMu" questionid="a"><h3 class="stem">【单选题】选图</h3><label><input type="radio" name="r" value="A">A、<img src="${DATA}"></label></div><div class="TiMu" questionid="b"><h3 class="stem">【单选题】文字</h3><label><input type="radio" name="s" value="A">A、甲</label></div></section>`);
  try{const d=f.api.extract();assert.equal(d.media[0].location,'option');assert.equal(d.media[0].optionKey,'A');assert(d.questions[0].capabilities.prefill);assert(!d.questions[1].contextImageIds.length);}finally{f.close();}
 });
 await test('四个纯图片选项：章节、题干嵌套和 for 标签均稳定对应 A-D，不跨题共享',async()=>{
  for(const layout of [{legacy:true},{legacy:true,nested:true},{external:true},{sibling:true}]){
   const f=fixture(`<section class="mark_item"><h2 class="type_tit">单选题</h2>${imageChoice('picture',layout)}<div class="singleQuesId" data="text"><h3 class="stem">【单选题】文字题</h3><label><input type="radio" name="text" value="A">甲</label></div></section>`);
   try{const d=f.api.extract(),q=d.questions[0];assert.equal(d.media.length,4);assert.equal(d.media.map(m=>m.optionKey).join(''),'ABCD');assert(d.media.every(m=>m.location==='option'));assert(q.options.every(o=>o.text===''&&o.imageIds.length===1));assert(q.capabilities.analyze&&q.capabilities.prefill);assert.equal(d.questions[1].contextImageIds.length,0);assert.equal(f.api.signature(d.questions,d.media),f.api.signature(f.api.extract().questions,f.api.extract().media));}finally{f.close();}
  }
 });
 await test('图片单选多选：AI 收到每项图片 ID，原图和解析显示在对应选项内，按 key 预填且不提交',async()=>{
  for(const multiple of [false,true]){
   const f=fixture(imageChoice('visual',{multiple}));let submits=0;f.d.body.insertAdjacentHTML('beforeend','<button id="submit">提交</button>');f.d.querySelector('#submit').onclick=()=>submits++;
   try{f.api.initQuizAssistant();const flow=f.api.runAnswerFlow(),request=await pending(f),d=f.api.extract(),keys=multiple?['A','C']:['B'];
    const sent=answer(request,{answers:[{id:d.questions[0].id,answer:keys,reason:'模拟图片选择'}],mediaAnalysis:[{imageId:d.media[0].id,summary:'选项图片（模拟）',items:['图中内容']}]}).data;
    assert.equal(sent.questions[0].options.map(o=>o.key).join(''),'ABCD');assert(sent.questions[0].options.every(o=>o.text===''&&o.imageIds.length===1));assert.equal(sent.imageManifest[0].sources.map(s=>s.optionKey).join(''),'ABCD');await flow;
    const s=f.d.getElementById('cx-ai-study-root').shadowRoot;assert.equal(s.querySelectorAll('.option-item .question-image').length,4);assert.equal(s.querySelectorAll('.question-card > .media-list').length,0);
    for(const key of ['A','B','C','D']){const item=s.querySelector(`[data-option-key="${key}"]`);assert(item.querySelector('.question-image'));assert(item.querySelector('.media-caption').textContent.includes('选项 '+key));assert(item.querySelector('.image-details').textContent.includes('图中内容'));assert.equal(item.classList.contains('is-answer'),keys.includes(key));}
    assert.equal([...f.d.querySelectorAll('input:checked')].map(i=>i.value).join(''),keys.join(''));assert.equal(submits,0);
    const copied=f.api.formatResultText(f.api.controller.result);assert(copied.indexOf('，选项 A')<copied.indexOf('B.'));assert(!copied.includes('data:image')&&!copied.includes('https://'));assert(copied.includes('图片选项'));
   }finally{f.close();}
  }
 });
 await test('纯图片选项也受模型视觉能力和已有答案保护：Pro 不请求，Flash 保留手工 D',async()=>{
  const f=fixture(imageChoice('visual'),{model:'deepseek-pro'});
  try{f.api.initQuizAssistant();await f.api.runAnswerFlow();assert.equal(f.requests.length,0);assert(!f.d.querySelector('input:checked'));assert.equal(f.d.getElementById('cx-ai-study-root').shadowRoot.querySelectorAll('.option-item .question-image').length,4);assert(f.api.controller.result.skippedQuestions.length===1);}finally{f.close();}
  const g=fixture(imageChoice('visual'));g.d.querySelector('input[value="D"]').checked=true;
  try{g.api.initQuizAssistant();const flow=g.api.runAnswerFlow();answer(await pending(g));await flow;assert(g.d.querySelector('input[value="D"]').checked);assert(!g.d.querySelector('input[value="A"]').checked);assert.equal(g.api.controller.result.prefill.skipped,1);}finally{g.close();}
 });
 await test('图片选项检索保留全部选项标注；相同图片去重仍保留 A-D 关联',async()=>{
  const f=fixture(imageChoice('visual'));
  try{const d=f.api.extract(),p=await f.api.prepareQuestionMedia(d.media),chat=f.api.buildChatContent(d.questions,{},p),search=f.api.buildSearchContent(d.questions[0],p);assert.equal(chat.filter(c=>c.type==='image_url').length,1);assert.equal(search.filter(c=>c.type==='image').length,1);const text=search.filter(c=>c.type==='text').map(c=>c.text).join('\n');for(const key of ['A','B','C','D'])assert(text.includes('选项 '+key));assert(!text.includes('data:image')&&!text.includes('https://'));assert(f.api.buildAnswerPayload('deepseek-flash',d.questions,false,'high',{},p).messages[0].content.includes('options[].imageIds'));}finally{f.close();}
 });
 await test('分析中更换选项图片会中止预填并恢复 busy，保留图片列表',async()=>{
  const f=fixture(imageChoice('visual'));
  try{f.api.initQuizAssistant();const flow=f.api.runAnswerFlow(),request=await pending(f);f.d.querySelector('label img').src=DATA+'#changed-option';answer(request);await flow;assert.equal(f.api.controller.state.phase,'error');assert(!f.api.controller.state.busy);assert(!f.d.querySelector('input:checked'));assert(!f.api.controller.last);assert(!f.api.controller.result.answers);assert.equal(f.d.getElementById('cx-ai-study-root').shadowRoot.querySelectorAll('.option-item .question-image').length,4);}finally{f.close();}
 });
 await test('多个控件共用无法对应的图片容器不猜测选项，不分析或预填',async()=>{
  const f=fixture('<div class="singleQuesId" data="ambiguous"><h3 class="stem">【单选题】选图片</h3><div class="option"><input type="radio" name="ambiguous" value="A"><input type="radio" name="ambiguous" value="B"><img src="'+DATA+'"></div></div>');
  try{const q=f.api.extract().questions[0];assert(!q.capabilities.analyze&&!q.capabilities.prefill);assert(q.diagnostics.some(text=>text.includes('选项图片无法可靠对应')));f.api.initQuizAssistant();await f.api.runAnswerFlow();assert.equal(f.requests.length,0);assert(!f.d.querySelector('input:checked'));}finally{f.close();}
 });
 await test('懒加载和相对资源地址解析，加载状态不改变签名',async()=>{
  const f=fixture(homework(group(essay('q1','表格<img src="placeholder.png" data-original="/table.png">'))));
  try{const before=f.api.extract();assert.equal(before.media[0].src,'https://mooc1.chaoxing.com/table.png');f.d.querySelector('.mark_name img').src='/table.png';const after=f.api.extract();assert.equal(f.api.signature(before.questions,before.media),f.api.signature(after.questions,after.media));f.d.querySelector('.mark_name img').dataset.original='/new.png';const next=f.api.extract();assert.notEqual(f.api.signature(before.questions,before.media),f.api.signature(next.questions,next.media));}finally{f.close();}
 });
 await test('内联图片读取及同组请求去重，AI 文本不含资源地址和 DOM',async()=>{
  const f=fixture(homework(group(essay('q1',`建表<img src="${DATA}" data-private="secret">`)+essay('q2','查询表1'))));
  try{const d=f.api.extract(),prepared=await f.api.prepareQuestionMedia(d.media);const content=f.api.buildChatContent(d.questions,{},prepared);assert.equal(content.filter(c=>c.type==='image_url').length,1);assert.equal(content[2].image_url.detail,'original');const text=content[0].text;assert(!text.includes('data:')&&!text.includes('secret')&&!text.includes('src'));assert.equal(JSON.parse(text).imageManifest[0].questionIds.length,2);assert.equal(f.requests.length,0);}finally{f.close();}
 });
 await test('跨域图片使用独立 GET，共用下载且不携带 DeepSeek 认证',async()=>{
  const f=fixture('',{mediaResponse:r=>r.onload({status:200,finalUrl:r.url,response:bytes().buffer})});
  try{const media=[1,2].map(n=>({id:`img${n}`,src:'https://p.ananas.chaoxing.com/table.png',sourceQuestionNumber:n}));const p=await f.api.prepareQuestionMedia(media);assert.equal(p.size,2);assert.equal(f.requests.length,1);assert.equal(f.requests[0].responseType,'arraybuffer');assert(!f.requests[0].headers);assert.equal(f.requests[0].timeout,30000);}finally{f.close();}
 });
 await test('同源与 blob 图片在原题文档读取',async()=>{
  const f=fixture('');const seen=[];f.w.fetch=async url=>{seen.push(url);return{ok:true,url,arrayBuffer:async()=>bytes().buffer};};
  try{for(const src of ['https://mooc1.chaoxing.com/table.png','blob:https://mooc1.chaoxing.com/mock-image']){const p=await f.api.prepareQuestionMedia([{id:src,src,sourceQuestionNumber:1}]);assert.equal(p.size,1);}assert.equal(seen.length,2);assert(!f.requests.length);}finally{f.close();}
 });
 await test('404、超时、登录 HTML、坏图片、解码失败和不支持域名均拒绝',async()=>{
  for(const [kind,respond]of [['404',r=>r.onload({status:404})],['timeout',r=>r.ontimeout()],['html',r=>r.onload({status:200,response:Buffer.from('<html>login</html>').buffer})],['bad',r=>r.onload({status:200,response:new Uint8Array([1,2,3]).buffer})]]){
   const f=fixture('',{mediaResponse:respond});try{await assert.rejects(f.api.prepareQuestionMedia([{id:kind,src:'https://p.ananas.chaoxing.com/image.png',sourceQuestionNumber:1}]));}finally{f.close();}
  }
  const f=fixture('',{decodeError:true});try{await assert.rejects(f.api.prepareQuestionMedia([{id:'x',src:DATA,sourceQuestionNumber:1}]),/解码/);await assert.rejects(f.api.readMediaBytes('https://unknown.invalid/image.png'));await assert.rejects(f.api.readMediaBytes('blob:https://unknown.invalid/x'));}finally{f.close();}
 });
 await test('图片读取最多两个并发，失败后独立重试',async()=>{
  let active=0,max=0;const f=fixture('',{mediaResponse:r=>{active++;max=Math.max(max,active);setTimeout(()=>{active--;r.onload({status:200,response:bytes().buffer});},15);}});
  try{const media=Array.from({length:5},(_,i)=>({id:String(i),src:`https://p.ananas.chaoxing.com/${i}.png`,sourceQuestionNumber:i+1}));await f.api.prepareQuestionMedia(media);assert.equal(max,2);f.w.GM_xmlhttpRequest=r=>queueMicrotask(()=>r.ontimeout());await assert.rejects(f.api.prepareQuestionMedia(media.slice(0,1)));f.w.GM_xmlhttpRequest=r=>queueMicrotask(()=>r.onload({status:200,response:bytes().buffer}));assert.equal((await f.api.prepareQuestionMedia(media.slice(0,1))).size,1);}finally{f.close();}
 });
 await test('没有视觉的模型跳过图片题，纯文字题仍用原模型且不改存储',async()=>{
  const f=fixture(homework(group(essay('q1',`建表<img src="${DATA}">`))+group(essay('q2','文字解释','<textarea></textarea>'))),{model:'deepseek-v4-pro'});
  try{f.api.initQuizAssistant();const flow=f.api.runAnswerFlow({autoPrefill:false});const request=await pending(f);const {payload,data}=answer(request);assert.equal(payload.model,'deepseek-v4-pro');assert.equal(typeof payload.messages[1].content,'string');assert.deepEqual(data.questions.map(q=>q.id),['q2']);await flow;assert.equal(f.api.controller.result.skippedQuestions[0].id,'q1');assert.equal(f.api.controller.result.answers[0].answer.length,0);assert.equal(f.api.controller.result.modelsByQuestion.q2,'deepseek-v4-pro');assert(!f.writes.some(item=>item.key==='cx_model'));}finally{f.close();}
 });
 await test('全部图片题选择无视觉模型：保留图片列表、不请求、不预填',async()=>{
  const f=fixture(homework(group(essay('q1',`建表<img src="${DATA}">`,'<textarea></textarea>'))),{model:'deepseek-v4-pro'});
  try{f.api.initQuizAssistant();await f.api.runAnswerFlow();assert.equal(f.requests.length,0);assert.equal(f.d.querySelector('textarea').value,'');assert(!f.api.controller.last);assert(!f.api.controller.state.busy);assert(f.api.controller.state.message.includes('不支持图片'));assert(f.d.getElementById('cx-ai-study-root').shadowRoot.querySelector('.media-item'));}finally{f.close();}
 });
 await test('Flash 图文回答与图片表格解析进入可读列表，保留代码换行且不提交',async()=>{
  const f=fixture(homework(group(essay('q1',`建表<img src="${DATA}">`,'<form><textarea></textarea><button type="submit">提交</button></form>')+essay('q2','根据表1查询','<textarea>手工答案</textarea>'))));
  let submits=0;f.d.querySelector('form').addEventListener('submit',e=>{submits++;e.preventDefault();});
  try{f.api.initQuizAssistant();const flow=f.api.runAnswerFlow();const request=await pending(f);const media=f.api.extract().media;answer(request,{mediaAnalysis:[{imageId:media[0].id,summary:'goods 表结构',columns:['字段','类型','约束'],rows:[['id','INT(11)','主键、自增']],items:['表中有6个字段']}]});await flow;assert.equal(f.api.controller.state.phase,'done');assert.equal(f.d.querySelector('textarea').value,'CREATE TABLE goods (\n  id INT PRIMARY KEY\n);');assert.equal(f.d.querySelectorAll('textarea')[1].value,'手工答案');assert.equal(submits,0);const output=f.d.getElementById('cx-ai-study-root').shadowRoot;assert.equal(output.querySelectorAll('.image-table').length,2);assert(output.querySelector('.image-details').textContent.includes('6个字段'));const copy=f.api.formatResultText(f.api.controller.result);assert(copy.includes('id | INT(11) | 主键、自增'));assert(!copy.includes('data:image'));assert(!copy.includes('尚未生成答案'));}finally{f.close();}
 });
 await test('联网检索也发送对应图片，缺少真实来源继续报错',async()=>{
  const f=fixture(homework(group(essay('q1',`题目<img src="${DATA}">`))),{search:true});
  try{f.api.initQuizAssistant();const flow=f.api.runAnswerFlow({autoPrefill:false});const search=await pending(f);const data=JSON.parse(search.data);assert.equal(data.model,'deepseek-flash');assert(data.messages[0].content.some(part=>part.type==='image'&&part.source.type==='base64'));search.onload({status:200,responseText:JSON.stringify({content:[{type:'text',text:'没有来源'}]})});await flow;assert.equal(f.api.controller.state.phase,'error');assert(!f.api.controller.last);assert(f.api.controller.result.questions.length);assert(!f.api.controller.state.busy);}finally{f.close();}
 });
 await test('请求图片变化后不预填，失败保留列表并恢复加载状态',async()=>{
  const f=fixture(homework(group(essay('q1',`建表<img src="${DATA}">`,'<textarea></textarea>'))));
  try{f.api.initQuizAssistant();const flow=f.api.runAnswerFlow();const request=await pending(f);f.d.querySelector('.mark_name img').src=DATA+'#changed';answer(request);await flow;assert.equal(f.d.querySelector('textarea').value,'');assert.equal(f.api.controller.state.phase,'error');assert(!f.api.controller.last);assert(!f.api.controller.result.answers);assert(f.api.controller.result.media.length);assert(!f.api.controller.state.busy);assert(f.d.getElementById('cx-ai-toolbar').shadowRoot.querySelector('.spinner').hidden);}finally{f.close();}
 });
 await test('图片网络失败在请求 AI 前停止，可重新运行',async()=>{
  let fail=true;const f=fixture(homework(group(essay('q1','建表<img src="https://p.ananas.chaoxing.com/table.png">','<textarea></textarea>'))),{mediaResponse:r=>fail?r.ontimeout():r.onload({status:200,response:bytes().buffer})});
  try{f.api.initQuizAssistant();await f.api.runAnswerFlow();assert(!f.requests.some(r=>r.method==='POST'));assert(!f.api.controller.last);assert(f.api.controller.result.questions.length);fail=false;const flow=f.api.runAnswerFlow();answer(await pending(f));await flow;assert.equal(f.api.controller.state.phase,'done');}finally{f.close();}
 });
 await test('尺寸和请求体限制可靠阻止；组合超限先拆批，不截断单题',async()=>{
  const f=fixture('',{width:8193});try{await assert.rejects(f.api.prepareQuestionMedia([{id:'x',src:DATA,sourceQuestionNumber:1}]),/8192/);assert.throws(()=>f.api.assertRequestSize({x:'x'.repeat(44*1024*1024)}),/44 MiB/);
   const q=(id)=>({id,number:Number(id),type:'essay',question:'图题',options:[],imageIds:[id],contextImageIds:[]});const assets=new Map([['1',{dataUrl:'data:image/png;base64,'+'A'.repeat(24*1024*1024),width:1,height:1}],['2',{dataUrl:'data:image/png;base64,'+'B'.repeat(24*1024*1024),width:1,height:1}]]);
   assert.equal(f.api.splitQuestionBatches([q('1'),q('2')],{model:'deepseek-flash'},assets).length,2);assets.get('1').dataUrl+='C'.repeat(24*1024*1024);assert.throws(()=>f.api.splitQuestionBatches([q('1')],{model:'deepseek-flash'},assets),/第 1 题/);
   const many=Array.from({length:15},(_,i)=>String(i));const p=new Map(many.map(id=>[id,{dataUrl:'data:image/png;base64,'+id,width:5000,height:1}]));assert.throws(()=>f.api.buildChatContent([{...q('1'),imageIds:many}],{},p),/4096/);
  }finally{f.close();}
 });
 await test('作业工具条在标题右侧，成绩单独排列且不重复挂载',async()=>{
  const f=fixture(homework(group(essay('q1','解释'))));
  try{f.api.initQuizAssistant();f.api.initQuizAssistant();const header=f.d.querySelector('.detailsHead'),row=header.querySelector('.cx-ai-title-row'),actions=row.querySelector('.cx-ai-homework-actions');assert.equal(f.d.querySelectorAll('#cx-ai-toolbar').length,1);assert.equal(actions.firstElementChild.id,'cx-ai-toolbar');assert(actions.querySelector('.resultNum'));assert.equal(actions.querySelector('.resultNum').style.position,'static');assert.equal(row.firstElementChild.className,'mark_title');assert.equal(row.style.flexWrap,'wrap');assert.equal(row.style.paddingLeft,'40px');assert(header.querySelector('.infoHead').textContent.includes('10-08'));assert(header.querySelector('.analysisCard'));assert(!f.d.getElementById('cx-ai-toolbar').shadowRoot.getElementById('settings').hidden);}finally{f.close();}
 });
 await test('标题动态替换后复用工具条；可靠 fallback 插入真实首题前',async()=>{
  const f=fixture(homework(group(essay('q1','解释'))));
  try{f.api.startQuizObserver();await pause(100);const host=f.d.getElementById('cx-ai-toolbar');f.d.querySelector('.detailsHead').outerHTML='<div class="detailsHead"><h2 class="mark_title">新标题</h2></div>';await pause(130);assert.equal(f.d.querySelectorAll('#cx-ai-toolbar').length,1);assert(f.d.querySelector('.detailsHead').contains(f.d.getElementById('cx-ai-toolbar')));await pause(80);assert.equal(f.d.querySelectorAll('.cx-ai-title-row').length,1);}finally{f.close();}
  const g=fixture('<div class="TiMu"><div class="stem">题目容器</div><div class="question-item" data-question-id="a"><div class="stem">【简答题】首题</div></div></div>');try{g.api.initQuizAssistant();assert.equal(g.d.querySelector('.question-item').previousElementSibling.id,'cx-ai-toolbar');assert.equal(g.d.querySelector('.TiMu').previousElementSibling,null);}finally{g.close();}
 });
 const result={total:logs.length+failures.length,failures,logs};fs.writeFileSync(path.join(__dirname,'media-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exitCode=failures.length?1:0;
})();
