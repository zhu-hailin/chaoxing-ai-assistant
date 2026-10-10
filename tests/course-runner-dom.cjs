const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'../学习通AI助手.user.js'),'utf8');
const entry="    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startQuizObserver, { once: true });\n    else startQuizObserver();";
assert(source.includes(entry));
const code=source.replace(entry,'globalThis.courseAPI={initCourseDocumentBridge,courseDocumentBridgeRequest,courseRemoteReaderFrame,initStudyAssistant,initQuizAssistant,runAnswerFlow,createCourseRunner,courseTabs,courseFrameTree,courseDocumentReader,courseScrollToBottom,courseDocumentScrollState,courseTaskComplete,courseSubmitButton,courseSubmitConfirmation,courseQuizComplete,courseReportText,courseRunActive,get controller(){return controller},replaceRunner(r){courseRunner=r}};');
const logs=[],failures=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function test(name,run){try{await run();logs.push(`PASS ${name}`);}catch(error){failures.push(`${name}: ${error.stack}`);}}
const LIMITS={pollMs:3,settleMs:1,loadMs:150,videoLoadMs:150,completionMs:60,stallMs:500,resumeMs:4,maxResumes:4,slideMs:1,documentCheckMs:5,documentStableMs:15,documentBottomSamples:3,documentFallbackStepMs:2,documentFallbackPasses:2,submitMs:80};
function fixture(chapters,opts={}){
 const runtimeErrors=[],virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',error=>runtimeErrors.push(error.message));
 const dom=new JSDOM('<div id="mainid"><input id="curChapterId"><div id="prev_tab"></div><iframe id="iframe"></iframe></div><div id="content1"><div id="coursetree"><ul></ul></div></div>',{url:opts.url||'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=mock-course&clazzid=mock-class&cpi=mock-account',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole});
 const w=dom.window,d=w.document,storage=new Map(opts.storage||[['deepseek_api_key',opts.key??'mock-only-key'],['cx_model',opts.model||'deepseek-flash']]);
 if(opts.session)w.sessionStorage.setItem('cx-ai-course-session',opts.session);
 const events=[],requests=[],timers=new Set(),videos=[],values=new Map();let active=0,tab=0,submitClicks=0,lastDoc;
 w.GM_getValue=(key,fallback)=>storage.has(key)?storage.get(key):fallback;
 w.GM_setValue=(key,value)=>storage.set(key,JSON.parse(JSON.stringify(value)));w.GM_getResourceText=()=> '{}';
 w.GM_xmlhttpRequest=request=>{
  requests.push(request);let cancelled=false;
  const timer=setTimeout(()=>{
   if(cancelled&&!opts.lateResponse)return;
   if(opts.error){request[opts.error==='timeout'?'ontimeout':'onerror']();return;}
   const payload=JSON.parse(request.data),input=JSON.parse(payload.messages[1].content),answers=input.questions.map(q=>({id:q.id,answer:opts.invalid?[]:q.type==='essay'?['模拟简答\n第二行']:['A'],reason:opts.invalid?'条件不明确':'模拟答案'}));
   request.onload({status:200,responseText:JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({answers})}}]})});
  },opts.requestMs||8);timers.add(timer);
  return {abort(){cancelled=true;if(!opts.lateResponse)clearTimeout(timer);events.push('api-abort');request.onabort?.();}};
 };
 const keyFor=(ci,ti,task)=>`${ci}:${ti}:${task}`;
 chapters.forEach((chapter,ci)=>(chapter.tabs||[]).forEach((page,ti)=>(page.tasks||[]).forEach((task,i)=>{if(task.learned)values.set(keyFor(ci,ti,i),true);})));
 const rowFor=ci=>d.getElementById(`cur${ci+1}`);
 const update=()=>{
  chapters.forEach((chapter,ci)=>{
   const pending=(chapter.tabs||[]).flatMap((page,ti)=>(page.tasks||[]).map((task,i)=>(!task.optional||opts.optionalPending)&&values.get(keyFor(ci,ti,i))!==true)).filter(Boolean).length;
   const row=rowFor(ci);row.classList.toggle('posCatalog_active',ci===active);
   row.querySelector('.orangeNew')?.remove();row.querySelector('.icon_Completed')?.remove();
   if(chapter.already || pending===0&&chapter.ackDone){const span=d.createElement('span');span.className='icon_Completed';row.append(span);}
   else if(!chapter.unknownStatus){const span=d.createElement('span');span.className='orangeNew';span.textContent=String(pending);row.append(span);}
  });
 };
 const finish=(ci,ti,i,container)=>{
  if(opts.noAck)return;
  values.set(keyFor(ci,ti,i),true);container?.setAttribute('data-completed','true');chapters[ci].ackDone=true;update();
 };
 const renderPage=()=>{
  const old=d.getElementById('iframe'),frame=d.createElement('iframe');frame.id='iframe';old.replaceWith(frame);
  const doc=frame.contentDocument;doc.body.innerHTML='<div class="page-content"></div>';lastDoc=doc;
  const page=chapters[active].tabs?.[tab]||{title:'资料',text:'普通文字资料',tasks:[]};const ci=active,ti=tab;
  d.querySelectorAll('#prev_tab li').forEach((li,i)=>li.classList.toggle('active',i===tab));
  if(page.text)doc.querySelector('.page-content').textContent=page.text;
  for(const [i,task]of(page.tasks||[]).entries()){
   const container=doc.createElement('div');container.setAttribute('data-course-task','');container.setAttribute('data-completed',String(values.get(keyFor(ci,ti,i))===true));doc.body.append(container);
   if(task.optional)container.setAttribute('data-required','false');
   if(task.kind==='video'){
    const video=doc.createElement('video');container.append(video);let time=task.start||0,paused=true,ended=false,playing,loaded=!task.lazy;
    Object.defineProperties(video,{duration:{get:()=>loaded?(task.duration??3):NaN},currentTime:{get:()=>time,set(){throw Error('禁止修改视频进度')}},paused:{get:()=>paused},ended:{get:()=>ended},seeking:{get:()=>false}});
    video.play=()=>{
     events.push(`play:${ci}:${ti}:${i}`);
     if(task.nativeOnly&&!loaded)throw Error('必须先点击原播放入口');
     loaded=true;
     if(task.blocked)return Promise.reject(Object.assign(Error('blocked'),{name:'NotAllowedError'}));
     if(task.faceOnPlay){const face=doc.createElement('div');face.className='chapterVideoFaceMaskDiv';doc.body.append(face);}
     paused=false;video.dispatchEvent(new doc.defaultView.Event('playing'));if(playing)clearInterval(playing);
     if(task.pauseOnEveryPlay){paused=true;video.dispatchEvent(new doc.defaultView.Event('pause'));return Promise.resolve();}
     playing=setInterval(()=>{
      if(paused||task.stall)return;
      time+=1;video.dispatchEvent(new doc.defaultView.Event('timeupdate'));
      if((task.pauseAt===time&&!video.didPause)||(task.pauseTimes||[]).includes(time)){paused=true;video.didPause=true;video.dispatchEvent(new doc.defaultView.Event('pause'));}
      if(task.faceAtPause===time){const face=doc.createElement('div');face.className='chapterVideoFaceMaskDiv';doc.body.append(face);}
      if(time>=video.duration){ended=true;paused=true;clearInterval(playing);finish(ci,ti,i,container);video.dispatchEvent(new doc.defaultView.Event('ended'));}
     },10);timers.add(playing);return Promise.resolve();
    };
    video.pause=()=>{paused=true;};videos.push(video);
    if(task.nativeOnly){const button=doc.createElement('button');button.className='vjs-big-play-button';button.textContent='播放';button.onclick=()=>{events.push(`native-play:${ci}:${ti}:${i}`);loaded=true;return video.play();};container.append(button);}
   }else if(task.kind==='ppt'){
    if(task.swiper){
     container.innerHTML='<div class="swiper-container"><div class="swiper-slide swiper-slide-active">第一页</div><div class="swiper-slide">第二页</div><div class="swiper-slide">末页</div><div class="swiper-pagination"><button class="swiper-pagination-bullet">1</button><button class="swiper-pagination-bullet">2</button><button class="swiper-pagination-bullet">3</button></div></div>';
     container.querySelectorAll('.swiper-pagination-bullet').forEach((button,index)=>button.onclick=()=>{container.querySelectorAll('.swiper-slide').forEach((slide,si)=>slide.classList.toggle('swiper-slide-active',index===si));events.push(`slide:${index+1}`);if(index===2)finish(ci,ti,i,container);});continue;
    }
    container.innerHTML='<div class="document-reader"><input id="pageNumber" data-slide-current="1" value="1"><span id="numPages" data-slide-total="4">4</span><button id="lastPage" data-slide-last>末页</button><button id="next" data-slide-next>下一页</button></div>';
    if(doc.querySelectorAll('#pageNumber').length>1)container.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
    const go=value=>{container.querySelector('[data-slide-current]').value=String(value);events.push(`slide:${value}`);if(value===4)finish(ci,ti,i,container);};
    container.querySelector('[data-slide-last]').onclick=()=>go(4);container.querySelector('[data-slide-next]').onclick=()=>go(Number(container.querySelector('[data-slide-current]').value)+1);
    if(task.nextOnly)container.querySelector('[data-slide-last]').remove();
   }else if(task.kind==='quiz'){
    container.innerHTML='<div class="CeYan"><div class="ceyan_name"><h3>章节测试</h3></div><span class="testTit_status">待完成</span></div>';
    if(task.complete){container.querySelector('.testTit_status').textContent=task.statusText||'已完成';finish(ci,ti,i,container);continue;}
    const quiz=container.querySelector('.CeYan');
    for(let qi=0;qi<(task.count||1);qi++){
     const q=doc.createElement('div');q.className='singleQuesId';q.setAttribute('data',String(qi+1));
     q.innerHTML=task.essay?'<div class="Zy_TItle"><span class="fontLabel">【简答题】解释概念</span></div><textarea></textarea>':`<div class="Zy_TItle"><span class="fontLabel">【${task.unknown?'排序题':'单选题'}】请选择甲</span></div><label><input type="radio" name="q${qi}" value="A">甲</label><label><input type="radio" name="q${qi}" value="B">乙</label>`;
     if(task.filled)q.querySelector('input[value=B]').checked=true;
     if(task.readonly)q.querySelector('textarea')?.setAttribute('readonly','');
     quiz.append(q);
    }
    const submit=doc.createElement('button');submit.setAttribute('data-quiz-submit','');submit.textContent='提交';quiz.append(submit);
    submit.onclick=()=>{
     submitClicks++;events.push(`submit:${ci}:${ti}`);
     const ack=()=>{if(opts.submitNoAck)return;container.querySelector('.testTit_status').textContent='已提交';finish(ci,ti,i,container);};
     if(task.confirm){
      const target=task.confirmAt==='owner'?d:doc,dialog=target.createElement('div');
      if(task.confirmAt==='owner'){
       dialog.id='workpop';dialog.className='maskDiv';
       dialog.innerHTML='<div class="popDiv wid440 Marking"><h3>提示</h3><p id="popcontent" class="popWord fs16 colorIn">确认提交？</p><div class="popBottom"><a id="popok" role="button" class="jb_btn jb_btn_92 fr fs14">提交</a><a id="popno" role="button">取消</a></div></div>';
      }else{dialog.setAttribute('role','dialog');dialog.innerHTML='确定提交测验？<button>确认提交</button>';}
      target.body.append(dialog);dialog.querySelector('#popok,button').onclick=()=>{events.push('confirm');dialog.remove();ack();};
     }else ack();
    };
    if(task.ambiguous){const other=submit.cloneNode(true);quiz.append(other);}
   }else if(task.kind==='scroll'){
    container.innerHTML='<div class="continuous-reader" style="overflow-y:auto"><img id="img" class="imglook" src="data:image/png;base64,mock"></div>';
    Object.defineProperties(container.querySelector('img'),{complete:{get:()=>true},naturalWidth:{get:()=>800}});
    const node=task.outer?d.documentElement:task.root?doc.documentElement:container.firstChild;
    let top=0,height=task.height||1000;const viewport=200;
    Object.defineProperties(node,{clientHeight:{get:()=>viewport},scrollHeight:{get:()=>height},scrollTop:{get:()=>top,set:value=>{
     if(task.stall)return;
     top=Math.min(height-viewport,value);events.push(`scroll:${ci}:${top}`);
     if(task.grow && top>=height-viewport && height===1000){height=1400;return;}
     if(top>=height-viewport)finish(ci,ti,i,container);
    }}});
   }else if(task.kind==='survey')container.textContent='调查问卷，请自行完成';
   else if(task.kind==='homework')container.innerHTML='<div class="fanyaMarking_left"><h2>作业详情</h2></div>';
   else if(task.kind==='unknown')container.innerHTML='<img id="img" class="imglook">';
  }
  return doc;
 };
 const renderChapter=ci=>{
  active=ci;tab=0;d.querySelector('#curChapterId').value=String(ci+1);d.querySelector('#prev_tab').replaceChildren();
  for(const [index,page]of(chapters[ci].tabs||[]).entries()){
   const li=d.createElement('li');li.id=`dct${index+1}`;li.textContent=page.title;li.onclick=()=>{if(tab!==index){tab=index;events.push(`tab:${ci}:${index}`);renderPage();}};d.querySelector('#prev_tab').append(li);
  }
  renderPage();update();
 };
 chapters.forEach((chapter,ci)=>{
  const li=d.createElement('li');li.innerHTML=`<div class="posCatalog_select" id="cur${ci+1}"><span class="posCatalog_name" title="${chapter.title||'模拟章节'+(ci+1)}"><em class="posCatalog_sbar">${ci+1}</em>${chapter.title||'模拟章节'+(ci+1)}</span></div>`;
  li.querySelector('.posCatalog_name').onclick=()=>{
   events.push(`chapter:${ci}`);
   if(opts.navigateOut){w.dispatchEvent(new w.Event('pagehide'));return;}
   if(opts.loadDelay){active=ci;update();const frame=d.createElement('iframe');frame.id='iframe';d.getElementById('iframe').replaceWith(frame);const timer=setTimeout(()=>renderChapter(ci),opts.loadDelay);timers.add(timer);}else renderChapter(ci);
  };d.querySelector('#coursetree ul').append(li);
 });
 renderChapter(0);w.eval(opts.noAutoResume?code.replace('if(owner===doc) courseRunner?.resumeIfNeeded();',''):code);w.courseAPI.initStudyAssistant();
 const runner=w.courseAPI.createCourseRunner(d,w.courseAPI.controller,{limits:{...LIMITS,...opts.limits},sleep:opts.sleep});w.courseAPI.replaceRunner(runner);
 const startWithDefaults=runner.start;runner.start=(options={})=>startWithDefaults({continueOnTimeout:false,...options});
 return {w,d,storage,runner,startWithDefaults,requests,events,videos,api:w.courseAPI,get doc(){return lastDoc},get submits(){return submitClicks},close(){runner.stop();timers.forEach(clearTimeout);dom.window.close();assert.deepEqual(runtimeErrors,[],'页面或已销毁 iframe 存在未处理异常');}};
}
const video=(extra={})=>({title:'视频',tasks:[{kind:'video',...extra}]});
const ppt=(extra={})=>({title:'资料',tasks:[{kind:'ppt',...extra}]});
const quiz=(extra={})=>({title:'章节测验',tasks:[{kind:'quiz',...extra}]});
async function runWith(chapters,opts,verify){const f=fixture(chapters,opts);try{const report=await f.runner.start();await verify(f,report);}finally{f.close();}}
(async()=>{
 await test('完整课程：多视频→PPT→测验确认提交→无视频无测验章节→下一目录',()=>runWith([
  {tabs:[{title:'视频',tasks:[{kind:'video',start:1,pauseAt:2,duration:4},{kind:'video'}]},ppt(),quiz({essay:true,confirm:true})]},
  {tabs:[{title:'资料',text:'仅文字，无章节测验',tasks:[]}]},{tabs:[video()]}
 ],{},(f,r)=>{assert.equal(r.status,'done');assert.equal(r.videos,3);assert.equal(r.documents,1);assert.equal(r.quizzes,1);assert.equal(f.submits,1);assert(f.events.indexOf('slide:4')<f.events.indexOf('submit:0:2'));assert(f.events.includes('chapter:1')&&f.events.includes('chapter:2'));assert.equal(r.chapters[0].tasks[0].startSeconds,1);assert.equal(r.chapters[0].tasks[0].durationSeconds,4);assert(!f.api.controller.state.busy);assert(!f.api.courseRunActive());assert(!JSON.stringify([...f.storage]).includes('mock-only-key",'));}));
 await test('已完成章节跳过，视频结束前不跳章或提交',async()=>{
  const f=fixture([{already:true,tabs:[video()]},{tabs:[video({duration:4})]}]);try{const p=f.runner.start();await delay(7);assert.equal(f.submits,0);assert(!f.events.includes('chapter:2'));const r=await p;assert.equal(r.status,'done');assert.equal(r.chapters[0].status,'already');assert.equal(r.videos,1);}finally{f.close();}
 });

 await test('关闭自动跳过已学：进入已学章节并播放视频、阅读PPT，已提交测验仍不重做',async()=>{
  const f=fixture([{already:true,tabs:[video({learned:true}),ppt({learned:true}),quiz({complete:true})]},{tabs:[video()]}]);
  try{const r=await f.runner.start({skipLearned:false});assert.equal(r.status,'done');assert.equal(r.videos,2);assert.equal(r.documents,1);assert.equal(r.quizzes,0);assert.equal(f.submits,0);assert.equal(f.requests.length,0);assert(f.events.includes('play:0:0:0'));assert(f.events.includes('slide:4'));assert.equal(r.chapters[0].tasks[2].status,'already');assert.equal(f.storage.get(f.runner.key).skipLearned,false);}finally{f.close();}
 });
 await test('开启自动跳过已学：未完成章节中的已学视频与PPT仍跳过',async()=>{
  const f=fixture([{tabs:[video({learned:true}),ppt({learned:true}),video()]}]);
  try{const r=await f.runner.start();assert.equal(r.status,'done');assert.equal(r.videos,1);assert.equal(r.documents,0);assert(!f.events.includes('play:0:0:0'));assert(!f.events.includes('slide:4'));assert.equal(r.chapters[0].tasks[0].status,'already');assert.equal(r.chapters[0].tasks[1].status,'already');assert.equal(f.storage.get(f.runner.key).skipLearned,true);}finally{f.close();}
 });
 await test('自动跳过已学开关：默认开启、保存选择、开始事件传递、运行锁定与结束恢复',async()=>{
  const f=fixture([{already:true,tabs:[video({duration:8})]}]);
  try{const s=f.d.getElementById('cx-ai-study-root').shadowRoot,toggle=s.getElementById('course-skip-learned');assert(toggle.checked);toggle.checked=false;toggle.dispatchEvent(new f.w.Event('change'));assert.equal(f.storage.get('cx_course_skip_learned'),false);f.api.controller.openPanel('chapters');assert(!toggle.checked);s.getElementById('course-start').click();for(let i=0;i<50&&!f.runner.busy;i++)await delay(2);assert(f.runner.busy);assert(toggle.disabled);assert.equal(f.storage.get(f.runner.key).skipLearned,false);for(let i=0;i<200&&f.runner.report.status==='running';i++)await delay(5);assert.equal(f.runner.report.status,'done');assert.equal(f.runner.report.videos,1);assert(!toggle.disabled);assert(!toggle.checked);}finally{f.close();}
  const f2=fixture([{tabs:[video()]}],{storage:[['cx_course_skip_learned',false]]});try{assert.equal(f2.d.getElementById('cx-ai-study-root').shadowRoot.getElementById('course-skip-learned').checked,false);}finally{f2.close();}
 });
 await test('恢复运行保留原来的关闭选择，不受新的默认值影响',async()=>{
  const chapters=[{already:true,tabs:[video({stall:true})]}],f=fixture(chapters);
  try{const first=f.runner.start({skipLearned:false});for(let i=0;i<50&&!f.events.includes('play:0:0:0');i++)await delay(2);f.runner.stop();const stopped=await first;assert.equal(stopped.status,'stopped');assert.equal(f.storage.get(f.runner.key).skipLearned,false);chapters[0].tabs[0].tasks[0].stall=false;const r=await f.runner.start({resume:true,skipLearned:true});assert.equal(r.status,'done');assert.equal(r.videos,1);assert.equal(f.storage.get(f.runner.key).skipLearned,false);}finally{f.close();}
 });

 await test('从当前开始默认关闭：即使当前在第二章，也从目录第一章开始',async()=>{
  const f=fixture([{tabs:[video()]},{tabs:[video()]},{tabs:[video()]}]);
  try{f.d.querySelector('#cur2 .posCatalog_name').click();f.events.length=0;const s=f.d.getElementById('cx-ai-study-root').shadowRoot;assert(!s.getElementById('course-from-current').checked);const r=await f.runner.start();assert.equal(r.status,'done');assert.equal(r.videos,3);assert.equal(r.chapters.length,3);assert(f.events.includes('chapter:0'));assert.equal(f.storage.get(f.runner.key).fromCurrent,false);assert.equal(f.storage.get(f.runner.key).startChapterId,'cur1');}finally{f.close();}
 });
 await test('从当前开始UI事件：本次从第二章开始、队列不含之前章节、运行时锁定',async()=>{
  const f=fixture([{tabs:[video()]},{tabs:[video({duration:8})]},{tabs:[video()]}]);
  try{f.d.querySelector('#cur2 .posCatalog_name').click();f.events.length=0;const s=f.d.getElementById('cx-ai-study-root').shadowRoot,toggle=s.getElementById('course-from-current');toggle.checked=true;s.getElementById('course-start').click();for(let i=0;i<50&&!f.runner.busy;i++)await delay(2);assert(f.runner.busy);assert(toggle.disabled);for(let i=0;i<200&&f.runner.report.status==='running';i++)await delay(5);const r=f.runner.report;assert.equal(r.status,'done');assert.equal(r.videos,2);assert.deepEqual(Array.from(r.chapters,c=>c.id),['cur2','cur3']);assert(!f.events.includes('chapter:0'));assert(!toggle.disabled);assert.equal(f.storage.get(f.runner.key).startChapterId,'cur2');assert.equal(f.storage.get(f.runner.key).fromCurrent,true);assert(s.getElementById('course-report').textContent.includes('2/2'));assert.equal(s.getElementById('status').textContent,'自动学习已结束');assert(!s.getElementById('status').textContent.includes('视频结束'));}finally{f.close();}
 });
 await test('从当前开始与跳过已学独立：当前已学章节按跳过开关处理',async()=>{
  for(const skipLearned of [true,false]){const f=fixture([{tabs:[video()]},{already:true,tabs:[video({learned:true})]},{tabs:[video()]}]);try{f.d.querySelector('#cur2 .posCatalog_name').click();f.events.length=0;const r=await f.runner.start({fromCurrent:true,skipLearned});assert.equal(r.status,'done');assert.equal(r.chapters.length,2);assert.equal(r.videos,skipLearned?1:2);assert.equal(r.chapters[0].status,skipLearned?'already':'done');assert(!f.events.includes('chapter:0'));}finally{f.close();}}
 });
 await test('当前章节缺失或多选时不启动，不静默退回第一章',async()=>{
  for(const ambiguous of [false,true]){const f=fixture([{tabs:[video()]},{tabs:[video()]}]);try{f.d.querySelectorAll('.posCatalog_select').forEach(n=>n.classList.toggle('posCatalog_active',ambiguous));await f.runner.start({fromCurrent:true});assert(!f.runner.busy);assert.equal(f.runner.report,undefined);assert.equal(f.events.length,0);assert.equal(f.requests.length,0);assert.match(f.api.controller.state.message,/无法确定当前章节/);}finally{f.close();}}
 });
 await test('当前起点恢复不重算；底部仅简要状态，上方保留完整报告和其他错误',async()=>{
  const chapters=[{tabs:[video()]},{tabs:[video({stall:true})]},{tabs:[video()]}],f=fixture(chapters);
  try{f.d.querySelector('#cur2 .posCatalog_name').click();f.events.length=0;const first=f.runner.start({fromCurrent:true});for(let i=0;i<50&&!f.events.includes('play:1:0:0');i++)await delay(2);f.runner.stop();await first;const s=f.d.getElementById('cx-ai-study-root').shadowRoot;assert.equal(s.getElementById('status').textContent,'自动学习已停止');assert(s.getElementById('course-report').textContent.includes('用户停止自动学习'));chapters[1].tabs[0].tasks[0].stall=false;f.d.querySelector('#cur1 .posCatalog_name').click();f.events.length=0;const r=await f.runner.start({resume:true,fromCurrent:false});assert.equal(r.status,'done');assert.equal(r.videos,2);assert.equal(r.chapters.length,2);assert(!f.events.includes('chapter:0'));assert.equal(f.storage.get(f.runner.key).startChapterId,'cur2');f.api.controller.report('普通模型错误\n具体原因','error');assert.equal(s.getElementById('status').textContent,'普通模型错误\n具体原因');}finally{f.close();}
 });

 await test('超时继续默认开启：停滞视频暂停后下一章，不计完成且报告单独标记',async()=>{
  const f=fixture([{tabs:[video({stall:true})]},{tabs:[video()]}],{limits:{stallMs:65}});try{const r=await f.startWithDefaults();assert.equal(r.status,'done');assert.equal(r.chapters[0].status,'timed-out');assert.equal(r.chapters[0].tasks[0].status,'timed-out');assert.equal(r.videos,1);assert(f.videos[0].paused);assert(f.events.includes('chapter:1'));assert.match(f.api.courseReportText(r),/超时跳过 1 个章节（不计为完成）/);assert.match(f.api.courseReportText(r),/目录遍历结束/);assert.equal(f.storage.get(f.runner.key).continueOnTimeout,true);}finally{f.close();}
 });
 await test('关闭超时继续：保留原停止行为，不进入下一章',async()=>{
  const f=fixture([{tabs:[video({stall:true})]},{tabs:[video()]}],{limits:{stallMs:65}});try{const r=await f.runner.start({continueOnTimeout:false});assert.equal(r.status,'stopped');assert.equal(r.chapters[0].status,'stopped');assert(!f.events.includes('chapter:1'));}finally{f.close();}
 });
 await test('PPT完成确认等待超时继续后续章节，不把超时PPT记完成',async()=>{
  const f=fixture([{tabs:[ppt()]},{tabs:[video()]}],{noAck:true});try{const r=await f.runner.start({continueOnTimeout:true});assert.equal(r.status,'done');assert.equal(r.documents,0);assert.equal(r.chapters[0].status,'timed-out');assert(f.events.includes('chapter:1'));assert.equal(r.chapters[1].status,'timed-out');}finally{f.close();}
 });
 await test('开启超时继续仍停止人脸验证、人工取消、无效答案和提交结果不明',async()=>{
  for(const spec of [{task:video({faceOnPlay:true}),reason:/人脸/},{task:quiz(),opts:{submitNoAck:true},reason:/提交后未收到/},{task:quiz({unknown:true}),reason:/无法可靠|未知|题型/}]){const f=fixture([{tabs:[spec.task]},{tabs:[video()]}],spec.opts||{});try{const r=await f.runner.start({continueOnTimeout:true});assert.equal(r.status,'stopped');assert.match(r.reason,spec.reason);assert(!f.events.includes('chapter:1'));assert.equal(r.chapters[0].status,'stopped');}finally{f.close();}}
  const f=fixture([{tabs:[video({stall:true})]},{tabs:[video()]}]);try{const p=f.runner.start({continueOnTimeout:true});for(let i=0;i<50&&!f.events.some(e=>e.startsWith('play:'));i++)await delay(2);f.runner.stop();const r=await p;assert.equal(r.status,'stopped');assert(!f.events.includes('chapter:1'));}finally{f.close();}
 });
 await test('超时继续开关UI默认开启、保存关闭选择、运行禁用及恢复沿用原值',async()=>{
  const chapters=[{tabs:[video({stall:true})]},{tabs:[video()]}],f=fixture(chapters,{limits:{stallMs:65}});try{const s=f.d.getElementById('cx-ai-study-root').shadowRoot,t=s.getElementById('course-timeout-next');assert(t.checked);t.checked=false;t.dispatchEvent(new f.w.Event('change'));assert.equal(f.storage.get('cx_course_timeout_next'),false);s.getElementById('course-start').click();for(let i=0;i<50&&!f.runner.busy;i++)await delay(2);assert(t.disabled);for(let i=0;i<100&&f.runner.report.status==='running';i++)await delay(5);assert.equal(f.runner.report.status,'stopped');assert(!t.disabled);assert.equal(f.storage.get(f.runner.key).continueOnTimeout,false);const r=await f.runner.start({resume:true,continueOnTimeout:true});assert.equal(r.status,'stopped');assert(!f.events.includes('chapter:1'));assert.equal(f.storage.get(f.runner.key).continueOnTimeout,false);}finally{f.close();}
 });
 await test('模型请求超时可继续下一章，不预填或提交失败测验',async()=>{
  const f=fixture([{tabs:[quiz()]},{tabs:[video()]}],{error:'timeout'});try{const r=await f.runner.start({continueOnTimeout:true});assert.equal(r.status,'done');assert.equal(r.chapters[0].status,'timed-out');assert.equal(r.quizzes,0);assert.equal(f.submits,0);assert.equal(r.videos,1);assert(f.events.includes('chapter:1'));assert.match(r.chapters[0].reason,/超时/);}finally{f.close();}
 });
 await test('PPT 无末页按钮时逐页到末页，仍需平台完成确认',()=>runWith([{tabs:[ppt({nextOnly:true})]}],{},(f,r)=>{assert.equal(r.status,'done');assert.deepEqual(f.events.filter(x=>x.startsWith('slide:')),['slide:2','slide:3','slide:4']);}));
 await test('Swiper 幻灯片通过原分页按钮到末页，收到任务完成才继续',()=>runWith([{tabs:[ppt({swiper:true}),video()]}],{},(f,r)=>{assert.equal(r.status,'done');assert.equal(r.documents,1);assert.equal(r.videos,1);assert(f.events.includes('slide:3'));assert(f.events.indexOf('slide:3')<f.events.indexOf('tab:0:1'));}));
 await test('末页未获平台确认则停止，不假报完成',()=>runWith([{tabs:[ppt()]}],{noAck:true},(f,r)=>{assert.equal(r.status,'stopped');assert.match(r.reason,/未确认任务完成/);assert.equal(r.documents,0);}));
 await test('视频播放起点与暂停恢复，不改 currentTime 或倍速',()=>runWith([{tabs:[video({start:1,duration:4,pauseAt:2})]}],{},(f,r)=>{assert.equal(r.status,'done');assert(f.events.filter(x=>x.startsWith('play:')).length===2);assert.equal(r.chapters[0].tasks[0].startSeconds,1);assert.equal(f.videos[0].playbackRate,1);}));
 await test('零散暂停超过总恢复上限：有实际播放进展时重置连续计数，首次启动不计恢复',()=>runWith([{tabs:[video({duration:84,pauseTimes:[12,24,36,48,60,72]})]}],{},(f,r)=>{
  assert.equal(r.status,'done');assert.equal(r.videos,1);const task=r.chapters[0].tasks[0];assert.equal(task.resumes,6);assert.equal(task.pauseCount,6);assert.equal(task.unstableResumes,0);assert.equal(f.events.filter(e=>e.startsWith('play:')).length,7);assert.equal(f.videos.at(-1).playbackRate,1);
 }));
 await test('后台短段播放已有累计进度：多次恢复均少于10秒仍能完整播放',async()=>{
  const f=fixture([{tabs:[video({duration:64,pauseTimes:[8,16,24,28,36,42,50,58]})]}]);
  try{Object.defineProperty(f.d,'visibilityState',{get:()=> 'hidden',configurable:true});Object.defineProperty(f.d,'hasFocus',{value:()=>false,configurable:true});for(const v of f.videos){Object.defineProperty(v,'readyState',{get:()=>4,configurable:true});Object.defineProperty(v,'networkState',{get:()=>1,configurable:true});}
   const r=await f.runner.start(),task=r.chapters[0].tasks[0];assert.equal(r.status,'done');assert.equal(r.videos,1);assert.equal(task.resumes,8);assert.equal(task.pauseCount,8);assert.equal(task.unstableResumes,0);assert.equal(f.events.filter(e=>e.startsWith('play:')).length,9);assert(task.playbackEvents.filter(e=>e.event==='pause').every(e=>e.visibility==='hidden'&&e.focused===false&&e.readyState===4&&e.networkState===1));assert.equal(f.videos.at(-1).currentTime,64);assert.equal(f.videos.at(-1).playbackRate,1);
  }finally{f.close();}
 });
 await test('累计进度清零之后再次没有进度：恢复上限重新生效并停止在当前章节',async()=>{
  const page=video({duration:40,pauseTimes:[6,12,14]}),f=fixture([{tabs:[page]},{tabs:[video()]}]);
  try{for(const v of f.videos){const original=v.play;v.play=()=>{if(v.currentTime>=14)page.tasks[0].pauseOnEveryPlay=true;return original();};}
   const r=await f.runner.start({continueOnTimeout:true}),task=r.chapters[0].tasks[0];assert.equal(r.status,'stopped');assert.match(r.reason,/连续.*暂停/);assert.equal(task.unstableResumes,4);assert.equal(task.resumes,5);assert.equal(f.videos.at(-1).currentTime,14);assert.equal(r.videos,0);assert(!f.events.includes('chapter:1'));assert.equal(f.events.filter(e=>e.startsWith('play:')).length,6);
  }finally{f.close();}
 });
 await test('仅短暂推进不能清空恢复预算：连续暂停仍有界停止',()=>runWith([{tabs:[video({duration:20,pauseTimes:[1,2,3,4,5,6]})]},{tabs:[video()]}],{},(f,r)=>{
  assert.equal(r.status,'stopped');assert.match(r.reason,/连续.*暂停/);const task=r.chapters[0].tasks[0];assert.equal(task.resumes,4);assert.equal(task.unstableResumes,4);assert.equal(task.pauseCount,5);assert.equal(r.videos,0);assert(!f.events.includes('chapter:1'));assert.equal(f.events.filter(e=>e.startsWith('play:')).length,5);
 }));
 await test('play成功但没有进度仍立即暂停：保留恢复上限，不被超时继续开关绕过',async()=>{
  const f=fixture([{tabs:[video({pauseOnEveryPlay:true})]},{tabs:[video()]}]);try{const r=await f.runner.start({continueOnTimeout:true});assert.equal(r.status,'stopped');assert.match(r.reason,/连续.*暂停/);assert.equal(r.chapters[0].tasks[0].resumes,4);assert.equal(f.events.filter(e=>e.startsWith('play:')).length,5);assert(!f.events.includes('chapter:1'));}finally{f.close();}
 });
 await test('暂停时的前后台与缓冲状态记录可复制，停止后监听已移除且不记录网址或令牌',async()=>{
  for(const [visibility,focused] of [['visible',true],['visible',false],['hidden',false]]){const f=fixture([{tabs:[video({pauseOnEveryPlay:true})]}]);try{
   Object.defineProperty(f.d,'visibilityState',{get:()=>visibility,configurable:true});Object.defineProperty(f.d,'hasFocus',{value:()=>focused,configurable:true});for(const v of f.videos){Object.defineProperty(v,'readyState',{get:()=>2,configurable:true});Object.defineProperty(v,'networkState',{get:()=>2,configurable:true});}
   const r=await f.runner.start(),task=r.chapters[0].tasks[0];assert.equal(task.lastPause.visibility,visibility);assert.equal(task.lastPause.focused,focused);assert.equal(task.lastPause.readyState,2);assert.equal(task.lastPause.networkState,2);assert.equal(task.lastPause.errorCode,null);assert(task.playbackEvents.length<=12);assert.equal(task.lastPause.seconds,0);
   const text=f.api.courseReportText(r);assert.match(text,/视频状态记录/);assert(text.includes(visibility==='hidden'?'后台':'可见'));assert(text.includes(focused?'有焦点':'失焦'));assert.match(text,/来源尚未确认/);assert.match(text,/最近播放事件（相对启动时间）/);assert.match(text,/\+\d+\.\d 秒 开始播放/);assert.match(text,/\+\d+\.\d 秒 暂停/);assert.match(text,/readyState=2/);assert(!JSON.stringify(task.playbackEvents).includes('https:'));assert(!JSON.stringify(task.playbackEvents).includes('mock-only-key'));
   const count=task.pauseCount;const v=f.videos.at(-1);v.dispatchEvent(new v.ownerDocument.defaultView.Event('pause'));assert.equal(task.pauseCount,count);
  }finally{f.close();}}
 });
 await test('旧运行报告的事件可复制：限制条数、保留状态变化且不输出额外网址或密钥',async()=>{
  const f=fixture([{tabs:[video()]}]);try{
   const task={type:'video',status:'stopped',playbackState:{seconds:313,visibility:'visible',focused:true,errorCode:null},startedAt:1000};
   const report={status:'stopped',chapters:[{number:'1.1',title:'模拟视频',status:'stopped',issues:[],tasks:[task]}],videos:0,documents:0,quizzes:0};
   assert.doesNotThrow(()=>f.api.courseReportText(report));assert(!f.api.courseReportText(report).includes('最近播放事件'));
   task.playbackEvents=Array.from({length:16},(_,index)=>({event:index%2?'pause':'playing',at:1000+index*1000,seconds:300+index,visibility:index<10?'visible':'hidden',focused:index<10,readyState:4,networkState:1,errorCode:null,url:'https://mock.invalid/?secret=mock-only-key'}));
   task.playbackEvents.push(null,{event:'https://mock.invalid/secret',at:17000},{event:'pause',at:NaN});
   const text=f.api.courseReportText(report),trace=text.split('最近播放事件')[1];
   assert.equal(trace.split('\n').filter(line=>line.startsWith('+')).length,12);assert(!trace.includes('+0.0 秒'));assert.match(trace,/\+4\.0 秒 开始播放：视频 304 秒，可见、窗口有焦点/);assert.match(trace,/\+15\.0 秒 暂停：视频 315 秒，后台、窗口失焦/);assert(!text.includes('mock.invalid'));assert(!text.includes('mock-only-key'));assert(!text.includes('NaN'));
   delete task.startedAt;assert.match(f.api.courseReportText(report),/相对首条保留记录/);assert.match(f.api.courseReportText(report),/\+0\.0 秒 开始播放：视频 304 秒/);
  }finally{f.close();}
 });
 await test('恢复前出现人脸验证立即停止：诊断不能被用于绕过验证',()=>runWith([{tabs:[video({duration:8,pauseTimes:[2],faceAtPause:2})]},{tabs:[video()]}],{},(f,r)=>{
  assert.equal(r.status,'stopped');assert.match(r.reason,/人脸/);assert.equal(f.events.filter(e=>e.startsWith('play:')).length,1);assert.equal(r.chapters[0].tasks[0].resumes,0);assert(!f.events.includes('chapter:1'));
 }));
 await test('暂停之后发生媒体错误：报告使用最新错误状态，不被旧暂停快照覆盖',async()=>{
  const f=fixture([{tabs:[video({pauseOnEveryPlay:true})]}]);let mediaError=null;
  try{for(const v of f.videos){Object.defineProperty(v,'error',{get:()=>mediaError,configurable:true});const play=v.play;v.play=()=>{const pending=play();queueMicrotask(()=>{mediaError={code:3};v.dispatchEvent(new v.ownerDocument.defaultView.Event('error'));});return pending;};}
   const r=await f.runner.start(),task=r.chapters[0].tasks[0];assert.equal(r.status,'stopped');assert.match(r.reason,/错误 3/);assert.equal(task.lastPause.errorCode,null);assert.equal(task.playbackState.errorCode,3);const text=f.api.courseReportText(r),latest=text.split('最近播放事件')[0];assert.match(latest,/错误码=3/);assert(!latest.includes('错误码=无'));assert.match(text,/媒体错误：.*错误码=3/);assert.equal(f.events.filter(e=>e.startsWith('play:')).length,1);
  }finally{f.close();}
 });
 await test('浏览器拒绝自动播放有明确停止报告',()=>runWith([{tabs:[video({blocked:true})]}],{},(f,r)=>{assert.equal(r.status,'stopped');assert.match(r.reason,/浏览器阻止/);}));
 await test('缓冲进度停滞超时，不按预计时长假结束',()=>runWith([{tabs:[video({stall:true})]}],{limits:{stallMs:65}},(f,r)=>{assert.equal(r.status,'stopped');assert.match(r.reason,/长时间没有变化/);assert.equal(r.videos,0);}));
 await test('人脸识别停止，没有移除验证或继续播放下一视频',()=>runWith([{tabs:[video({faceOnPlay:true}),video()]}],{},(f,r)=>{assert.equal(r.status,'stopped');assert.match(r.reason,/人脸识别/);assert(f.doc.querySelector('.chapterVideoFaceMaskDiv'));assert(!f.events.includes('tab:0:1'));}));
 await test('无模型配置仍可播放视频，遇到测验停止并列出题号',()=>runWith([{tabs:[video(),quiz({count:2})]}],{key:''},(f,r)=>{assert.equal(r.videos,1);assert.equal(r.status,'stopped');assert.match(r.reason,/先配置模型/);assert.equal(f.requests.length,0);assert.equal(f.submits,0);assert.equal(r.chapters[0].issues.map(x=>x.number).join(','),'1,2');}));
  await test('未知题型列出具体题号，不调用模型或提交',()=>runWith([{tabs:[quiz({unknown:true,count:2})]}],{},(f,r)=>{assert.equal(r.status,'stopped');assert.equal(r.chapters[0].issues.map(x=>x.number).join(','),'1,2');assert.equal(f.requests.length,0);assert.equal(f.submits,0);}));
 await test('无效 AI 答案与已有不同手工答案均停止自动提交',async()=>{
  for(const opts of [{invalid:true},{}])await runWith([{tabs:[quiz({filled:!opts.invalid})]}],opts,(f,r)=>{assert.equal(r.status,'stopped');assert.equal(f.submits,0);assert(r.chapters[0].issues.some(x=>x.number===1));});
 });
 await test('只读简答可分析，但控件无法可靠写入时列题号停止',()=>runWith([{tabs:[quiz({essay:true,readonly:true})]}],{},(f,r)=>{assert.equal(r.status,'stopped');assert.equal(f.requests.length,1);assert.equal(f.submits,0);assert.equal(r.chapters[0].issues[0].number,1);}));
 await test('提交后没有成功标记，只点一次，不跳下一章节',()=>runWith([{tabs:[quiz()]},{tabs:[video()]}],{submitNoAck:true},(f,r)=>{assert.equal(r.status,'stopped');assert.match(r.reason,/未收到成功状态/);assert.equal(f.submits,1);assert(!f.events.includes('chapter:1'));}));
 await test('多个提交入口禁止猜测点击',()=>runWith([{tabs:[quiz({ambiguous:true})]}],{},(f,r)=>{assert.equal(r.status,'stopped');assert.match(r.reason,/唯一确认/);assert.equal(f.submits,0);}));
 await test('测验请求失败记录所有未完成题号，恢复锁与按钮',()=>runWith([{tabs:[quiz({count:3})]}],{error:'timeout'},(f,r)=>{assert.equal(r.status,'stopped');assert.equal(r.chapters[0].issues.map(x=>x.number).join(','),'1,2,3');assert.equal(f.submits,0);assert(!f.api.controller.state.busy);assert(!f.api.courseRunActive());}));
 await test('主动停止会中止 API，迟到响应不能预填/提交',async()=>{
  const f=fixture([{tabs:[quiz()]}],{requestMs:100});try{const p=f.runner.start();await delay(15);f.runner.stop();const r=await p;assert.equal(r.status,'stopped');assert.equal(f.submits,0);assert(f.events.includes('api-abort'));await delay(110);assert.equal(f.submits,0);assert(!f.api.controller.state.busy);}finally{f.close();}
 });
 await test('用户切换目录或页面标签立即停止，不填到新页面',async()=>{
  const f=fixture([{tabs:[quiz(),video()]},{tabs:[video()]}],{requestMs:35});try{const p=f.runner.start();await delay(10);f.d.querySelector('#dct2').click();const r=await p;assert.equal(r.status,'stopped');assert.match(r.reason,/切换了页面标签/);assert.equal(f.submits,0);}finally{f.close();}
 });
 await test('作业界面与未适配 PPT 终止，给出人工处理报告',async()=>{
  for(const kind of ['homework','unknown'])await runWith([{tabs:[{title:'资料',tasks:[{kind}]}]}],{},(f,r)=>{assert.equal(r.status,'stopped');assert.match(r.reason,/作业页面|未适配/);assert.equal(f.requests.length,0);assert.equal(f.submits,0);});
 });
 await test('默认不自行开始，重复启动互斥，目录入口可停止且状态可复制',async()=>{
  const f=fixture([{tabs:[video({duration:5})]}]);try{assert.equal(f.events.length,0);const p=f.runner.start();await f.runner.start();await delay(6);assert(f.api.courseRunActive());assert(f.d.getElementById('cx-ai-study-root').shadowRoot.getElementById('course-start').disabled);f.d.getElementById('cx-ai-study-root').shadowRoot.getElementById('course-stop').click();const r=await p;assert.equal(r.status,'stopped');assert.match(f.api.courseReportText(r),/自动学习已停止/);assert(!f.api.courseRunActive());}finally{f.close();}
 });
 await test('未授权自动提交选项关闭时预填后停留，不跳目录',async()=>{
  const f=fixture([{tabs:[quiz()]},{tabs:[video()]}]);try{const r=await f.runner.start({submit:false});assert.equal(r.status,'stopped');assert.match(r.reason,/人工提交/);assert.equal(f.submits,0);assert(!f.events.includes('chapter:1'));assert(f.doc.querySelector('input[value=A]').checked);}finally{f.close();}
 });
 await test('视频已结束但任务未确认仍停止，不跳下一目录',()=>runWith([{tabs:[video()]},{tabs:[video()]}],{noAck:true},(f,r)=>{assert.equal(r.status,'stopped');assert.equal(r.videos,0);assert.match(r.reason,/平台.*未确认/);assert(!f.events.includes('chapter:1'));}));
 await test('自动提交多个测验 iframe，各题目文档独立处理',async()=>{
  const f=fixture([{tabs:[quiz()]}]);try{
   const parent=f.doc;parent.body.replaceChildren();
   for(let index=0;index<2;index++){
    const frame=parent.createElement('iframe');parent.body.append(frame);const doc=frame.contentDocument;
    doc.body.innerHTML='<div class="singleQuesId" data="1"><div class="Zy_TItle"><span class="fontLabel">【简答题】解释概念</span></div><textarea></textarea></div><span class="testTit_status">待完成</span><button data-quiz-submit>提交</button>';
    doc.querySelector('button').onclick=()=>{doc.querySelector('.testTit_status').textContent='已提交';f.d.querySelector('.orangeNew').textContent='0';};
   }
   const r=await f.runner.start();assert.equal(r.status,'done');assert.equal(r.quizzes,2);assert.equal(f.requests.length,2);
  }finally{f.close();}
 });
 await test('模型分析期间修改题干，停止并保留未提交状态',async()=>{
  const f=fixture([{tabs:[quiz()]}],{requestMs:35});try{const p=f.runner.start();await delay(10);f.doc.querySelector('.fontLabel').textContent='【单选题】另一道题';const r=await p;assert.equal(r.status,'stopped');assert.match(r.reason,/不一致/);assert.equal(f.submits,0);}finally{f.close();}
 });
 await test('出现验证码或账号切换时中止未完成模型请求',async()=>{
  for(const kind of ['captcha','account']){
   const f=fixture([{tabs:[quiz()]}],{requestMs:100});try{const p=f.runner.start();await delay(10);
    if(kind==='captcha'){const node=f.doc.createElement('div');node.setAttribute('data-captcha','');f.doc.body.append(node);}else f.w.history.replaceState({},'','?courseId=mock-course&clazzid=mock-class&cpi=other-account');
    const r=await p;assert.equal(r.status,'stopped');assert.match(r.reason,/验证码|账号已变化/);assert.equal(f.submits,0);assert(f.events.includes('api-abort'));
   }finally{f.close();}
  }
 });
 await test('另一个页面的有效运行锁禁止重复刷课',async()=>{
  const f=fixture([{tabs:[video()]}]);try{
   f.storage.set(f.runner.key,{status:'running',session:'different-mock-tab',heartbeat:Date.now()});await f.runner.start();assert.equal(f.requests.length,0);assert.equal(f.events.length,0);assert.match(f.api.controller.state.message,/另一个页面/);
  }finally{f.close();}
 });
 await test('多目录没有总量截断，无视频和测验的文字目录均遍历',()=>runWith(Array.from({length:31},()=>({tabs:[{title:'资料',text:'无需视频的文字材料'}]})),{},(f,r)=>{assert.equal(r.status,'done');assert.equal(r.chapters.length,31);assert.equal(r.chapters.filter(c=>c.status==='done').length,31);assert.equal(f.requests.length,0);}));
 await test('提交结果替换 iframe 文档后仍能确认成功，不误判新题目',async()=>{
  const f=fixture([{tabs:[quiz()]}]);try{
   const doc=f.doc;doc.querySelector('[data-quiz-submit]').onclick=()=>{const frame=doc.defaultView.frameElement;frame.contentDocument.open();frame.contentDocument.write('<span class="testTit_status">已提交</span>');frame.contentDocument.close();f.d.querySelector('.orangeNew').textContent='0';};
   const r=await f.runner.start();assert.equal(r.status,'done');assert.equal(r.quizzes,1);
  }finally{f.close();}
 });
 await test('跨域 iframe 无法读取时明确停止，不能假定无任务',async()=>{
  const f=fixture([{tabs:[video()]}]);try{Object.defineProperty(f.d.getElementById('iframe'),'contentDocument',{get:()=>null});const r=await f.runner.start();assert.equal(r.status,'stopped');assert.match(r.reason,/跨域/);assert.equal(r.videos,0);}finally{f.close();}
 });
 await test('刷课报告不存 Key、题目答案、图片 Base64 和资源地址',()=>runWith([{tabs:[quiz({essay:true})]}],{},(f,r)=>{
  assert.equal(r.status,'done');const stored=JSON.stringify(f.storage.get(f.runner.key));assert(!stored.includes('mock-only-key')&&!stored.includes('模拟简答')&&!stored.includes('data:image')&&!stored.includes('https://'));assert.equal(r.chapters[0].tasks[0].questionCount,1);
 }));
 await test('异步章节加载先等待新内容，不能把空文档判为无任务',()=>runWith([{tabs:[video()]},{tabs:[quiz()]}],{loadDelay:25},(f,r)=>{assert.equal(r.status,'done');assert.equal(r.videos,1);assert.equal(r.quizzes,1);}));
 await test('原生导航刷新只在同一浏览器会话恢复既有队列',async()=>{
  const chapters=[{tabs:[video()]},{tabs:[video()]}];const first=fixture(chapters,{navigateOut:true});let stored,session;
  try{const r=await first.runner.start();assert.equal(r.status,'running');stored=[...first.storage];session=first.w.sessionStorage.getItem('cx-ai-course-session');assert.equal(r.videos,1);}finally{first.close();}
  const next=fixture([{tabs:[video()]},{tabs:[video()]}],{storage:stored,session,noAutoResume:true});
  try{const r=await next.runner.resumeIfNeeded();assert.equal(r.status,'done');assert.equal(r.videos,2);assert(!r.chapters.some(c=>c.issues.length));}finally{next.close();}
 });
 await test('手动离开播放页保存中止报告，不静默重启',async()=>{
  const f=fixture([{tabs:[video({duration:30})]}]);try{const p=f.runner.start();await delay(12);f.w.dispatchEvent(new f.w.Event('pagehide'));const r=await p;assert.equal(r.status,'stopped');assert.match(r.reason,/离开或刷新/);assert.equal(f.runner.resumeIfNeeded(),undefined);}finally{f.close();}
 });
 await test('题目 iframe 的刷课入口委托给主页面，切页后仍继续到视频',async()=>{
  const f=fixture([{tabs:[quiz({essay:true}),video()]}]);try{
   const child=f.doc.defaultView;child.GM_getValue=f.w.GM_getValue;child.GM_setValue=f.w.GM_setValue;child.GM_xmlhttpRequest=f.w.GM_xmlhttpRequest;child.GM_getResourceText=f.w.GM_getResourceText;
   child.eval(code);child.courseAPI.initQuizAssistant();child.courseAPI.controller.openPanel('chapters');
   const portal=f.d.getElementById('cx-ai-quiz-panel');assert(portal);portal.shadowRoot.getElementById('course-start').click();
   await delay(10);assert(f.runner.busy);assert(portal.shadowRoot.getElementById('status-spinner').hidden===false);
   for(let i=0;i<100&&f.runner.busy;i++)await delay(5);
   assert.equal(f.runner.report.status,'done');assert.equal(f.runner.report.quizzes,1);assert.equal(f.runner.report.videos,1);assert(f.events.includes('tab:0:1'));
  }finally{f.close();}
 });

 await test('问卷等待时跳过本章节，进入下一章且不计为完成',async()=>{
  const f=fixture([{title:'问卷',tabs:[{title:'问卷',tasks:[{kind:'survey'}]}]},{tabs:[video()]}]);try{
   const p=f.runner.start();await delay(9);const shadow=f.d.getElementById('cx-ai-study-root').shadowRoot;
   assert(!shadow.getElementById('course-skip').disabled);shadow.getElementById('course-skip').click();assert.equal(f.runner.skip(),false);
   const r=await p;assert.equal(r.status,'done');assert.equal(r.chapters[0].status,'skipped');assert.equal(r.chapters[1].status,'done');
   assert.equal(r.videos,1);assert.match(f.api.courseReportText(r),/用户跳过 1 个章节/);assert.match(f.api.courseReportText(r),/1\/2 个章节/);
   assert(!f.d.getElementById('cur1').querySelector('.icon_Completed'));assert.equal(f.storage.get(f.runner.key).report.chapters[0].status,'skipped');
   assert(shadow.getElementById('course-skip').disabled);
  }finally{f.close();}
 });
 await test('跳过正在播放的视频会暂停，只跳一章不累计完成视频',async()=>{
  const f=fixture([{tabs:[video({duration:30})]},{tabs:[video()]}]);try{
   const p=f.runner.start();await delay(9);assert(f.runner.skip());const r=await p;
   assert.equal(r.status,'done');assert(f.videos[0].paused);assert(!f.videos[0].ended);assert.equal(r.videos,1);assert.equal(r.chapters[0].tasks[0].status,'skipped');
  }finally{f.close();}
 });
 await test('跳过分析章节取消请求，迟到回答不能填写或提交下一章',async()=>{
  const f=fixture([{tabs:[quiz()]},{tabs:[video()]}],{requestMs:80,lateResponse:true});try{
   const old=f.doc.querySelector('input[value=A]'),p=f.runner.start();await delay(12);assert.equal(f.requests.length,1);assert(f.runner.skip());
   const r=await p;assert.equal(r.status,'done');assert.equal(r.chapters[0].status,'skipped');assert.equal(f.submits,0);assert(f.events.includes('api-abort'));
   await delay(90);assert(!old.checked);assert.equal(f.submits,0);assert.equal(r.videos,1);assert.equal(r.chapters[0].issues.length,0);
  }finally{f.close();}
 });
 await test('章节尚未加载时仍可跳过，不把空内容判作完成',async()=>{
  const f=fixture([{tabs:[{title:'问卷',tasks:[{kind:'survey'}]}]},{tabs:[video()]}]);try{
   f.doc.body.replaceChildren();const p=f.runner.start();await delay(7);assert(f.runner.skip());const r=await p;
   assert.equal(r.status,'done');assert.equal(r.chapters[0].status,'skipped');assert.equal(r.videos,1);
  }finally{f.close();}
 });
 await test('最后一章跳过结束遍历，但不会声称全部章节完成',async()=>{
  const f=fixture([{tabs:[{title:'问卷',tasks:[{kind:'survey'}]}]}]);try{
   const p=f.runner.start();await delay(7);assert(f.runner.skip());const r=await p;
   assert.equal(r.status,'done');assert.match(f.api.courseReportText(r),/目录遍历结束：0\/1/);assert(!f.api.courseReportText(r).includes('全部流程完成'));
   assert(!f.runner.canSkip);assert.equal(f.runner.skip(),false);
  }finally{f.close();}
 });
 await test('跳过后立即停止，停止优先，不自行进入下一章',async()=>{
  const f=fixture([{tabs:[video({duration:30})]},{tabs:[video()]}]);try{
   const p=f.runner.start();await delay(7);f.runner.skip();f.runner.stop();const r=await p;
   assert.equal(r.status,'stopped');assert(!f.events.includes('chapter:1'));assert.equal(r.videos,0);
  }finally{f.close();}
 });
 await test('测验已提交等待确认期间禁止跳过，不跳到不确定的新章节',async()=>{
  const f=fixture([{tabs:[quiz()]},{tabs:[video()]}],{submitNoAck:true});try{
   const p=f.runner.start();for(let i=0;i<40&&!f.submits;i++)await delay(2);assert.equal(f.submits,1);
   assert(!f.runner.canSkip);assert.equal(f.runner.skip(),false);assert(f.d.getElementById('cx-ai-study-root').shadowRoot.getElementById('course-skip').disabled);
   const r=await p;assert.equal(r.status,'stopped');assert(!f.events.includes('chapter:1'));
  }finally{f.close();}
 });
 await test('跳过不能越过人脸或验证码拦截',async()=>{
  const f=fixture([{tabs:[video({duration:30})]},{tabs:[video()]}]);try{
   const p=f.runner.start();await delay(7);const blocker=f.doc.createElement('div');blocker.setAttribute('data-captcha','');f.doc.body.append(blocker);
   assert.equal(f.runner.skip(),false);const r=await p;assert.equal(r.status,'stopped');assert.match(r.reason,/验证码/);assert(!f.events.includes('chapter:1'));
  }finally{f.close();}
 });
 await test('子测验面板的跳过按钮委托主页面，取消测验后继续下一章',async()=>{
  const f=fixture([{tabs:[quiz()]},{tabs:[video()]}],{requestMs:80});try{
   const child=f.doc.defaultView;child.GM_getValue=f.w.GM_getValue;child.GM_setValue=f.w.GM_setValue;child.GM_xmlhttpRequest=f.w.GM_xmlhttpRequest;child.GM_getResourceText=f.w.GM_getResourceText;
   child.eval(code);child.courseAPI.initQuizAssistant();child.courseAPI.controller.openPanel('chapters');
   const p=f.runner.start();await delay(10);const button=f.d.getElementById('cx-ai-quiz-panel').shadowRoot.getElementById('course-skip');assert(!button.disabled);button.click();
   const r=await p;assert.equal(r.status,'done');assert.equal(r.chapters[0].status,'skipped');assert.equal(f.submits,0);assert.equal(r.videos,1);
  }finally{f.close();}
 });
 await test('跳过记录随原生导航恢复，已跳章节不重新执行',async()=>{
  const first=fixture([{tabs:[{title:'问卷',tasks:[{kind:'survey'}]}]},{tabs:[video()]}],{navigateOut:true});let stored,session;
  try{const p=first.runner.start();await delay(7);first.runner.skip();const r=await p;assert.equal(r.status,'running');stored=[...first.storage];session=first.w.sessionStorage.getItem('cx-ai-course-session');}finally{first.close();}
  const next=fixture([{tabs:[{title:'问卷',tasks:[{kind:'survey'}]}]},{tabs:[video()]}],{storage:stored,session,noAutoResume:true});try{
   const r=await next.runner.resumeIfNeeded();assert.equal(r.status,'done');assert.equal(r.chapters[0].status,'skipped');assert.equal(r.videos,1);
  }finally{next.close();}
 });
 await test('连续图片 PPT 直接到底并稳定复查，收到平台完成后才继续',()=>runWith([
  {tabs:[{title:'PPT',tasks:[{kind:'scroll'}]}]},{tabs:[video()]}
 ],{},(f,r)=>{assert.equal(r.status,'done');assert.equal(r.documents,1);assert.equal(r.videos,1);assert(f.events.filter(e=>e.startsWith('scroll:')).length<=6);assert(f.events.includes('scroll:0:800'));assert.equal(r.chapters[0].tasks[0].reader,'scroll');}));
 await test('资料滚动到底但无任务确认则停止，不伪造完成',()=>runWith([{tabs:[{title:'PPT',tasks:[{kind:'scroll'}]}]}],{noAck:true},(f,r)=>{assert.equal(r.status,'stopped');assert.equal(r.documents,0);assert.match(r.reason,/最底部.*未确认/);}));
 await test('延迟加载增加高度后继续滚动到新的底部',()=>runWith([{tabs:[{title:'PPT',tasks:[{kind:'scroll',grow:true}]}]}],{},(f,r)=>{assert.equal(r.status,'done');assert.equal(r.documents,1);assert(f.events.includes('scroll:0:1200'));}));
 await test('支持资料 iframe 的文档滚动根与自动高度 iframe 外层滚动',async()=>{
  for(const target of ['root','outer'])await runWith([{tabs:[{title:'PPT',tasks:[{kind:'scroll',[target]:true}]}]}],{},(f,r)=>{assert.equal(r.status,'done');assert.equal(r.documents,1);assert(f.events.includes('scroll:0:800'));});
 });
 await test('滚动无响应时停止，未知图片不作为资料或完成信号',()=>runWith([{tabs:[{title:'PPT',tasks:[{kind:'scroll',stall:true}]}]}],{},(f,r)=>{assert.equal(r.status,'stopped');assert.equal(r.documents,0);assert.match(r.reason,/滚动没有响应/);}));
 await test('滚动资料期间跳过或停止会取消余下滚动',async()=>{
  for(const action of ['skip','stop']){
   const f=fixture([{tabs:[{title:'PPT',tasks:[{kind:'scroll',height:20000}]}]},{tabs:[video()]}]);try{
    const p=f.runner.start();await delay(7);assert(f.events.some(e=>e.startsWith('scroll:')));f.runner[action]();
    const r=await p;assert.equal(r.documents,0);assert.equal(r.chapters[0].status,action==='skip'?'skipped':'stopped');assert.equal(r.status,action==='skip'?'done':'stopped');
    const count=f.events.filter(e=>e.startsWith('scroll:')).length;await delay(10);assert.equal(f.events.filter(e=>e.startsWith('scroll:')).length,count);
   }finally{f.close();}
  }
 });

 await test('后台延迟唤醒：原入口已加载的视频不能被过期计时器误跳过',async()=>{
  let slowPoll=false,delayed=false;const f=fixture([{tabs:[video({lazy:true,nativeOnly:true,duration:12})]},{tabs:[video()]}],{limits:{videoLoadMs:30},sleep:ms=>{if(ms===3&&slowPoll&&!delayed){delayed=true;return delay(80);}return delay(ms);}});
  try{Object.defineProperty(f.d,'visibilityState',{get:()=> 'hidden',configurable:true});const button=f.doc.querySelector('.vjs-big-play-button'),load=button.onclick;button.onclick=()=>{slowPoll=true;setTimeout(()=>load(),15);};
   const r=await f.runner.start({continueOnTimeout:true});assert(delayed);assert.equal(r.status,'done');assert.equal(r.videos,2);assert.equal(r.chapters[0].status,'done');assert.equal(r.chapters[0].tasks[0].durationSeconds,12);assert(!r.chapters.some(c=>c.status==='timed-out'));assert(f.events.indexOf('chapter:1')>f.events.indexOf('play:0:0:0'));assert.equal(f.videos.at(-1).playbackRate,1);
  }finally{f.close();}
 });
 await test('后台延迟唤醒：真实未加载仍超时，不假报视频完成',async()=>{
  let slowPoll=false;const f=fixture([{tabs:[video({lazy:true,nativeOnly:true})]},{tabs:[video()]}],{limits:{videoLoadMs:30},sleep:ms=>ms===3&&slowPoll?delay(80):delay(ms)});
  try{f.doc.querySelector('.vjs-big-play-button').onclick=()=>{slowPoll=true;};const r=await f.runner.start();assert.equal(r.status,'stopped');assert.equal(r.videos,0);assert.match(r.reason,/尚未加载/);assert(!f.events.includes('chapter:1'));assert(!f.events.some(e=>e.startsWith('play:')));
  }finally{f.close();}
 });
 await test('暂停事件唤醒：后台轮询挂起时及时恢复，取消后不继续操作',async()=>{
  let f,pending;const held=[];f=fixture([{tabs:[video({duration:100,pauseAt:2})]},{tabs:[video()]}],{sleep:ms=>ms===3&&f?.events.includes('play:0:0:0')?new Promise(resolve=>held.push(resolve)):delay(ms)});
  try{Object.defineProperty(f.d,'visibilityState',{get:()=> 'hidden',configurable:true});pending=f.runner.start();for(let i=0;i<50&&!f.events.filter(e=>e.startsWith('play:')).slice(1).length;i++)await delay(5);
   assert(held.length>0);assert.equal(f.events.filter(e=>e.startsWith('play:')).length,2);assert.equal(f.runner.report.chapters[0].tasks[0].resumes,1);assert.equal(f.videos[0].playbackRate,1);f.runner.stop();const r=await pending;assert.equal(r.status,'stopped');assert.equal(r.videos,0);assert(!f.events.includes('chapter:1'));held.forEach(resolve=>resolve());await delay(5);assert.equal(f.events.filter(e=>e.startsWith('play:')).length,2);
  }finally{f.runner.stop();held.forEach(resolve=>resolve());if(pending)await pending;f.close();}
 });
 await test('懒加载视频先播放再读取时长，不等待永远未初始化的 metadata',()=>runWith([{tabs:[video({lazy:true})]}],{},(f,r)=>{assert.equal(r.status,'done');assert.equal(r.videos,1);assert(f.events.includes('play:0:0:0'));assert.equal(r.chapters[0].tasks[0].durationSeconds,3);}));
 await test('播放器必须点击原播放入口才能加载时长，正常调用原入口',()=>runWith([{tabs:[video({lazy:true,nativeOnly:true})]}],{},(f,r)=>{assert.equal(r.status,'done',r.reason);assert.equal(r.videos,1);assert(f.events.includes('native-play:0:0:0'));assert(f.events.indexOf('native-play:0:0:0')<f.events.indexOf('play:0:0:0'));}));
 await test('同页视频、PPT、视频和第二份PPT逐任务依DOM顺序处理',()=>runWith([{tabs:[{title:'混合任务',tasks:[{kind:'video',lazy:true},{kind:'ppt'},{kind:'video'},{kind:'ppt',nextOnly:true}]}]}],{},(f,r)=>{
  assert.equal(r.status,'done',r.reason+'; '+f.events.join(','));assert.equal(r.videos,2);assert.equal(r.documents,2);assert.deepEqual(Array.from(r.chapters[0].tasks,t=>t.type),['video','document','video','document']);
  assert(f.events.indexOf('play:0:0:0')<f.events.indexOf('slide:4'));assert(f.events.indexOf('slide:4')<f.events.indexOf('play:0:0:2'));assert.equal(f.events.filter(e=>e==='slide:4').length,2);
 }));
 await test('同章视频和滚动PPT分标签依次完成后才进入下一章节',()=>runWith([{tabs:[video({lazy:true,nativeOnly:true}),{title:'PPT',tasks:[{kind:'scroll'}]}]},{tabs:[video()]}],{},(f,r)=>{
  assert.equal(r.status,'done',r.reason);assert.equal(r.videos,2);assert.equal(r.documents,1);assert(f.events.indexOf('tab:0:1')<f.events.indexOf('chapter:1'));assert(f.events.indexOf('scroll:0:800')<f.events.indexOf('chapter:1'));
 }));
 await test('视频和PPT混合的嵌套iframe任务按父页顺序处理',async()=>{
  const f=fixture([{tabs:[{title:'混合任务',tasks:[{kind:'video'},{kind:'ppt'},{kind:'video'}]}]}]);try{
   const wrappers=[...f.doc.querySelectorAll('[data-course-task]')];
   for(const wrapper of wrappers){const frame=f.doc.createElement('iframe');wrapper.parentNode.insertBefore(frame,wrapper);frame.contentDocument.body.append(wrapper);}
   const r=await f.runner.start();assert.equal(r.status,'done');assert.equal(r.videos,2);assert.equal(r.documents,1);assert.deepEqual(Array.from(r.chapters[0].tasks,t=>t.type),['video','document','video']);
  }finally{f.close();}
 });
 await test('问卷已经超时停止时仍能明确跳过本章续接既有队列',async()=>{
  const f=fixture([{tabs:[{title:'问卷',tasks:[{kind:'survey'}]}]},{tabs:[video()]}]);try{
   const first=await f.runner.start();assert.equal(first.status,'stopped');assert(f.runner.canSkip);assert(!f.d.getElementById('cx-ai-study-root').shadowRoot.getElementById('course-skip').disabled);
   const r=await f.runner.skip();assert.equal(r.status,'done');assert.equal(r.chapters[0].status,'skipped');assert.equal(r.videos,1);assert.equal(r.chapters.length,2);
  }finally{f.close();}
 });
 await test('已停止但提交结果不明或已手动换章时禁止跳过续接',async()=>{
  const f=fixture([{tabs:[quiz()]},{tabs:[video()]}],{submitNoAck:true});try{await f.runner.start();assert(!f.runner.canSkip);assert.equal(f.runner.skip(),false);assert(!f.events.includes('chapter:1'));}finally{f.close();}
  const g=fixture([{tabs:[{title:'问卷',tasks:[{kind:'survey'}]}]},{tabs:[video()]}]);try{await g.runner.start();g.d.querySelector('#cur2 .posCatalog_name').click();assert(!g.runner.canSkip);assert.equal(g.runner.skip(),false);}finally{g.close();}
 });

 await test('没有任务点的PPT直接下一节，不滚动不累计资料完成',async()=>{
  const f=fixture([{unknownStatus:true,tabs:[{title:'PPT',tasks:[{kind:'scroll',optional:true}]}]},{tabs:[video()]}]);try{
   const r=await f.runner.start();assert.equal(r.status,'done');assert.equal(r.chapters[0].status,'no-tasks');assert.equal(r.documents,0);assert.equal(r.videos,1);assert(!f.events.some(e=>e.startsWith('scroll:')));assert.match(f.api.courseReportText(r),/无任务点/);
  }finally{f.close();}
 });
 await test('同章可选PPT与必做视频混合，只跳无任务点资料并完成必做视频',async()=>{
  const f=fixture([{tabs:[{title:'PPT',tasks:[{kind:'scroll',optional:true}]},video()]}]);try{
   f.d.querySelector('#cur1 .orangeNew').textContent='1';const r=await f.runner.start();assert.equal(r.status,'done');assert.equal(r.documents,0);assert.equal(r.videos,1);assert(f.events.includes('tab:0:1'));assert(!f.events.some(e=>e.startsWith('scroll:')));
  }finally{f.close();}
 });
 await test('同页可选资料和必做视频逐项区分，不把混合章节整体跳掉',async()=>{
  const f=fixture([{tabs:[{title:'混合任务',tasks:[{kind:'scroll',optional:true},{kind:'video'}]}]}]);try{
   f.d.querySelector('#cur1 .orangeNew').textContent='1';const r=await f.runner.start();assert.equal(r.status,'done');assert.equal(r.documents,0);assert.equal(r.videos,1);assert(!f.events.some(e=>e.startsWith('scroll:')));
  }finally{f.close();}
 });
 await test('无任务标记但目录仍有未完成任务，不误报整章完成',()=>runWith([{tabs:[{title:'PPT',tasks:[{kind:'scroll',optional:true}]}]}],{optionalPending:true},(f,r)=>{assert.equal(r.status,'stopped');assert.equal(r.documents,0);assert.match(r.reason,/仍有未完成任务/);}));

 await test('测验先完成而本章视频未完成时只跳过测验，仍处理视频',()=>runWith([{tabs:[quiz({complete:true}),video({lazy:true})]}],{},(f,r)=>{
  assert.equal(r.status,'done');assert.equal(r.videos,1);assert.equal(r.quizzes,0);assert.equal(f.requests.length,0);assert.equal(f.submits,0);assert.equal(r.chapters[0].tasks[0].status,'already');assert.match(f.api.courseReportText(r),/测验已完成/);
 }));
 await test('已提交无题目结果页和带分数完成状态都不重新调用AI',async()=>{
  for(const statusText of ['已提交','提交成功','已完成 100 分','已完成（95分）'])await runWith([{tabs:[quiz({complete:true,statusText}),ppt()]}],{},(f,r)=>{
   assert.equal(r.status,'done');assert.equal(r.documents,1);assert.equal(r.quizzes,0);assert.equal(f.requests.length,0);assert.equal(f.submits,0);assert.equal(r.chapters[0].tasks[0].status,'already');
  });
 });
 await test('同页已完成测验和未完成视频混合，不跳过视频也不重复交卷',()=>runWith([{tabs:[{title:'混合任务',tasks:[{kind:'quiz',complete:true},{kind:'video',lazy:true}]}]}],{},(f,r)=>{
  assert.equal(r.status,'done');assert.equal(r.videos,1);assert.equal(r.quizzes,0);assert.equal(f.requests.length,0);assert.equal(f.submits,0);
 }));
 await test('题干提到已完成不能误认成测验完成状态',async()=>{
  const f=fixture([{tabs:[quiz()]}]);try{f.doc.querySelector('.fontLabel').textContent='【单选题】以下哪个选项说明“已完成100分”？';const r=await f.runner.start();assert.equal(r.status,'done');assert.equal(f.requests.length,1);assert.equal(f.submits,1);}finally{f.close();}
 });

 await test('原生附件的任务点文字标记能识别为必做视频，不误跳过',async()=>{
  const f=fixture([{tabs:[video({lazy:true})]}]);try{
   const container=f.doc.querySelector('[data-course-task]');container.removeAttribute('data-course-task');container.className='ans-attach-ct';
   const label=f.doc.createElement('span');label.textContent='任务点';container.prepend(label);const r=await f.runner.start();assert.equal(r.status,'done');assert.equal(r.videos,1);assert(f.events.includes('play:0:0:0'));
  }finally{f.close();}
 });
 await test('任务点已完成文字标记跳过视频，但继续同章PPT任务',async()=>{
  const f=fixture([{tabs:[{title:'混合任务',tasks:[{kind:'video'},{kind:'ppt'}]}]}]);try{
   const container=f.doc.querySelector('[data-course-task]');container.removeAttribute('data-course-task');container.removeAttribute('data-completed');container.className='ans-attach-ct';
   const label=f.doc.createElement('span');label.textContent='任务点已完成';container.prepend(label);
   const r=await f.runner.start();assert.equal(r.documents,1);assert.equal(r.videos,0);assert.equal(r.chapters[0].tasks[0].status,'already');assert(!f.events.includes('play:0:0:0'));
  }finally{f.close();}
 });
 await test('新版跨域PPT按正常滚动推进，并等待外层平台完成标记',async()=>{
  const f=fixture([{tabs:[ppt()]}]);try{
   const container=f.doc.querySelector('[data-course-task]');container.innerHTML='<div id="img" class="imglook"><iframe id="panView" src="https://mooc1.chaoxing.com/mooc-ans/screen/file/mock"></iframe></div>';
   const frame=container.querySelector('iframe'),child=frame.contentWindow;Object.defineProperty(frame,'contentDocument',{get:()=>null});
   let top=0;const messages=[];
   child.postMessage=(data,origin)=>{messages.push({data,origin});if(origin!=='https://pan-yz.chaoxing.com')return;if(data.op==='step'||data.op==='bottom'){top=data.op==='bottom'?800:Math.min(800,top+160);if(top===800){container.setAttribute('data-completed','true');f.d.querySelector('.orangeNew').textContent='0';}}setTimeout(()=>f.w.dispatchEvent(new f.w.MessageEvent('message',{source:child,origin:'https://pan-yz.chaoxing.com',data:{channel:data.channel,kind:'result',id:data.id,state:{loaded:true,top,height:200,total:1000,canBottom:true,imageCount:1,pendingImages:0}}})),1);};
   const r=await f.runner.start();assert.equal(r.status,'done');assert.equal(r.documents,1);assert.equal(r.chapters[0].tasks[0].reader,'remote-scroll');assert.equal(top,800);assert(messages.every(m=>m.origin!=='*'&&!JSON.stringify(m.data).includes('mock-only-key')));
  }finally{f.close();}
 });
 await test('跨域PPT未响应时停止，不假报完成',async()=>{
  const f=fixture([{tabs:[ppt()]}]);try{
   const c=f.doc.querySelector('[data-course-task]');c.innerHTML='<div id="img" class="imglook"><iframe id="panView" src="https://mooc1.chaoxing.com/mooc-ans/screen/file/mock"></iframe></div>';
   const frame=c.querySelector('iframe');Object.defineProperty(frame,'contentDocument',{get:()=>null});frame.contentWindow.postMessage=()=>{};
   const r=await f.runner.start();assert.equal(r.status,'stopped');assert.equal(r.documents,0);assert.match(r.reason,/未响应/);
  }finally{f.close();}
 });
 await test('未知跨域iframe不能因存在panView名称而绕过检查',async()=>{
  const f=fixture([{tabs:[ppt()]}]);try{const c=f.doc.querySelector('[data-course-task]');c.innerHTML='<div id="img" class="imglook"><iframe id="panView" src="https://example.invalid/screen/file/mock"></iframe></div>';const frame=c.querySelector('iframe');Object.defineProperty(frame,'contentDocument',{get:()=>null});assert.equal(f.api.courseRemoteReaderFrame(frame),false);assert.equal(f.api.courseFrameTree(f.d).inaccessible.length,1);}finally{f.close();}
 });
 await test('跨域滚动响应校验来源和请求ID，取消会清理等待',async()=>{
  const f=fixture([{tabs:[ppt()]}]);try{const c=f.doc.querySelector('[data-course-task]');c.innerHTML='<div id="img" class="imglook"><iframe id="panView" src="https://mooc1.chaoxing.com/mooc-ans/screen/file/mock"></iframe></div>';const frame=c.querySelector('iframe'),child=frame.contentWindow;child.postMessage=()=>{};const signal=new f.w.AbortController();let settled=false;const p=f.api.courseDocumentBridgeRequest(frame,'read',signal.signal,100).then(()=>{settled=true;},e=>{assert.match(e.message,/取消/);settled=true;});f.w.dispatchEvent(new f.w.MessageEvent('message',{source:child,origin:'https://example.invalid',data:{channel:'cx-ai-document-v1',kind:'result',id:'wrong',state:{loaded:true,top:1000,height:200,total:1000}}}));await delay(4);assert.equal(settled,false);signal.abort();await p;}finally{f.close();}
 });
 await test('跨域阅读器子模块只接受合法超星祖先窗口，正常滚动且不伪造任务状态',async()=>{
  const f=fixture([{tabs:[ppt()]}]);try{
   const frame=f.d.createElement('iframe');f.d.body.append(frame);const doc=frame.contentDocument,view=frame.contentWindow;
   Object.defineProperty(doc,'URL',{value:'https://pan-yz.chaoxing.com/screen/v2/file_mock'});
   doc.body.innerHTML='<div class="fileBox"><ul><li><img src="data:image/png;base64,AA=="></li></ul></div>';
   const img=doc.querySelector('img');Object.defineProperties(img,{complete:{get:()=>true},naturalWidth:{get:()=>800}});
   Object.defineProperties(doc.documentElement,{clientHeight:{get:()=>200},scrollHeight:{get:()=>1000}});
   const responses=[];f.w.postMessage=(data,origin)=>responses.push({data,origin});f.api.initCourseDocumentBridge(doc);
   let nextId=0;const send=(origin,source,op,id='mock-'+(++nextId))=>view.dispatchEvent(new view.MessageEvent('message',{origin,source,data:{channel:'cx-ai-document-v1',kind:'request',id,op}}));
   send('https://example.invalid',f.w,'step');send('https://mooc1.chaoxing.com',view,'step');assert.equal(responses.length,0);
   send('https://mooc1.chaoxing.com',f.w,'read');assert.equal(responses.at(-1).data.state.top,0);
   send('https://mooc1.chaoxing.com',f.w,'step');assert.equal(responses.at(-1).data.state.top,160);assert.equal(responses.at(-1).data.state.loaded,true);assert.equal(responses.at(-1).origin,'https://mooc1.chaoxing.com');assert(!('completed' in responses.at(-1).data.state));
   const face=doc.createElement('div');face.setAttribute('data-face-verification','');doc.body.append(face);send('https://mooc1.chaoxing.com',f.w,'step');assert.match(responses.at(-1).data.error,/人脸/);assert.equal(doc.documentElement.scrollTop,160);
  }finally{f.close();}
 });
 await test('跨域PPT子脚本晚加载时重发同一请求并正常读取',async()=>{
  const f=fixture([{tabs:[ppt()]}]);try{
   const c=f.doc.querySelector('[data-course-task]');c.innerHTML='<div id="img" class="imglook"><iframe id="panView" src="https://mooc1.chaoxing.com/mooc-ans/screen/file/mock"></iframe></div>';
   const frame=c.querySelector('iframe'),child=frame.contentWindow,ids=[];let attempts=0;
   child.postMessage=(data,origin)=>{if(origin!=='https://pan-yz.chaoxing.com')return;attempts++;ids.push(data.id);if(attempts<3)return;f.w.dispatchEvent(new f.w.MessageEvent('message',{origin,source:child,data:{channel:data.channel,kind:'result',id:data.id,state:{loaded:true,top:0,height:200,total:1000}}}));};
   const state=await f.api.courseDocumentBridgeRequest(frame,'read',null,1200);assert.equal(attempts,3);assert.equal(new Set(ids).size,1);assert.equal(state.height,200);await delay(270);assert.equal(attempts,3,'完成后仍在重发');
  }finally{f.close();}
 });
 await test('跨域step响应丢失重发同一ID时只滚动一次，变更操作不能复用ID',async()=>{
  const f=fixture([{tabs:[ppt()]}]);try{
   const frame=f.d.createElement('iframe');f.d.body.append(frame);const doc=frame.contentDocument,view=frame.contentWindow;
   Object.defineProperty(doc,'URL',{value:'https://pan-yz.chaoxing.com/screen/v2/file_mock'});
   doc.body.innerHTML='<div class="fileBox"><ul><li><img></li></ul></div>';
   Object.defineProperties(doc.querySelector('img'),{complete:{get:()=>true},naturalWidth:{get:()=>800}});
   Object.defineProperties(doc.documentElement,{clientHeight:{get:()=>200},scrollHeight:{get:()=>1000}});
   const responses=[];f.w.postMessage=data=>responses.push(data);f.api.initCourseDocumentBridge(doc);
   const send=(id,op)=>view.dispatchEvent(new view.MessageEvent('message',{origin:'https://mooc1.chaoxing.com',source:f.w,data:{channel:'cx-ai-document-v1',kind:'request',id,op}}));
   send('one','step');send('one','step');assert.equal(doc.documentElement.scrollTop,160);assert.equal(responses.length,2);assert.equal(responses[1].state.top,160);
   send('one','read');assert.equal(responses.length,2);send('two','step');assert.equal(doc.documentElement.scrollTop,320);assert.equal(doc.documentElement.getAttribute('data-cx-document-bridge'),'v1.07');
  }finally{f.close();}
 });
 await test('跨域PPT重试途中取消或替换阅读器停止发消息',async()=>{
  for(const action of ['abort','replace']){
   const f=fixture([{tabs:[ppt()]}]);try{
    const c=f.doc.querySelector('[data-course-task]');c.innerHTML='<div id="img" class="imglook"><iframe id="panView" src="https://mooc1.chaoxing.com/mooc-ans/screen/file/mock"></iframe></div>';
    const frame=c.querySelector('iframe'),signal=new f.w.AbortController();let attempts=0;frame.contentWindow.postMessage=()=>attempts++;
    const promise=f.api.courseDocumentBridgeRequest(frame,'read',signal.signal,1000);await delay(5);
    if(action==='abort')signal.abort();else frame.remove();
    await assert.rejects(promise,action==='abort'?/取消/:/已切换/);const count=attempts;await delay(270);assert.equal(attempts,count);
   }finally{f.close();}
  }
 });
 // Shared userscript storage mock, asynchronous change events as in separate sandboxes.
 const pptMailboxFixture=f=>{
  const listeners=new Map(),writes=[],children=[];let sequence=0;
  const change=(key,value)=>{
   const old=f.storage.get(key);if(value===undefined)f.storage.delete(key);else f.storage.set(key,JSON.parse(JSON.stringify(value)));
   for(const [id,item]of [...listeners])if(item.key===key)queueMicrotask(()=>{if(listeners.has(id))item.callback(key,old,value,true);});
  };
  f.w.GM_addValueChangeListener=(key,callback)=>{const id=++sequence;listeners.set(id,{key,callback});return id;};
  f.w.GM_removeValueChangeListener=id=>listeners.delete(id);
  f.w.GM_deleteValue=key=>change(key,undefined);
  f.w.GM_setValue=(key,value)=>{writes.push({key,value:JSON.parse(JSON.stringify(value))});change(key,value);};
  const attach=(container,index=0,ack=true)=>{
   container.innerHTML='<div id="img" class="imglook"><iframe id="panView" ></iframe></div>';
   const frame=container.querySelector('iframe'),view=frame.contentWindow,doc=frame.contentDocument;
   const attribute=frame.getAttribute.bind(frame);frame.getAttribute=name=>name==='src'?'https://mooc1.chaoxing.com/mooc-ans/screen/file/mock':attribute(name);
   Object.defineProperty(doc,'URL',{value:'https://pan-yz.chaoxing.com/screen/v2/file_mock'});
   Object.defineProperty(doc,'referrer',{configurable:true,value:'https://mooc1.chaoxing.com/ananas/modules/pdf/index.html'});
   doc.body.innerHTML='<div class="fileBox"><ul><li><img></li></ul></div>';
   Object.defineProperties(doc.querySelector('img'),{complete:{get:()=>true},naturalWidth:{get:()=>800}});
   let top=0;
   Object.defineProperties(doc.documentElement,{clientHeight:{get:()=>200},scrollHeight:{get:()=>1000},scrollTop:{get:()=>top,set:value=>{
    top=Math.max(0,Math.min(800,value));f.events.push(`ppt-scroll:${index}:${top}`);
    if(top===800&&ack){container.setAttribute('data-completed','true');if([...f.doc.querySelectorAll('[data-course-task]')].every(n=>n.getAttribute('data-completed')==='true'))f.d.querySelector('.orangeNew').textContent='0';}
   }}});
   f.api.initCourseDocumentBridge(doc);Object.defineProperty(frame,'contentDocument',{get:()=>null});
   // Simulate privileged MessageEvent.source=null: direct step must be ignored.
   view.postMessage=(data,origin)=>{if(origin!=='https://pan-yz.chaoxing.com')return;queueMicrotask(()=>view.dispatchEvent(new view.MessageEvent('message',{source:null,origin:'https://mooc1.chaoxing.com',data})));};
   children.push(view);return {frame,doc,view,get top(){return top;}};
  };
  return {attach,writes,listeners,cleanup(){children.forEach(view=>view.dispatchEvent(new view.Event('pagehide')));}};
 };
 await test('PPT 私有信箱处理沙箱 source=null，控制实际HTML滚动并清理临时数据',async()=>{
  const f=fixture([{tabs:[ppt()]}]),bus=pptMailboxFixture(f);try{
   const reader=bus.attach(f.doc.querySelector('[data-course-task]'));
   const state=await f.api.courseDocumentBridgeRequest(reader.frame,'step',null,600);
   assert.equal(state.top,160);assert.equal(reader.top,160);await delay(2);
   assert.equal(bus.listeners.size,0);assert(![...f.storage.keys()].some(k=>k.startsWith('cx-ai-ppt-request:')));
   assert(!JSON.stringify(bus.writes).includes('mock-only-key'));assert(!JSON.stringify(bus.writes).includes('https://'));
   const command=bus.writes.find(w=>w.value.kind==='request').value;
   reader.view.dispatchEvent(new reader.view.MessageEvent('message',{source:null,origin:'https://mooc1.chaoxing.com',data:{...command,id:'direct-unauthorized',op:'step'}}));
   assert.equal(reader.top,160,'null source 直接滚动不得执行');
  }finally{bus.cleanup();f.close();}
 });
 await test('同页两个PPT甚至相同文件独立滚动，全部确认后才进入下一章',async()=>{
  const f=fixture([{tabs:[{title:'多个PPT',tasks:[{kind:'ppt'},{kind:'ppt'}]}]},{tabs:[{title:'普通资料',tasks:[]}]}]),bus=pptMailboxFixture(f);try{
   const readers=[...f.doc.querySelectorAll('[data-course-task]')].map((n,i)=>bus.attach(n,i));
   readers.forEach(reader=>assert.equal(f.api.courseDocumentReader(f.doc,reader.frame.closest('[data-course-task]'))?.node,reader.frame,'未找到所属资料阅读器'));
   const r=await f.runner.start();assert.equal(r.status,'done',JSON.stringify({r,events:f.events}));assert.equal(r.documents,2);
   assert.deepEqual(Array.from(r.chapters[0].tasks,t=>t.number),[1,2]);assert(readers.every(reader=>reader.top===800));
   assert(f.events.indexOf('ppt-scroll:1:800')>f.events.indexOf('ppt-scroll:0:800'));
   assert(f.events.indexOf('chapter:1')>f.events.indexOf('ppt-scroll:1:800'));
   const ids=new Set(bus.writes.filter(w=>w.value.kind==='request').map(w=>w.key));assert(ids.size>=10);
   await delay(2);assert.equal(bus.listeners.size,0);
  }finally{bus.cleanup();f.close();}
 });
 await test('第二份PPT到底但平台未确认时停止，不能跳章或算完成',async()=>{
  const f=fixture([{tabs:[{title:'多个PPT',tasks:[{kind:'ppt'},{kind:'ppt'}]}]},{tabs:[video()]}]),bus=pptMailboxFixture(f);try{
   [...f.doc.querySelectorAll('[data-course-task]')].forEach((n,i)=>bus.attach(n,i,i===0));
   const r=await f.runner.start();assert.equal(r.status,'stopped');assert.equal(r.documents,1);assert.match(r.reason,/平台.*未确认/);assert(!f.events.includes('chapter:1'));
  }finally{bus.cleanup();f.close();}
 });
 await test('PPT 信箱拒绝错误referrer，取消及换页清理等待和监听',async()=>{
  const f=fixture([{tabs:[ppt()]}]),bus=pptMailboxFixture(f);try{
   const reader=bus.attach(f.doc.querySelector('[data-course-task]'));
   // Valid referrer is not enough when origin is wrong.
   reader.view.dispatchEvent(new reader.view.MessageEvent('message',{source:null,origin:'https://example.invalid',data:{channel:'cx-ai-document-v1',kind:'bind',id:'spoofed'}}));
   assert.equal(bus.listeners.size,0);
   Object.defineProperty(reader.doc,'referrer',{configurable:true,value:'https://example.invalid/parent'});
   await assert.rejects(f.api.courseDocumentBridgeRequest(reader.frame,'step',null,80),/未响应/);await delay(2);assert.equal(reader.top,0);assert.equal(bus.listeners.size,0);
   reader.view.postMessage=()=>{};
   const signal=new f.w.AbortController(),pending=f.api.courseDocumentBridgeRequest(reader.frame,'step',signal.signal,600);
   signal.abort();await assert.rejects(pending,/取消/);await delay(2);assert.equal(reader.top,0);assert.equal(bus.listeners.size,0);
   const switched=f.api.courseDocumentBridgeRequest(reader.frame,'read',null,600);
   reader.frame.remove();await assert.rejects(switched,/已切换/);await delay(2);assert.equal(bus.listeners.size,0);
  }finally{bus.cleanup();f.close();}
 });
 await test('PPT 滚动响应丢失通过信箱重试，同一step仍只滚动一次',async()=>{
  const f=fixture([{tabs:[ppt()]}]),bus=pptMailboxFixture(f);try{
   const reader=bus.attach(f.doc.querySelector('[data-course-task]'));
   const set=f.w.GM_setValue;let lost=true;
   f.w.GM_setValue=(key,value)=>{if(value.kind==='result'&&lost){lost=false;return;}set(key,value);};
   const state=await f.api.courseDocumentBridgeRequest(reader.frame,'step',null,1000);
   assert.equal(state.top,160);assert.equal(reader.top,160);assert.equal(f.events.filter(e=>e.startsWith('ppt-scroll:')).length,1);
   const ids=bus.writes.filter(w=>w.value.kind==='request').map(w=>w.value.id);assert(ids.length>=2);assert.equal(new Set(ids).size,1);
  }finally{bus.cleanup();f.close();}
 });

 await test('PPT 私有信箱优先内部overflow滚动条，不滚动外部HTML',async()=>{
  const f=fixture([{tabs:[ppt()]}]),bus=pptMailboxFixture(f);try{
   const reader=bus.attach(f.doc.querySelector('[data-course-task]')),box=reader.doc.querySelector('.fileBox');box.style.overflowY='auto';
   Object.defineProperties(box,{clientHeight:{get:()=>200},scrollHeight:{get:()=>1000}});
   const state=await f.api.courseDocumentBridgeRequest(reader.frame,'step',null,600);assert.equal(state.top,160);assert.equal(box.scrollTop,160);assert.equal(reader.top,0);
  }finally{bus.cleanup();f.close();}
 });
 await test('PPT 私有信箱图片尚未加载时不滚动或冒充完成',async()=>{
  const f=fixture([{tabs:[ppt()]}]),bus=pptMailboxFixture(f);try{
   const reader=bus.attach(f.doc.querySelector('[data-course-task]'));
   reader.doc.querySelector('img').remove();reader.doc.querySelector('li').append(reader.doc.createElement('img'));
   const state=await f.api.courseDocumentBridgeRequest(reader.frame,'step',null,600);assert.equal(state.loaded,false);assert.equal(reader.top,0);assert(!('completed' in state));
  }finally{bus.cleanup();f.close();}
 });
 const nestedPPTFixture=(f,container,index=0)=>{
  container.innerHTML='<div id="img" class="imglook"><iframe id="panView"></iframe></div>';
  const frame=container.querySelector('iframe'),doc=frame.contentDocument,child=frame.contentWindow;
  const attribute=frame.getAttribute.bind(frame);frame.getAttribute=name=>name==='src'?'https://mooc1.chaoxing.com/mooc-ans/screen/file/mock':attribute(name);
  Object.defineProperty(doc,'URL',{value:'https://pan-yz.chaoxing.com/screen/v2/file_mock'});
  doc.body.innerHTML='<div class="fileBox"><ul><li><img></li></ul></div>';
  Object.defineProperties(doc.querySelector('img'),{complete:{get:()=>true},naturalWidth:{get:()=>800}});
  let top=0;const parentReplies=[],rootReplies=[];
  Object.defineProperties(doc.documentElement,{clientHeight:{get:()=>200},scrollHeight:{get:()=>1000},scrollTop:{get:()=>top,set:value=>{
   top=value;f.events.push(`nested-ppt:${index}:${top}`);
   if(top===800){container.setAttribute('data-completed','true');if([...f.doc.querySelectorAll('[data-course-task]')].every(n=>n.getAttribute('data-completed')==='true'))f.d.querySelector('.orangeNew').textContent='0';}
  }}});
  f.doc.defaultView.postMessage=data=>parentReplies.push(data);
  f.w.postMessage=(data,origin)=>{rootReplies.push(data);queueMicrotask(()=>f.w.dispatchEvent(new f.w.MessageEvent('message',{data,origin:'https://pan-yz.chaoxing.com',source:child})));};
  child.postMessage=(data,origin)=>{if(origin==='https://pan-yz.chaoxing.com')queueMicrotask(()=>child.dispatchEvent(new child.MessageEvent('message',{data,origin:'https://mooc1.chaoxing.com',source:f.w})));};
  f.api.initCourseDocumentBridge(doc);Object.defineProperty(frame,'contentDocument',{get:()=>null});
  const send=(source,origin,id,op='step')=>child.dispatchEvent(new child.MessageEvent('message',{source,origin,data:{channel:'cx-ai-document-v1',kind:'request',id,op}}));
  return {frame,doc,child,parentReplies,rootReplies,send,get top(){return top;}};
 };
 await test('多层PPT接受顶层请求，回复并监听实际发送窗口',async()=>{
  const f=fixture([{tabs:[ppt()]}]);try{
   const reader=nestedPPTFixture(f,f.doc.querySelector('[data-course-task]'));
   const state=await f.api.courseDocumentBridgeRequest(reader.frame,'step',null,100);assert.equal(state.top,160);assert.equal(reader.rootReplies.length,1);assert.equal(reader.parentReplies.length,0);
   assert.equal(reader.doc.documentElement.getAttribute('data-cx-document-bridge-route'),'ancestor-v2');
  }finally{f.close();}
 });
 await test('多层PPT直属父请求仍回复直属父，不能强制回顶层',async()=>{
  const f=fixture([{tabs:[ppt()]}]);try{
   const reader=nestedPPTFixture(f,f.doc.querySelector('[data-course-task]'));
   reader.send(f.doc.defaultView,'https://mooc1.chaoxing.com','immediate');
   assert.equal(reader.top,160);assert.equal(reader.parentReplies.length,1);assert.equal(reader.rootReplies.length,0);
  }finally{f.close();}
 });
 await test('多层PPT拒绝同源兄弟窗口、自身和错误origin',async()=>{
  const f=fixture([{tabs:[ppt()]}]);try{
   const reader=nestedPPTFixture(f,f.doc.querySelector('[data-course-task]'));
   const sibling=f.d.createElement('iframe');f.d.body.append(sibling);
   reader.send(sibling.contentWindow,'https://mooc1.chaoxing.com','sibling');reader.send(reader.child,'https://mooc1.chaoxing.com','self');reader.send(f.w,'https://example.invalid','bad-origin');
   assert.equal(reader.top,0);assert.equal(reader.parentReplies.length+reader.rootReplies.length,0);
  }finally{f.close();}
 });
 await test('多层PPT重复step仍仅推进一次并回传给实际请求祖先',async()=>{
  const f=fixture([{tabs:[ppt()]}]);try{
   const reader=nestedPPTFixture(f,f.doc.querySelector('[data-course-task]'));
   reader.send(f.w,'https://mooc1.chaoxing.com','repeat');reader.send(f.w,'https://mooc1.chaoxing.com','repeat');
   assert.equal(reader.top,160);assert.equal(reader.rootReplies.length,2);assert.equal(reader.parentReplies.length,0);
  }finally{f.close();}
 });
 await test('多层PPT在中间文档收到回复不能冒充顶层请求成功',async()=>{
  const f=fixture([{tabs:[ppt()]}]);try{
   const reader=nestedPPTFixture(f,f.doc.querySelector('[data-course-task]'));let request;
   reader.child.postMessage=(data,origin)=>{if(origin==='https://pan-yz.chaoxing.com')request=data;};
   const pending=f.api.courseDocumentBridgeRequest(reader.frame,'read',null,150);let settled=false;pending.then(()=>settled=true);
   const response={channel:'cx-ai-document-v1',kind:'result',id:request.id,state:{loaded:true,top:0,height:200,total:1000}};
   f.doc.defaultView.dispatchEvent(new f.doc.defaultView.MessageEvent('message',{source:reader.child,origin:'https://pan-yz.chaoxing.com',data:response}));await delay(2);assert.equal(settled,false);
   f.w.dispatchEvent(new f.w.MessageEvent('message',{source:reader.child,origin:'https://pan-yz.chaoxing.com',data:response}));assert.equal((await pending).loaded,true);
  }finally{f.close();}
 });

 await test('隐藏的完成标记不能跳过仍未完成的视频',async()=>{
  const f=fixture([{tabs:[video()]}]);try{const c=f.doc.querySelector('[data-course-task]');c.insertAdjacentHTML('beforeend','<span class="icon_Completed" hidden></span>');const r=await f.runner.start();assert.equal(r.status,'done');assert.equal(r.videos,1);assert(f.events.includes('play:0:0:0'));}finally{f.close();}
 });
 await test('无任务资料中的隐藏任务标记不能强制播放',async()=>{
  const f=fixture([{tabs:[video({optional:true})]}]);try{const c=f.doc.querySelector('[data-course-task]');c.removeAttribute('data-course-task');c.removeAttribute('data-required');c.className='ans-attach-ct';c.insertAdjacentHTML('beforeend','<div hidden><span class="ans-job-icon"></span></div>');const r=await f.runner.start();assert.equal(r.status,'done');assert.equal(r.chapters[0].status,'no-tasks');assert.equal(r.videos,0);assert(!f.events.some(e=>e.startsWith('play:')));}finally{f.close();}
 });
 await test('视频播放中延迟出现的第二个任务仍继续处理',async()=>{
  const f=fixture([{tabs:[{title:'混合任务',tasks:[{kind:'video',duration:5},{kind:'ppt'}]}]}]);try{const late=f.doc.querySelectorAll('[data-course-task]')[1];late.remove();const p=f.runner.start();await delay(15);f.doc.body.append(late);const r=await p;assert.equal(r.status,'done');assert.equal(r.videos,1);assert.equal(r.documents,1);}finally{f.close();}
 });
 await test('单页PPT没有滚动距离时仍能等待平台完成，不报加载失败',async()=>{
  const f=fixture([{tabs:[{title:'PPT',tasks:[{kind:'scroll'}]}]}]);try{const c=f.doc.querySelector('[data-course-task]');Object.defineProperties(f.doc.documentElement,{clientHeight:{get:()=>200},scrollHeight:{get:()=>200},scrollTop:{get:()=>0,set(){}}});c.firstChild.style.overflowY='visible';const p=f.runner.start();await delay(12);c.setAttribute('data-completed','true');f.d.querySelector('.orangeNew').textContent='0';const r=await p;assert.equal(r.status,'done');assert.equal(r.documents,1);}finally{f.close();}
 });
 await test('隐藏的分页资料控件不进入任务队列',async()=>{
  const f=fixture([{tabs:[ppt()]}]);try{f.doc.querySelector('[data-course-task]').hidden=true;const reader=f.api.courseDocumentReader(f.doc);assert.equal(reader,null);}finally{f.close();}
 });
 await test('分页PPT反复回到首页时按阅读总时限停止',async()=>{
  const f=fixture([{tabs:[ppt({nextOnly:true})]}]);let safety;try{const r2=f.api.createCourseRunner(f.d,f.api.controller,{limits:{...LIMITS,documentMs:25}});let clicks=0;const counter=f.doc.querySelector('[data-slide-current]');f.doc.querySelector('[data-slide-next]').onclick=()=>{clicks++;counter.value='2';f.w.setTimeout(()=>{if(counter.isConnected)counter.value='1';},0);};safety=setTimeout(()=>r2.stop('防止测试挂起'),150);const r=await r2.start({continueOnTimeout:false});assert.equal(r.status,'stopped');assert.match(r.reason,/阅读超时/);assert.equal(r.documents,0);assert(clicks>1);}finally{clearTimeout(safety);f.close();}
 });
 await test('首次资料控件延迟加载时等待控件，不当作普通文字或立即停止',async()=>{
  const f=fixture([{tabs:[{title:'PPT',tasks:[{kind:'ppt'}]}]}]);try{const c=f.doc.querySelector('[data-course-task]'),reader=c.firstChild;reader.remove();c.textContent='正在加载资料';const p=f.runner.start();await delay(15);c.replaceChildren(reader);const r=await p;assert.equal(r.status,'done');assert.equal(r.documents,1);}finally{f.close();}
 });
 await test('第一任务完成后的等待间隙出现新任务，也继续处理',async()=>{
  const f=fixture([{tabs:[{title:'混合任务',tasks:[{kind:'video'},{kind:'ppt'}]}]}]);try{const late=f.doc.querySelectorAll('[data-course-task]')[1];late.remove();const p=f.runner.start();for(let i=0;i<100&&f.runner.report?.chapters[0].tasks[0]?.status!=='done';i++)await delay(1);assert.equal(f.runner.report.chapters[0].tasks[0].status,'done');await delay(3);f.doc.body.append(late);const r=await p;assert.equal(r.status,'done');assert.equal(r.videos,1);assert.equal(r.documents,1);}finally{f.close();}
 });
 await test('目录行内隐藏完成模板不跳过本章，目录折叠不丢失真实状态',async()=>{
  const f=fixture([{tabs:[video()]}]);try{f.d.querySelector('#cur1').insertAdjacentHTML('beforeend','<span class="icon_Completed" hidden></span>');f.d.querySelector('#coursetree ul').style.display='none';const r=await f.runner.start();assert.equal(r.status,'done');assert.equal(r.videos,1);assert.equal(r.chapters[0].status,'done');}finally{f.close();}
 });
 // 独立审查确认的边界与运行锁回归；共享存储不包含真实账户数据。
 await test('空附件壳先出现，真实任务标记和视频或PPT晚到仍可完成',async()=>{
  for(const page of [video(),ppt()]){
   const f=fixture([{tabs:[page]}]);let timer;
   try{
    const c=f.doc.querySelector('[data-course-task]'),content=c.firstChild;
    content.remove();c.removeAttribute('data-course-task');c.removeAttribute('data-completed');c.className='ans-attach-ct';
    const p=f.runner.start();timer=setTimeout(()=>{c.insertAdjacentHTML('afterbegin','<span class="ans-job-icon"></span>');c.append(content);},12);
    const r=await p;assert.equal(r.status,'done',r.reason);assert.equal(r.videos+r.documents,1);assert(!r.chapters[0].tasks.some(t=>t.type==='non-task'));
   }finally{clearTimeout(timer);f.close();}
  }
 });
 await test('未加载的空附件壳超时停止，不假报无任务或完成',async()=>{
  const f=fixture([{tabs:[{title:'附件',tasks:[{kind:'video'}]}]}]);try{
   const c=f.doc.querySelector('[data-course-task]');c.replaceChildren();c.removeAttribute('data-course-task');c.removeAttribute('data-completed');c.className='ans-attach-ct';
   const r=await f.runner.start();assert.equal(r.status,'stopped');assert.match(r.reason,/控件未适配或仍未加载/);assert.equal(r.videos,0);assert(!r.chapters[0].tasks.some(t=>t.type==='non-task'));
  }finally{f.close();}
 });
 const shareStorage=(a,b)=>{b.w.GM_getValue=(key,fallback)=>a.storage.has(key)?a.storage.get(key):fallback;b.w.GM_setValue=(key,value)=>a.storage.set(key,JSON.parse(JSON.stringify(value)));};
 const makePair=()=>{
  const a=fixture([{tabs:[video({duration:300})]}],{limits:{stallMs:10000}});
  const b=fixture([{tabs:[video({duration:300})]}],{session:a.w.sessionStorage.getItem('cx-ai-course-session'),noAutoResume:true,limits:{stallMs:10000}});
  shareStorage(a,b);return [a,b];
 };
 await test('同会话两个窗口共享GM存储，第二窗口不能重复启动同一课程',async()=>{
  const [a,b]=makePair();let ap;
  try{
   ap=a.runner.start();for(let i=0;i<50&&!a.events.some(e=>e.startsWith('play:'));i++)await delay(2);
   assert(a.runner.busy);const saved=JSON.stringify(a.storage.get(a.runner.key));const r=await b.runner.start();
   assert.equal(r,undefined);assert.equal(b.runner.busy,false);assert(!b.events.some(e=>e.startsWith('play:')));assert.equal(JSON.stringify(a.storage.get(a.runner.key)),saved);
  }finally{a.runner.stop();b.runner.stop();await ap;a.close();b.close();}
 });
 await test('复制同会话页面不自动恢复正在原窗口运行的课程',async()=>{
  const [a,b]=makePair();let ap;
  try{
   ap=a.runner.start();await delay(8);assert(a.runner.busy);assert.equal(await b.runner.resumeIfNeeded(),undefined);assert.equal(b.runner.busy,false);assert.equal(b.events.length,0);
  }finally{a.runner.stop();b.runner.stop();await ap;a.close();b.close();}
 });
 await test('运行记录被其他实例接管时停止，不能覆盖接管者记录',async()=>{
  const f=fixture([{tabs:[video({duration:300})]}],{limits:{stallMs:10000}});let p;
  try{
   p=f.runner.start();await delay(8);assert(f.runner.busy);
   const winner={...f.storage.get(f.runner.key),ownerId:'mock-other-document',heartbeat:Date.now()};f.storage.set(f.runner.key,winner);
   for(let i=0;i<50&&f.runner.busy;i++)await delay(2);
   assert.equal(f.runner.busy,false);const r=await p;assert.equal(r.status,'stopped');assert.match(r.reason,/运行锁已失效/);assert.equal(f.storage.get(f.runner.key).ownerId,'mock-other-document');
  }finally{f.runner.stop();await p;f.close();}
 });
 const fakeLocks=()=>{
  const held=new Set(),calls=[];
  return {held,calls,async request(name,options,callback){assert.equal(options.ifAvailable,true);calls.push(name);if(held.has(name))return callback(null);held.add(name);try{return await callback({name});}finally{held.delete(name);}}};
 };
 await test('浏览器课程互斥锁阻止同时启动，结束后释放且可重新开始',async()=>{
  const [a,b]=makePair(),locks=fakeLocks();let ap,bp;
  Object.defineProperty(a.w.navigator,'locks',{value:locks});Object.defineProperty(b.w.navigator,'locks',{value:locks});
  try{
   ap=a.runner.start();assert.equal(await b.runner.start(),undefined);assert.equal(locks.held.size,1);assert.equal(locks.calls.length,2);assert.equal(b.events.length,0);
   a.runner.stop();await ap;assert.equal(locks.held.size,0);
   bp=b.runner.start();await delay(8);assert(b.runner.busy);assert(b.events.some(e=>e.startsWith('play:')));
  }finally{a.runner.stop();b.runner.stop();await Promise.all([ap,bp]);a.close();b.close();assert.equal(locks.held.size,0);}
 });
 await test('互斥锁按课程独立，没有添加不同课程间的限制',async()=>{
  const a=fixture([{tabs:[video({duration:300})]}],{limits:{stallMs:10000}});
  const b=fixture([{tabs:[video({duration:300})]}],{url:'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=mock-other-course&clazzid=mock-class&cpi=mock-account',noAutoResume:true,limits:{stallMs:10000}});
  const locks=fakeLocks();let ap,bp;shareStorage(a,b);Object.defineProperty(a.w.navigator,'locks',{value:locks});Object.defineProperty(b.w.navigator,'locks',{value:locks});
  try{
   ap=a.runner.start();bp=b.runner.start();await delay(8);assert(a.runner.busy&&b.runner.busy);assert.equal(locks.held.size,2);assert.notEqual(locks.calls[0],locks.calls[1]);
  }finally{a.runner.stop();b.runner.stop();await Promise.all([ap,bp]);a.close();b.close();}
 });
 await test('失效的旧运行记录可由手动开始接管，不沿用旧会话',async()=>{
  const f=fixture([{tabs:[video()]}]);try{
   f.storage.set(f.runner.key,{status:'running',ownerId:'old-document',session:'old-session',heartbeat:Date.now()-16000});const r=await f.runner.start();
   assert.equal(r.status,'done',r.reason);assert.equal(r.videos,1);assert.notEqual(f.storage.get(f.runner.key).ownerId,'old-document');assert.equal(f.storage.get(f.runner.key).handoff,false);
  }finally{f.close();}
 });
 await test('浏览器锁释放后，原生导航交接仍能在新页面续接原队列',async()=>{
  const locks=fakeLocks(),first=fixture([{tabs:[video()]},{tabs:[video()]}],{navigateOut:true});let stored,session;
  Object.defineProperty(first.w.navigator,'locks',{value:locks});
  try{
   const r=await first.runner.start();assert.equal(r.status,'running');assert.equal(r.videos,1);assert.equal(locks.held.size,0);
   assert.equal(first.storage.get(first.runner.key).handoff,true);stored=[...first.storage];session=first.w.sessionStorage.getItem('cx-ai-course-session');
  }finally{first.close();}
  const next=fixture([{tabs:[video()]},{tabs:[video()]}],{storage:stored,session,noAutoResume:true});Object.defineProperty(next.w.navigator,'locks',{value:locks});
  try{const r=await next.runner.resumeIfNeeded();assert.equal(r.status,'done',r.reason);assert.equal(r.videos,2);assert.equal(locks.held.size,0);assert.equal(next.storage.get(next.runner.key).handoff,false);}finally{next.close();}
 });
 // 主页面 #workpop 的结构来自只读现场 DOM；不包含账户或 API 信息。
 await test('内层章节测验在主页面确认提交，成功后才进入下一章',()=>runWith([
  {tabs:[quiz({confirm:true,confirmAt:'owner'})]},{tabs:[video()]}
 ],{},(f,r)=>{assert.equal(r.status,'done',r.reason);assert.equal(r.quizzes,1);assert.equal(f.submits,1);assert.equal(f.events.filter(x=>x==='confirm').length,1);assert(f.events.indexOf('confirm')<f.events.indexOf('chapter:1'));}));
 await test('主页面确认只点一次，没有成功回报不跳章',()=>runWith([
  {tabs:[quiz({confirm:true,confirmAt:'owner'})]},{tabs:[video()]}
 ],{submitNoAck:true},(f,r)=>{assert.equal(r.status,'stopped');assert.match(r.reason,/未收到成功状态/);assert.equal(r.quizzes,0);assert.equal(f.submits,1);assert.equal(f.events.filter(x=>x==='confirm').length,1);assert(!f.events.includes('chapter:1'));}));
 await test('已有可见提交确认窗口禁止重新启动提交',async()=>{
  const f=fixture([{tabs:[quiz()]}]);try{
   const pop=f.d.createElement('div');pop.className='popDiv';pop.innerHTML='确认提交？<button>提交</button>';let clicks=0;pop.querySelector('button').onclick=()=>clicks++;f.d.body.append(pop);
   const r=await f.runner.start();assert.equal(r.status,'stopped');assert.match(r.reason,/已有提交确认窗口/);assert.equal(f.submits,0);assert.equal(clicks,0);
  }finally{f.close();}
 });
 await test('只搜索当前测验父链，忽略兄弟测验确认弹窗',async()=>{
  const f=fixture([{tabs:[quiz({confirm:true,confirmAt:'owner'})]}]);try{
   const other=f.d.createElement('iframe');f.d.body.append(other);other.contentDocument.body.innerHTML='<div class="popDiv">确认提交？<button>提交</button></div>';let clicks=0;other.contentDocument.querySelector('button').onclick=()=>clicks++;
   const r=await f.runner.start();assert.equal(r.status,'done',r.reason);assert.equal(r.quizzes,1);assert.equal(clicks,0);
  }finally{f.close();}
 });
 await test('延迟出现的主页面确认窗口仍可处理',async()=>{
  const f=fixture([{tabs:[quiz({confirm:true,confirmAt:'owner'})]}]);try{
   const button=f.doc.querySelector('[data-quiz-submit]'),click=button.onclick;let timer;
   button.onclick=()=>{click();const pop=f.d.getElementById('workpop');pop.hidden=true;timer=setTimeout(()=>pop.hidden=false,15);};
   const r=await f.runner.start();clearTimeout(timer);assert.equal(r.status,'done',r.reason);assert.equal(f.events.filter(x=>x==='confirm').length,1);
  }finally{f.close();}
 });
 await test('多个父页面提交确认入口停止，不猜测或重复提交',async()=>{
  const f=fixture([{tabs:[quiz({confirm:true,confirmAt:'owner'})]}]);try{
   const button=f.doc.querySelector('[data-quiz-submit]'),click=button.onclick;let confirmed=0;
   button.onclick=()=>{click();const extra=f.d.createElement('button');extra.textContent='确认提交';extra.onclick=()=>confirmed++;f.d.querySelector('#workpop .popBottom').append(extra);};
   const r=await f.runner.start();assert.equal(r.status,'stopped');assert.match(r.reason,/多个提交确认入口/);assert.equal(confirmed,0);assert(!f.events.includes('confirm'));assert.equal(f.submits,1);
  }finally{f.close();}
 });
 await test('确认窗口隐藏、禁用、验证码和取消按钮不会被点击，嵌套容器去重',async()=>{
  const f=fixture([{tabs:[quiz()]}]);try{
   const pop=f.d.createElement('div');pop.setAttribute('role','dialog');pop.innerHTML='<div class="popDiv">确认提交？<a role="button" aria-disabled="true">提交</a><button>取消</button><button hidden>确认</button></div>';f.d.body.append(pop);
   assert.equal(f.api.courseSubmitConfirmation(f.doc,f.d).length,0);
   pop.querySelector('a').removeAttribute('aria-disabled');assert.equal(f.api.courseSubmitConfirmation(f.doc,f.d).length,1);
   pop.hidden=true;assert.equal(f.api.courseSubmitConfirmation(f.doc,f.d).length,0);pop.hidden=false;
   pop.querySelector('.popDiv').prepend(f.d.createTextNode('验证码'));assert.equal(f.api.courseSubmitConfirmation(f.doc,f.d).length,0);
  }finally{f.close();}
 });
 await test('中间父 iframe 提交确认仍可找到，不越过指定 owner',async()=>{
  const f=fixture([{tabs:[quiz()]}]);try{
   const parent=f.doc,inner=parent.createElement('iframe');parent.body.append(inner);
   parent.body.insertAdjacentHTML('beforeend','<div class="popDiv">确认提交？<button>提交</button></div>');
   assert.equal(f.api.courseSubmitConfirmation(inner.contentDocument,f.d).length,1);
   assert.equal(f.api.courseSubmitConfirmation(inner.contentDocument).length,0);
   f.d.body.insertAdjacentHTML('beforeend','<div class="popDiv">确认提交？<button>提交</button></div>');
   assert.equal(f.api.courseSubmitConfirmation(inner.contentDocument,parent).length,1);
   assert.equal(f.api.courseSubmitConfirmation(inner.contentDocument,f.d).length,2);
  }finally{f.close();}
 });
 // 提交导航的瞬时不可读状态来自现场停止原因；使用模拟完成回报。
 for(const mode of ['null','throw','ancestor'])await test(`测验确认后 ${mode} iframe 短暂不可读，恢复后自动下一章`,async()=>{
  const f=fixture([{tabs:[quiz({confirm:true,confirmAt:'owner'})]},{tabs:[video()]}]);let timer;
  try{
   let doc=f.doc;
   if(mode==='ancestor'){
    const inner=doc.createElement('iframe');doc.body.append(inner);inner.contentDocument.body.append(doc.querySelector('[data-course-task]'));doc=inner.contentDocument;
   }
   const frame=f.d.getElementById('iframe'),original=frame.contentDocument,button=doc.querySelector('[data-quiz-submit]'),click=button.onclick;let unavailable=false;
   Object.defineProperty(frame,'contentDocument',{configurable:true,get:()=>{if(unavailable){if(mode==='throw')throw new f.w.DOMException('navigation','SecurityError');return null;}return original;}});
   button.onclick=()=>{click();const ok=f.d.getElementById('popok'),confirm=ok.onclick;ok.onclick=()=>{confirm();unavailable=true;timer=setTimeout(()=>{unavailable=false;f.events.push('result-ready');},20);};};
   const r=await f.runner.start();assert.equal(r.status,'done',r.reason);assert.equal(r.quizzes,1);assert.equal(r.videos,1);assert.equal(f.submits,1);assert.equal(f.events.filter(x=>x==='confirm').length,1);assert(f.events.indexOf('result-ready')<f.events.indexOf('chapter:1'));
  }finally{clearTimeout(timer);f.close();}
 });
 await test('第一次提交立即触发 iframe 导航时仍等待结果，不重复提交',async()=>{
  const f=fixture([{tabs:[quiz()]},{tabs:[video()]}]);let timer;
  try{
   const doc=f.doc,frame=doc.defaultView.frameElement,button=doc.querySelector('[data-quiz-submit]'),click=button.onclick;let unavailable=false;
   Object.defineProperty(frame,'contentDocument',{configurable:true,get:()=>unavailable?null:doc});
   button.onclick=()=>{click();unavailable=true;timer=setTimeout(()=>unavailable=false,20);};
   const r=await f.runner.start();assert.equal(r.status,'done',r.reason);assert.equal(r.quizzes,1);assert.equal(f.submits,1);assert.equal(r.videos,1);
  }finally{clearTimeout(timer);f.close();}
 });
 await test('提交后 iframe 永久不可读则超时停止，不假报成功或下一章',async()=>{
  const f=fixture([{tabs:[quiz({confirm:true,confirmAt:'owner'})]},{tabs:[video()]}]);
  try{
   const frame=f.d.getElementById('iframe'),doc=f.doc,button=doc.querySelector('[data-quiz-submit]'),click=button.onclick;
   button.onclick=()=>{click();const ok=f.d.getElementById('popok'),confirm=ok.onclick;ok.onclick=()=>{confirm();Object.defineProperty(frame,'contentDocument',{configurable:true,get:()=>null});};};
   const r=await f.runner.start();assert.equal(r.status,'stopped');assert.match(r.reason,/未收到成功状态/);assert.equal(r.quizzes,0);assert(!f.events.includes('chapter:1'));assert.equal(f.submits,1);assert.equal(f.runner.canSkip,false);
  }finally{f.close();}
 });
 await test('提交期间其他任务 iframe 不可读仍立即停止',async()=>{
  const f=fixture([{tabs:[quiz({confirm:true,confirmAt:'owner'})]},{tabs:[video()]}]);
  try{
   const button=f.doc.querySelector('[data-quiz-submit]'),click=button.onclick;
   button.onclick=()=>{click();const ok=f.d.getElementById('popok'),confirm=ok.onclick;ok.onclick=()=>{confirm();const other=f.doc.createElement('iframe');f.doc.body.append(other);Object.defineProperty(other,'contentDocument',{get:()=>null});};};
   const r=await f.runner.start();assert.equal(r.status,'stopped');assert.match(r.reason,/跨域/);assert.equal(r.quizzes,0);assert(!f.events.includes('chapter:1'));
  }finally{f.close();}
 });
 for(const mode of ['face','chapter'])await test(`提交 iframe 加载期间 ${mode} 检查仍生效`,async()=>{
  const f=fixture([{tabs:[quiz({confirm:true,confirmAt:'owner'})]},{tabs:[video()]}]);
  try{
   const frame=f.d.getElementById('iframe'),button=f.doc.querySelector('[data-quiz-submit]'),click=button.onclick;
   button.onclick=()=>{click();const ok=f.d.getElementById('popok'),confirm=ok.onclick;ok.onclick=()=>{confirm();Object.defineProperty(frame,'contentDocument',{get:()=>null});
    if(mode==='face'){const face=f.d.createElement('div');face.setAttribute('data-face-verification','');f.d.body.append(face);}
    else{f.d.querySelector('#cur1').classList.remove('posCatalog_active');f.d.querySelector('#cur2').classList.add('posCatalog_active');}
   };};
   const r=await f.runner.start();assert.equal(r.status,'stopped');assert.match(r.reason,mode==='face'?/人脸/:/切换了章节/);assert.equal(r.quizzes,0);assert(!f.events.includes('chapter:1'));
  }finally{f.close();}
 });

 await test('学习开关默认值、保存和新页面恢复',async()=>{
  const controls=[['course-auto-submit','cx_course_auto_submit',true],['course-skip-learned','cx_course_skip_learned',true],['course-from-current','cx_course_from_current',false],['course-timeout-next','cx_course_timeout_next',true],['course-mute-video','cx_course_mute_video',true]];
  const f=fixture([{tabs:[video()]}]);let saved;
  try{const s=f.d.getElementById('cx-ai-study-root').shadowRoot;for(const [id,key,def] of controls){const t=s.getElementById(id);assert.equal(t.checked,def);t.checked=!def;t.dispatchEvent(new f.w.Event('change'));assert.equal(f.storage.get(key),!def);}saved=Array.from(f.storage.entries());assert(s.getElementById('github').querySelector('svg'));assert.equal(s.getElementById('github').textContent,'');assert.equal(s.getElementById('github').getAttribute('aria-label'),'GitHub 项目主页');}finally{f.close();}
  const f2=fixture([{tabs:[video()]}],{storage:saved});try{const s=f2.d.getElementById('cx-ai-study-root').shadowRoot;for(const [id,key,def] of controls)assert.equal(s.getElementById(id).checked,!def);}finally{f2.close();}
 });
 await test('视频默认静音在播放前生效，多个视频均静音',async()=>{
  const f=fixture([{tabs:[{title:'视频',tasks:[{kind:'video'},{kind:'video'}]}]}]);
  try{for(const v of f.videos){const play=v.play;v.play=()=>{assert(v.muted);return play();};}const r=await f.runner.start();assert.equal(r.videos,2);assert(f.videos.every(v=>v.muted));assert.equal(f.storage.get(f.runner.key).muteVideo,true);}finally{f.close();}
 });
 await test('关闭静音后正常有声播放，恢复沿用运行静音配置',async()=>{
  const chapters=[{tabs:[video({stall:true})]}],f=fixture(chapters);
  try{f.videos[0].muted=true;const pending=f.runner.start({muteVideo:false});for(let i=0;i<50&&!f.events.some(e=>e.startsWith('play:'));i++)await delay(2);assert.equal(f.videos[0].muted,false);f.runner.stop();await pending;assert.equal(f.storage.get(f.runner.key).muteVideo,false);chapters[0].tabs[0].tasks[0].stall=false;const r=await f.runner.start({resume:true,muteVideo:true});assert.equal(r.videos,1);assert.equal(f.videos.at(-1).muted,false);assert.equal(f.storage.get(f.runner.key).muteVideo,false);}finally{f.close();}
 });
 await test('界面静音选项传入运行且运行时禁用',async()=>{
  const f=fixture([{tabs:[video()]}],{storage:[['cx_course_mute_video',false]]});
  try{const s=f.d.getElementById('cx-ai-study-root').shadowRoot,t=s.getElementById('course-mute-video');assert(!t.checked);s.getElementById('course-start').click();for(let i=0;i<50&&!f.runner.busy;i++)await delay(2);assert(t.disabled);assert.equal(f.storage.get(f.runner.key).muteVideo,false);for(let i=0;i<200&&f.runner.report.status==='running';i++)await delay(5);assert.equal(f.runner.report.status,'done');assert(!t.disabled);assert(f.videos.every(v=>!v.muted));}finally{f.close();}
 });

 // Controlled reader geometry and acknowledgements: no production completion writes.
 const scrollHarness=(configs=[{}],options={})=>{
  const f=fixture([{tabs:[{title:'多个PPT',tasks:configs.map(()=>({kind:'ppt'}))}]},{tabs:[{title:'文字资料',tasks:[]}]}],options);
  const readers=[...f.doc.querySelectorAll('[data-course-task]')].map((container,index)=>{
   container.innerHTML='<div class="continuous-reader" style="overflow-y:auto;scroll-behavior:smooth!important"><img id="img" class="imglook" src="data:image/png;base64,AA=="><img src="data:image/png;base64,AA=="></div>';
   const node=container.firstChild,state={top:0,height:200,total:1000,pending:0,writes:[],ack:true,...configs[index]};
   const acknowledge=()=>{container.setAttribute('data-completed','true');if([...f.doc.querySelectorAll('[data-course-task]')].every(n=>n.getAttribute('data-completed')==='true'))f.d.querySelector('.orangeNew').textContent='0';};
   [...node.querySelectorAll('img')].forEach((img,i)=>Object.defineProperties(img,{complete:{get:()=>i===0||!state.pending},naturalWidth:{get:()=>i===0||!state.pending?800:0}}));
   Object.defineProperties(node,{clientHeight:{get:()=>state.height},scrollHeight:{get:()=>state.total},scrollTop:{get:()=>state.top,set:value=>{
    state.writes.push({requested:value,behavior:node.style.getPropertyValue('scroll-behavior'),priority:node.style.getPropertyPriority('scroll-behavior')});
    if(!state.blocked)state.top=Math.max(0,Math.min(state.total-state.height,value,state.cap??Infinity));
    f.events.push(`ppt-position:${index}:${state.top}`);state.onWrite?.(value,state,acknowledge);
    if(state.ack&&!state.pending&&state.top===state.total-state.height)acknowledge();
   }}});
   return {node,state,container,acknowledge};
  });return {f,readers};
 };
 await test('长PPT直接到真正底部，滚动次数与页数无关且恢复平滑样式',async()=>{
  for(const total of [1000,44000]){const {f,readers:[{node,state}]}=scrollHarness([{total}]);try{
   const r=await f.runner.start();assert.equal(r.status,'done');assert.equal(r.documents,1);assert.equal(state.writes[0].requested,total);assert.equal(state.top,total-200);assert(state.writes.length<=6);
   assert(state.writes.every(w=>w.behavior==='auto'&&w.priority==='important'));assert.equal(node.style.getPropertyValue('scroll-behavior'),'smooth');assert.equal(node.style.getPropertyPriority('scroll-behavior'),'important');
   assert.equal(r.chapters[0].tasks[0].documentState.distance,0);assert(f.api.courseReportText(r).includes('资料状态记录'));assert(!f.d.getElementById('cx-ai-study-root').shadowRoot.getElementById('status').textContent.includes('距底部'));
  }finally{f.close();}}
 });
 await test('1.5px末尾残余也精确校正到底，异常时恢复原样式',async()=>{
  const {f,readers:[{node,state}]}=scrollHarness([{top:798.5}]);try{
   const r=await f.runner.start();assert.equal(r.status,'done');assert.equal(state.writes[0].requested,1000);assert.equal(state.top,800);
   const bad=f.doc.createElement('div');bad.style.setProperty('scroll-behavior','smooth','important');Object.defineProperties(bad,{scrollHeight:{get:()=>100},scrollTop:{set(){throw Error('拒绝滚动')}}});
   assert.throws(()=>f.api.courseScrollToBottom(bad),/拒绝滚动/);assert.equal(bad.style.getPropertyValue('scroll-behavior'),'smooth');assert.equal(bad.style.getPropertyPriority('scroll-behavior'),'important');
  }finally{f.close();}
 });
 await test('等待平台确认期间延迟增长高度仍补滚，确认等待从新底部重计',async()=>{
  const {f,readers:[{state,acknowledge}]}=scrollHarness([{ack:false}],{limits:{completionMs:400}});let timer;
  try{const p=f.runner.start();for(let i=0;i<100&&(f.runner.report?.chapters[0].tasks[0]?.bottomCorrections||0)<4;i++)await delay(1);
   await delay(180);state.total=1600;state.onWrite=(value,s)=>{if(s.top===1400&&!timer)timer=setTimeout(acknowledge,300);};
   const r=await p;assert.equal(r.status,'done',r.reason);assert.equal(state.top,1400);assert.equal(r.documents,1);assert(f.events.includes('ppt-position:0:1400'));
  }finally{clearTimeout(timer);f.close();}
 });
 await test('首图已加载但中间图片懒加载时快速回退遍历，再确认底部',async()=>{
  const {f,readers:[{state}]}=scrollHarness([{pending:1,onWrite:(value,s)=>{if(s.top>=360&&s.top<800)s.pending=0;}}]);try{
   const r=await f.runner.start();assert.equal(r.status,'done',r.reason);assert.equal(r.documents,1);assert.equal(r.chapters[0].tasks[0].fallbackPasses,1);
   assert.equal(state.writes[0].requested,1000);assert(state.writes.some(w=>w.requested===0));assert(state.writes.some(w=>w.requested===180));assert.equal(state.top,800);
  }finally{f.close();}
 });
 await test('懒加载失败最多回退两轮，平台标记不能掩盖未加载图片',async()=>{
  const {f,readers:[{state,acknowledge}]}=scrollHarness([{pending:1}]);try{
   const p=f.runner.start();for(let i=0;i<100&&!state.writes.length;i++)await delay(1);acknowledge();const r=await p;
   assert.equal(r.status,'stopped');assert.equal(r.documents,0);assert.equal(r.chapters[0].tasks[0].fallbackPasses,2);assert.match(r.reason,/图片未加载/);
  }finally{f.close();}
 });
 await test('被钳制或无响应的滚动不能算到底，即使平台显示完成',async()=>{
  for(const config of [{cap:300},{blocked:true}]){const {f,readers:[{acknowledge}]}=scrollHarness([config],{limits:{loadMs:35}});try{
   const p=f.runner.start();await delay(8);acknowledge();const r=await p;assert.equal(r.status,'stopped');assert.equal(r.documents,0);assert.match(r.reason,/滚动没有响应/);assert(!f.events.includes('chapter:1'));
  }finally{f.close();}}
 });
 await test('图片加载统计只含当前阅读器，不混入目录工具栏和另一份PPT',async()=>{
  const {f,readers:[a,b]}=scrollHarness([{}, {pending:1}]);try{
   f.doc.body.insertAdjacentHTML('beforeend','<img src="broken-toolbar">');const state=f.api.courseDocumentScrollState(a.node,a.node);assert.equal(state.imageCount,2);assert.equal(state.pendingImages,0);
   assert.equal(f.api.courseDocumentScrollState(b.node,b.node).pendingImages,1);
  }finally{f.close();}
 });
 await test('同页两份PPT分别校正到底，第二份未确认则不进入下一章',async()=>{
  const {f,readers:[a,b]}=scrollHarness([{}, {total:2400,ack:false}]);try{
   const r=await f.runner.start();assert.equal(r.status,'stopped');assert.equal(r.documents,1);assert.equal(a.state.top,800);assert.equal(b.state.top,2200);assert(!f.events.includes('chapter:1'));
   assert(r.chapters[0].tasks.every(t=>t.bottomCorrections>=3));assert.match(r.reason,/平台尚未确认/);
  }finally{f.close();}
 });
 await test('跨域bottom指令支持重试去重、拒绝错误来源并回读实际位置',async()=>{
  const f=fixture([{tabs:[ppt()]}]),bus=pptMailboxFixture(f);try{
   const reader=bus.attach(f.doc.querySelector('[data-course-task]'));
   const set=f.w.GM_setValue;let lost=true;f.w.GM_setValue=(key,value)=>{if(value.kind==='result'&&lost){lost=false;return;}set(key,value);};
   const state=await f.api.courseDocumentBridgeRequest(reader.frame,'bottom',null,1000);assert.equal(state.top,800);assert.equal(state.canBottom,true);assert.equal(state.imageCount,1);assert.equal(state.pendingImages,0);assert.equal(f.events.filter(e=>e.startsWith('ppt-scroll:')).length,1);
   const command=bus.writes.find(w=>w.value.kind==='request').value;assert.equal(new Set(bus.writes.filter(w=>w.value.kind==='request').map(w=>w.value.id)).size,1);
   reader.view.dispatchEvent(new reader.view.MessageEvent('message',{source:f.w,origin:'https://example.invalid',data:{...command,id:'spoof-bottom'}}));assert.equal(reader.top,800);
   await delay(2);assert.equal(bus.listeners.size,0);assert(![...f.storage.keys()].some(k=>k.startsWith('cx-ai-ppt-request:')));
  }finally{bus.cleanup();f.close();}
 });
 await test('跨域bottom取消及页面替换停止等待和重试',async()=>{
  for(const action of ['abort','replace']){const f=fixture([{tabs:[ppt()]}]),bus=pptMailboxFixture(f);try{
   const reader=bus.attach(f.doc.querySelector('[data-course-task]'));reader.view.postMessage=()=>{};const signal=new f.w.AbortController();
   const p=f.api.courseDocumentBridgeRequest(reader.frame,'bottom',signal.signal,600);await delay(2);if(action==='abort')signal.abort();else reader.frame.remove();
   await assert.rejects(p,action==='abort'?/取消/:/已切换/);const writes=bus.writes.length;await delay(270);assert.equal(bus.writes.length,writes);assert.equal(bus.listeners.size,0);assert.equal(reader.top,0);
  }finally{bus.cleanup();f.close();}}
 });
 await test('旧跨域子脚本明确提示刷新，不能冒充PPT已完成',async()=>{
  const f=fixture([{tabs:[ppt()]}]);try{
   const c=f.doc.querySelector('[data-course-task]');c.innerHTML='<div id="img" class="imglook"><iframe id="panView" src="https://mooc1.chaoxing.com/mooc-ans/screen/file/mock"></iframe></div>';
   const frame=c.querySelector('iframe'),child=frame.contentWindow;const ops=[];
   child.postMessage=(data,origin)=>{if(origin!=='https://pan-yz.chaoxing.com')return;ops.push(data.op);f.w.dispatchEvent(new f.w.MessageEvent('message',{source:child,origin,data:{channel:data.channel,kind:'result',id:data.id,state:{loaded:true,top:0,height:200,total:1000}}}));};
   const r=await f.runner.start();assert.equal(r.status,'stopped');assert.equal(r.documents,0);assert.match(r.reason,/阅读器版本未同步.*刷新整个课程页/);assert.deepEqual(ops,['read']);
  }finally{f.close();}
 });

 await test('真实跨域子脚本的懒加载回退执行top/scan，并等待同一PPT确认',async()=>{
  const f=fixture([{tabs:[ppt()]}]),bus=pptMailboxFixture(f);try{
   const reader=bus.attach(f.doc.querySelector('[data-course-task]')),box=reader.doc.querySelector('.fileBox');box.style.overflowY='auto';
   const last=reader.doc.createElement('img');reader.doc.querySelector('li').append(last);let top=0,pending=true;
   Object.defineProperties(last,{complete:{get:()=>!pending},naturalWidth:{get:()=>pending?0:800}});
   Object.defineProperties(box,{clientHeight:{get:()=>200},scrollHeight:{get:()=>1000},scrollTop:{get:()=>top,set:value=>{
    top=Math.max(0,Math.min(800,value));f.events.push(`remote-scan:${top}`);if(top>=360&&top<800)pending=false;
    if(top===800&&!pending){f.doc.querySelector('[data-course-task]').setAttribute('data-completed','true');f.d.querySelector('.orangeNew').textContent='0';}
   }}});
   const r=await f.runner.start();assert.equal(r.status,'done',r.reason);assert.equal(r.documents,1);assert.equal(top,800);assert.equal(reader.top,0);
   const task=r.chapters[0].tasks[0];assert.equal(task.fallbackPasses,1);assert.equal(task.documentState.imageCount,2);assert.equal(task.documentState.pendingImages,0);
   const ops=bus.writes.filter(w=>w.value.kind==='request').map(w=>w.value.op);assert(ops.indexOf('bottom')<ops.indexOf('top'));assert(ops.includes('scan'));assert(f.events.includes('remote-scan:180'));
   await delay(2);assert.equal(bus.listeners.size,0);
  }finally{bus.cleanup();f.close();}
 });
 await test('跨域等待完成时动态增加高度仍补滚，不采信旧底部',async()=>{
  const f=fixture([{tabs:[ppt()]}]),bus=pptMailboxFixture(f);let timer;
  try{
   const reader=bus.attach(f.doc.querySelector('[data-course-task]')),box=reader.doc.querySelector('.fileBox');box.style.overflowY='auto';let top=0,total=1000,writes=0;
   Object.defineProperties(box,{clientHeight:{get:()=>200},scrollHeight:{get:()=>total},scrollTop:{get:()=>top,set:value=>{
    top=Math.max(0,Math.min(total-200,value));writes++;if(writes===3)timer=setTimeout(()=>{total=1600;},6);
    if(top===1400){f.doc.querySelector('[data-course-task]').setAttribute('data-completed','true');f.d.querySelector('.orangeNew').textContent='0';}
   }}});
   const r=await f.runner.start();assert.equal(r.status,'done',r.reason);assert.equal(r.documents,1);assert.equal(top,1400);assert.equal(r.chapters[0].tasks[0].documentState.total,1600);
  }finally{clearTimeout(timer);bus.cleanup();f.close();}
 });
 const result={total:logs.length+failures.length,failures,logs};console.log(JSON.stringify(result,null,2));fs.writeFileSync(path.join(__dirname,'course-runner-results.json'),JSON.stringify(result,null,2));process.exitCode=failures.length?1:0;
})().catch(error=>{console.error(error);process.exitCode=1;});
