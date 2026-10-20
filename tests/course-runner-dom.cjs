const {installSpeedPlayer}=require('./video-speed-fixture.cjs');
const {withModelFixture}=require('./model-fixture.cjs');
const {policyInput,respondPolicy}=require('./answer-policy-mock.cjs');
const classificationRequests=[];
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'../学习通AI助手.user.js'),'utf8');
const entry="    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startQuizObserver, { once: true });\n    else startQuizObserver();";
assert(source.includes(entry));
const code=source.replace(entry,'globalThis.courseAPI={isCourseStudyURL,isCourseStudyOrigin,studyOwnerDocument,mediaAddressAllowed,courseTaskTargetReady,courseContentReady,coursePageWithoutTasks,courseInvalidateTaskProbe,createManualVideoProtection,initOtherFeatures,readCourseCatalog,courseURLContext,courseStudyContext,courseScoreKey,catalogStatus,refreshCourseSidebar,navigateCourseChapter,courseProbeMarkup,courseProbeArguments,courseProbeSummary,courseTaskProbe,courseTaskEligibility,findNextCourseTask,courseVideoSpeedCapability,courseApplyVideoSpeed,exportCxDiagnostics,backgroundPlaybackGuard,initBackgroundPlayback,courseVideoPauseInput,courseVideoQuizCandidate,courseVideoQuizSnapshot,courseRunProtection,courseRecordChapterOutcome,coursePendingChapters,courseRetryCandidate,courseLearningSettings,courseVideoForegroundPolicy,courseOwnerForegroundState,courseVideoPlayedRanges,courseVideoPositionDecision,initCourseDocumentBridge,courseDocumentBridgeRequest,courseRemoteReaderFrame,initStudyAssistant,initQuizAssistant,runAnswerFlow,createCourseRunner,courseTabs,courseFrameTree,courseTaskContainer,courseTaskContains,coursePageTasks,courseTaskRequired,courseDocumentReader,courseScrollToBottom,courseDocumentScrollState,courseTaskComplete,courseSubmitButton,courseSubmitConfirmation,courseQuizComplete,courseReportText,courseRunActive,get controller(){return controller},replaceRunner(r){courseRunner=r}};');
// DOM 模拟环境不能生成浏览器可信输入；只在测试代码替换激活检查。安全用例使用原始检查。
const activationCheck='/* TRUSTED_ASSISTANT_ACTIVATION */';
assert(code.includes(activationCheck));
const trustedCode=code.replace(activationCheck,'return true; /* test harness only: jsdom user activation */');
// 只有显式标记的夹具输入才模拟可信媒体操作，其他合成点击仍走生产拒绝路径。
const mediaInputCode=trustedCode.replace('if(event?.isTrusted!==true)return false;', 'if(event?.isTrusted!==true && event.__mockTrustedVideoPause!==true)return false;');
const logs=[],failures=[];
let activeTestName='';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function test(name,run){if(process.env.COURSE_TEST_FILTER&&!name.includes(process.env.COURSE_TEST_FILTER))return;activeTestName=name;if(process.env.COURSE_TEST_PROGRESS)console.log('RUN '+name);try{await run();logs.push(`PASS ${name}`);}catch(error){failures.push(`${name}: ${error.stack}`);}}
// 普通流程使用有限但足以容纳整组 JSDOM/GC 调度的等待预算，避免把宿主耗时当成平台故障。
// 时间边界用例继续通过 opts.limits 单独设置短期限；轮询、模拟媒体速度及行为断言保持独立。
const LIMITS={pollMs:3,settleMs:1,frameReadDelayMs:1,maxFrameReadRetries:5,loadMs:1500,videoLoadMs:1500,videoStartRetryMs:12,completionMs:600,stallMs:3000,resumeMs:12,maxResumes:4,videoManualPauseIntentMs:30,videoSeekToleranceSeconds:2,videoSeekStableMs:8,videoSeekTimeoutMs:100,videoProgressEpsilonSeconds:0.05,videoPlayedRangeToleranceSeconds:0.25,videoReplayGraceMs:80,videoQuizConfirmMs:80,slideMs:1,documentCheckMs:5,documentStableMs:15,documentBottomSamples:3,documentFallbackStepMs:2,documentFallbackPasses:2,submitMs:800};
function playerInput(video,{type='click',target=video,key=' ',trusted=true}={}){
 const view=target.ownerDocument.defaultView,event=type==='keydown'?new view.KeyboardEvent(type,{key,bubbles:true}):new view.MouseEvent(type,{bubbles:true});
 if(trusted)Object.defineProperty(event,'__mockTrustedVideoPause',{value:true});
 target.dispatchEvent(event);
}
function trackPauseCaptures(doc){
 const add=doc.addEventListener.bind(doc),remove=doc.removeEventListener.bind(doc);doc.pauseCaptures=new Map();
 doc.addEventListener=(type,fn,options)=>{if(['pointerdown','click','keydown'].includes(type)&&(options===true||options?.capture===true)){
  if(!doc.pauseCaptures.has(type))doc.pauseCaptures.set(type,new Set());doc.pauseCaptures.get(type).add(fn);
 }return add(type,fn,options);};
 doc.removeEventListener=(type,fn,options)=>{if(options===true||options?.capture===true)doc.pauseCaptures.get(type)?.delete(fn);return remove(type,fn,options);};
}
function fixture(chapters,opts={}){
 const runtimeErrors=[],virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',error=>runtimeErrors.push(error.message));
 const dom=new JSDOM('<div id="mainid"><input id="curChapterId"><div id="prev_tab"></div><iframe id="iframe"></iframe></div><div id="content1"><div id="coursetree"><ul></ul></div></div>',{url:opts.url||'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=mock-course&clazzid=mock-class&cpi=mock-account',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole});
 const w=dom.window,d=w.document,storage=new Map(opts.storage||[['deepseek_api_key',opts.key??'mock-only-key'],['cx_model',opts.model||'deepseek-flash']]);
 if(opts.autoContext!==undefined)storage.set('cx_auto_course_context',opts.autoContext);
 trackPauseCaptures(d);
 if(opts.session)w.sessionStorage.setItem('cx-ai-course-session',opts.session);
 const events=[],requests=[],timers=new Set(),videos=[],values=new Map();let active=0,tab=0,submitClicks=0,lastDoc;
 w.confirm=message=>{events.push('confirm-auto-submit:'+message);return opts.confirmSubmit!==false;};
 w.GM_getValue=withModelFixture((key,fallback)=>storage.has(key)?storage.get(key):fallback);
 w.GM_setValue=(key,value)=>storage.set(key,JSON.parse(JSON.stringify(value)));w.GM_getResourceText=()=> '{}';
 const uiListeners=new Map(),menus=new Map();let uiListenerId=0;
 const attachUiStorage=view=>{
  view.GM_getValue=withModelFixture((key,fallback)=>storage.has(key)?storage.get(key):fallback);
  view.GM_setValue=(key,value)=>{const old=storage.get(key);storage.set(key,JSON.parse(JSON.stringify(value)));for(const record of uiListeners.values())if(record.key===key)record.fn(key,old,value,record.view!==view);};
  view.GM_addValueChangeListener=(key,fn)=>{const id=++uiListenerId;uiListeners.set(id,{key,fn,view});return id;};
  view.GM_removeValueChangeListener=id=>uiListeners.delete(id);
  view.GM_registerMenuCommand=(name,fn)=>{if(view===w){if(menus.has(name))throw Error('菜单重复注册');menus.set(name,fn);}};
 };attachUiStorage(w);
 w.GM_xmlhttpRequest=request=>{
    const policy=policyInput(request);if(policy){classificationRequests.push(request);queueMicrotask(()=>opts.policyResponse?opts.policyResponse(request,policy):respondPolicy(request,policy));return {abort(){request.onabort?.();}};}

  requests.push(request);let cancelled=false;
  const timer=opts.holdModelResponse?null:setTimeout(()=>{
   if(cancelled&&!opts.lateResponse)return;
   if(opts.error){request[opts.error==='timeout'?'ontimeout':'onerror']();return;}
   const payload=JSON.parse(request.data),input=JSON.parse(payload.messages[1].content),answers=input.questions.map(q=>({id:q.id,answer:opts.videoQuizAnswers?opts.videoQuizAnswers[requests.length-1]||['A']:opts.invalid?[]:q.type==='essay'?['模拟简答\n第二行']:['A'],reason:opts.invalid?'条件不明确':'模拟答案'}));
   request.onload({status:200,responseText:JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({answers})}}]})});
  },opts.requestMs||8);if(timer!==null)timers.add(timer);
  return {abort(){cancelled=true;if(!opts.lateResponse)clearTimeout(timer);events.push('api-abort');request.onabort?.();}};
 };
 const keyFor=(ci,ti,task)=>`${ci}:${ti}:${task}`;
 const probeRequests=[],probeAborts=[];let probeActive=0,maxProbeActive=0;
 const cardsURL=(ci,ti)=>{const url=new URL('/mooc-ans/knowledge/cards',w.location.href),params=new URL(w.location.href).searchParams;url.search=new URLSearchParams({courseid:params.get('courseId'),clazzid:params.get('clazzid'),cpi:params.get('cpi'),knowledgeid:String(ci+1),num:String(ti),mooc2:'1'}).toString();return url.href;};
 const probeHTML=(ci,ti)=>{
  const page=chapters[ci].tabs[ti];
  if(page.probeHTML)return page.probeHTML;
  const attachments=page.probeAttachments??(page.tasks||[]).map((task,i)=>({type:task.kind==='quiz'?'workid':task.kind==='ppt'?'document':task.kind==='video'?'video':'unadapted',isPassed:values.get(`${ci}:${ti}:${i}`)===true,job:!task.optional,jobid:'mock-job-'+i,property:{_jobid:'mock-job-'+i}}));
  return '<script>(function(){mArg = "";try{mArg = '+JSON.stringify({attachments})+';}catch(e){}uParse(".ans-cc",null,mArg);})();</script>';
 };
 const probeTabs=ci=>'<div id="prev_tab">'+chapters[ci].tabs.map((page,ti)=>'<li id="dct'+(ti+1)+'" cardid="mock-card-'+ci+'-'+ti+'" title="'+page.title+'" onclick="changeDisplayContent('+(ti+1)+','+chapters[ci].tabs.length+',1)"></li>').join('')+'</div><iframe id="iframe" src="'+cardsURL(ci,0).replaceAll('&','&amp;')+'"></iframe>';
 if(opts.probe)w.fetch=(raw,config)=>{
  const url=new URL(raw),ajax=url.pathname.endsWith('studentstudyAjax'),ci=Number(url.searchParams.get(ajax?'chapterId':'knowledgeid'))-1,ti=Number(url.searchParams.get('num')||0);
  probeRequests.push({path:url.pathname,chapter:ci,tab:ajax?null:ti});probeActive++;maxProbeActive=Math.max(maxProbeActive,probeActive);
  return new Promise((resolve,reject)=>{
   let finished=false;const finish=()=>{if(finished)return;finished=true;probeActive--;config.signal.removeEventListener('abort',abort);};
   const abort=()=>{probeAborts.push({chapter:ci,tab:ajax?null:ti});if(opts.probeLate)return;clearTimeout(timer);finish();reject(Object.assign(Error('cancelled'),{name:'AbortError'}));};
   const timer=setTimeout(()=>{try{let html=ajax?probeTabs(ci):probeHTML(ci,ti);html=opts.probeResponse?.(url,html,{d,events})??html;finish();if(opts.probeFail===true||typeof opts.probeFail==='function'&&opts.probeFail(url))throw Error('mock network failure');resolve({ok:true,status:200,url:raw,headers:{get:()=>null},text:async()=>html});}catch(error){finish();reject(error);}},(typeof opts.probeDelay==='function'?opts.probeDelay(url):opts.probeDelay)||2);timers.add(timer);config.signal.addEventListener('abort',abort,{once:true});
  });
 };

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
  const doc=frame.contentDocument;trackPauseCaptures(doc);doc.body.innerHTML='<div class="page-content"></div>';lastDoc=doc;
  const page=chapters[active].tabs?.[tab]||{title:'资料',text:'普通文字资料',tasks:[]};const ci=active,ti=tab;
  d.querySelectorAll('#prev_tab li').forEach((li,i)=>li.classList.toggle('active',i===tab));
  if(page.text)doc.querySelector('.page-content').textContent=page.text;
  for(const [i,task]of(page.tasks||[]).entries()){
   const container=doc.createElement('div');container.setAttribute('data-course-task','');container.setAttribute('data-completed',String(values.get(keyFor(ci,ti,i))===true));doc.body.append(container);
   if(task.optional)container.setAttribute('data-required','false');
   if(task.kind==='video'){
    if(task.foreground){const hint=doc.createElement('p');hint.textContent='观看时不可离开或将页面最小化';container.append(hint);}
    const video=doc.createElement('video');container.append(video);let time=task.start||0,paused=true,ended=false,playing,loaded=!task.lazy,seeking=false,ready=loaded?4:0;
    let playedRanges=(task.playedRanges||[]).map(range=>[...range]),playedUnavailable=Boolean(task.playedUnavailable);
    const addPlayed=(start,end)=>{
     if(end<=start)return;playedRanges.push([start,end]);playedRanges.sort((a,b)=>a[0]-b[0]);
     playedRanges=playedRanges.reduce((all,range)=>{const last=all.at(-1);if(last&&range[0]<=last[1])last[1]=Math.max(last[1],range[1]);else all.push([...range]);return all;},[]);
    };
    Object.defineProperty(video,'played',{get:()=>{if(playedUnavailable)throw Error('模拟区间不可读');const copy=playedRanges.map(range=>[...range]);return {length:copy.length,start:i=>copy[i][0],end:i=>copy[i][1]};}});
    Object.defineProperties(video,{duration:{get:()=>loaded?(task.duration??3):NaN},currentTime:{get:()=>time,set(){throw Error('禁止修改视频进度')}},paused:{get:()=>paused},ended:{get:()=>ended},seeking:{get:()=>seeking},readyState:{get:()=>ready,configurable:true},networkState:{get:()=>1,configurable:true}});
    // 仅夹具控制内部媒体状态；被测脚本仍不能写入 currentTime。
    video.simulateMedia=(patch={},type)=>{
     if(patch.natural&&'seconds'in patch)addPlayed(time,patch.seconds);
     if('playedRanges'in patch)playedRanges=patch.playedRanges.map(range=>[...range]);
     if('playedUnavailable'in patch)playedUnavailable=patch.playedUnavailable;
     if('seconds'in patch)time=patch.seconds;
     if('seeking'in patch)seeking=patch.seeking;
     if('readyState'in patch)ready=patch.readyState;
     if('paused'in patch)paused=patch.paused;
     if('ended'in patch){ended=patch.ended;if(ended){paused=true;finish(ci,ti,i,container);}}
     if(type)video.dispatchEvent(new doc.defaultView.Event(type));
    };
    const add=video.addEventListener.bind(video),remove=video.removeEventListener.bind(video);video.testListeners=new Map();
    video.addEventListener=(type,fn,...rest)=>{if(!video.testListeners.has(type))video.testListeners.set(type,new Set());video.testListeners.get(type).add(fn);add(type,fn,...rest);};
    video.removeEventListener=(type,fn,...rest)=>{video.testListeners.get(type)?.delete(fn);remove(type,fn,...rest);};
    let playAttempts=0,nativeAttempts=0;video.startAttemptTimes=[];
    video.play=()=>{
     events.push(`play:${ci}:${ti}:${i}`);
     playAttempts++;video.startAttemptTimes.push(Date.now());
     if(playAttempts<=(task.playNoEffect||0))return Promise.resolve();
     if(playAttempts<=(task.abortFirst||0))return Promise.reject(Object.assign(Error('not ready yet'),{name:'AbortError'}));
     if(task.nativeOnly&&!loaded)throw Error('必须先点击原播放入口');
     loaded=true;ready=4;
     if(task.blocked)return Promise.reject(Object.assign(Error('blocked'),{name:'NotAllowedError'}));
     if(task.faceOnPlay){const face=doc.createElement('div');face.className='chapterVideoFaceMaskDiv';doc.body.append(face);}
     paused=false;video.dispatchEvent(new doc.defaultView.Event('playing'));if(playing)clearInterval(playing);
     if(task.pauseOnEveryPlay){if(task.manualPause)playerInput(video);paused=true;video.dispatchEvent(new doc.defaultView.Event('pause'));return Promise.resolve();}
     if(task.manual)return Promise.resolve();
     playing=setInterval(()=>{
      if(paused||task.stall||seeking)return;
      const previous=time;time=Math.min(time+1,video.duration);addPlayed(previous,time);video.dispatchEvent(new doc.defaultView.Event('timeupdate'));
      if((task.pauseAt===time&&!video.didPause)||(task.pauseTimes||[]).includes(time)){if(task.manualPause)playerInput(video);paused=true;video.didPause=true;video.dispatchEvent(new doc.defaultView.Event('pause'));}
      if(task.faceAtPause===time){const face=doc.createElement('div');face.className='chapterVideoFaceMaskDiv';doc.body.append(face);}
      if(time>=video.duration){ended=true;paused=true;clearInterval(playing);finish(ci,ti,i,container);video.dispatchEvent(new doc.defaultView.Event('ended'));}
     },10);timers.add(playing);return Promise.resolve();
    };
    video.pause=()=>{if(!paused){paused=true;video.dispatchEvent(new doc.defaultView.Event('pause'));}};videos.push(video);if(task.nativeSpeed)video.speedFixture=installSpeedPlayer(video,task.nativeSpeed);
    if(task.nativeOnly){const button=doc.createElement('button');button.className='vjs-big-play-button';button.textContent='播放';button.onclick=()=>{events.push(`native-play:${ci}:${ti}:${i}`);nativeAttempts++;video.startAttemptTimes.push(Date.now());if(nativeAttempts<=(task.nativeNoEffect||0))return;loaded=true;return video.play();};container.append(button);}
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
     if(task.manualText && qi===(task.count||1)-1)q.innerHTML='<div class="Zy_TItle"><span class="fontLabel">【简答题】'+task.manualText+'</span></div><textarea></textarea>';
     if(task.manualValue&&q.querySelector('textarea'))q.querySelector('textarea').value=task.manualValue;
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
   }else if(task.kind==='knowledge-graph')container.innerHTML='<h2>章节知识图谱</h2><svg aria-label="知识节点"><circle r="4"></circle></svg>';
   else if(task.kind==='survey')container.textContent='调查问卷，请自行完成';
   else if(task.kind==='homework')container.innerHTML='<div class="fanyaMarking_left"><h2>作业详情</h2></div>';
   else if(task.kind==='unknown')container.innerHTML='<img id="img" class="imglook">';
   // 必需的未适配任务夹具提供真实可见标记；无任务页另用无标记夹具验证。
   if(!task.optional&&['survey','homework','unknown'].includes(task.kind)){const icon=doc.createElement('span');icon.className='ans-job-icon';container.append(icon);}
  }
  if(opts.probe){const get=frame.getAttribute.bind(frame);frame.getAttribute=name=>name==='src'?cardsURL(ci,ti):get(name);const holder=doc.createElement('template');holder.innerHTML=probeHTML(ci,ti);doc.body.append(holder.content);
   // A completed native navigation in this fixture; no real iframe/network is mounted.
   Object.defineProperty(doc,'URL',{value:cardsURL(ci,ti),configurable:true});Object.defineProperty(doc,'readyState',{value:'complete',configurable:true});
   // Visible native-module fixtures are already rendered; pre-read templates remain detached.
   for(const child of doc.querySelectorAll('iframe'))if(child.contentDocument){child.contentDocument.body.innerHTML='<span>模拟原生模块已加载</span>';Object.defineProperty(child.contentDocument,'readyState',{value:'complete',configurable:true});}}
  return doc;
 };
 const renderChapter=ci=>{
  active=ci;tab=0;d.querySelector('#curChapterId').value=String(ci+1);d.querySelector('#prev_tab').replaceChildren();
  for(const [index,page]of(chapters[ci].tabs||[]).entries()){
   const li=d.createElement('li');li.id=`dct${index+1}`;li.textContent=page.title;if(opts.probe){li.setAttribute('cardid','mock-card-'+ci+'-'+index);li.setAttribute('onclick','changeDisplayContent('+(index+1)+','+chapters[ci].tabs.length+',1)');}li.onclick=()=>{if(tab!==index){tab=index;events.push(`tab:${ci}:${index}`);renderPage();}};d.querySelector('#prev_tab').append(li);
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
 renderChapter(0);opts.beforeRuntime?.(w,videos);const runtimeCode=opts.genuineActivation?code:opts.genuineMediaInputs?trustedCode:mediaInputCode;w.eval(opts.noAutoResume?runtimeCode.replace('if(owner===doc) courseRunner?.resumeIfNeeded();',''):runtimeCode);w.courseAPI.initStudyAssistant();
 const runner=w.courseAPI.createCourseRunner(d,w.courseAPI.controller,{limits:{...LIMITS,...opts.limits},sleep:opts.sleep,now:opts.now});w.courseAPI.replaceRunner(runner);
 const startWithDefaults=runner.start;runner.start=(options={})=>startWithDefaults({submit:true,continueOnTimeout:false,...options});
 if(typeof activeTestName!=='undefined'&&activeTestName.startsWith('视频弹题')){const watchdog=setTimeout(()=>{if(runner.busy){console.log('POPUP WATCHDOG '+JSON.stringify(runner.report?.chapters[0]?.tasks));runner.stop('模拟弹题测试超时');}},8000);timers.add(watchdog);}
 return {w,d,storage,runner,startWithDefaults,requests,events,videos,probeRequests,probeAborts,get maxProbeActive(){return maxProbeActive},menus,uiListeners,attachUiStorage,api:w.courseAPI,get doc(){return lastDoc},get submits(){return submitClicks},close(){runner.stop();timers.forEach(clearTimeout);dom.window.close();assert.deepEqual(runtimeErrors,[],'页面或已销毁 iframe 存在未处理异常');}};
}
const video=(extra={})=>({title:'视频',tasks:[{kind:'video',...extra}]});
const ppt=(extra={})=>({title:'资料',tasks:[{kind:'ppt',...extra}]});
const quiz=(extra={})=>({title:'章节测验',tasks:[{kind:'quiz',...extra}]});
async function runWith(chapters,opts,verify){const f=fixture(chapters,opts);try{const report=await f.runner.start();await verify(f,report);}finally{f.close();}}
async function waitForTest(predicate,message='等待模拟状态超时'){
 for(let i=0;i<200;i++){if(predicate())return;await delay(2);}assert.fail(message);
}
function assertSeekListenersRemoved(v){for(const type of ['timeupdate','seeking','seeked','canplay','loadeddata','ratechange'])assert.equal(v.testListeners.get(type)?.size||0,0,type+' 监听未清理');}
async function manualVideoTest(run,opts={},chapters=[{tabs:[video({manual:true,start:100,duration:105})]}],startOptions={}){
 const f=fixture(chapters,opts),pending=f.runner.start(startOptions);
 try{await waitForTest(()=>f.events.some(e=>e.startsWith('play:')));await run(f,pending,f.videos.find(v=>!v.paused&&!v.ended));}
 finally{f.runner.stop();try{await pending;}finally{f.close();}}
}
function finishManual(v){while(v.currentTime<v.duration)v.simulateMedia({seconds:Math.min(v.duration,v.currentTime+0.5),natural:true},'timeupdate');v.simulateMedia({ended:true},'ended');}
function foregroundFixture(f,visible=true,focused=true){
 const state={visible,focused};Object.defineProperty(f.d,'visibilityState',{get:()=>state.visible?'visible':'hidden',configurable:true});Object.defineProperty(f.d,'hasFocus',{value:()=>state.focused,configurable:true});
 return (isVisible,isFocused=isVisible)=>{state.visible=isVisible;state.focused=isFocused;f.d.dispatchEvent(new f.w.Event('visibilitychange'));f.w.dispatchEvent(new f.w.Event(isFocused?'focus':'blur'));};
}
function videoPopup(f,v,options={}){
 const doc=v.ownerDocument,root=doc.createElement('div');root.className='ans-videoquiz';root.dataset.cueSeconds=String(options.cue??100);
 const type=options.type||'单选题';
 root.innerHTML=`<fieldset data-questionid="popup-${options.cue??100}" data-question-type="${type}"><legend>【${type}】${options.text||'请选择甲'}</legend>${type==='简答题'?'<textarea></textarea>':'<label><input type="'+(type==='多选题'?'checkbox':'radio')+'" name="popup-'+(options.cue??100)+'" value="A">A. 甲</label><label><input type="'+(type==='多选题'?'checkbox':'radio')+'" name="popup-'+(options.cue??100)+'" value="B">B. 乙</label>'}</fieldset><button type="button" id="videoquiz-submit">确定</button><p class="videoquiz-feedback"></p>`;
 v.parentElement.append(root);let confirms=0;
 const feedback=text=>{root.querySelector('.videoquiz-feedback').textContent=text;};
 const release=()=>{root.remove();return v.play();};
 root.querySelector('button').onclick=()=>{confirms++;if(options.confirm)options.confirm({root,v,feedback,release,confirms});else{feedback('回答正确');const proof=root.querySelector('.videoquiz-feedback').cloneNode(true);v.parentElement.append(proof);release();}};
 return {root,feedback,release,get confirms(){return confirms}};
}
const taskProbeFixture=name=>fs.readFileSync(path.join(__dirname,'fixtures/task-probe-'+name+'.html'),'utf8');
const probeRange=f=>f.api.readCourseCatalog(f.d).entries.filter(entry=>!entry.isGroup);
const probeSettings=f=>({owner:f.d,submit:false,skipLearned:true});
(async()=>{

 // These domain-compatibility cases are added for user-authorized future runs; not executed for this repair.
 for(const [host,studyPath] of [['mooc1.chaoxing.com','/mycourse/studentstudy'],['mooc1.xuexitong.com','/mycourse/studentstudy'],['mooc1-2.chaoxing.com','/mooc-ans/mycourse/studentstudy']]) {
  await test(`课程域名：${host} 初始化、嵌套归属和重复挂载`,()=>{
   const f=fixture([{tabs:[video()]}],{url:`https://${host}${studyPath}?courseId=mock-course&clazzid=mock-class&cpi=mock-account`});try{
    assert(f.d.getElementById('cx-ai-study-root'));assert(f.d.getElementById('cx-ai-study-toolbar'));
    assert.equal(f.api.studyOwnerDocument(f.doc),f.d);
    const nested=f.doc.createElement('iframe');f.doc.body.append(nested);assert.equal(f.api.studyOwnerDocument(nested.contentDocument),f.d);
    const button=f.d.getElementById('cx-ai-study-toolbar').shadowRoot.getElementById('settings');assert.match(button.textContent,/学习通AI助手/);button.click();
    f.api.initStudyAssistant();f.api.initStudyAssistant();assert.equal(f.d.querySelectorAll('#cx-ai-study-root').length,1);assert.equal(f.d.querySelectorAll('#cx-ai-study-toolbar').length,1);
    const next=f.d.createElement('iframe');next.id='iframe';f.d.querySelector('#mainid #iframe').replaceWith(next);f.api.initStudyAssistant();
    assert.equal(f.api.courseFrameTree(f.d).root,next);assert.equal(next.previousElementSibling.id,'cx-ai-study-toolbar');assert.equal(f.d.querySelectorAll('#cx-ai-study-root').length,1);
   }finally{f.close();}
  });
  await test(`课程域名：${host} 后台保护保留激活和释放规则`,async()=>{
   const f=fixture([{tabs:[video()]}],{url:`https://${host}${studyPath}?courseId=mock-course&clazzid=mock-class&cpi=mock-account`});try{
    const guard=f.api.backgroundPlaybackGuard;assert(guard);assert.equal(f.api.initBackgroundPlayback(),guard);
    await f.videos[0].play();let intercepted=0,received=0;
    const release=guard.activate({video:f.videos[0],canProtect:()=>true,onSuppressed:()=>intercepted++});
    const receive=()=>received++;f.w.addEventListener('mouseout',receive);
    f.w.dispatchEvent(new f.w.MouseEvent('mouseout',{relatedTarget:null}));assert.equal(intercepted,1);assert.equal(received,0);
    release();f.w.dispatchEvent(new f.w.MouseEvent('mouseout',{relatedTarget:null}));assert.equal(received,1);f.w.removeEventListener('mouseout',receive);
   }finally{f.close();}
  });
  await test(`课程域名：${host} 视频资料继续处理、关闭测验不提交`,async()=>{
   const f=fixture([{tabs:[video(),ppt(),quiz()]}],{url:`https://${host}${studyPath}?courseId=mock-course&clazzid=mock-class&cpi=mock-account`});try{
    const result=await f.runner.start({submit:false});assert.equal(result.status,'done',result.reason);assert.equal(result.videos,1);assert.equal(f.submits,0);assert.equal(f.requests.length,0);
   }finally{f.close();}
  });
 }
 await test('课程域名：元数据保留两类安装匹配、普通页与伪造主机不创建入口',()=>{
  assert.match(source,/^\/\/ @match\s+\*:\/\/\*\.chaoxing\.com\/\*$/m);assert.match(source,/^\/\/ @match\s+\*:\/\/\*\.xuexitong\.com\/\*$/m);
  const f=fixture([{tabs:[video()]}]);try{
   for(const url of ['https://other.example/mycourse/studentstudy','https://mooc1.xuexitong.com.evil.invalid/mycourse/studentstudy','https://mooc1.xuexitong.com/mycourse/list','https://mooc1-2.chaoxing.com.evil.invalid/mooc-ans/mycourse/studentstudy','https://mooc1-2.chaoxing.com/mooc-ans/work/doHomeWorkNew','https://mooc1-2.chaoxing.com/mooc-ans/mycourse/studentstudyAjax','https://other.chaoxing.com/mooc-ans/mycourse/studentstudy'])assert.equal(f.api.isCourseStudyURL(new URL(url)),false);
   f.w.history.replaceState({},'','/mycourse/list');f.d.getElementById('cx-ai-study-root').remove();f.d.getElementById('cx-ai-study-toolbar').remove();f.api.initStudyAssistant();assert.equal(f.d.getElementById('cx-ai-study-root'),null);assert.equal(f.d.getElementById('cx-ai-study-toolbar'),null);assert.equal(f.api.initBackgroundPlayback(),null);
  }finally{f.close();}
 });
 await test('课程域名：旧站课件仍校验发送者、来源与操作类型',()=>{
  const f=fixture([{tabs:[ppt()]}],{url:'https://mooc1.xuexitong.com/mycourse/studentstudy?courseId=mock-course&clazzid=mock-class&cpi=mock-account'});try{
   const frame=f.doc.createElement('iframe');f.doc.body.append(frame);const doc=frame.contentDocument,view=frame.contentWindow;
   Object.defineProperty(doc,'URL',{value:'https://pan-yz.chaoxing.com/screen/v2/file_mock'});doc.body.innerHTML='<div class="fileBox"><ul><li><img></li></ul></div>';
   const responses=[];f.w.postMessage=data=>responses.push(data);f.api.initCourseDocumentBridge(doc);
   const send=(origin,sender,op='read')=>view.dispatchEvent(new view.MessageEvent('message',{origin,source:sender,data:{channel:'cx-ai-document-v1',kind:'request',id:'domain-reader',op}}));
   send('https://unknown.invalid',f.w);send('https://mooc1.xuexitong.com.evil.invalid',f.w);send('https://mooc1.xuexitong.com',{postMessage(){throw new Error('Unrelated window accepted');}});send('https://mooc1.xuexitong.com',f.w,'invalid');assert.equal(responses.length,0);
   assert.equal(f.api.isCourseStudyOrigin('https://mooc1.xuexitong.com:8443'),false);assert.equal(f.api.isCourseStudyOrigin('http://mooc1.xuexitong.com'),false);
   send('https://mooc1.xuexitong.com',f.w);assert.equal(responses.length,1);assert.equal(responses[0].kind,'result');
  }finally{f.close();}
 });
 // Reconstructed from the user's confirmed legacy selectors; colours/current item/hierarchy remain unverified.
 const legacyDirectory = (f, html) => {const root=f.d.getElementById('coursetree');root.innerHTML=html;f.api.refreshCourseSidebar();return root;};
 const legacyRow = (id, number, title, handler='onclick="getTeacherAjax(11,22,33)"') => `<h4 id="${id}"><a title="${title}" ${handler}><span class="hideChapterNumber">${number}</span>${title}</a><span class="roundpointStudent blue"></span></h4>`;
 const legacyFixture = () => fixture([{tabs:[video()]}],{url:'https://mooc1-2.chaoxing.com/mooc-ans/mycourse/studentstudy?courseId=mock-course&clazzid=mock-class&cpi=mock-account'});
 await test('目录专项：旧版 h4 无 li 仍提取编号标题与本地章节 ID',()=>{
  const f=legacyFixture();try{
   const root=legacyDirectory(f,legacyRow('cur876543','1.2','矩阵的变换')+legacyRow('cur765432','2.1','行列式'));
   const catalog=f.api.readCourseCatalog(f.d);assert.equal(catalog.structure,'legacy-h4');assert.equal(catalog.entries.length,2);assert.equal(root.querySelector('h4').closest('li'),null);
   assert.deepEqual(Array.from(catalog.entries,e=>[e.id,e.chapterId,e.number,e.title]),[['cur876543','876543','1.2','矩阵的变换'],['cur765432','765432','2.1','行列式']]);
   for(const entry of catalog.entries){assert.equal(entry.parentId,null);assert.equal(entry.hierarchyKnown,false);assert.equal(entry.isGroup,false);assert.equal(entry.target,root.querySelector('#'+entry.id+' a'));}
   assert.equal(f.api.readCourseCatalog(f.doc).sourceDoc,f.d);
  }finally{f.close();}
 });
 await test('目录专项：蓝色与未验证样式不推断完成数层级或当前选中',()=>{
  const f=legacyFixture();try{
   legacyDirectory(f,legacyRow('cur1001','1','父标题')+legacyRow('cur1002','1.1','子标题'));
   const row=f.d.getElementById('cur1001');row.className='blue active posCatalog_active';row.insertAdjacentHTML('beforeend','<span class="orangeNew">0</span><i class="icon_Completed"></i>');
   for(const entry of f.api.readCourseCatalog(f.d).entries){assert.equal(entry.completed,null);assert.equal(entry.pending,null);assert.equal(entry.active,null);assert.equal(entry.parentId,null);assert.equal(f.api.catalogStatus(entry),'状态未提供');}
   assert.equal(f.submits,0);assert.equal(f.requests.length,0);
  }finally{f.close();}
 });
 await test('目录专项：旧版章节点击只委托原生 getTeacherAjax 链接',()=>{
  const f=legacyFixture();try{
   const root=legacyDirectory(f,legacyRow('cur4512','3.1','原生跳转'));let clicked=0;const link=root.querySelector('a');link.addEventListener('click',event=>{event.preventDefault();clicked++;});
   f.api.navigateCourseChapter('cur4512');assert.equal(clicked,1);assert.equal(f.requests.length,0);assert.equal(f.submits,0);assert.equal(f.api.readCourseCatalog(f.d).entries[0].active,null);
   const button=f.d.getElementById('cx-ai-study-root').shadowRoot.querySelector('[data-chapter-button="cur4512"]');assert(button);button.click();assert.equal(clicked,2);
  }finally{f.close();}
 });
 await test('目录专项：href 与行级原生处理器可绑定未知链接保持禁用',()=>{
  const f=legacyFixture();try{
   const root=legacyDirectory(f,legacyRow('cur401','1','href','href="javascript:getTeacherAjax(77,88,99)"')+legacyRow('cur402','2','行处理器','')+legacyRow('cur403','3','未知链接','onclick="unverifiedAction()"'));
   root.querySelector('#cur402').setAttribute('onclick','return getTeacherAjax(77,88,100)');f.api.refreshCourseSidebar();
   const entries=f.api.readCourseCatalog(f.d).entries;assert(entries[0].target);assert(entries[1].target);assert.equal(entries[2].target,null);
   const s=f.d.getElementById('cx-ai-study-root').shadowRoot;assert.equal(s.querySelector('[data-chapter-button="cur401"]').disabled,false);assert.equal(s.querySelector('[data-chapter-button="cur403"]').disabled,true);
  }finally{f.close();}
 });
 await test('目录专项：重复 ID 多候选标题及空标题不会制造可执行章节',()=>{
  const f=legacyFixture();try{
   legacyDirectory(f,legacyRow('cur991','1','保留首项')+legacyRow('cur991','2','重复项')+'<h4 id="cur992"><a title="甲"></a><a title="乙"></a></h4>'+legacyRow('cur993','3',''));
   const entries=f.api.readCourseCatalog(f.d).entries;assert.equal(entries.length,1);assert.equal(entries[0].title,'保留首项');
  }finally{f.close();}
 });
 await test('目录专项：旧版平铺展示搜索与不可信标题使用文本渲染',()=>{
  const f=legacyFixture();try{
   const root=legacyDirectory(f,legacyRow('cur601','1.1','矩阵')+legacyRow('cur602','1.2','行列式'));root.querySelector('#cur602 a').title='<img src=x onerror=alert(1)>';f.api.refreshCourseSidebar();
   const s=f.d.getElementById('cx-ai-study-root').shadowRoot,list=s.getElementById('catalog-list');assert.equal(list.querySelectorAll('[data-chapter-button]').length,2);assert.equal(list.querySelector('img'),null);assert.match(list.textContent,/<img src=x onerror=alert\(1\)>/);assert.match(s.getElementById('catalog-status').textContent,/2 个章节.*未确认/);
   const search=s.getElementById('catalog-search');search.value='矩阵';search.dispatchEvent(new f.w.Event('input'));assert.equal(list.querySelectorAll('[data-chapter-button]').length,1);assert.equal(list.querySelector('[data-chapter-button]').dataset.chapterButton,'cur601');
  }finally{f.close();}
 });
 await test('目录专项：后加载旧版章节和原生处理器更新可刷新展示',async()=>{
  const f=legacyFixture();try{
   const root=legacyDirectory(f,'<div>目录正在加载</div>');assert.equal(f.api.readCourseCatalog(f.d).structure,'unrecognized');root.innerHTML=legacyRow('cur711','7.1','后加载章节','');await delay(140);
   const s=f.d.getElementById('cx-ai-study-root').shadowRoot;assert.equal(s.querySelector('[data-chapter-button="cur711"]').disabled,true);
   root.querySelector('a').setAttribute('onclick','getTeacherAjax(44,55,66)');await delay(140);assert.equal(s.querySelector('[data-chapter-button="cur711"]').disabled,false);assert.equal(f.api.readCourseCatalog(f.d).structure,'legacy-h4');
  }finally{f.close();}
 });
 await test('目录专项：新版目录层级完成标记待完成数及当前项保持原解析',()=>{
  const f=legacyFixture();try{
   legacyDirectory(f,'<ul><li><div class="posCatalog_select" id="curGroup"><span class="posCatalog_title" title="课程分组">课程分组</span></div><ul><li><div class="posCatalog_select posCatalog_active" id="cur31"><a class="posCatalog_name" title="新版完成章节"><em class="posCatalog_sbar">3.1</em>新版完成章节</a><i class="icon_Completed"></i></div></li><li><div class="posCatalog_select" id="cur32"><a class="posCatalog_name" title="新版待完成章节"><em class="posCatalog_sbar">3.2</em>新版待完成章节</a><span class="orangeNew">2</span></div></li></ul></li></ul>'+legacyRow('cur999','9','旁侧旧模板'));
   const catalog=f.api.readCourseCatalog(f.d);assert.equal(catalog.structure,'pos-catalog');assert.equal(catalog.entries.length,3);const done=catalog.entries.find(e=>e.id==='cur31'),pending=catalog.entries.find(e=>e.id==='cur32');assert.equal(done.parentId,'curGroup');assert.equal(done.completed,true);assert.equal(done.active,true);assert.equal(pending.pending,2);assert.equal(pending.completed,false);assert.equal(f.api.catalogStatus(pending),'待完成 · 2项');assert.equal(done.target,f.d.querySelector('#cur31 .posCatalog_name'));
  }finally{f.close();}
 });

 // Legacy runtime identity cases: source only in this repair, awaiting a future authorized run.
 const legacyCardsContext = (f,params={}) => {
  const query=new URLSearchParams({courseid:'mock-course',clazzid:'mock-class',cpi:'mock-account',knowledgeid:'1',num:'0',...params});
  const url=new URL('/mooc-ans/knowledge/cards',f.w.location.href);url.search=query.toString();
  const frame=f.d.querySelector('#mainid #iframe'),get=frame.getAttribute.bind(frame);frame.getAttribute=name=>name==='src'?url.href:get(name);
  Object.defineProperty(f.doc,'URL',{value:url.href,configurable:true});return url;
 };
 const legacyNoCpiFixture = () => fixture([{tabs:[video({manual:true})]}],{url:'https://mooc1-2.chaoxing.com/mooc-ans/mycourse/studentstudy?chapterId=1&courseId=mock-course&clazzid=mock-class&enc=mock-enc'});
 await test('旧版启动：顶层缺 cpi 从已核对课程 iframe 补齐且启动时重新读取',async()=>{
  const f=legacyNoCpiFixture();let pending;try{
   assert.equal(f.runner.key,null);assert.equal(f.api.studyOwnerDocument(f.d),f.d);legacyCardsContext(f);
   legacyDirectory(f,Array.from({length:113},(_,i)=>legacyRow('cur'+(i+1),String(i+1),'旧版章节'+(i+1),'href="javascript:getTeacherAjax(1,2,3)"')).join(''));
   const catalog=f.api.readCourseCatalog(f.d);assert.equal(catalog.entries.length,113);assert.equal(catalog.entries.filter(e=>e.active).length,1);assert.equal(catalog.entries.find(e=>e.active).id,'cur1');assert(f.runner.key?.includes('mock-account'));
   pending=f.runner.start({fromCurrent:true,submit:false});await waitForTest(()=>f.events.some(e=>e.startsWith('play:')));assert(!f.api.controller.state.message.includes('独立作业页'));f.runner.stop();await pending;assert.equal(f.submits,0);
  }finally{f.runner.stop();if(pending)await pending;f.close();}
 });
 await test('旧版启动：字段大小写及别名统一且重复冲突参数拒绝',()=>{
  const f=legacyNoCpiFixture();try{
   f.w.history.replaceState({},'','?CourseID=mock-course&CLASSID=mock-class&chapterId=9');const url=legacyCardsContext(f);
   url.search='CourseID=mock-course&ClassId=mock-class&CPI=mock-account&ChapterID=1';const frame=f.d.querySelector('#mainid #iframe');frame.getAttribute=name=>name==='src'?url.href:null;Object.defineProperty(f.doc,'URL',{value:url.href,configurable:true});
   assert.equal(f.api.courseStudyContext(f.d).complete,true);assert.equal(f.api.readCourseCatalog(f.d).scopeKey,f.api.courseScoreKey(f.d));
   const ambiguous=f.api.courseURLContext(new URL('https://mooc1-2.chaoxing.com/mooc-ans/knowledge/cards?courseId=one&courseid=two'));assert(ambiguous.conflict);
  }finally{f.close();}
 });
 for(const field of ['courseid','clazzid','cpi'])await test('旧版启动：顶层与 iframe 身份冲突停止 '+field,async()=>{
  const f=legacyNoCpiFixture();try{
   f.w.history.replaceState({},'','?courseId=mock-course&clazzid=mock-class&cpi=mock-account');legacyCardsContext(f,{[field]:'other-identity'});assert.equal(f.api.courseScoreKey(f.d),null);
   await f.runner.start({submit:false});assert.match(f.api.controller.state.message,/课程身份冲突/);assert.equal(f.events.filter(e=>e.startsWith('play:')).length,0);assert.equal(f.submits,0);assert.equal(f.requests.length,0);
  }finally{f.close();}
 });
 await test('旧版启动：跨域或非 cards URL 不提供缺失账号且独立作业仍拒绝',async()=>{
  const f=legacyNoCpiFixture();try{
   const frame=f.d.querySelector('#mainid #iframe');for(const url of ['https://unknown.invalid/mooc-ans/knowledge/cards?courseid=mock-course&clazzid=mock-class&cpi=other','https://mooc1-2.chaoxing.com/unrelated?courseid=mock-course&clazzid=mock-class&cpi=other']){frame.getAttribute=name=>name==='src'?url:null;assert.equal(f.api.courseScoreKey(f.d),null);}
   f.w.history.replaceState({},'','/mooc-ans/work/doHomeWorkNew?courseId=mock-course&clazzid=mock-class&cpi=mock-account');assert.equal(f.api.studyOwnerDocument(f.d),null);await f.runner.start({submit:false});assert.match(f.api.controller.state.message,/独立作业页/);assert.equal(f.events.filter(e=>e.startsWith('play:')).length,0);
  }finally{f.close();}
 });
 await test('旧版启动：src 元数据不冒充已加载章节或视频任务',async()=>{
  const f=legacyNoCpiFixture();try{
   legacyCardsContext(f);legacyDirectory(f,legacyRow('cur1','1','旧版章节'));Object.defineProperty(f.doc,'URL',{value:'about:blank',configurable:true});assert.equal(f.api.courseStudyContext(f.d).complete,true);assert.equal(f.api.readCourseCatalog(f.d).entries[0].active,null);
   await f.runner.start({fromCurrent:true,submit:false});assert.match(f.api.controller.state.message,/实际任务尚未就绪/);assert.equal(f.events.filter(e=>e.startsWith('play:')).length,0);
  }finally{f.close();}
 });
 await test('旧版启动：顶层初始章节参数不覆盖实际加载章节',()=>{
  const f=legacyNoCpiFixture();try{
   f.w.history.replaceState({},'','?courseId=mock-course&clazzid=mock-class&chapterId=113');legacyCardsContext(f,{knowledgeid:'2'});legacyDirectory(f,legacyRow('cur1','1','第一章')+legacyRow('cur2','2','第二章'));
   assert.equal(f.api.readCourseCatalog(f.d).entries.find(e=>e.active).id,'cur2');assert.equal(f.api.courseStudyContext(f.d).chapterId,'2');
  }finally{f.close();}
 });

 await test('旧版启动：实际 cards 已加载但没有任务节点时保留启动检查',async()=>{
  const f=legacyNoCpiFixture();try{
   legacyCardsContext(f);legacyDirectory(f,legacyRow('cur1','1','旧版章节'));f.videos[0].remove();await f.runner.start({fromCurrent:true,submit:false});assert.match(f.api.controller.state.message,/实际任务尚未就绪/);assert.equal(f.events.filter(e=>e.startsWith('play:')).length,0);assert.equal(f.submits,0);
  }finally{f.close();}
 });
 await test('旧版启动：运行中 iframe 账号改变仍停止且保留原会话身份',async()=>{
  const f=legacyNoCpiFixture();let pending;try{
   legacyCardsContext(f);legacyDirectory(f,legacyRow('cur1','1','旧版章节'));pending=f.runner.start({fromCurrent:true,submit:false});await waitForTest(()=>f.events.some(e=>e.startsWith('play:')));legacyCardsContext(f,{cpi:'changed-account'});
   const report=await pending;assert.equal(report.status,'stopped');assert.match(report.reason,/课程或账号已变化/);assert.equal(f.submits,0);
  }finally{f.runner.stop();if(pending)await pending;f.close();}
 });

 // Synthetic unknown rows only: the real legacy chapter markup is still pending user collection.
 await test('旧版课程：目录容器已存在但章节结构未知，保留入口且不启动空队列',async()=>{
  const f=fixture([{tabs:[video()]}],{url:'https://mooc1-2.chaoxing.com/mooc-ans/mycourse/studentstudy?courseId=mock-course&clazzid=mock-class&cpi=mock-account'});
  try{
   const root=f.d.getElementById('coursetree'),original=[...root.childNodes];root.replaceChildren(f.d.createTextNode('模拟未适配目录'));
   f.api.initStudyAssistant();const catalog=f.api.readCourseCatalog(f.d);
   assert.equal(catalog.root,root);assert.equal(catalog.structure,'unrecognized');assert.equal(catalog.entries.length,0);
   assert.equal(f.d.querySelectorAll('#cx-ai-study-root').length,1);assert.equal(f.d.querySelectorAll('#cx-ai-study-toolbar').length,1);
   await f.runner.start({submit:false});assert.match(f.api.controller.state.message,/尚未识别章节结构/);assert.equal(f.events.filter(x=>x.startsWith('play:')).length,0);assert.equal(f.requests.length,0);assert.equal(f.submits,0);
   root.replaceChildren(...original);assert.equal(f.api.readCourseCatalog(f.d).structure,'pos-catalog');assert.equal(f.api.readCourseCatalog(f.d).entries.length,1);
  }finally{f.close();}
 });
 await test('旧版课程：多层框架延迟视频与节点替换均重新读取，不把空框架当作无任务',()=>{
  const f=fixture([{tabs:[video({manual:true})]}],{url:'https://mooc1-2.chaoxing.com/mooc-ans/mycourse/studentstudy?courseId=mock-course&clazzid=mock-class&cpi=mock-account'});
  try{
   const video=f.videos[0],container=f.api.courseTaskContainer(video),mount=video.parentElement;video.remove();
   const middle=f.doc.createElement('iframe');mount.append(middle);const inner=middle.contentDocument.createElement('iframe');middle.contentDocument.body.append(inner);
   let tree=f.api.courseFrameTree(f.d);assert.equal(tree.documents.length,4);assert.equal(f.api.coursePageTasks(tree).filter(t=>t.type==='video').length,0);assert.equal(f.api.courseContentReady(f.d),false);assert.equal(f.api.coursePageWithoutTasks(tree,[]),false);
   inner.contentDocument.body.append(video);tree=f.api.courseFrameTree(f.d);assert.equal(f.api.coursePageTasks(tree).find(t=>t.type==='video').node,video);assert.equal(f.api.courseTaskContainer(video),container);assert(f.api.courseTaskContains(container,video));
   const replacement=middle.contentDocument.createElement('iframe');inner.replaceWith(replacement);tree=f.api.courseFrameTree(f.d);assert(!tree.documents.includes(video.ownerDocument));assert(!f.api.coursePageTasks(tree).some(t=>t.node===video));assert.equal(f.api.courseContentReady(f.d),false);
   const next=replacement.contentDocument.createElement('video');replacement.contentDocument.body.append(next);assert.equal(f.api.coursePageTasks(f.api.courseFrameTree(f.d)).find(t=>t.type==='video').node,next);
   Object.defineProperty(replacement,'contentDocument',{configurable:true,get(){throw new f.w.DOMException('blocked','SecurityError');}});tree=f.api.courseFrameTree(f.d);assert(tree.inaccessible.includes(replacement));assert.equal(f.api.courseContentReady(f.d),false);assert.equal(f.api.coursePageWithoutTasks(tree,[]),false);
  }finally{f.close();}
 });
 await test('旧版课程：编号域名与课件来源保持精确边界',()=>{
  const f=fixture([{tabs:[ppt()]}],{url:'https://mooc1-2.chaoxing.com/mooc-ans/mycourse/studentstudy?courseId=mock-course&clazzid=mock-class&cpi=mock-account'});
  try{
   for(const url of ['https://mooc1-2.chaoxing.com/mooc-ans/mycourse/studentstudy','https://mooc1-3.chaoxing.com/mooc-ans/mycourse/studentstudy','https://mooc1.chaoxing.com/mycourse/studentstudy'])assert.equal(f.api.isCourseStudyURL(new URL(url)),true);
   assert(f.api.isCourseStudyOrigin('https://mooc1-2.chaoxing.com'));
   for(const origin of ['https://mooc1-2.chaoxing.com:8443','http://mooc1-2.chaoxing.com','https://mooc1-2.chaoxing.com.evil.invalid','https://mooc1-2.chaoxing.com/path','https://user@mooc1-2.chaoxing.com'])assert.equal(f.api.isCourseStudyOrigin(origin),false);
   const holder=f.doc.createElement('div');holder.id='img';holder.className='imglook';holder.innerHTML='<iframe id="panView" src="https://mooc1-2.chaoxing.com/mooc-ans/screen/file/mock"></iframe>';f.doc.body.append(holder);assert(f.api.courseRemoteReaderFrame(holder.firstChild));holder.firstChild.src='https://mooc1-2.chaoxing.com/mooc-ans/knowledge/cards';assert.equal(f.api.courseRemoteReaderFrame(holder.firstChild),false);
  }finally{f.close();}
 });

 await test('课程域名：阅读器路径与旧站图片资源边界保留',()=>{
  const f=fixture([{tabs:[ppt()]}]);try{
   const holder=f.doc.createElement('div');holder.id='img';holder.className='imglook';holder.innerHTML='<iframe id="panView" src="https://mooc1.xuexitong.com/mooc-ans/screen/file/mock"></iframe>';f.doc.body.append(holder);
   const frame=holder.querySelector('iframe');assert.equal(f.api.courseRemoteReaderFrame(frame),true);frame.src='https://mooc1.xuexitong.com/other';assert.equal(f.api.courseRemoteReaderFrame(frame),false);frame.src='https://unknown.invalid/mooc-ans/screen/file/mock';assert.equal(f.api.courseRemoteReaderFrame(frame),false);
   assert.equal(f.api.mediaAddressAllowed('https://mooc1.xuexitong.com/image/mock.png',f.doc),true);assert.equal(f.api.mediaAddressAllowed('https://mooc1.xuexitong.com.evil.invalid/image/mock.png',f.doc),false);
  }finally{f.close();}
 });

 await test('秒级定位：脱敏真实视频/测验/静态课件/讨论结构均可判定',()=>{
  const f=fixture([{tabs:[video()]}]);try{
   const result=name=>f.api.courseProbeSummary(f.api.courseProbeMarkup(f.d,taskProbeFixture(name)));
   assert.deepEqual(JSON.parse(JSON.stringify(result('video').tasks)),[{type:'video',completed:true,required:true}]);
   assert.equal(result('work').tasks[0].type,'quiz');assert.equal(f.api.courseTaskEligibility(result('work').tasks[0],{submit:false}).reason,'quiz-disabled');
   assert(result('static').known);assert.equal(result('static').tasks.length,0);assert.equal(result('insertbbs').tasks[0].required,false);assert.equal(result('insertbbs').tasks[0].type,'discussion');
   assert.equal(f.d.querySelectorAll('.ans-module').length,0);assert.equal(f.requests.length,0);assert.equal(f.submits,0);
  }finally{f.close();}
 });
 await test('秒级定位：空数组仍需完整静态结构，动态和未知占位不能排除',()=>{
  const f=fixture([{tabs:[video()]}]);try{for(const dynamic of ['<iframe></iframe>','<canvas></canvas>','<div class="ans-module"></div>','<div data-loading></div>','<button>加载</button>','<a onclick="load()">加载</a>']){
   const raw=taskProbeFixture('static').replace('</div>',dynamic+'</div>');assert.equal(f.api.courseProbeSummary(f.api.courseProbeMarkup(f.d,raw)).known,false,dynamic);
  }assert.equal(f.api.courseProbeSummary(f.api.courseProbeMarkup(f.d,'<div class="ans-cc"></div>')).known,false);}finally{f.close();}
 });
 await test('秒级定位：讨论名称可变化，任务ID/声明/标记任一存在均不自动排除',()=>{
  const f=fixture([{tabs:[video()]}]);try{
   const parse=html=>f.api.courseProbeSummary(f.api.courseProbeMarkup(f.d,html));const raw=taskProbeFixture('insertbbs');assert.equal(parse(raw.replaceAll('脱敏标题','任意栏目名称')).tasks[0].required,false);
   for(const html of [raw.replace('"module":"insertbbs"','"jobid":"new-job","module":"insertbbs"'),raw.replace('"property":','"job":true,"property":'),raw.replace('</div>','<span class="ans-job-icon"></span></div>'),raw.replace('"fixture-mid"','"fixture-mid","_jobid":"new-job"'),raw.replace('</div>','<iframe class="ans-module unknown-task"></iframe></div>')]){
    const summary=parse(html);assert(!summary.known||summary.tasks.some(task=>task.required!==false));
   }
  }finally{f.close();}
 });
 await test('秒级定位：已完成视频和关闭测验之间的静态/讨论栏零原生切换',async()=>{
  const f=fixture([{tabs:[{...video({learned:true}),probeHTML:taskProbeFixture('video')},{title:'资料',tasks:[],probeHTML:taskProbeFixture('static')},{...quiz(),probeHTML:taskProbeFixture('work')},{title:'任意讨论标题',tasks:[],probeHTML:taskProbeFixture('insertbbs')}]},{tabs:[video()]}],{probe:true});
  try{const r=await f.runner.start({submit:false});assert.equal(r.status,'done',r.reason);assert.equal(r.videos,1);assert.equal(r.chapters[0].status,'manual-pending');assert(!f.events.some(e=>e.startsWith('tab:0:')||e.startsWith('play:0:')));assert.equal(f.requests.length,0);assert.equal(f.submits,0);assert.equal(f.d.querySelector('#cur1 .icon_Completed'),null);assert(f.maxProbeActive<=4);}finally{f.close();}
 });
 await test('秒级定位：跨章乱序返回仍选前面的任务，最大并发4',async()=>{
  const f=fixture([{tabs:[quiz()]},{tabs:[video()]},{tabs:[video()]},{tabs:[video()]},{tabs:[video()]},{tabs:[video()]}],{probe:true,probeDelay:url=>url.pathname.endsWith('studentstudyAjax')?2:Number(url.searchParams.get('knowledgeid'))===2?45:2});
  try{const r=await f.api.findNextCourseTask(probeRange(f),probeSettings(f),new f.w.AbortController().signal);assert.equal(r.entry.id,'cur2');assert.equal(r.tab.id,'dct1');assert(f.maxProbeActive>1&&f.maxProbeActive<=4);assert(!f.probeRequests.some(item=>item.chapter>=5));assert.equal(f.events.length,0);assert.equal(f.requests.length,0);assert.equal(f.submits,0);}finally{f.close();}
 });
 await test('秒级定位：前面的未知栏目优先核实，不能选后面已知视频',async()=>{
  const f=fixture([{tabs:[{...video(),probeAttachments:[{type:'future-module',jobid:'mock',isPassed:false}]}]},{tabs:[video()]}],{probe:true});try{const r=await f.api.findNextCourseTask(probeRange(f),probeSettings(f),new f.w.AbortController().signal);assert.equal(r.entry.id,'cur1');assert.equal(r.tab.id,'dct1');assert.equal(r.reason,'live-task-conflict');assert.equal(f.events.length,0);}finally{f.close();}
 });
 await test('秒级定位：目标确定取消后续在途请求，迟到响应不会写入缓存或继续探测',async()=>{
  const f=fixture([{tabs:[video()]},{tabs:[video()]},{tabs:[video()]},{tabs:[video()]}],{probe:true,probeLate:true,probeDelay:url=>Number(url.searchParams.get('knowledgeid')||url.searchParams.get('chapterId'))===1?2:60});
  try{const range=probeRange(f),settings=probeSettings(f);const r=await f.api.findNextCourseTask(range,settings,new f.w.AbortController().signal);assert.equal(r.entry.id,'cur1');const count=f.probeRequests.length;assert(f.probeAborts.length>0);await delay(90);assert.equal(f.probeRequests.length,count);assert.equal(f.events.length,0);
   const before=f.probeRequests.length,probe=await f.api.courseTaskProbe(f.d,range[1],{signal:new f.w.AbortController().signal});assert(probe.known);assert(f.probeRequests.length>before);
  }finally{f.close();}
 });
 await test('秒级定位：60秒内命中缓存，过期重新读取，刷新实例没有旧缓存',async()=>{
  let clock=0,hits=0;const chapters=[{tabs:[quiz()]},{tabs:[video()]}],f=fixture(chapters,{probe:true});
  try{const options={...probeSettings(f),now:()=>clock,onCacheHit:()=>hits++},scan=()=>f.api.findNextCourseTask(probeRange(f),options,new f.w.AbortController().signal);
   assert.equal((await scan()).entry.id,'cur2');const count=f.probeRequests.length;assert.equal((await scan()).entry.id,'cur2');assert.equal(f.probeRequests.length,count);assert(hits>0);clock=60001;await scan();assert(f.probeRequests.length>count);
  }finally{f.close();}
  const g=fixture(chapters,{probe:true});try{await g.api.findNextCourseTask(probeRange(g),probeSettings(g),new g.w.AbortController().signal);assert(g.probeRequests.length>0);}finally{g.close();}
 });
 await test('秒级定位：相同请求共享进行中Promise，一个消费者取消不影响另一个',async()=>{
  const f=fixture([{tabs:[quiz()]},{tabs:[video()]}],{probe:true,probeDelay:25});try{const entry=probeRange(f)[1],a=new f.w.AbortController(),b=new f.w.AbortController();let dedup=0;
   const first=f.api.courseTaskProbe(f.d,entry,{signal:a.signal,onDeduplicated:()=>dedup++}).catch(()=>null),second=f.api.courseTaskProbe(f.d,entry,{signal:b.signal,onDeduplicated:()=>dedup++});await delay(5);a.abort();assert.equal(await first,null);assert((await second).known);assert.equal(f.probeRequests.length,1);assert(dedup>0);assert.equal(f.probeAborts.length,0);
  }finally{f.close();}
 });
 await test('秒级定位：两个定位入口共用全局4路限制',async()=>{
  const f=fixture(Array.from({length:8},()=>({tabs:[quiz()]})),{probe:true,probeDelay:5});try{const a=f.api.findNextCourseTask(probeRange(f),probeSettings(f),new f.w.AbortController().signal),b=f.api.findNextCourseTask(probeRange(f),probeSettings(f),new f.w.AbortController().signal);assert.equal((await a).entry,null);assert.equal((await b).entry,null);assert(f.maxProbeActive<=4);assert(f.maxProbeActive>1);}finally{f.close();}
 });
 await test('秒级定位：目录计数和显式完成事件按章清缓存，不清其他章',async()=>{
  const f=fixture([{tabs:[quiz()]},{tabs:[quiz()]},{tabs:[video()]}],{probe:true});try{const scan=()=>f.api.findNextCourseTask(probeRange(f),probeSettings(f),new f.w.AbortController().signal);await scan();let before=f.probeRequests.length;f.api.courseInvalidateTaskProbe(f.d,'cur2');await scan();const requests=f.probeRequests.slice(before);assert(requests.some(x=>x.chapter===1));assert(!requests.some(x=>x.chapter===2));
   before=f.probeRequests.length;f.d.querySelector('#cur2 .orangeNew').textContent='2';const r=await scan();assert.equal(r.entry.id,'cur2');assert.equal(r.probe.reason,'pending-count-mismatch');assert(f.probeRequests.slice(before).some(x=>x.chapter===1));
  }finally{f.close();}
 });
 await test('秒级定位：未知/失败不缓存为无任务，下次允许重新读取',async()=>{
  let failing=true;const f=fixture([{tabs:[quiz()]},{tabs:[video()]}],{probe:true,probeFail:()=>failing});try{let range=probeRange(f),r=await f.api.findNextCourseTask(range,probeSettings(f),new f.w.AbortController().signal);assert.equal(r.entry.id,'cur2');assert.equal(r.probe.known,false);const count=f.probeRequests.length;failing=false;r=await f.api.findNextCourseTask(probeRange(f),probeSettings(f),new f.w.AbortController().signal);assert.equal(r.entry.id,'cur2');assert.equal(r.probe.known,true);assert(f.probeRequests.length>count);}finally{f.close();}
 });
 await test('秒级定位：就绪快路径核对栏目、Document URL、状态和实际控件',()=>{
  const f=fixture([{tabs:[video(),video()]}],{probe:true});try{const target={chapterId:'cur1',tabId:'dct1',type:'video'};assert(f.api.courseTaskTargetReady(f.d,target));assert(!f.api.courseTaskTargetReady(f.d,{...target,tabId:'dct2'}));assert(!f.api.courseTaskTargetReady(f.d,{...target,type:'document'}));
   const url=f.doc.URL;for(const bad of ['about:blank',url.replace('num=0','num=1')]){Object.defineProperty(f.doc,'URL',{value:bad,configurable:true});assert(!f.api.courseTaskTargetReady(f.d,target));}Object.defineProperty(f.doc,'URL',{value:url,configurable:true});Object.defineProperty(f.doc,'readyState',{value:'loading',configurable:true});assert(!f.api.courseTaskTargetReady(f.d,target));Object.defineProperty(f.doc,'readyState',{value:'complete',configurable:true});f.doc.body.insertAdjacentHTML('beforeend','<div data-loading></div>');assert(!f.api.courseTaskTargetReady(f.d,target));
  }finally{f.close();}
 });
 await test('秒级定位：缓存原始摘要，设置变化重新判断测验资格',async()=>{
  const f=fixture([{tabs:[quiz()]},{tabs:[video()]}],{probe:true});try{const signal=new f.w.AbortController().signal;assert.equal((await f.api.findNextCourseTask(probeRange(f),probeSettings(f),signal)).entry.id,'cur2');const before=f.probeRequests.length;const r=await f.api.findNextCourseTask(probeRange(f),{...probeSettings(f),submit:true},signal);assert.equal(r.entry.id,'cur1');assert.equal(r.targetType,'quiz');assert.equal(f.probeRequests.length,before);assert.equal(f.requests.length,0);assert.equal(f.submits,0);}finally{f.close();}
 });
 await test('秒级定位：当前栏目cardId变化清理该章旧结构缓存',async()=>{
  const f=fixture([{tabs:[quiz()]},{tabs:[video()]}],{probe:true});try{let entry=probeRange(f)[1];const probe=await f.api.courseTaskProbe(f.d,entry);await probe.read(probe.tabs[0]);f.d.querySelector('#cur2 .posCatalog_name').click();f.d.querySelector('#dct1').setAttribute('cardid','changed-card');entry=probeRange(f)[1];const changed=await f.api.courseTaskProbe(f.d,entry);assert.equal(changed.tabs[0].cardId,'changed-card');f.d.querySelector('#cur1 .posCatalog_name').click();const before=f.probeRequests.length;await f.api.courseTaskProbe(f.d,probeRange(f)[1]);assert.equal(f.probeRequests.length,before+1);}finally{f.close();}
 });
 await test('秒级定位：账号变化取消整个请求池，保留任务未完成状态',async()=>{
  const f=fixture([{tabs:[quiz()]},{tabs:[video()]},{tabs:[video()]},{tabs:[video()]}],{probe:true,probeDelay:50});try{const pending=f.runner.start({submit:false});await waitForTest(()=>f.probeRequests.length>=3);f.w.history.replaceState({},'','?courseId=mock-course&clazzid=mock-class&cpi=changed-account');const r=await pending;assert.equal(r.status,'stopped');assert.match(r.reason,/账号已变化/);assert(f.probeAborts.length>0);const count=f.probeRequests.length;await delay(70);assert.equal(f.probeRequests.length,count);assert.equal(f.events.filter(e=>/^(play|tab|chapter):/.test(e)).length,0);assert.equal(f.requests.length,0);assert.equal(f.submits,0);assert(!f.api.courseRunActive(f.d));}finally{f.close();}
 });
 await test('秒级定位：控件已就绪不固定等待2秒，原生只跳最终目标',async()=>{
  const sleeps=[],f=fixture([{tabs:[quiz()]},{tabs:[quiz(),video()]}],{probe:true,limits:{frameReadDelayMs:2000},sleep:ms=>{sleeps.push(ms);return delay(ms);}});try{const r=await f.runner.start({submit:false});assert.equal(r.status,'done',r.reason);assert(!sleeps.includes(2000));assert(r.locator.readyHits>0);assert.deepEqual(f.events.filter(e=>/^(chapter|tab):/.test(e)),['chapter:1','tab:1:1']);assert.equal(r.videos,1);assert.equal(f.submits,0);}finally{f.close();}
 });
 await test('秒级定位：过渡Document仍按原间隔等待，加载完成后继续',async()=>{
  const sleeps=[],f=fixture([{tabs:[video()]}],{probe:true,limits:{frameReadDelayMs:20},sleep:ms=>{sleeps.push(ms);return delay(ms);}});try{Object.defineProperty(f.doc,'URL',{value:'about:blank',configurable:true});const url=f.d.querySelector('#iframe').getAttribute('src'),timer=setTimeout(()=>Object.defineProperty(f.doc,'URL',{value:url,configurable:true}),8);const r=await f.runner.start({submit:false});clearTimeout(timer);assert.equal(r.status,'done',r.reason);assert(sleeps.includes(20));assert.equal(r.videos,1);}finally{f.close();}
 });
 await test('秒级定位：21章100ms读取性能样本，冷定位5秒内和缓存300ms内',async()=>{
  const chapters=Array.from({length:20},()=>({tabs:[{...video({learned:true}),probeHTML:taskProbeFixture('video')},{title:'课件',tasks:[],probeHTML:taskProbeFixture('static')},{...quiz(),probeHTML:taskProbeFixture('work')},{title:'讨论',tasks:[],probeHTML:taskProbeFixture('insertbbs')}]}));chapters.push({tabs:[video()]});const f=fixture(chapters,{probe:true,probeDelay:100});
  try{let hits=0;const options={...probeSettings(f),onCacheHit:()=>hits++},start=performance.now();const cold=await f.api.findNextCourseTask(probeRange(f),options,new f.w.AbortController().signal);const coldMs=performance.now()-start,requests=f.probeRequests.length;
   const warmStart=performance.now(),warm=await f.api.findNextCourseTask(probeRange(f),options,new f.w.AbortController().signal),warmMs=performance.now()-warmStart;
   // Same readers and inputs, one awaited read at a time: isolates the concurrency benefit.
   const serialFixture=fixture(chapters,{probe:true,probeDelay:100});let serialReference;
   try{const serialStart=performance.now();let target;
    outer:for(const entry of probeRange(serialFixture)){const probe=await serialFixture.api.courseTaskProbe(serialFixture.d,entry);assert(probe.known);for(const tab of probe.tabs){const summary=await probe.read(tab);assert(summary.known);if(summary.tasks.some(task=>serialFixture.api.courseTaskEligibility(task,probeSettings(serialFixture)).status!=='excluded')){target=entry.id;break outer;}}}
    serialReference={elapsedMs:Math.round(performance.now()-serialStart),requests:serialFixture.probeRequests.length,maxInFlight:serialFixture.maxProbeActive,target};assert.equal(target,'cur21');assert.equal(serialReference.maxInFlight,1);
   }finally{serialFixture.close();}
   assert.equal(cold.entry.id,'cur21');assert.equal(warm.entry.id,'cur21');assert.equal(f.events.length,0);assert.equal(f.probeRequests.length,requests);assert(f.maxProbeActive<=4);assert(coldMs<5000,'cold '+coldMs);assert(warmMs<300,'warm '+warmMs);
   fs.writeFileSync(path.join(__dirname,'task-locator-fast-results.json'),JSON.stringify({fixture:'mock-only',chapters:21,tabsBeforeTarget:80,requestDelayMs:100,serialReference,coldMs:Math.round(coldMs),warmMs:Math.round(warmMs),requests,cacheHits:hits,maxInFlight:f.maxProbeActive,nativeColumnSwitches:0,playCalls:0,modelCalls:f.requests.length,submissions:f.submits},null,2));
  }finally{f.close();}
 });
 await test('其他功能：默认关闭，不自动启动尚未播放的视频',async()=>{
  const f=fixture([{tabs:[video({manual:true})]}]);let guard;
  try{const s=f.d.getElementById('cx-ai-study-root').shadowRoot;assert(!s.getElementById('other-keep-video-playing').checked);assert(!s.getElementById('other-hide-platform-ai').checked);guard=f.api.createManualVideoProtection(f.d);guard.tick();assert.equal(guard.activeVideo,null);assert.equal(f.events.length,0);assert.equal(f.requests.length,0);assert.equal(f.submits,0);}finally{guard?.close();f.close();}
 });
 for(const environment of ['mouseout','blur','hidden','none'])await test('其他功能：手动观看未知暂停有界恢复，环境='+environment,async()=>{
  let clock=0;const f=fixture([{tabs:[video({manual:true,duration:60})]}]);let guard;
  try{const v=f.videos[0];await v.play();guard=f.api.createManualVideoProtection(f.d,{now:()=>clock});guard.tick();assert.equal(guard.activeVideo,v);let exits=0;f.w.addEventListener('mouseout',()=>exits++);
   if(environment==='mouseout'){f.w.dispatchEvent(new f.w.MouseEvent('mouseout',{relatedTarget:null}));assert.equal(exits,0);}else if(environment!=='none')foregroundFixture(f)(environment!=='hidden',false);
   v.pause();clock=2999;guard.tick();assert.equal(v.startAttemptTimes.length,1);clock=3000;guard.tick();await delay(0);assert.equal(v.startAttemptTimes.length,2);assert(!v.paused);assert.equal(v.playbackRate,1);assert.equal(v.currentTime,0);assert.equal(f.submits,0);assert.equal(f.requests.length,0);
   guard.close();f.w.dispatchEvent(new f.w.MouseEvent('mouseout',{relatedTarget:null}));assert.equal(exits,1);
  }finally{guard?.close();f.close();}
 });
 await test('其他功能：无效恢复最多8次，原生播放累计10秒后恢复额度',async()=>{
  let clock=0;const f=fixture([{tabs:[video({manual:true,duration:100})]}]);let guard;
  try{const v=f.videos[0];await v.play();guard=f.api.createManualVideoProtection(f.d,{now:()=>clock});guard.tick();v.pause();const original=v.play;v.play=()=>{f.events.push('manual-recovery');return Promise.resolve();};
   for(let i=0;i<10;i++){clock+=3000;guard.tick();await delay(0);}assert.equal(f.events.filter(x=>x==='manual-recovery').length,8);assert.match(guard.status,/上限/);
   v.play=original;await v.play();for(let i=1;i<=9;i++){clock+=1000;v.simulateMedia({seconds:i,natural:true});guard.tick();}v.pause();clock+=3000;guard.tick();assert.equal(v.startAttemptTimes.length,2);
   await v.play();clock+=1000;v.simulateMedia({seconds:10,natural:true});guard.tick();v.pause();clock+=3000;guard.tick();await delay(0);assert.equal(v.startAttemptTimes.length,4);assert(!v.paused);
  }finally{guard?.close();f.close();}
 });
 await test('其他功能：请求未结束不并行恢复，关闭后迟到结果没有后续操作',async()=>{
  let clock=0,resolve,attempts=0;const f=fixture([{tabs:[video({manual:true})]}]);let guard;
  try{const v=f.videos[0];await v.play();guard=f.api.createManualVideoProtection(f.d,{now:()=>clock});guard.tick();v.pause();v.play=()=>{attempts++;return new Promise(done=>resolve=done);};clock=3000;guard.tick();clock=9000;guard.tick();assert.equal(attempts,1);guard.close();resolve();await delay(0);clock+=3000;guard.tick();assert.equal(attempts,1);assert.equal(guard.activeVideo,null);
  }finally{guard?.close();f.close();}
 });
 for(const trusted of [true,false])await test('其他功能：手动暂停意图归属校验，可信='+trusted,async()=>{
  let clock=0;const f=fixture([{tabs:[video({manual:true})]}]);let guard;
  try{const v=f.videos[0];await v.play();guard=f.api.createManualVideoProtection(f.d,{now:()=>clock});guard.tick();playerInput(v,{trusted});v.pause();clock=3000;guard.tick();await delay(0);assert.equal(v.startAttemptTimes.length,trusted?1:2);if(trusted){assert.match(guard.status,/手动暂停/);await v.play();v.pause();clock+=3000;guard.tick();await delay(0);assert.equal(v.startAttemptTimes.length,3);}}
  finally{guard?.close();f.close();}
 });
 await test('其他功能：编辑器和其他视频点击不冒充当前视频暂停',async()=>{
  let clock=0;const f=fixture([{tabs:[{title:'双视频',tasks:[{kind:'video',manual:true},{kind:'video',manual:true}]}]}]);let guard;
  try{const [v,other]=f.videos;await v.play();guard=f.api.createManualVideoProtection(f.d,{now:()=>clock});guard.tick();const textarea=f.doc.createElement('textarea');f.doc.body.append(textarea);playerInput(v,{target:textarea});playerInput(other);v.pause();clock=3000;guard.tick();await delay(0);assert.equal(v.startAttemptTimes.length,2);assert(other.paused);
  }finally{guard?.close();f.close();}
 });
 for(const marker of ['data-face-verification','data-captcha','video-quiz','foreground'])await test('其他功能：平台门槛优先于恢复，类型='+marker,async()=>{
  let clock=0;const f=fixture([{tabs:[video({manual:true,foreground:marker==='foreground'})]}]);let guard;
  try{const v=f.videos[0];foregroundFixture(f)(true,true);await v.play();guard=f.api.createManualVideoProtection(f.d,{now:()=>clock});guard.tick();if(marker==='video-quiz')f.doc.body.insertAdjacentHTML('beforeend','<div class="ans-videoquiz"><a id="videoquiz-submit">提交</a></div>');else if(marker==='foreground')foregroundFixture(f)(false,false);else f.doc.body.insertAdjacentHTML('beforeend','<div '+marker+'>请验证</div>');v.pause();clock=3000;guard.tick();assert.equal(v.startAttemptTimes.length,1);assert.equal(f.requests.length,0);assert.equal(f.submits,0);
  }finally{guard?.close();f.close();}
 });
 await test('其他功能：定位位移不恢复额度，数据未就绪不尝试播放',async()=>{
  let clock=0;const f=fixture([{tabs:[video({manual:true,duration:100})]}]);let guard;
  try{const v=f.videos[0];await v.play();guard=f.api.createManualVideoProtection(f.d,{now:()=>clock,maxResumes:1});guard.tick();v.pause();clock=3000;guard.tick();await delay(0);clock+=1000;v.simulateMedia({seconds:30,seeking:true},'seeking');v.simulateMedia({seeking:false},'seeked');guard.tick();v.pause();clock+=3000;guard.tick();assert.equal(v.startAttemptTimes.length,2);assert.match(guard.status,/上限/);guard.close();guard=f.api.createManualVideoProtection(f.d,{now:()=>clock});await v.play();guard.tick();v.simulateMedia({readyState:0,paused:true},'pause');clock+=3000;guard.tick();assert.equal(v.startAttemptTimes.length,3);
  }finally{guard?.close();f.close();}
 });
 await test('其他功能：多播放器不混淆，节点替换释放旧监听和拦截',async()=>{
  const f=fixture([{tabs:[{title:'多视频',tasks:[{kind:'video',manual:true},{kind:'video',manual:true}]}]}]);let guard;
  try{const [a,b]=f.videos;await a.play();await b.play();guard=f.api.createManualVideoProtection(f.d);guard.tick();assert.equal(guard.activeVideo,null);b.pause();guard.tick();assert.equal(guard.activeVideo,a);a.remove();guard.tick();assert.equal(guard.activeVideo,null);assert.equal(a.testListeners.get('pause').size,0);assert.equal(a.testListeners.get('playing').size,0);assert.equal(f.submits,0);
  }finally{guard?.close();f.close();}
 });
 await test('其他功能：自动刷课接管期间让出保护，停止后手动观看恢复',async()=>{
  let clock=0;const f=fixture([{tabs:[video({manual:true,duration:60})]}]);let guard,p;
  try{const v=f.videos[0];await v.play();guard=f.api.createManualVideoProtection(f.d,{now:()=>clock});guard.tick();p=f.runner.start({skipLearned:false});await waitForTest(()=>f.api.courseRunActive(f.d));guard.tick();assert.equal(guard.activeVideo,null);assert.match(guard.status,/刷课/);f.runner.stop();await p;await v.play();guard.tick();assert.equal(guard.activeVideo,v);f.menus.get('隐藏助手全部界面')();v.pause();clock=3000;guard.tick();await delay(0);assert(!v.paused);assert.equal(f.d.getElementById('cx-ai-study-root').style.display,'none');
  }finally{f.runner.stop();if(p)await p;guard?.close();f.close();}
 });
 await test('其他功能：关闭开关和页面退出释放播放监听，重复初始化不叠加',async()=>{
  const f=fixture([{tabs:[video({manual:true})]}]);
  try{const v=f.videos[0],s=f.d.getElementById('cx-ai-study-root').shadowRoot,toggle=s.getElementById('other-keep-video-playing');await v.play();assert.equal(f.api.initOtherFeatures(f.d),f.api.initOtherFeatures(f.d));toggle.checked=true;toggle.dispatchEvent(new f.w.Event('change'));assert.equal(v.testListeners.get('pause').size,1);toggle.checked=false;toggle.dispatchEvent(new f.w.Event('change'));assert.equal(v.testListeners.get('pause').size,0);toggle.checked=true;toggle.dispatchEvent(new f.w.Event('change'));assert.equal(v.testListeners.get('pause').size,1);f.w.dispatchEvent(new f.w.Event('pagehide'));assert.equal(v.testListeners.get('pause').size,0);
  }finally{f.close();}
 });
 await test('任务定位：静态JSON解析不执行脚本，字符串/注释/正则/函数体伪赋值不生效',()=>{
  const f=fixture([{tabs:[video()]}]);try{
   const root=f.api.courseProbeMarkup(f.d,'<script>window.probeExecuted=true;/* mArg={"attachments":[]}; */const text="mArg={}";/;mArg={"fake":true};/;function later(){mArg={"fake":true};}var mArg="";mArg={"attachments":[{"type":"video","jobid":"mock","isPassed":false}]};</script><iframe src="https://invalid.example/player"></iframe>');
   assert.equal(f.w.probeExecuted,undefined);assert.equal(root.isConnected,false);assert.equal(f.api.courseProbeSummary(root).tasks[0].type,'video');
   for(const text of ['mArg={};mArg={};','mArg={attachments:[]};'])assert.equal(f.api.courseProbeArguments(f.api.courseProbeMarkup(f.d,'<script>'+text+'</script>')),null);
  }finally{f.close();}
 });
 await test('任务定位：开关决定任务适用性，空元数据不当作无任务',()=>{
  const f=fixture([{tabs:[video()]}]);try{
   const decide=(type,completed,settings={})=>f.api.courseTaskEligibility({type,completed,required:true},{submit:false,skipLearned:true,...settings});
   assert.equal(decide('quiz',null).reason,'quiz-disabled');assert.equal(decide('quiz',null,{submit:true}).status,'unknown');assert.equal(decide('video',true).reason,'already');assert.equal(decide('video',true,{skipLearned:false}).status,'eligible');assert.equal(decide('video',false).status,'eligible');assert.equal(decide('unknown',false).status,'unknown');assert.equal(decide('knowledge-graph',false).reason,'knowledge-graph');
   assert.equal(f.api.courseProbeSummary(f.api.courseProbeMarkup(f.d,'<script>mArg={"attachments":[]};</script><span class="ans-job-icon"></span>')).known,false);
  }finally{f.close();}
 });
 await test('任务定位：当前第③栏作为0坐标，前两栏零读取/切换/模型或播放',async()=>{
  const f=fixture([{tabs:[video(),quiz(),video()]}],{probe:true});try{
   f.d.querySelector('#dct3').click();f.events.length=0;const r=await f.runner.start({submit:false,fromCurrent:true});assert.equal(r.status,'done',r.reason);assert.equal(r.videos,1);assert.equal(r.quizzes,0);
   assert.deepEqual(f.probeRequests,[]);assert.deepEqual(f.events.filter(e=>/^(play|tab|chapter):/.test(e)),['play:0:2:0']);assert.equal(f.requests.length,0);assert.equal(f.storage.get(f.runner.key).rangeStart.tabId,'dct3');
  }finally{f.close();}
 });
 await test('任务定位：未勾从当前从首栏搜索，有序并发确定目标后停止读取',async()=>{
  const f=fixture([{tabs:[video(),video(),video()]},{tabs:[video()]}],{probe:true});try{
   f.d.querySelector('#dct3').click();f.events.length=0;const range=f.api.readCourseCatalog(f.d).entries.filter(x=>!x.isGroup);
   const result=await f.api.findNextCourseTask(range,{owner:f.d,submit:false,skipLearned:true},new f.w.AbortController().signal);
   assert.equal(result.tab.id,'dct1');assert.equal(result.entry.id,'cur1');const count=f.probeRequests.length;await delay(20);assert.equal(f.probeRequests.length,count);assert(f.probeRequests.some(x=>x.chapter===0&&x.tab===0));assert.equal(f.requests.length,0);assert.equal(f.submits,0);assert.equal(f.events.length,0);assert(f.maxProbeActive<=4);
  }finally{f.close();}
 });
 await test('任务定位：前章只剩关闭的测验，不打开栏目，直接处理后续视频',async()=>{
  const f=fixture([{tabs:[video({learned:true}),quiz()]},{tabs:[video(),video()]}],{probe:true});try{
   const r=await f.runner.start({submit:false});assert.equal(r.status,'done',r.reason);assert.equal(r.videos,2);assert.equal(r.chapters[0].status,'manual-pending');assert(!f.events.includes('tab:0:1'));assert(!f.events.some(x=>x.startsWith('play:0:')));assert.equal(f.requests.length,0);assert.equal(f.submits,0);assert(f.maxProbeActive<=4);assert.equal(f.d.querySelector('#cur1 .icon_Completed'),null);
  }finally{f.close();}
 });
 await test('任务定位：同栏视频/PPT/测验保持顺序，只排除测验',async()=>{
  const f=fixture([{tabs:[{title:'混合',tasks:[{kind:'video'},{kind:'quiz'},{kind:'ppt'}]},quiz()]}],{probe:true});try{
   const r=await f.runner.start({submit:false});assert.equal(r.status,'done',r.reason);assert.equal(r.videos,1);assert.equal(r.documents,1);assert.equal(f.submits,0);assert.equal(f.requests.length,0);assert.deepEqual(Array.from(r.chapters[0].tasks,t=>t.type),['video','quiz','document','quiz']);assert.equal(r.chapters[0].status,'manual-pending');assert(!f.events.includes('tab:0:1'));
  }finally{f.close();}
 });
 await test('任务定位：开启提交正常解题，关闭跳过已学可重新处理视频',async()=>{
  for(const submit of [false,true]){const f=fixture([{tabs:[video({learned:true}),quiz()]}],{probe:true});try{const r=await f.runner.start({submit,skipLearned:false});assert.equal(r.status,'done',r.reason);assert.equal(r.videos,1);assert.equal(f.submits,submit?1:0);assert.equal(f.requests.length,submit?1:0);}finally{f.close();}}
 });
 await test('任务定位：当前栏目边界随导航恢复，前两栏不重新执行',async()=>{
  const f=fixture([{tabs:[video(),quiz(),video({stall:true})]}],{probe:true});let saved,session,key=f.runner.key;
  try{f.d.querySelector('#dct3').click();const pending=f.runner.start({submit:false,fromCurrent:true});await waitForTest(()=>f.events.includes('play:0:2:0'));session=f.w.sessionStorage.getItem('cx-ai-course-session');f.w.dispatchEvent(new f.w.Event('pagehide'));await pending;saved=JSON.parse(JSON.stringify(f.storage.get(key)));saved.handoff=true;saved.status='running';saved.report.status='running';}finally{f.close();}
  const g=fixture([{tabs:[video(),quiz(),video()]}],{probe:true,storage:[[key,saved]],session,noAutoResume:true});try{const r=await g.runner.start({resume:true});assert.equal(r.status,'done',r.reason);assert.equal(r.videos,1);assert(!g.events.includes('play:0:0:0'));assert(g.events.includes('play:0:2:0'));assert.equal(g.submits,0);}finally{g.close();}
 });
 await test('任务定位：未知类型/空附件/缺完成状态回原页面核实视频',async()=>{
  for(const attachments of [[],[{type:'new-type',jobid:'mock',isPassed:false}],[{type:'video',jobid:'mock'}]]){const f=fixture([{tabs:[{...video(),probeAttachments:attachments}]}],{probe:true});try{const r=await f.runner.start({submit:false});assert.equal(r.status,'done',r.reason);assert.equal(r.videos,1);}finally{f.close();}}
 });
 await test('任务定位：网络失败或地址不匹配回原流程，不漏实际视频',async()=>{
  for(const failure of ['network','scope']){const f=fixture([{tabs:[quiz(),video()]}],{probe:true,probeFail:failure==='network'});try{
   if(failure==='scope'){const frame=f.d.querySelector('#iframe'),original=frame.getAttribute;frame.getAttribute=name=>name==='src'?original(name).replace('courseid=mock-course','courseid=other'):original(name);}
   const r=await f.runner.start({submit:false});assert.equal(r.status,'done',r.reason);assert.equal(r.videos,1);assert.equal(f.submits,0);if(failure==='scope')assert.equal(f.probeRequests.length,0);
  }finally{f.close();}}
 });
 await test('任务定位：停止取消与迟到响应没有后续操作并释放运行锁',async()=>{
  const f=fixture([{tabs:[video({learned:true}),quiz()]},{tabs:[video()]}],{probe:true,probeDelay:40,probeLate:true});try{const pending=f.runner.start({submit:false});await waitForTest(()=>f.probeRequests.length>0);f.runner.stop();const r=await pending;await delay(70);assert.equal(r.status,'stopped');assert(!f.events.some(e=>/^(play|tab|chapter):/.test(e)));assert.equal(f.requests.length,0);assert.equal(f.submits,0);assert(!f.runner.busy);assert(!f.api.courseRunActive(f.d));}finally{f.close();}
 });
 await test('任务定位：读取摘要时跳过本章，中止旧请求后只执行后续章节',async()=>{
  const f=fixture([{tabs:[video({learned:true}),quiz()]},{tabs:[video()]}],{probe:true,probeDelay:30});try{const pending=f.runner.start({submit:false});await waitForTest(()=>f.probeRequests.length>0);assert(f.runner.skip());const r=await pending;assert.equal(r.status,'done',r.reason);assert.equal(r.chapters[0].status,'skipped');assert.equal(r.videos,1);assert(!f.events.some(e=>e.startsWith('play:0:')));assert.equal(f.submits,0);}finally{f.close();}
 });
 await test('任务定位：读取期间人工换栏或目录变化取消旧定位',async()=>{
  for(const change of ['tab','catalog']){const f=fixture([{tabs:[video({learned:true}),quiz(),video()]}],{probe:true,probeDelay:30});try{const pending=f.runner.start({submit:false});await waitForTest(()=>f.probeRequests.length>0);if(change==='tab')f.d.querySelector('#dct3').click();else f.d.querySelector('#cur1').id='cur-removed';const r=await pending;assert.equal(r.status,'stopped');assert.match(r.reason,/定位期间|课程目录/);assert(!f.events.some(e=>e.startsWith('play:')));assert.equal(f.submits,0);}finally{f.close();}}
 });
 await test('任务定位：目录完成先筛选，不读取已完成章节',async()=>{
  const f=fixture([{already:true,tabs:[video()]},{tabs:[video()]}],{probe:true});try{const r=await f.runner.start({submit:false});assert.equal(r.status,'done',r.reason);assert.equal(r.chapters[0].status,'already');assert(f.probeRequests.every(x=>x.chapter!==0));assert.equal(r.videos,1);}finally{f.close();}
 });
 await test('任务定位：人脸和验证码优先停止，定位期间零请求',async()=>{
  for(const marker of ['data-face-verification','data-captcha']){const f=fixture([{tabs:[quiz(),video()]}],{probe:true});try{f.doc.body.insertAdjacentHTML('afterbegin','<div '+marker+'>请验证</div>');const r=await f.runner.start({submit:false});assert.equal(r.status,'stopped');assert.equal(f.probeRequests.length,0);assert.equal(f.requests.length,0);assert.equal(f.submits,0);}finally{f.close();}}
 });
 await test('任务定位：未确认提交禁用快速排除，沿既有核对流程处理',async()=>{
  const f=fixture([{tabs:[quiz()]}],{probe:true});try{f.storage.set(f.runner.key,{status:'stopped',report:{chapters:[{tasks:[{type:'quiz',status:'stopped',submissionStarted:true}]}]}});const r=await f.runner.start({submit:false});assert.equal(r.status,'done',r.reason);assert.equal(f.probeRequests.length,0);assert.equal(r.locator.fallbacks,1);assert.equal(f.submits,0);assert.equal(r.chapters[0].status,'manual-pending');}finally{f.close();}
 });
 await test('任务定位：目录待完成数大于已映射任务时不提前排除整章',async()=>{
  const f=fixture([{tabs:[quiz()]}],{probe:true});try{f.d.querySelector('#cur1 .orangeNew').textContent='2';const range=f.api.readCourseCatalog(f.d).entries.filter(x=>!x.isGroup);const r=await f.api.findNextCourseTask(range,{owner:f.d,submit:false,skipLearned:true},new f.w.AbortController().signal);assert.equal(r.entry.id,'cur1');assert.equal(r.probe.reason,'pending-count-mismatch');assert.equal(f.submits,0);}finally{f.close();}
 });
 await test('任务定位：人工重试仅处理原队列及原栏目边界',async()=>{
  const f=fixture([{tabs:[video(),quiz(),quiz()]}],{probe:true});try{f.d.querySelector('#dct3').click();await f.runner.start({submit:false,fromCurrent:true});assert(f.runner.canRetry);f.events.length=0;const r=await f.runner.retryIncomplete(undefined,{submit:true});assert.equal(r.status,'done',r.reason);assert.equal(f.submits,1);assert(!f.events.includes('tab:0:0'));assert(!f.events.includes('tab:0:1'));assert.equal(r.videos,0);}finally{f.close();}
 });
 await test('任务定位：任务摘要与当前DOM冲突时核实页面，不漏实际未完成任务',async()=>{
  const f=fixture([{tabs:[{...video(),probeAttachments:[{type:'video',isPassed:true,jobid:'mock'}]}]}],{probe:true});try{const r=await f.runner.start({submit:false});assert.equal(r.status,'done',r.reason);assert.equal(r.videos,1);assert(f.events.includes('play:0:0:0'));}finally{f.close();}
 });
 await test('任务定位：记录切换/摘要请求/耗时，较逐栏核实减少切换',async()=>{
  const samples=[];for(const probe of [false,true]){const f=fixture([{tabs:[video({learned:true}),quiz(),quiz()]},{tabs:[video()]}],{probe}),began=Date.now();try{const r=await f.runner.start({submit:false});assert.equal(r.status,'done',r.reason);assert.equal(r.videos,1);samples.push({mode:probe?'indexed':'page-by-page',chapterNavigations:f.events.filter(e=>e.startsWith('chapter:')).length,tabNavigations:f.events.filter(e=>e.startsWith('tab:')).length,requests:f.probeRequests.length,elapsedMs:Date.now()-began});}finally{f.close();}}
  assert(samples[1].tabNavigations<samples[0].tabNavigations);fs.writeFileSync(path.join(__dirname,'task-locator-results.json'),JSON.stringify({fixture:'mock-only',samples},null,2));
 });
 await test('倍速集成：真实菜单DOM与模拟缺失组件字段正常选择2x',async()=>{const f=fixture([{tabs:[video({nativeSpeed:{nativeMarkup:true,omitItemRate:true}})]}],{autoContext:false});try{const r=await f.runner.start({speedEnabled:true});assert.equal(r.status,'done',r.reason);assert.equal(r.videos,1);assert.deepEqual(f.videos[0].speedFixture.clicks,[2]);assert.equal(r.chapters[0].tasks[0].speedState.evidence,'native-configuration-and-dom-menu');assert.equal(f.submits,0);}finally{f.close();}});
 await test('倍速集成：同页多视频独立选择，禁止档位不变且正常确认完成',async()=>{const f=fixture([{tabs:[{title:'视频',tasks:[{kind:'video',nativeSpeed:{}},{kind:'video',nativeSpeed:{rates:false}},{kind:'video',nativeSpeed:{rates:[1,1.5]}}]}]}],{autoContext:false});try{const r=await f.runner.start({speedEnabled:true});assert.equal(r.status,'done',r.reason);assert.equal(r.videos,3);assert.deepEqual(f.videos.map(v=>v.speedFixture.clicks),[[2],[],[1.5]]);assert.equal(f.storage.get(f.runner.key).speedEnabled,true);}finally{f.close();}});
 await test('倍速集成：默认关闭与视频信息识别开启时都不点击倍速',async()=>{for(const recognition of [false,true]){const f=fixture([{tabs:[video({nativeSpeed:{}})]}],{autoContext:recognition});try{const r=await f.runner.start({speedEnabled:recognition});assert.equal(r.videos,1,r.reason);assert.equal(f.videos[0].speedFixture.clicks.length,0);assert.equal(r.chapters[0].tasks[0].speedState.outcome,recognition?'recognition-enabled':'switch-off');}finally{f.close();}}});
 await test('倍速集成：开关持久化且运行期间冻结',async()=>{const f=fixture([{tabs:[video({manual:true,nativeSpeed:{}})]}],{autoContext:false});let p;try{const s=f.d.getElementById('cx-ai-study-root').shadowRoot,t=s.getElementById('course-speed-enabled');assert(!t.checked);t.checked=true;t.dispatchEvent(new f.w.Event('change'));assert.equal(f.storage.get('cx_course_speed_enabled'),true);s.getElementById('course-start').click();await waitForTest(()=>f.videos[0].speedFixture.clicks.length===1);assert(t.disabled);t.checked=false;t.dispatchEvent(new f.w.Event('change'));assert(t.checked);assert.equal(f.storage.get(f.runner.key).speedEnabled,true);f.runner.stop();await waitForTest(()=>!f.d.getElementById('cx-ai-course-lease')?.getAttribute('data-run-id'));assert(!t.disabled);}finally{f.runner.stop();f.close();}});
 await test('倍速集成：人工暂停期间不选择倍速菜单',async()=>{const f=fixture([{tabs:[video({manual:true,nativeSpeed:{}})]}],{autoContext:false});let p;try{const v=f.videos[0];v.speedFixture.options.playbackRates=false;v.speedFixture.holder.classList.add('vjs-hidden');p=f.runner.start({speedEnabled:true});await waitForTest(()=>!v.paused);playerInput(v);v.pause();v.speedFixture.options.playbackRates=[.75,1,1.25,1.5,2];v.speedFixture.holder.classList.remove('vjs-hidden');await delay(30);assert.equal(v.speedFixture.clicks.length,0);assert(v.paused);f.runner.stop();await p;}finally{f.runner.stop();if(p)await p;f.close();}});
 await test('倍速集成：导航接力保留开关，旧会话缺字段默认关闭',async()=>{
  const chapters=[{tabs:[video({nativeSpeed:{}})]},{tabs:[video({nativeSpeed:{rates:[1,1.5]}})]}];let stored,session;
  const first=fixture(chapters,{navigateOut:true,autoContext:false});try{const r=await first.runner.start({speedEnabled:true});assert.equal(r.status,'running');stored=[...first.storage];session=first.w.sessionStorage.getItem('cx-ai-course-session');}finally{first.close();}
  for(const legacy of [false,true]){const values=JSON.parse(JSON.stringify(stored));if(legacy)for(const [key,value]of values)if(key.startsWith('cx_course_run:'))delete value.speedEnabled;
   const f=fixture(chapters,{storage:values,session,noAutoResume:true});try{const r=await f.runner.resumeIfNeeded();assert.equal(r.status,'done',r.reason);assert.equal(r.videos,2);const selected=f.videos.flatMap(v=>v.speedFixture?.clicks||[]);assert.deepEqual(selected,legacy?[]:[1.5]);assert.equal(f.storage.get(f.runner.key).speedEnabled,!legacy);}finally{f.close();}
  }
 });
 await test('倍速集成：视频弹题人工等待期间不选择菜单',async()=>{const f=fixture([{tabs:[video({manual:true,nativeSpeed:{}})]}],{autoContext:false});let p;try{const v=f.videos[0];v.speedFixture.options.playbackRates=false;v.speedFixture.holder.classList.add('vjs-hidden');p=f.runner.start({speedEnabled:true});await waitForTest(()=>!v.paused);const popup=videoPopup(f,v,{type:'简答题',text:'请手写后拍照上传'});v.pause();v.speedFixture.options.playbackRates=[.75,1,1.25,1.5,2];v.speedFixture.holder.classList.remove('vjs-hidden');await waitForTest(()=>f.runner.report.chapters[0].tasks[0].videoQuizzes.some(item=>item.phase==='manual-wait'));assert.equal(v.speedFixture.clicks.length,0);assert.equal(popup.confirms,0);f.runner.stop();await p;}finally{f.runner.stop();if(p)await p;f.close();}});
 await test('旧版后台恢复：早期鼠标拦截仅保护当前正在播放的视频，停止即释放',async()=>{
  const f=fixture([{tabs:[video({manual:true,duration:5})]}]);let p;let received=0;
  const exit=target=>f.w.dispatchEvent(new f.w.MouseEvent('mouseout',{relatedTarget:target}));
  try{f.w.addEventListener('mouseout',()=>received++);assert.equal(f.api.initBackgroundPlayback(),f.api.backgroundPlaybackGuard);
   exit(null);assert.equal(received,1);p=f.runner.start();await waitForTest(()=>!f.videos[0].paused);
   exit(null);assert.equal(received,1);assert.equal(f.runner.report.chapters[0].tasks[0].backgroundState.interceptedMouseouts,1);
   exit(f.d.body);assert.equal(received,2);f.runner.stop();exit(null);assert.equal(received,3);const r=await p;assert.equal(r.videos,0);
   f.api.backgroundPlaybackGuard.close();f.api.backgroundPlaybackGuard.close();exit(null);assert.equal(received,4);
  }finally{f.runner.stop();if(p)await p;f.close();}
 });
 for(const reason of ['none','mouseout','blur','hidden'])await test('旧版后台恢复：未知暂停正常恢复，环境='+reason,async()=>{
  const f=fixture([{tabs:[video({manual:true,duration:5})]}]);const foreground=foregroundFixture(f);let p;
  try{p=f.runner.start();await waitForTest(()=>!f.videos[0].paused);const v=f.videos[0];
   if(reason==='mouseout')f.w.dispatchEvent(new f.w.MouseEvent('mouseout',{relatedTarget:null}));
   if(reason==='blur')foreground(true,false);if(reason==='hidden')foreground(false,false);
   v.pause();await waitForTest(()=>f.events.filter(e=>e.startsWith('play:')).length===2);
   assert(!v.paused);assert.equal(v.playbackRate,1);assert.equal(f.runner.report.chapters[0].tasks[0].pauseState.waitCount,0);
   finishManual(v);const r=await p;assert.equal(r.status,'done',r.reason);assert.equal(r.videos,1);assert.equal(r.chapters[0].tasks[0].resumes,1);
   assert.match(f.api.courseReportText(r),/后台播放保护记录/);
  }finally{f.runner.stop();if(p)await p;f.close();}
 });
 await test('旧版后台恢复：恢复冷却3秒，与首次启动的2秒冷却分开',async()=>{
  let clock=10000;const f=fixture([{tabs:[video({manual:true,duration:4})]}],{now:()=>clock,limits:{resumeMs:3000,videoStartRetryMs:2000,stallMs:10000}});let p;
  try{p=f.runner.start();await waitForTest(()=>!f.videos[0].paused);const v=f.videos[0];v.pause();clock+=2999;await delay(15);
   assert.equal(v.startAttemptTimes.length,1);assert(v.paused);clock++;await waitForTest(()=>v.startAttemptTimes.length===2);
   assert(!v.paused);finishManual(v);assert.equal((await p).videos,1);
  }finally{f.runner.stop();if(p)await p;f.close();}
 });
 for(const type of ['pointerdown','click','keydown'])await test('旧版后台恢复：可信'+type+'暂停保持暂停并解除鼠标拦截',async()=>{
  const f=fixture([{tabs:[video({manual:true,duration:5})]}]);let p;let received=0;
  try{f.w.addEventListener('mouseout',()=>received++);p=f.runner.start();await waitForTest(()=>!f.videos[0].paused);const v=f.videos[0];
   playerInput(v,{type});v.pause();await waitForTest(()=>f.runner.report.chapters[0].tasks[0].pauseState.waiting);await delay(40);
   f.w.dispatchEvent(new f.w.MouseEvent('mouseout',{relatedTarget:null}));assert.equal(received,1);assert.equal(v.startAttemptTimes.length,1);
   assert.match(f.runner.report.chapters[0].tasks[0].pauseState.reason,/手动暂停/);await v.play();finishManual(v);const r=await p;
   assert.equal(r.videos,1);assert.equal(r.chapters[0].tasks[0].resumes,0);
  }finally{f.runner.stop();if(p)await p;f.close();}
 });
 for(const targetKind of ['synthetic','other-video','textarea','quiz','expired','wrong-key'])await test('旧版后台恢复：不相关输入不能冒充暂停意图 '+targetKind,async()=>{
  const f=fixture([{tabs:[video({manual:true,duration:5})]}]);let p;
  try{p=f.runner.start();await waitForTest(()=>!f.videos[0].paused);const v=f.videos[0];let target=v;
   if(targetKind==='other-video'){target=f.doc.createElement('video');target.hidden=true;f.doc.body.append(target);}
   if(targetKind==='textarea'){target=f.doc.createElement('textarea');v.parentElement.append(target);}
   if(targetKind==='quiz'){const root=f.doc.createElement('div');root.className='ans-videoquiz';root.hidden=true;target=f.doc.createElement('button');root.append(target);v.parentElement.append(root);}
   playerInput(v,{target,trusted:targetKind!=='synthetic',type:targetKind==='wrong-key'?'keydown':'click',key:'ArrowRight'});
   if(targetKind==='expired')await delay(40);v.pause();await waitForTest(()=>v.startAttemptTimes.length===2);
   assert(!v.paused);finishManual(v);assert.equal((await p).videos,1);
  }finally{f.runner.stop();if(p)await p;f.close();}
 });
 await test('旧版后台恢复：生产可信检查拒绝夹具标记伪造及合成事件',async()=>{
  const f=fixture([{tabs:[video({manual:true,duration:5})]}],{genuineMediaInputs:true});let p;
  try{p=f.runner.start();await waitForTest(()=>!f.videos[0].paused);const v=f.videos[0];playerInput(v);v.pause();await waitForTest(()=>v.startAttemptTimes.length===2);
   assert(!v.paused);finishManual(v);assert.equal((await p).videos,1);
  }finally{f.runner.stop();if(p)await p;f.close();}
 });
 await test('旧版后台恢复：第8次无效恢复后等待人工，不存在第9次或下一章',async()=>{
  const f=fixture([{tabs:[video({pauseOnEveryPlay:true})]},{tabs:[video()]}],{limits:{maxResumes:8,resumeMs:6}});let p;
  try{p=f.runner.start({continueOnTimeout:true});await waitForTest(()=>f.runner.report.chapters[0].tasks[0]?.pauseState.waiting);
   const task=f.runner.report.chapters[0].tasks[0];assert.equal(task.resumes,8);assert.equal(task.backgroundState.recoveryAttempts,8);assert.equal(f.videos[0].startAttemptTimes.length,9);
   await delay(35);assert.equal(f.videos[0].startAttemptTimes.length,9);assert.equal(task.backgroundState.category,'recovery-blocked');assert.equal(f.runner.report.status,'running');assert.equal(f.runner.report.videos,0);assert(!f.events.includes('chapter:1'));
   f.runner.stop();assert.equal((await p).status,'stopped');assertSeekListenersRemoved(f.videos[0]);
  }finally{f.runner.stop();if(p)await p;f.close();}
 });
 await test('旧版后台恢复：页面或节点替换、跳过期间立即解除拦截',async()=>{
  for(const action of ['replace','chapter','skip','captcha']){
   const f=fixture([{tabs:[video({manual:true,duration:5})]},{tabs:[video()]}]);let p;let received=0;
   try{f.w.addEventListener('mouseout',()=>received++);p=f.runner.start();await waitForTest(()=>!f.videos[0].paused);const v=f.videos[0];
    if(action==='replace')v.remove();if(action==='chapter')f.d.querySelector('#cur2 .posCatalog_name').click();if(action==='skip')f.runner.skip();
    if(action==='captcha'){const node=f.doc.createElement('div');node.setAttribute('data-captcha','');f.doc.body.append(node);}
    f.w.dispatchEvent(new f.w.MouseEvent('mouseout',{relatedTarget:null}));assert.equal(received,1);
    const r=await p;assert.equal(r.videos,action==='skip'?1:0);assertSeekListenersRemoved(v);
   }finally{f.runner.stop();if(p)await p;f.close();}
  }
 });
 await test('旧版后台恢复：明确前台要求不拦截离开，也不恢复后台暂停',async()=>{
  const f=fixture([{tabs:[video({manual:true,foreground:true,duration:4})]}]),foreground=foregroundFixture(f);let p;let received=0;
  try{f.w.addEventListener('mouseout',()=>received++);p=f.runner.start();await waitForTest(()=>!f.videos[0].paused);
   f.w.dispatchEvent(new f.w.MouseEvent('mouseout',{relatedTarget:null}));assert.equal(received,1);foreground(false);await delay(30);
   assert(f.videos[0].paused);assert.equal(f.videos[0].startAttemptTimes.length,1);foreground(true);await waitForTest(()=>!f.videos[0].paused);
   finishManual(f.videos[0]);assert.equal((await p).videos,1);
  }finally{f.runner.stop();if(p)await p;f.close();}
 });
 await test('旧版后台恢复：非课程页面不安装旧监听，页面销毁移除监听',async()=>{
  for(const url of ['https://mooc1.chaoxing.com/visit/stucoursemiddle','https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu']){
   const f=fixture([{tabs:[video()]}],{url});try{assert.equal(f.api.backgroundPlaybackGuard,null);assert.equal(f.api.initBackgroundPlayback(),null);}finally{f.close();}
  }
  const f=fixture([{tabs:[video()]}]);try{f.w.dispatchEvent(new f.w.Event('pagehide'));let received=0;f.w.addEventListener('mouseout',()=>received++);
   f.w.dispatchEvent(new f.w.MouseEvent('mouseout',{relatedTarget:null}));assert.equal(received,1);
  }finally{f.close();}
 });
 await test('旧版后台恢复：未就绪暂停受停滞时限约束，不无限等待数据',async()=>{
  let clock=10000;const f=fixture([{tabs:[video({manual:true,duration:5})]}],{now:()=>clock,limits:{stallMs:50}});let p;
  try{p=f.runner.start();await waitForTest(()=>!f.videos[0].paused);f.videos[0].simulateMedia({paused:true,readyState:1},'pause');clock+=60;
   const r=await p;assert.equal(r.status,'stopped');assert.equal(r.videos,0);assert.match(r.reason,/长时间没有变化/);assert.equal(f.videos[0].startAttemptTimes.length,1);
  }finally{f.runner.stop();if(p)await p;f.close();}
 });
 await test('旧版后台恢复：只有正常播放累计10秒才清零无效恢复预算',async()=>{
  const f=fixture([{tabs:[video({manual:true,duration:15})]}],{limits:{maxResumes:3,resumeMs:6}});let p;
  try{p=f.runner.start();await waitForTest(()=>!f.videos[0].paused);const v=f.videos[0],task=f.runner.report.chapters[0].tasks[0];
   for(let i=1;i<=3;i++){v.pause();await waitForTest(()=>v.startAttemptTimes.length===i+1);await delay(2);}
   assert.equal(task.unstableResumes,3);assert.equal(task.progressState.resumeProgressSeconds,0);
   for(let seconds=1;seconds<=9;seconds++)v.simulateMedia({seconds,natural:true},'timeupdate');
   assert.equal(task.unstableResumes,3);v.simulateMedia({seconds:10,natural:true},'timeupdate');assert.equal(task.unstableResumes,0);
   v.pause();await waitForTest(()=>v.startAttemptTimes.length===5);finishManual(v);const r=await p;assert.equal(r.videos,1);assert.equal(task.resumes,4);
  }finally{f.runner.stop();if(p)await p;f.close();}
 });
 await test('旧版后台恢复：先播放后暂停但play Promise未结束时不并行调用',async()=>{
  const f=fixture([{tabs:[video({manual:true,duration:4})]}]);let p,settle;
  try{const v=f.videos[0],play=v.play;let calls=0;v.play=()=>{calls++;const result=play();return calls===1?new Promise(resolve=>{settle=resolve}):result};
   p=f.runner.start();await waitForTest(()=>!v.paused);v.pause();await delay(35);assert.equal(calls,1);assert(v.paused);
   settle();await waitForTest(()=>calls===2);assert(!v.paused);finishManual(v);assert.equal((await p).videos,1);
  }finally{settle?.();f.runner.stop();if(p)await p;f.close();}
 });
 await test('旧版后台恢复：可靠原生播放按钮的人工暂停受到保护',async()=>{
  const f=fixture([{tabs:[video({manual:true,duration:4,nativeOnly:true})]}]);let p;
  try{p=f.runner.start();await waitForTest(()=>!f.videos[0].paused);const v=f.videos[0],button=v.parentElement.querySelector('.vjs-big-play-button');
   playerInput(v,{type:'pointerdown',target:button});v.pause();await waitForTest(()=>f.runner.report.chapters[0].tasks[0].pauseState.waiting);await delay(30);
   assert.equal(v.startAttemptTimes.length,2);assert.equal(f.runner.report.chapters[0].tasks[0].resumes,0);await v.play();finishManual(v);assert.equal((await p).videos,1);
  }finally{f.runner.stop();if(p)await p;f.close();}
 });
 await test('旧版后台恢复：阻止稍后注册的鼠标移出暂停处理器',async()=>{
  const f=fixture([{tabs:[video({manual:true,duration:4})]}]);let p;let pauses=0;
  try{f.w.addEventListener('mouseout',()=>{pauses++;f.videos[0].pause()},true);p=f.runner.start();await waitForTest(()=>!f.videos[0].paused);
   f.w.dispatchEvent(new f.w.MouseEvent('mouseout',{relatedTarget:null}));assert(!f.videos[0].paused);assert.equal(pauses,0);assert.equal(f.videos[0].startAttemptTimes.length,1);
   finishManual(f.videos[0]);const r=await p;assert.equal(r.videos,1);f.w.dispatchEvent(new f.w.MouseEvent('mouseout',{relatedTarget:null}));assert.equal(pauses,1);
  }finally{f.runner.stop();if(p)await p;f.close();}
 });
 await test('旧版后台恢复：不能撤销先注册处理器的暂停，但仍可正常恢复',async()=>{
  let pauses=0;const f=fixture([{tabs:[video({manual:true,duration:4})]}],{beforeRuntime(w,videos){w.addEventListener('mouseout',()=>{pauses++;videos[0].pause()},true)}});let p;
  try{p=f.runner.start();await waitForTest(()=>!f.videos[0].paused);f.w.dispatchEvent(new f.w.MouseEvent('mouseout',{relatedTarget:null}));
   assert(f.videos[0].paused);assert.equal(pauses,1);await waitForTest(()=>f.videos[0].startAttemptTimes.length===2);assert(!f.videos[0].paused);
   assert.equal(f.runner.report.chapters[0].tasks[0].backgroundState.interceptedMouseouts,0);finishManual(f.videos[0]);assert.equal((await p).videos,1);
  }finally{f.runner.stop();if(p)await p;f.close();}
 });
 await test('旧版后台恢复：定位前跳且暂停时先停止，不调用恢复入口',async()=>{
  const f=fixture([{tabs:[video({manual:true,start:100,duration:140})]},{tabs:[video()]}]);let p;
  try{p=f.runner.start({continueOnTimeout:true});await waitForTest(()=>!f.videos[0].paused);f.videos[0].simulateMedia({seconds:130,paused:true},'pause');
   const r=await p;assert.equal(r.status,'stopped');assert.match(r.reason,/进度跳转/);assert.equal(r.videos,0);assert.equal(f.videos[0].startAttemptTimes.length,1);assert(!f.events.includes('chapter:1'));
  }finally{f.runner.stop();if(p)await p;f.close();}
 });
 await test('旧版后台恢复：手动暂停期间的未就绪定位不消耗定位预算',async()=>{
  let clock=10000;const f=fixture([{tabs:[video({manual:true,start:100,duration:105})]}],{now:()=>clock,limits:{videoSeekTimeoutMs:50}});let p;
  try{p=f.runner.start();await waitForTest(()=>!f.videos[0].paused);const v=f.videos[0];playerInput(v);v.simulateMedia({seeking:true,paused:true,readyState:1},'seeking');
   await waitForTest(()=>f.runner.report.chapters[0].tasks[0].pauseState.waiting);clock+=120000;await delay(10);
   assert.equal(f.runner.report.status,'running');assert.equal(v.startAttemptTimes.length,1);v.simulateMedia({seeking:false,readyState:4},'seeked');await v.play();
   await waitForTest(()=>!f.runner.report.chapters[0].tasks[0].pauseState.waiting);clock+=9;
   await waitForTest(()=>f.runner.report.chapters[0].tasks[0].seekState.outcome==='continuous');finishManual(v);assert.equal((await p).videos,1);
  }finally{f.runner.stop();if(p)await p;f.close();}
 });
 await test('旧版后台恢复：冷却期间用户已播放，不再点击播放或累计恢复',async()=>{
  let clock=10000;const f=fixture([{tabs:[video({manual:true,duration:4})]}],{now:()=>clock,limits:{resumeMs:3000,stallMs:10000}});let p;
  try{p=f.runner.start();await waitForTest(()=>!f.videos[0].paused);const v=f.videos[0];v.pause();await delay(5);clock+=2999;await v.play();clock++;
   await delay(15);assert.equal(v.startAttemptTimes.length,2);assert.equal(f.runner.report.chapters[0].tasks[0].resumes,0);finishManual(v);const r=await p;assert.equal(r.videos,1,r.reason);
  }finally{f.runner.stop();if(p)await p;f.close();}
 });
 await test('旧版后台恢复：人工等待、弹题和结束后监听正确释放',async()=>{
  const f=fixture([{tabs:[video({manual:true,duration:4})]}]);let p;let received=0;
  try{f.w.addEventListener('mouseout',()=>received++);p=f.runner.start();await waitForTest(()=>!f.videos[0].paused);const v=f.videos[0],doc=v.ownerDocument;
   for(const target of [f.d,doc])for(const type of ['pointerdown','click','keydown'])assert.equal(target.pauseCaptures.get(type)?.size,1);
   const popup=videoPopup(f,v,{text:'请手写上传',type:'简答题'});f.w.dispatchEvent(new f.w.MouseEvent('mouseout',{relatedTarget:null}));assert.equal(received,1);
   v.pause();await waitForTest(()=>f.runner.report.chapters[0].tasks[0].videoQuizzes[0]?.phase==='manual-wait');assert.equal(f.requests.length,0);assert.equal(v.startAttemptTimes.length,1);
   f.runner.stop();await p;for(const target of [f.d,doc])for(const type of ['pointerdown','click','keydown'])assert.equal(target.pauseCaptures.get(type)?.size,0);
   assertSeekListenersRemoved(v);assert(popup.root.isConnected);
  }finally{f.runner.stop();if(p)await p;f.close();}
 });
 await test('旧版后台恢复：同页多个视频不复用暂停意图和无效恢复预算',async()=>{
  const first={kind:'video',pauseOnEveryPlay:true,duration:4},second={kind:'video',manual:true,duration:4};
  const f=fixture([{tabs:[{title:'视频',tasks:[first,second]}]}],{limits:{maxResumes:2,resumeMs:5}});let p;
  try{p=f.runner.start();await waitForTest(()=>f.runner.report.chapters[0].tasks[0]?.pauseState.waiting);first.pauseOnEveryPlay=false;await f.videos[0].play();finishManual(f.videos[0]);
   await waitForTest(()=>!f.videos[1].paused);f.videos[1].pause();await waitForTest(()=>f.videos[1].startAttemptTimes.length===2);finishManual(f.videos[1]);const r=await p;
   assert.equal(r.videos,2);assert.equal(r.chapters[0].tasks[0].resumes,2);assert.equal(r.chapters[0].tasks[1].resumes,1);assert.equal(r.chapters[0].tasks[1].pauseState.waitCount,0);
  }finally{f.runner.stop();if(p)await p;f.close();}
 });
 await test('旧版后台恢复：报告只输出固定诊断字段，缺省和额外敏感字段兼容',async()=>{
  const f=fixture([{tabs:[video({manual:true,duration:4})]}]);let p;
  try{p=f.runner.start();await waitForTest(()=>!f.videos[0].paused);f.runner.stop();const r=await p,state=r.chapters[0].tasks[0].backgroundState;
   state.url='https://mock.invalid/?token=mock-only-key';state.reason='mock-only-key';state.installedReadyState='mock-only-key';state.category='mock-only-key';state.recoveryAttempts=-2;
   let text=f.api.courseReportText(r);assert.match(text,/后台播放保护记录/);assert(!text.includes('mock-only-key'));assert(!text.includes('mock.invalid'));assert.match(text,/恢复入口尝试 0 次/);
   delete r.chapters[0].tasks[0].backgroundState;assert.doesNotThrow(()=>f.api.courseReportText(r));
  }finally{f.runner.stop();if(p)await p;f.close();}
 });
 await test('旧版后台恢复：恢复入口完全无效也只尝试8次，内部重试不绕过上限',async()=>{
  const f=fixture([{tabs:[video({manual:true,duration:4})]},{tabs:[video()]}],{limits:{maxResumes:8,resumeMs:6}});let p;
  try{p=f.runner.start({continueOnTimeout:true});await waitForTest(()=>!f.videos[0].paused);const v=f.videos[0];let retries=0;
   v.play=()=>{retries++;v.startAttemptTimes.push(Date.now());return Promise.resolve()};v.pause();await waitForTest(()=>f.runner.report.chapters[0].tasks[0].pauseState.waiting);
   assert.equal(retries,8);assert.equal(f.runner.report.chapters[0].tasks[0].resumes,8);await delay(25);assert.equal(retries,8);assert(!f.events.includes('chapter:1'));assert.equal(f.runner.report.videos,0);
   f.runner.stop();assert.equal((await p).status,'stopped');
  }finally{f.runner.stop();if(p)await p;f.close();}
 });
 await test('旧版后台恢复：暂停引起未知AbortError仍有限重试，不误当硬错误停止',async()=>{
  const f=fixture([{tabs:[video({manual:true,duration:4})]}],{limits:{resumeMs:6}});let p;
  try{p=f.runner.start();await waitForTest(()=>!f.videos[0].paused);const v=f.videos[0],play=v.play;let retries=0;
   v.play=()=>{retries++;if(retries<=2){v.simulateMedia({paused:false},'playing');v.pause();return Promise.reject(Object.assign(Error('interrupted by pause'),{name:'AbortError'}))}return play()};
   v.pause();await waitForTest(()=>retries===3);assert(!v.paused);finishManual(v);const r=await p;assert.equal(r.videos,1,r.reason);assert.equal(r.chapters[0].tasks[0].resumes,3);
  }finally{f.runner.stop();if(p)await p;f.close();}
 });
 await test('旧版后台恢复：尚未真正播放的连续AbortError也在8次后转人工',async()=>{
  const f=fixture([{tabs:[video({manual:true,duration:4})]},{tabs:[video()]}],{limits:{maxResumes:8,resumeMs:6}});let p;
  try{p=f.runner.start();await waitForTest(()=>!f.videos[0].paused);const v=f.videos[0];let retries=0;
   v.play=()=>{retries++;v.simulateMedia({paused:true},'pause');return Promise.reject(Object.assign(Error('interrupted by pause'),{name:'AbortError'}))};
   v.pause();await waitForTest(()=>f.runner.report.chapters[0].tasks[0].pauseState.waiting);assert.equal(retries,8);assert.equal(f.runner.report.status,'running');assert.equal(f.runner.report.videos,0);assert(!f.events.includes('chapter:1'));
   f.runner.stop();await p;
  }finally{f.runner.stop();if(p)await p;f.close();}
 });
 await test('视频弹题：页面销毁后的迟到状态更新不再读取失效DOM',async()=>{
  const f=fixture([{tabs:[video()]}]);const ctl=f.api.controller;f.close();assert.doesNotThrow(()=>ctl.report('停止后的迟到报告','error'));
 });
 await test('视频弹题：共享手写要求阻止整份模型请求，报告保存可见题干与选项',async()=>{
  const f=fixture([{tabs:[video({manual:true})]}]);let p;try{const popup=videoPopup(f,f.videos[0]);popup.root.insertAdjacentHTML('afterbegin','<div class="question-instructions">请手写拍照上传</div>');p=f.runner.start();await waitForTest(()=>f.runner.report?.chapters[0]?.tasks[0]?.videoQuizzes?.[0]?.phase==='manual-wait');assert.equal(f.requests.length,0);assert.equal(popup.confirms,0);assert.match(f.api.courseReportText(f.runner.report),/请选择甲/);assert.match(f.api.courseReportText(f.runner.report),/手写拍照上传/);assert.match(f.api.courseReportText(f.runner.report),/A\. 甲/);}finally{f.runner.stop();if(p)await p;f.close();}
 });
 await test('视频弹题：原生回看独立计时，不重置此前普通回退保护',async()=>{
  let offset=0;await manualVideoTest(async(f,pending,v)=>{
   const task=f.runner.report.chapters[0].tasks[0];v.simulateMedia({seconds:95,seeking:true},'seeking');v.simulateMedia({seeking:false},'seeked');await waitForTest(()=>task.rollbackCount===1);const original={...task.replayState};v.simulateMedia({seconds:96,natural:true},'timeupdate');
   const popup=videoPopup(f,v,{cue:96,confirm({feedback,root}){feedback('回答错误，请重新观看');v.parentElement.append(root.querySelector('.videoquiz-feedback').cloneNode(true));v.simulateMedia({seconds:90,seeking:true,readyState:1},'seeking');root.hidden=true;v.simulateMedia({seeking:false,readyState:4,paused:false},'seeked');v.dispatchEvent(new f.doc.defaultView.Event('playing'));}});v.pause();await waitForTest(()=>task.rollbackCount===2);
   assert.equal(popup.confirms,1);assert.equal(task.videoQuizzes[0].rewatch.from,96);assert.equal(task.videoQuizzes[0].rewatch.distance,6);assert.equal(task.replayState.startedAt,original.startedAt);assert.equal(task.replayState.frontierAtStart,100);
   offset+=8000;v.simulateMedia({seconds:91,natural:true},'timeupdate');await delay(15);assert(f.runner.busy);for(let s=92;s<=97;s++)v.simulateMedia({seconds:s,natural:true},'timeupdate');await waitForTest(()=>task.videoQuizzes[0].phase==='passed');assert.equal(task.replayState.startedAt,original.startedAt);
   offset+=16000;v.simulateMedia({seconds:98,natural:true},'timeupdate');const r=await pending;assert.equal(r.videos,0);assert.match(r.reason,/反复回退/);assert.equal(task.replayState.outcome,'timeout');
  },{now:()=>Date.now()+offset,limits:{stallMs:40000}},[{tabs:[video({manual:true,start:100,duration:120,playedRanges:[[0,100]]})]}]);
 });
 await test('视频弹题：同轮原生回看不能无限延期，仍按有限额度超时',async()=>{
  let offset=0;await manualVideoTest(async(f,pending,v)=>{
   const popup=videoPopup(f,v,{confirm({feedback,root}){feedback('回答错误，请重新观看');v.parentElement.append(root.querySelector('.videoquiz-feedback').cloneNode(true));v.simulateMedia({seconds:90,seeking:true,readyState:1},'seeking');root.hidden=true;v.simulateMedia({seeking:false,readyState:4,paused:false},'seeked');v.dispatchEvent(new f.doc.defaultView.Event('playing'));}});v.pause();const task=f.runner.report.chapters[0].tasks[0];await waitForTest(()=>task.rollbackCount===1);const deadline=task.videoQuizzes[0].rewatch.deadline;
   v.simulateMedia({seconds:89,seeking:true},'seeking');v.simulateMedia({seeking:false},'seeked');await waitForTest(()=>task.rollbackCount===2);assert.equal(task.videoQuizzes[0].rewatch.deadline,deadline);offset+=21000;v.simulateMedia({seconds:90,natural:true},'timeupdate');const r=await pending;assert.equal(popup.confirms,1);assert.equal(r.videos,0);assert.match(r.reason,/弹题要求回看/);
  },{now:()=>Date.now()+offset,limits:{stallMs:40000}},[{tabs:[video({manual:true,start:100,duration:120,playedRanges:[[0,100]]})]}]);
 });
 await test('视频弹题：同章多个视频分别维护题目次数和状态',async()=>{
  const f=fixture([{tabs:[{title:'视频',tasks:[{kind:'video'},{kind:'video'}]}]}]);try{let first,second;f.videos[0].addEventListener('playing',()=>{if(first)return;first=videoPopup(f,f.videos[0]);f.videos[0].pause();});f.videos[1].addEventListener('playing',()=>{if(second)return;second=videoPopup(f,f.videos[1]);f.videos[1].pause();});const r=await f.runner.start();assert.equal(r.status,'done',r.reason);assert.equal(r.videos,2);assert.equal(first.confirms,1);assert.equal(second.confirms,1);assert.equal(r.chapters[0].tasks.filter(t=>t.type==='video').length,2);assert(r.chapters[0].tasks.every(t=>t.videoQuizzes[0].attempts===1));}finally{f.close();}
 });
 await test('视频弹题：模型请求超时仅网络重试，不变成章节超时或跳过',async()=>{
  const f=fixture([{tabs:[video({manual:true})]},{tabs:[video()]}],{error:'timeout',limits:{stallMs:30,videoLoadMs:30}});let p;try{const popup=videoPopup(f,f.videos[0]);p=f.runner.start({continueOnTimeout:true,skipUnanswerable:true});for(let i=0;i<600&&f.runner.report?.chapters[0]?.tasks[0]?.videoQuizzes?.[0]?.phase!=='manual-wait';i++)await delay(4);assert.equal(f.runner.report.chapters[0].tasks[0].videoQuizzes[0].phase,'manual-wait');assert.equal(f.requests.length,2);assert.equal(f.runner.report.chapters[0].tasks[0].videoQuizzes[0].modelRequests,2);assert.equal(f.runner.report.chapters[0].tasks[0].videoQuizzes[0].modelRetries,1);assert.equal(popup.confirms,0);assert(f.runner.busy);assert.equal(f.runner.report.protection.consecutiveFailures,0);assert(!f.events.includes('chapter:1'));}finally{f.runner.stop();if(p)await p;f.close();}
 });
 await test('视频弹题：默认开关开启，弹题先于启动处理，不计章节测验提交',async()=>{
  const f=fixture([{tabs:[video()]}]);try{const popup=videoPopup(f,f.videos[0]);const r=await f.runner.start();assert.equal(r.status,'done',r.reason);assert.equal(r.videos,1);assert.equal(r.quizzes,0);assert.equal(popup.confirms,1);assert.equal(f.submits,0);assert.equal(f.requests.length,1);assert.equal(f.storage.get(f.runner.key).videoQuizAuto,true);assert.equal(r.chapters[0].tasks.length,1);assert.equal(r.chapters[0].tasks[0].videoQuizzes[0].attempts,1);assertSeekListenersRemoved(f.videos[0]);assert.match(f.api.courseReportText(r),/视频弹题记录/);}finally{f.close();}
 });
 await test('视频弹题：关闭开关沿用停止行为，旧恢复会话缺字段不能自动接管',async()=>{
  const f=fixture([{tabs:[video()]}]);try{videoPopup(f,f.videos[0]);const r=await f.runner.start({videoQuizAuto:false});assert.equal(r.status,'stopped');assert.match(r.reason,/交互题/);assert.equal(f.requests.length,0);const oldSession=f.storage.get(f.runner.key);delete oldSession.videoQuizAuto;f.storage.set(f.runner.key,oldSession);const restored=await f.runner.start({resume:true});assert.equal(restored.status,'stopped');assert.match(restored.reason,/交互题/);assert.equal(f.requests.length,0);}finally{f.close();}
 });
 await test('视频弹题：播放过程中出现题目，暂停后自动处理并正常继续',async()=>{
  const f=fixture([{tabs:[video({manual:true})]}]);let p;try{p=f.runner.start();await waitForTest(()=>!f.videos[0].paused);const v=f.videos[0];v.simulateMedia({seconds:0.5,natural:true},'timeupdate');const popup=videoPopup(f,v);v.pause();await waitForTest(()=>popup.confirms===1);await waitForTest(()=>!v.paused);finishManual(v);const r=await p;assert.equal(r.status,'done',r.reason);assert.equal(r.videos,1);assert.equal(f.requests.length,1);}finally{f.runner.stop();if(p)await p;f.close();}
 });
 await test('视频弹题：初次判错新答案重试，反馈携带上一轮错误而不重复章节提交',async()=>{
  const f=fixture([{tabs:[video()]}],{videoQuizAnswers:[['A'],['B']]});try{const popup=videoPopup(f,f.videos[0],{confirm({feedback,confirms,root,release}){if(confirms===1)feedback('回答错误');else{feedback('回答正确');f.videos[0].parentElement.append(root.querySelector('.videoquiz-feedback').cloneNode(true));release();}}});const r=await f.runner.start();assert.equal(r.status,'done',r.reason);assert.equal(popup.confirms,2);assert.equal(f.requests.length,2);const input=JSON.parse(JSON.parse(f.requests[1].data).messages[1].content);assert.equal(input.answerFeedback[0].previousAttempts[0].answer[0],'A');assert.match(input.answerFeedback[0].previousAttempts[0].feedback,/错误/);assert.equal(r.quizzes,0);}finally{f.close();}
 });
 await test('视频弹题：模型失败保持运行，不受超时继续及无法答题跳过开关影响',async()=>{
  let clock=Date.now();const f=fixture([{tabs:[video({manual:true})]},{tabs:[video()]}],{invalid:true,now:()=>clock,limits:{stallMs:30,videoLoadMs:30}});let p;try{const popup=videoPopup(f,f.videos[0]);p=f.runner.start({continueOnTimeout:true,skipUnanswerable:true});await waitForTest(()=>f.runner.report?.chapters[0]?.tasks[0]?.videoQuizzes?.[0]?.phase==='manual-wait');clock+=5000;await delay(100);assert(f.runner.busy);assert(!f.events.includes('chapter:1'));assert.equal(popup.confirms,0);await popup.release();f.videos[0].simulateMedia({seconds:0.5,natural:true},'timeupdate');await waitForTest(()=>f.runner.report.chapters[0].tasks[0].videoQuizzes[0].phase==='passed');finishManual(f.videos[0]);const r=await p;assert.equal(r.status,'done',r.reason);assert.equal(r.protection.consecutiveFailures,0);}finally{f.runner.stop();if(p)await p;f.close();}
 });
 await test('视频弹题：确认结果不明保持等待并禁止跳过，停止后不重试确认',async()=>{
  const f=fixture([{tabs:[video({manual:true})]}]);let p;try{const popup=videoPopup(f,f.videos[0],{confirm({root}){root.hidden=true;}});p=f.runner.start();await waitForTest(()=>f.runner.report?.chapters[0]?.tasks[0]?.videoQuizzes?.[0]?.phase==='manual-wait');assert.equal(popup.confirms,1);assert.equal(f.runner.canSkip,false);assert.equal(f.runner.skip(),false);f.runner.stop();const r=await p;assert.equal(r.videos,0);assert.equal(f.runner.canRetry,false);const second=f.runner.start();await waitForTest(()=>f.runner.busy);f.runner.stop();await second;assert.equal(popup.confirms,1);}finally{f.runner.stop();if(p)await p;f.close();}
 });
 await test('视频弹题：待结果刷新重现原题，持久化次数不归零且不重复动作',async()=>{
  const f=fixture([{tabs:[video({manual:true})]}]);let p;try{const popup=videoPopup(f,f.videos[0],{confirm(){}});p=f.runner.start();await waitForTest(()=>f.runner.report?.chapters[0]?.tasks[0]?.videoQuizzes?.[0]?.phase==='manual-wait');f.runner.stop();await p;const record=[...f.storage.entries()].find(([key])=>key.startsWith('cx_video_quiz:'));assert.equal(record[1][0].attempts,1);p=f.runner.start();await waitForTest(()=>f.runner.report.chapters[0]?.tasks[0]?.videoQuizzes?.[0]?.phase==='manual-wait');assert.equal(popup.confirms,1);assert.equal(f.requests.length,1);}finally{f.runner.stop();if(p)await p;f.close();}
 });
 await test('视频弹题：人工题不生成答案、不自动确认，支持题规则保持',async()=>{
  const f=fixture([{tabs:[video({manual:true})]}]);let p;try{const popup=videoPopup(f,f.videos[0],{type:'简答题',text:'手写拍照上传行列式计算'});p=f.runner.start();await waitForTest(()=>f.runner.report?.chapters[0]?.tasks[0]?.videoQuizzes?.[0]?.phase==='manual-wait');assert.equal(f.requests.length,0);assert.equal(popup.confirms,0);assert.equal(popup.root.querySelector('textarea').value,'');assert(f.runner.canSkip);}finally{f.runner.stop();if(p)await p;f.close();}
 });
 await test('视频弹题：原生强制回看不写进度，同一错误只获一次额度，回看后重新答题',async()=>{
  const f=fixture([{tabs:[video({manual:true,start:335.63,duration:340,playedRanges:[[0,335.63]]})]}],{videoQuizAnswers:[['A'],['B']]});let p;try{const v=f.videos[0],popup=videoPopup(f,v,{confirm({feedback,root,confirms,release}){if(confirms===1){feedback('回答错误，请重新观看');v.parentElement.append(root.querySelector('.videoquiz-feedback').cloneNode(true));v.simulateMedia({seconds:328,seeking:true,readyState:1,paused:true},'seeking');root.hidden=true;v.simulateMedia({seeking:false,readyState:4,paused:false},'seeked');v.dispatchEvent(new f.doc.defaultView.Event('playing'));}else{feedback('回答正确');v.parentElement.append(root.querySelector('.videoquiz-feedback').cloneNode(true));release();}}});p=f.runner.start();await waitForTest(()=>f.runner.report?.chapters[0]?.tasks[0]?.seekState?.outcome==='rollback');const task=f.runner.report.chapters[0].tasks[0];assert.equal(task.videoQuizzes[0].attempts,1);assert.equal(task.videoQuizzes[0].history[0].rewatchGranted,true);assert(task.videoQuizzes[0].rewatch.distance>=7);for(let i=329;i<=336;i++)v.simulateMedia({seconds:i,natural:true},'timeupdate');popup.root.hidden=false;popup.root.querySelector('input').checked=false;popup.feedback('');await waitForTest(()=>popup.confirms===2);finishManual(v);const r=await p;assert.equal(r.status,'done',r.reason);assert.equal(r.videos,1);assert.equal(task.videoQuizzes[0].attempts,2);}finally{f.runner.stop();if(p)await p;f.close();}
 });
 await test('视频弹题：视频结束与题目同时出现，先处理弹题再读取完成',async()=>{
  const f=fixture([{tabs:[video({manual:true})]}]);let p;try{p=f.runner.start();await waitForTest(()=>!f.videos[0].paused);const popup=videoPopup(f,f.videos[0]);finishManual(f.videos[0]);const r=await p;assert.equal(r.status,'done',r.reason);assert.equal(popup.confirms,1);assert.equal(r.videos,1);}finally{f.runner.stop();if(p)await p;f.close();}
 });
 await test('视频弹题：开启全隐藏只更新状态，弹题处理不自动恢复助手',async()=>{
  const f=fixture([{tabs:[video()]}]);try{f.menus.get('隐藏助手全部界面')();const popup=videoPopup(f,f.videos[0]);const r=await f.runner.start();assert.equal(r.status,'done',r.reason);assert.equal(popup.confirms,1);assert.equal(f.d.getElementById('cx-ai-study-root').style.display,'none');}finally{f.close();}
 });
 await test('视频弹题：运行中开关禁改且与章节测验自动提交独立',async()=>{
  const f=fixture([{tabs:[video({manual:true})]}]);let p;try{const s=f.d.getElementById('cx-ai-study-root').shadowRoot,box=s.getElementById('course-video-quiz-auto');assert(box.checked);p=f.runner.start({submit:false});await waitForTest(()=>f.runner.busy);assert(box.disabled);box.checked=false;box.dispatchEvent(new f.w.Event('change'));assert.equal(f.storage.get('cx_course_video_quiz_auto'),undefined);const popup=videoPopup(f,f.videos[0]);f.videos[0].pause();await waitForTest(()=>popup.confirms===1);finishManual(f.videos[0]);const r=await p;assert.equal(r.status,'done',r.reason);assert.equal(r.quizzes,0);}finally{f.runner.stop();if(p)await p;f.close();}
 });
 await test('视频弹题：确认前人工跳过取消分析，迟到答案不影响后续章节',async()=>{
  const f=fixture([{tabs:[video({manual:true})]},{tabs:[video()]}],{requestMs:120,lateResponse:true});let p;try{const popup=videoPopup(f,f.videos[0]);p=f.runner.start();await waitForTest(()=>f.requests.length===1);assert(f.runner.canSkip);f.runner.skip();const r=await p;await delay(140);assert.equal(r.status,'done',r.reason);assert.equal(popup.confirms,0);assert.equal(r.videos,1);assert(f.events.includes('api-abort'));}finally{f.runner.stop();if(p)await p;f.close();}
 });
 await test('视频弹题：前台限制仍等待，不通过弹题恢复入口抢播后台视频',async()=>{
  const f=fixture([{tabs:[video({foreground:true,manual:true})]}]);let p;try{const setForeground=foregroundFixture(f,false,false);p=f.runner.start();await waitForTest(()=>f.runner.report?.chapters[0]?.tasks[0]?.foregroundState?.waiting);assert.equal(f.events.filter(e=>e.startsWith('play:')).length,0);const popup=videoPopup(f,f.videos[0],{confirm({feedback}){feedback('回答正确');}});await waitForTest(()=>popup.confirms===1);assert(f.videos[0].paused);popup.root.remove();setForeground(true,true);await waitForTest(()=>!f.videos[0].paused);finishManual(f.videos[0]);const r=await p;assert.equal(r.status,'done',r.reason);}finally{f.runner.stop();if(p)await p;f.close();}
 });
 await test('视频弹题：停止清理媒体监听，分析迟到响应不能确认',async()=>{
  const f=fixture([{tabs:[video({manual:true})]}],{requestMs:120,lateResponse:true});let p;try{const popup=videoPopup(f,f.videos[0]);p=f.runner.start();await waitForTest(()=>f.requests.length===1);f.runner.stop();const r=await p;await delay(140);assert.equal(popup.confirms,0);assert.equal(r.videos,0);assertSeekListenersRemoved(f.videos[0]);}finally{f.runner.stop();if(p)await p;f.close();}
 });
 await test('知识图谱：原生标签确认图谱页面直接跳过，不等待加载，不记完成',async()=>{
  const f=fixture([{tabs:[{title:'4 知识图谱',tasks:[{kind:'survey'}]}]},{tabs:[video()]}],{limits:{loadMs:40}});
  try{const r=await f.runner.start();assert.equal(r.status,'done',r.reason);assert.equal(r.videos,1);assert.equal(r.documents,0);assert.equal(r.quizzes,0);assert.equal(r.chapters[0].status,'manual-pending');assert.equal(r.chapters[0].tasks.length,1);assert.equal(r.chapters[0].tasks[0].type,'knowledge-graph');assert.equal(r.protection.consecutiveFailures,0);assert(f.events.includes('chapter:1'));assert.equal(f.requests.length,0);assert.equal(f.submits,0);assert.match(f.api.courseReportText(r),/知识图谱/);assert(!f.api.courseReportText(r).startsWith('全部流程完成'));}finally{f.close();}
 });
 await test('知识图谱：章节图谱标题确认控件，同页视频与PPT继续执行',async()=>{
  const f=fixture([{tabs:[{title:'混合资料',tasks:[{kind:'video'},{kind:'knowledge-graph'},{kind:'ppt'}]}]},{tabs:[video()]}]);
  try{const r=await f.runner.start();assert.equal(r.status,'done',r.reason);assert.equal(r.videos,2);assert.equal(r.documents,1);assert.equal(r.chapters[0].status,'manual-pending');assert.deepEqual(Array.from(r.chapters[0].tasks,t=>t.type),['video','knowledge-graph','document']);assert.equal(r.chapters[0].tasks.filter(t=>t.type==='knowledge-graph').length,1);assert.equal(r.chapters[0].issues.length,1);}finally{f.close();}
 });
 await test('知识图谱：图谱标签不能吞掉已经识别的测验',async()=>{
  const page=quiz();page.title='知识图谱';const f=fixture([{tabs:[page]}]);try{const r=await f.runner.start();assert.equal(r.status,'done',r.reason);assert.equal(r.quizzes,1);assert.equal(r.chapters[0].tasks[0].type,'quiz');assert.equal(f.submits,1);}finally{f.close();}
 });
 await test('知识图谱：正文关键词与题干标题不能冒充图谱控件',async()=>{
  const f=fixture([{tabs:[{title:'调查问卷',text:'知识图谱',tasks:[{kind:'survey'}]}]},{tabs:[video()]}],{limits:{loadMs:20}});
  try{const r=await f.runner.start();assert.equal(r.status,'stopped');assert.equal(r.chapters[0].tasks.filter(t=>t.type==='knowledge-graph').length,0);assert(!f.events.includes('chapter:1'));}finally{f.close();}
  const q=fixture([{tabs:[quiz()]}]);try{q.doc.querySelector('.singleQuesId').insertAdjacentHTML('afterbegin','<h2>章节知识图谱</h2>');const r=await q.runner.start();assert.equal(r.status,'done',r.reason);assert.equal(r.quizzes,1);assert(!r.chapters[0].tasks.some(t=>t.type==='knowledge-graph'));}finally{q.close();}
 });
 await test('知识图谱：隐藏标题和其他标签不触发跳过',async()=>{
  const f=fixture([{tabs:[{title:'调查问卷',tasks:[{kind:'survey'}]},{title:'知识图谱',tasks:[{kind:'knowledge-graph'}]}]}],{limits:{loadMs:20}});
  try{f.doc.body.insertAdjacentHTML('afterbegin','<h2 hidden>章节知识图谱</h2>');const r=await f.runner.start();assert.equal(r.status,'stopped');assert(!f.events.includes('tab:0:1'));assert(!r.chapters[0].tasks.some(t=>t.type==='knowledge-graph'));}finally{f.close();}
 });
 await test('知识图谱：人脸或验证码阻断仍立即停止，不绕过到下一章',async()=>{
  for(const marker of ['data-face-verification','data-captcha']){const f=fixture([{tabs:[{title:'知识图谱',tasks:[{kind:'knowledge-graph'}]}]},{tabs:[video()]}]);try{f.doc.body.insertAdjacentHTML('afterbegin',`<div ${marker}>请验证</div>`);const r=await f.runner.start();assert.equal(r.status,'stopped');assert(!f.events.includes('chapter:1'));assert.equal(r.chapters[0].tasks.length,0);}finally{f.close();}}
 });
 await test('知识图谱：标签名称不能越过未知跨域iframe检查',async()=>{
  const f=fixture([{tabs:[{title:'知识图谱',tasks:[{kind:'knowledge-graph'}]}]},{tabs:[video()]}]);try{const frame=f.doc.createElement('iframe');frame.src='https://other.example/unknown';f.doc.body.append(frame);Object.defineProperty(frame,'contentDocument',{get:()=>null});const r=await f.runner.start();assert.equal(r.status,'stopped');assert.match(r.reason,/跨域/);assert(!f.events.includes('chapter:1'));}finally{f.close();}
 });
 await test('知识图谱：跳过不增加或清零连续失败次数，允许人工重试记录',async()=>{
  const f=fixture([{tabs:[{title:'调查问卷',tasks:[{kind:'survey'}]}]},{tabs:[{title:'知识图谱',tasks:[{kind:'knowledge-graph'}]}]}],{limits:{loadMs:20}});
  try{const r=await f.runner.start({continueOnTimeout:true});assert.equal(r.status,'done',r.reason);assert.equal(r.chapters[0].status,'timed-out');assert.equal(r.chapters[1].status,'manual-pending');assert.equal(r.protection.consecutiveFailures,1);assert.equal(f.api.coursePendingChapters(r).manual.length,1);assert.equal(f.runner.canRetry,true);assert.equal(r.videos+r.documents+r.quizzes,0);}finally{f.close();}
 });
 await test('启动重试：原生入口首次无效，冷却后再次点击并正常完成',async()=>{
  assert.match(source,/videoStartRetryMs:2000/);const f=fixture([{tabs:[video({lazy:true,nativeOnly:true,nativeNoEffect:1})]}]);
  try{const r=await f.runner.start();assert.equal(r.status,'done',r.reason);assert.equal(r.videos,1);assert.equal(r.chapters[0].tasks[0].startAttempts,2);assert.equal(f.events.filter(e=>e.startsWith('native-play:')).length,2);assert.equal(f.events.filter(e=>e.startsWith('play:')).length,1);assert(f.videos[0].startAttemptTimes[1]-f.videos[0].startAttemptTimes[0]>=LIMITS.videoStartRetryMs);assertSeekListenersRemoved(f.videos[0]);}finally{f.close();}
 });
 await test('启动重试：连续两次原生入口无效，第三次生效且不累计暂停恢复次数',async()=>{
  const f=fixture([{tabs:[video({lazy:true,nativeOnly:true,nativeNoEffect:2})]}]);try{const r=await f.runner.start();assert.equal(r.status,'done',r.reason);const task=r.chapters[0].tasks[0];assert.equal(task.startAttempts,3);assert.equal(task.resumes,0);assert.equal(task.unstableResumes,0);}finally{f.close();}
 });
 await test('启动重试：play已返回但未播放也重试，不增加首轮固定等待',async()=>{
  const f=fixture([{tabs:[video({playNoEffect:1})]}]);try{const r=await f.runner.start();assert.equal(r.status,'done',r.reason);assert.equal(r.chapters[0].tasks[0].startAttempts,2);assert(f.videos[0].startAttemptTimes[1]-f.videos[0].startAttemptTimes[0]>=LIMITS.videoStartRetryMs);}finally{f.close();}
  const normal=fixture([{tabs:[video()]}]);try{const r=await normal.runner.start();assert.equal(r.status,'done',r.reason);assert.equal(r.chapters[0].tasks[0].startAttempts,1);}finally{normal.close();}
 });
 await test('启动重试：始终没有播放仍受原总时限约束，首次失败停止',async()=>{
  const f=fixture([{tabs:[video({nativeOnly:true,lazy:true,nativeNoEffect:100})]},{tabs:[video()]}],{limits:{videoLoadMs:250,videoStartRetryMs:10}});
  try{const r=await f.runner.start();assert.equal(r.status,'stopped');assert.match(r.reason,/启动超时/);assert.equal(r.videos,0);assert(f.events.filter(e=>e.startsWith('native-play:')).length>=2);assert(!f.events.includes('chapter:1'));assertSeekListenersRemoved(f.videos[0]);}finally{f.close();}
 });
 await test('启动重试：超时继续开关沿用保护规则，不把未播放视频记为完成',async()=>{
  const f=fixture([{tabs:[video({nativeOnly:true,lazy:true,nativeNoEffect:100})]},{tabs:[video()]}],{limits:{videoLoadMs:250,videoStartRetryMs:10}});
  try{const r=await f.runner.start({continueOnTimeout:true});assert.equal(r.status,'done',r.reason);assert.equal(r.chapters[0].status,'timed-out');assert.equal(r.videos,1);assert(f.events.includes('chapter:1'));}finally{f.close();}
 });
 await test('启动重试：浏览器明确拒绝自动播放立即停止，不循环重试',async()=>{
  const f=fixture([{tabs:[video({blocked:true})]},{tabs:[video()]}]);try{const r=await f.runner.start({continueOnTimeout:true});assert.equal(r.status,'stopped');assert.match(r.reason,/浏览器阻止/);assert.equal(f.events.filter(e=>e.startsWith('play:')).length,1);assert(!f.events.includes('chapter:1'));assertSeekListenersRemoved(f.videos[0]);}finally{f.close();}
 });
 await test('启动重试：冷却期间停止或跳过立即取消旧入口重试',async()=>{
  for(const action of ['stop','skip']){const f=fixture([{tabs:[video({nativeOnly:true,lazy:true,nativeNoEffect:100})]},{tabs:[video()]}],{limits:{videoStartRetryMs:100}});let pending;
   try{pending=f.runner.start();await waitForTest(()=>f.events.some(e=>e.startsWith('native-play:')));if(action==='stop')f.runner.stop();else f.runner.skip();const r=await pending;assert.equal(f.events.filter(e=>e==='native-play:0:0:0').length,1);assertSeekListenersRemoved(f.videos[0]);assert.equal(r.status,action==='stop'?'stopped':'done',r.reason);assert.equal(r.videos,action==='stop'?0:1);}finally{if(pending)await pending;f.close();}}
 });
 await test('启动重试：冷却期间节点替换立即停止，不操作新视频',async()=>{
  const f=fixture([{tabs:[video({nativeOnly:true,lazy:true,nativeNoEffect:100})]}],{limits:{videoStartRetryMs:100}});let pending;
  try{pending=f.runner.start();await waitForTest(()=>f.events.some(e=>e.startsWith('native-play:')));f.videos[0].remove();const r=await pending;assert.equal(r.status,'stopped');assert.match(r.reason,/替换/);assert.equal(f.events.filter(e=>e.startsWith('native-play:')).length,1);assertSeekListenersRemoved(f.videos[0]);}finally{if(pending)await pending;f.close();}
 });
 await test('启动重试：首次初始化中断且未发生暂停，冷却后可重新启动',async()=>{
  const f=fixture([{tabs:[video({abortFirst:1})]}]);try{const r=await f.runner.start();assert.equal(r.status,'done',r.reason);assert.equal(r.videos,1);assert.equal(r.chapters[0].tasks[0].startAttempts,2);assert(f.videos[0].startAttemptTimes[1]-f.videos[0].startAttemptTimes[0]>=LIMITS.videoStartRetryMs);}finally{f.close();}
 });
 const addEditor=(f,{mode='null',src='javascript:void(0)',outside=false,holder=true,index=0}={})=>{
  const doc=f.doc,q=doc.querySelectorAll('.singleQuesId')[index];
  q.querySelector('textarea')?.remove();
  const editor=doc.createElement('div');editor.className='edui-editor edui-default';
  editor.innerHTML='<div class="'+(holder?'edui-editor-iframeholder':'answer-area')+'"><iframe id="ueditor_0"></iframe></div>';
  (outside?doc.body:q).append(editor);const frame=editor.querySelector('iframe');frame.setAttribute('src',src);
  if(mode==='null'||mode==='throw')Object.defineProperty(frame,'contentDocument',{get:()=>{if(mode==='throw')throw new f.w.DOMException('editor unavailable','SecurityError');return null;}});
  return frame;
 };
 for(const mode of ['null','throw','empty'])await test(`编辑器框架：${mode} 答案编辑器不阻断人工题跳过`,async()=>{
  const f=fixture([{tabs:[quiz({essay:true,count:3})]},{tabs:[video()]}]);
  try{for(let index=0;index<3;index++)addEditor(f,{mode,index,src:mode==='empty'?'about:blank':'javascript:void(0)'});const before=classificationRequests.length;
   const r=await f.runner.start({skipUnanswerable:true});assert.equal(r.status,'done',r.reason);assert.equal(r.chapters[0].status,'manual-pending');assert.equal(r.videos,1);assert.equal(r.quizzes,0);assert.equal(f.submits,0);assert(f.events.includes('chapter:1'));assert.equal(f.requests.length,0);assert.equal(classificationRequests.length,before);
  }finally{f.close();}
 });
 await test('编辑器框架：关闭跳过时报告人工题而非框架异常',async()=>{
  const f=fixture([{tabs:[quiz({essay:true})]},{tabs:[video()]}]);try{addEditor(f);const r=await f.runner.start();assert.equal(r.status,'stopped');assert.match(r.reason,/人工/);assert.doesNotMatch(r.reason,/跨域/);assert.equal(f.submits,0);assert(!f.events.includes('chapter:1'));}finally{f.close();}
 });
 await test('编辑器框架：真实嵌套任务链仍读取测验，编辑器内容不参与任务扫描',async()=>{
  const f=fixture([{tabs:[quiz({essay:true})]},{tabs:[video()]}]);try{
   const doc=f.doc,quizNode=doc.querySelector('[data-course-task]'),outer=doc.createElement('iframe');doc.body.append(outer);
   const inner=outer.contentDocument.createElement('iframe');outer.contentDocument.body.append(inner);inner.contentDocument.body.append(quizNode);
   const q=inner.contentDocument.querySelector('.singleQuesId');q.querySelector('textarea').remove();q.insertAdjacentHTML('beforeend','<div class="edui-editor"><div class="edui-editor-iframeholder"><iframe id="ueditor_0"></iframe></div></div>');
   const editor=q.querySelector('iframe'),answer=editor.contentDocument;answer.body.innerHTML='<p>我的手工答案</p>';const html=answer.body.innerHTML;const next=f.d.querySelector('#cur2 .posCatalog_name'),navigate=next.onclick;next.onclick=()=>{assert.equal(answer.body.innerHTML,html);f.events.push('editor-preserved');navigate();};
   const tree=f.api.courseFrameTree(f.d);assert(tree.documents.includes(inner.contentDocument));assert(!tree.documents.includes(answer));assert.equal(tree.inaccessible.length,0);
   const r=await f.runner.start({skipUnanswerable:true});assert.equal(r.status,'done',r.reason);assert.equal(r.videos,1);assert.equal(f.submits,0);assert(f.events.includes('editor-preserved'));
  }finally{f.close();}
 });
 await test('编辑器框架：混合测验填写支持题，编辑器原答案保留且零提交',async()=>{
  const f=fixture([{tabs:[quiz({count:2,manualText:'请手写计算过程'})]},{tabs:[video()]}]);try{
   const q=f.doc.querySelectorAll('.singleQuesId')[1];q.querySelector('textarea').remove();q.insertAdjacentHTML('beforeend','<div class="edui-editor"><div class="edui-editor-iframeholder"><iframe id="ueditor_1"></iframe></div></div>');
   const editor=q.querySelector('iframe');editor.contentDocument.body.innerHTML='<p>已有手写附件</p>';const answer=editor.contentDocument,first=f.doc.querySelector('input[value=A]');const next=f.d.querySelector('#cur2 .posCatalog_name'),navigate=next.onclick;next.onclick=()=>{assert.equal(answer.body.innerHTML,'<p>已有手写附件</p>');f.events.push('editor-preserved');navigate();};
   const r=await f.runner.start({skipUnanswerable:true});assert.equal(r.status,'done',r.reason);assert(first.checked);assert(f.events.includes('editor-preserved'));assert.equal(f.submits,0);assert.equal(r.videos,1);
  }finally{f.close();}
 });
 for(const variant of [{src:'https://other.example/task'},{holder:false},{outside:true}])await test(`编辑器框架：不满足编辑器限定 ${JSON.stringify(variant)} 仍停止`,async()=>{
  const f=fixture([{tabs:[quiz({essay:true})]},{tabs:[video()]}]);try{addEditor(f,variant);const r=await f.runner.start({skipUnanswerable:true});assert.equal(r.status,'stopped');assert.match(r.reason,/跨域/);assert(!f.events.includes('chapter:1'));assert.equal(f.requests.length,0);assert.equal(f.submits,0);}finally{f.close();}
 });
 await test('编辑器框架：验证框架即使位于编辑器容器也立即停止',async()=>{
  const f=fixture([{tabs:[quiz({essay:true})]},{tabs:[video()]}]);try{addEditor(f,{src:'https://other.example/captcha'});const r=await f.runner.start({skipUnanswerable:true});assert.equal(r.status,'stopped');assert.match(r.reason,/验证码/);assert(!f.events.includes('chapter:1'));assert.equal(f.submits,0);}finally{f.close();}
 });
 await test('编辑器框架：真实任务主 iframe 不可读仍停止',async()=>{
  const f=fixture([{tabs:[quiz({essay:true})]},{tabs:[video()]}]);try{addEditor(f);Object.defineProperty(f.d.getElementById('iframe'),'contentDocument',{get:()=>null});const r=await f.runner.start({skipUnanswerable:true});assert.equal(r.status,'stopped');assert.match(r.reason,/跨域/);assert(!f.events.includes('chapter:1'));assert.equal(f.submits,0);}finally{f.close();}
 });
 await test('编辑器框架：人工题旁人脸提示仍立即停止',async()=>{
  const f=fixture([{tabs:[quiz({essay:true})]},{tabs:[video()]}]);try{addEditor(f);f.doc.body.insertAdjacentHTML('beforeend','<div data-face-verification>请人脸验证</div>');const r=await f.runner.start({skipUnanswerable:true});assert.equal(r.status,'stopped');assert.match(r.reason,/人脸/);assert(!f.events.includes('chapter:1'));assert.equal(f.submits,0);}finally{f.close();}
 });

 await test('失败保护：无任务章节休息前后计数保持，休息结束后第三次失败停止',async()=>{
  let offset=0,advanced=false,f;
  const chapters=[{tabs:[video({stall:true})]},{unknownStatus:true,tabs:[{title:'PPT',tasks:[{kind:'scroll',optional:true}]}]},{tabs:[video({stall:true})]},{tabs:[video({stall:true})]},{tabs:[video()]}];
  f=fixture(chapters,{now:()=>Date.now()+offset,limits:{stallMs:65},sleep:ms=>{if(!advanced&&f.events.includes('chapter:1')){advanced=true;offset+=600001;}return delay(ms);}});
  const pending=f.runner.start({continueOnTimeout:true,restEnabled:true,studyMinutes:10,restMinutes:1});
  try{await waitForTest(()=>Number.isFinite(f.storage.get(f.runner.key)?.pacing?.restUntil));assert(advanced);assert.equal(f.runner.report.protection.consecutiveFailures,1);assert(!f.events.includes('chapter:2'));
   const saved=f.storage.get(f.runner.key);assert.equal(saved.protection.consecutiveFailures,1);offset+=60001;
   const r=await pending;assert.equal(r.protection.consecutiveFailures,3);assert(r.protection.triggered);assert(!f.events.includes('chapter:4'));}
  finally{f.runner.stop();await pending;f.close();}
 });
 await test('失败保护：最小化和运行开始都清除重试确认',async()=>{
  const chapters=[{tabs:[video({stall:true})]}],f=fixture(chapters,{limits:{stallMs:40}});try{await f.runner.start();const s=f.d.getElementById('cx-ai-study-root').shadowRoot,box=s.getElementById('course-retry-confirm');
   f.api.controller.openPanel('chapters');s.getElementById('course-retry').click();assert(!box.hidden);s.getElementById('minimize').click();assert(box.hidden);
   f.api.controller.openPanel('chapters');s.getElementById('course-retry').click();assert(!box.hidden);const pending=f.runner.start();await waitForTest(()=>f.runner.busy);assert(box.hidden);f.runner.stop();await pending;
  }finally{f.close();}
 });
 await test('失败保护：重试运行不采纳上轮迟到模型响应，不重复填写提交',async()=>{
  const f=fixture([{tabs:[quiz()]}],{requestMs:80,lateResponse:true});let first,second;
  try{first=f.runner.start();await waitForTest(()=>f.requests.length===1);f.runner.stop();await first;assert.equal(f.submits,0);assert(f.runner.canRetry);
   second=f.runner.retryIncomplete(undefined,{submit:true});await waitForTest(()=>f.requests.length===2);const r=await second;await delay(90);assert.equal(r.status,'done',r.reason);assert.equal(r.quizzes,1);assert.equal(f.submits,1);assert.equal(f.storage.get(f.runner.key).previousReport.quizzes,0);
  }finally{f.runner.stop();if(first)await first;if(second)await second;f.close();}
 });
 await test('失败保护：独立子测验重试入口禁用，主页面确认重试保持有效',async()=>{
  const f=fixture([{tabs:[quiz()]}],{requestMs:100});let first,second;
  try{first=f.runner.start();await waitForTest(()=>f.requests.length===1);f.runner.stop();await first;
   const child=f.doc.defaultView;child.GM_getValue=withModelFixture((k,b)=>f.storage.has(k)?f.storage.get(k):b);child.GM_setValue=(k,v)=>f.storage.set(k,v);child.GM_getResourceText=()=> '{}';
   child.eval(code);child.courseAPI.initQuizAssistant();child.courseAPI.controller.openPanel('chapters');
   const s=f.d.getElementById('cx-ai-quiz-panel').shadowRoot;assert(s.getElementById('course-retry').disabled);const before=f.requests.length;
   s.getElementById('course-retry').click();s.getElementById('course-retry-accept').click();assert.equal(f.requests.length,before);assert(!f.runner.busy);assert.match(s.getElementById('course-run-note').textContent,/主页面/);
   second=f.runner.retryIncomplete(undefined,{submit:true});await second;
   assert.equal(f.runner.report.status,'done');assert.equal(f.submits,1);assert.equal(f.requests.length,2);assert(!f.api.courseRunActive(f.d));
  }finally{f.runner.stop();if(first)await first;f.close();}
 });
 await test('失败保护：阈值可注入专项测试，普通开始建立新运行而非自动恢复',async()=>{
  const chapters=Array.from({length:3},()=>({tabs:[video({stall:true})]})),f=fixture(chapters,{limits:{stallMs:120,maxConsecutiveChapterFailures:2}});
  try{const old=await f.runner.start({continueOnTimeout:true});assert(old.protection.triggered);assert.equal(old.protection.consecutiveFailures,2);assert(!f.events.includes('chapter:2'));const oldId=f.storage.get(f.runner.key).ownerId;
   chapters.forEach(c=>c.tabs[0].tasks[0].stall=false);const r=await f.runner.start();assert.equal(r.status,'done',r.reason);assert.notEqual(f.storage.get(f.runner.key).ownerId,oldId);assert.equal(r.protection.consecutiveFailures,0);
  }finally{f.close();}
 });
 await test('失败保护：三章超时后停止，第四章没有任何操作',async()=>{
  const f=fixture(Array.from({length:4},()=>({tabs:[video({stall:true})]})),{limits:{stallMs:35}});
  try{const r=await f.runner.start({continueOnTimeout:true});assert.equal(r.status,'stopped');assert.match(r.reason,/连续 3/);
   assert.deepEqual(Array.from(r.chapters,c=>c.status),['timed-out','timed-out','timed-out','unvisited']);
   assert.equal(r.protection.consecutiveFailures,3);assert(r.protection.triggered);assert(!f.events.includes('chapter:3'));assert(!f.events.includes('play:3:0:0'));assert.equal(f.requests.length,0);assert.equal(f.submits,0);assert.equal(r.videos,0);
   assert(!f.runner.busy);assert(!f.api.courseRunActive(f.d));assert(!f.runner.canSkip);assert.equal(f.runner.skip(),false);assert.equal(f.runner.resumeIfNeeded(),undefined);
   assert.equal(r.chapters[2].issues.length,1);assert.match(r.chapters[2].reason,/进度长时间/);f.videos.forEach(assertSeekListenersRemoved);
   const s=f.d.getElementById('cx-ai-study-root').shadowRoot;assert.match(s.getElementById('course-protection-status').textContent,/连续 3/);assert.match(s.getElementById('course-pending-summary').textContent,/失败 3.*尚未处理 1/);assert.equal(s.getElementById('course-pending-list').children.length,4);assert(!s.getElementById('course-pending').open);
  }finally{f.close();}
 });
 await test('失败保护：关闭超时继续仍首次停止，不等待三次',()=>runWith([{tabs:[video({stall:true})]},{tabs:[video()]}],{limits:{stallMs:35}},(f,r)=>{assert.equal(r.status,'stopped');assert(!r.protection.triggered);assert(!f.events.includes('chapter:1'));assert.equal(r.videos,0);}));
 await test('失败保护：真实完成与原本已完成清零，不把四次分散失败连计',async()=>{
  let clock=0;const f=fixture([{tabs:[video({stall:true})]},{tabs:[video()]},{tabs:[video({stall:true})]},{already:true,tabs:[video()]},{tabs:[video({stall:true})]},{tabs:[video({stall:true})]},{tabs:[video()]}],{limits:{stallMs:60},now:()=>clock,sleep:async ms=>{await delay(ms);clock+=ms;}});
  try{const r=await f.runner.start({continueOnTimeout:true});assert.equal(r.status,'done',r.reason);assert.equal(r.protection.consecutiveFailures,0);assert(!r.protection.triggered);assert.equal(r.videos,2);assert.equal(r.chapters[3].status,'already');assert.match(f.api.courseReportText(r),/遍历结束，仍有待处理章节/);}
  finally{f.close();}
 });
 await test('失败保护：无任务和手动跳过不清零，也不增加次数',async()=>{
  const f=fixture([{tabs:[video({stall:true})]},{unknownStatus:true,tabs:[{title:'PPT',tasks:[{kind:'scroll',optional:true}]}]},{tabs:[video({manual:true})]},{tabs:[video({stall:true})]},{tabs:[video({stall:true})]},{tabs:[video()]}],{limits:{stallMs:65}}),pending=f.runner.start({continueOnTimeout:true});
  try{await waitForTest(()=>f.events.includes('play:2:0:0'));assert.equal(f.runner.report.protection.consecutiveFailures,1);f.runner.skip();const r=await pending;
   assert(r.protection.triggered);assert.equal(r.chapters[1].status,'no-tasks');assert.equal(r.chapters[2].status,'skipped');assert.equal(r.protection.consecutiveFailures,3);assert(!f.events.includes('chapter:5'));}
  finally{f.runner.stop();await pending;f.close();}
 });
 await test('失败保护：同章先完成视频再超时仅计一章，不能按任务完成清零',async()=>{
  const f=fixture([{tabs:[video({stall:true})]},{tabs:[{title:'混合视频',tasks:[{kind:'video'},{kind:'video',stall:true}]}]},{tabs:[video({stall:true})]},{tabs:[video()]}],{limits:{stallMs:250}});
  try{const r=await f.runner.start({continueOnTimeout:true});assert(r.protection.triggered);assert.equal(r.protection.consecutiveFailures,3);assert.equal(r.videos,1);assert.equal(r.chapters[1].tasks[0].status,'done');assert(!f.events.includes('chapter:3'));}
  finally{f.close();}
 });
 await test('失败保护：结果去重、旧会话重建只读当前位置之前',async()=>{
  const f=fixture([{tabs:[video()]}]);try{const chapters=[{status:'timed-out'},{status:'no-tasks'},{status:'skipped'},{status:'timed-out'},{status:'already'},{status:'timed-out'}];
   let p=f.api.courseRunProtection(null,chapters,4,3);assert.equal(p.consecutiveFailures,2);assert.equal(p.lastOutcomeIndex,3);
   f.api.courseRecordChapterOutcome(p,chapters[3],3);assert.equal(p.consecutiveFailures,2);
   f.api.courseRecordChapterOutcome(p,chapters[4],4);assert.equal(p.consecutiveFailures,0);
   f.api.courseRecordChapterOutcome(p,chapters[5],5);assert.equal(p.consecutiveFailures,1);
   const q=f.api.courseRunProtection({protection:p},chapters,5,3);assert.equal(q.lastOutcomeIndex,5);assert.equal(q.consecutiveFailures,1);
  }finally{f.close();}
 });
 for(const legacy of [false,true])await test(`失败保护：原生换页恢复保存连续失败，旧会话=${legacy}`,async()=>{
  const chapters=[{tabs:[video({stall:true})]},{tabs:[video({stall:true})]},{tabs:[video({stall:true})]},{tabs:[video()]}];
  const first=fixture(chapters,{navigateOut:true,limits:{stallMs:35}});let stored,session;
  try{const r=await first.runner.start({continueOnTimeout:true});assert.equal(r.status,'running');assert.equal(r.protection.consecutiveFailures,1);stored=[...first.storage];session=first.w.sessionStorage.getItem('cx-ai-course-session');}
  finally{first.close();}
  if(legacy){const value=stored.find(([key])=>key.startsWith('cx_course_run:'))[1];delete value.protection;delete value.report.protection;}
  const next=fixture(chapters,{storage:stored,session,noAutoResume:true,limits:{stallMs:35}});
  try{const r=await next.runner.resumeIfNeeded();assert(r.protection.triggered,r.reason);assert.equal(r.protection.consecutiveFailures,3);assert(!next.events.includes('chapter:3'));}
  finally{next.close();}
 });
 await test('失败保护：旧会话已经累计三次时恢复不再操作新章节',async()=>{
  const f=fixture(Array.from({length:4},()=>({tabs:[video()]})),{noAutoResume:true});try{
   const chapters=[0,1,2,3].map(i=>({id:'cur'+(i+1),number:String(i+1),title:'模拟章节',status:i<3?'timed-out':'unvisited',tasks:[],issues:[]}));
   // 使用真实会话初始化配置签名，随后模拟老版本导航交接。
   await f.runner.start();const saved=f.storage.get(f.runner.key);saved.status='running';saved.handoff=true;saved.report.status='running';saved.report.chapters=chapters;saved.chapterIndex=3;delete saved.protection;delete saved.report.protection;f.storage.set(f.runner.key,saved);
   const before=f.events.length;const r=await f.runner.resumeIfNeeded();assert(r.protection.triggered);assert.equal(f.events.length,before);assert.equal(r.chapters[3].status,'unvisited');
  }finally{f.close();}
 });
 await test('失败保护：正常结束仍展示最后一章失败、跳过与未处理，不声明全部完成',async()=>{
  const f=fixture([{tabs:[video({stall:true})]}],{limits:{stallMs:35}});try{const r=await f.runner.start({continueOnTimeout:true});assert.equal(r.status,'done');assert.match(f.api.courseReportText(r),/遍历结束，仍有待处理章节/);assert(!f.api.courseReportText(r).includes('全部流程完成'));
   const old={status:'done',chapters:[{id:'1',number:'1',title:'旧记录',status:'skipped',tasks:[],issues:[]}],videos:0,documents:0,quizzes:0};assert.match(f.api.courseReportText(old),/仍有待处理/);assert.equal(f.api.coursePendingChapters(old).skipped.length,1);
  }finally{f.close();}
 });
 await test('失败保护：确认重试前无副作用，取消、关闭、隐藏及记录变化清理确认',async()=>{
  const f=fixture([{tabs:[video({stall:true})]},{tabs:[video()]}],{limits:{stallMs:35}});try{await f.runner.start();const s=f.d.getElementById('cx-ai-study-root').shadowRoot,button=s.getElementById('course-retry'),accept=s.getElementById('course-retry-accept'),box=s.getElementById('course-retry-confirm');
   assert(!button.disabled);const before=f.events.length;button.click();assert(!box.hidden);assert.equal(f.events.length,before);assert.equal(f.requests.length,0);
   s.getElementById('course-retry-cancel').click();assert(box.hidden);accept.click();assert.equal(f.events.length,before);
   button.click();s.getElementById('close').click();assert(box.hidden);
   button.click();f.menus.get('隐藏助手全部界面')();assert(box.hidden);f.menus.get('显示助手界面')();
   button.click();const saved=f.storage.get(f.runner.key);saved.ownerId='changed';f.storage.set(f.runner.key,saved);accept.click();assert(box.hidden);assert.equal(f.events.length,before);assert.match(f.api.controller.state.message,/记录已变化/);
  }finally{f.close();}
 });
 await test('失败保护：保护停止重试新ID和零计数，保留上轮结果，正常刷新也能恢复',async()=>{
  const chapters=Array.from({length:4},()=>({tabs:[video({stall:true})]}));const first=fixture(chapters,{limits:{stallMs:35}});let stored;
  try{await first.runner.start({continueOnTimeout:true});stored=[...first.storage];assert(first.runner.report.protection.triggered);}finally{first.close();}
  chapters.forEach(ch=>ch.tabs[0].tasks[0].stall=false);
  const f=fixture(chapters,{storage:stored,noAutoResume:true});try{const old=f.storage.get(f.runner.key),oldId=old.ownerId;assert(f.runner.canRetry);assert.equal(f.runner.resumeIfNeeded(),undefined);
   const r=await f.runner.retryIncomplete();const saved=f.storage.get(f.runner.key);assert.equal(r.status,'done',r.reason);assert.equal(r.videos,4);assert.equal(r.protection.consecutiveFailures,0);assert(!r.protection.triggered);assert.notEqual(saved.ownerId,oldId);assert.equal(saved.previousReport.protection.triggered,true);assert.equal(saved.previousReport.videos,0);assert.equal(r.retryOf.startedAt,old.report.startedAt);assert.match(f.api.courseReportText(r),/仅统计本轮/);
  }finally{f.close();}
 });
 await test('失败保护：重试保留原顺序，排除主动跳过，当前开关即使关闭已学跳过也不重复播放已完成任务',async()=>{
  const chapters=[{tabs:[video()]},{tabs:[video({manual:true})]},{tabs:[{title:'多视频',tasks:[{kind:'video'},{kind:'video',stall:true}]}]},{tabs:[video()]}];
  const f=fixture(chapters,{limits:{stallMs:250}}),p=f.runner.start();try{await waitForTest(()=>f.events.includes('play:1:0:0'));f.runner.skip();await p;assert.equal(f.runner.report.chapters[0].status,'done');assert.equal(f.runner.report.chapters[1].status,'skipped');
   chapters[2].tabs[0].tasks[1].stall=false;f.storage.set('cx_course_skip_learned',false);f.storage.set('cx_course_auto_submit',false);const before=f.events.length;
   const r=await f.runner.retryIncomplete();assert.equal(r.status,'done',r.reason);assert.deepEqual(Array.from(r.chapters,c=>c.id),['cur3','cur4']);assert.equal(r.videos,2);assert(!f.events.slice(before).includes('play:2:0:0'));assert(!f.events.slice(before).includes('chapter:0'));assert(!f.events.slice(before).includes('chapter:1'));assert.equal(f.storage.get(f.runner.key).submit,false);assert.equal(f.storage.get(f.runner.key).previousReport.videos,2);
  }finally{f.runner.stop();await p;f.close();}
 });
 for(const invalid of ['busy','captcha','scope','missing','submission','running','stale'])await test(`失败保护：重试前再次检查${invalid}，拒绝时没有新操作`,async()=>{
  const f=fixture([{tabs:[video({stall:true})]},{tabs:[video()]}],{limits:{stallMs:35}});try{await f.runner.start();const candidate=f.api.courseRetryCandidate(f.d,f.storage.get(f.runner.key));assert(candidate.allowed);const saved=f.storage.get(f.runner.key);
   if(invalid==='busy')f.api.controller.state.busy=true;
   if(invalid==='captcha'){const n=f.doc.createElement('div');n.setAttribute('data-captcha','');f.doc.body.append(n);}
   if(invalid==='scope')saved.scope='another-account';if(invalid==='missing')f.d.querySelector('#cur2').remove();
   if(invalid==='submission')saved.report.chapters[0].tasks[0].submissionStarted=true;if(invalid==='running')saved.status='running';if(invalid==='stale')saved.ownerId='new-record';f.storage.set(f.runner.key,saved);
   const before=f.events.length;await f.runner.retryIncomplete(candidate.token);assert.equal(f.events.length,before);assert.equal(f.requests.length,0);assert.equal(f.submits,0);assert(!f.runner.busy);
  }finally{f.api.controller.state.busy=false;f.close();}
 });
 await test('失败保护：提交结果不明确时立即停止，超时继续不能改为累计或重试',async()=>{
  const f=fixture([{tabs:[quiz()]},{tabs:[video()]}],{submitNoAck:true});try{const r=await f.runner.start({continueOnTimeout:true});assert.equal(r.status,'stopped');assert(!r.protection.triggered);assert(!f.runner.canRetry);assert(!f.events.includes('chapter:1'));assert.equal(f.submits,1);await f.runner.retryIncomplete();assert.equal(f.submits,1);assert.match(f.api.controller.state.message,/提交结果未确认/);}
  finally{f.close();}
 });
 await test('失败保护：确认重试按钮只协调一个顶层运行，双击不重复播放',async()=>{
  const chapters=[{tabs:[video({stall:true})]}],f=fixture(chapters,{limits:{stallMs:65}});try{await f.runner.start();chapters[0].tabs[0].tasks[0].stall=false;const s=f.d.getElementById('cx-ai-study-root').shadowRoot,before=f.events.length;
   s.getElementById('course-retry').click();s.getElementById('course-retry-accept').click();s.getElementById('course-retry-accept').click();await waitForTest(()=>f.runner.busy);await waitForTest(()=>!f.runner.busy);assert.equal(f.runner.report.status,'done');assert.equal(f.events.slice(before).filter(e=>e.startsWith('play:')).length,1);
  }finally{f.close();}
 });
 await test('失败保护：标题按纯文本渲染，隐藏期间保护停止不重新打开界面',async()=>{
  const f=fixture(Array.from({length:4},()=>({tabs:[video({stall:true})]})),{limits:{stallMs:35}});try{f.menus.get('隐藏助手全部界面')();const r=await f.runner.start({continueOnTimeout:true});assert(r.protection.triggered);assert.equal(f.d.getElementById('cx-ai-study-root').style.display,'none');
   const saved=f.storage.get(f.runner.key);saved.report.chapters[0].title='<img src=x onerror=evil()> & test';f.storage.set(f.runner.key,saved);f.menus.get('显示助手界面')();f.d.dispatchEvent(new f.w.Event('cx-ai-course-update'));const list=f.d.getElementById('cx-ai-study-root').shadowRoot.getElementById('course-pending-list');assert.equal(list.querySelector('img'),null);assert(list.textContent.includes('<img src=x onerror=evil()>'));
  }finally{f.close();}
 });
 await test('前台限制只识别当前视频的可见观看提示，题干、隐藏和兄弟任务不命中',async()=>{
  const f=fixture([{tabs:[video({manual:true})]}]);try{
   const v=f.videos[0],container=v.parentElement;
   for(const html of ['<p hidden>观看时不可离开或将页面最小化</p>','<div class="TiMu"><p>观看时不可离开或将页面最小化</p></div>','<div data-course-task><p>观看时不可离开或将页面最小化</p></div>','<p>允许切换窗口，观看可离开页面</p>']){
    container.insertAdjacentHTML('beforeend',html);assert.equal(f.api.courseVideoForegroundPolicy(v).required,false);container.lastElementChild.remove();
   }
   container.insertAdjacentHTML('beforeend','<p>观看时不可离开或将页面最小化</p>');assert.equal(f.api.courseVideoForegroundPolicy(v).required,true);
   assert.match(f.api.courseVideoForegroundPolicy(v).evidence,/观看/);
  }finally{f.close();}
 });
 await test('前台限制：后台首次等待不启动，不增加恢复次数，返回后正常完成',async()=>{
  const f=fixture([{tabs:[video({foreground:true,manual:true})]}]),foreground=foregroundFixture(f,false),pending=f.runner.start();
  try{await waitForTest(()=>f.runner.report.chapters[0].tasks[0]?.foregroundState?.waiting);await delay(20);
   const task=f.runner.report.chapters[0].tasks[0];assert.equal(f.events.filter(e=>e.startsWith('play:')).length,0);assert.equal(task.resumes,0);assert.equal(task.foregroundState.waitCount,1);
   foreground(true);await waitForTest(()=>f.events.includes('play:0:0:0'));finishManual(f.videos[0]);const r=await pending;
   assert.equal(r.status,'done',r.reason);assert.equal(r.videos,1);assert(task.foregroundState.waitMs>=20);assert(!task.foregroundState.waiting);assertSeekListenersRemoved(f.videos[0]);
  }finally{f.runner.stop();await pending;f.close();}
 });
 await test('前台限制：可见但失焦仍等待；只有顶层可见且有焦点才继续',async()=>{
  const f=fixture([{tabs:[video({foreground:true,manual:true})]}]),foreground=foregroundFixture(f,true,false),pending=f.runner.start();
  try{await waitForTest(()=>f.runner.report.chapters[0].tasks[0]?.foregroundState?.waiting);assert(!f.events.some(e=>e.startsWith('play:')));
   foreground(false,true);await delay(10);assert(!f.events.some(e=>e.startsWith('play:')));foreground(true,true);await waitForTest(()=>f.events.some(e=>e.startsWith('play:')));finishManual(f.videos[0]);assert.equal((await pending).videos,1);
  }finally{f.runner.stop();await pending;f.close();}
 });
 await test('前台限制：等待远超停滞期限不误停，返回后真实卡住仍超时',async()=>{
  let clock=0;const f=fixture([{tabs:[video({foreground:true,manual:true})]}],{now:()=>clock,limits:{stallMs:80}}),foreground=foregroundFixture(f),pending=f.runner.start();
  try{await waitForTest(()=>f.events.includes('play:0:0:0'));const task=f.runner.report.chapters[0].tasks[0];foreground(false);await waitForTest(()=>task.foregroundState.waiting);
   const plays=f.events.filter(e=>e.startsWith('play:')).length;clock+=700000;await delay(10);assert.equal(f.runner.report.status,'running');assert.equal(f.events.filter(e=>e.startsWith('play:')).length,plays);
   foreground(true);await waitForTest(()=>!task.foregroundState.waiting);assert.equal(f.runner.report.status,'running');clock+=81;
   const r=await pending;assert.equal(r.status,'stopped');assert.match(r.reason,/进度长时间没有变化/);assert.equal(r.videos,0);assert(task.foregroundState.waitMs>=700000);
  }finally{f.runner.stop();await pending;f.close();}
 });
 await test('前台限制：定位等待排除后台时间，返回后重新稳定并继续',async()=>{
  const clockBase=Date.now();let offset=0;const f=fixture([{tabs:[video({foreground:true,manual:true,start:100,duration:105})]}],{now:()=>clockBase+offset,limits:{stallMs:120}}),foreground=foregroundFixture(f),pending=f.runner.start();
  try{await waitForTest(()=>f.events.includes('play:0:0:0'));const v=f.videos[0],task=f.runner.report.chapters[0].tasks[0];v.simulateMedia({seeking:true,readyState:1},'seeking');foreground(false);offset+=120000;
   v.simulateMedia({seeking:false,readyState:4},'seeked');await delay(10);assert.equal(f.runner.report.status,'running');foreground(true);
   await waitForTest(()=>!task.foregroundState.waiting);offset+=LIMITS.videoSeekStableMs+1;
   await waitForTest(()=>task.seekState?.outcome==='continuous');await waitForTest(()=>!v.paused);finishManual(v);const r=await pending;assert.equal(r.videos,1,r.reason);assertSeekListenersRemoved(v);
  }finally{f.runner.stop();await pending;f.close();}
 });
 await test('前台限制：回退重播预算排除后台时间，返回后继续获得新增进展',async()=>{
  let offset=0;const f=fixture([{tabs:[video({foreground:true,manual:true,start:100,duration:115,playedRanges:[[0,100]]})]}],{now:()=>Date.now()+offset}),foreground=foregroundFixture(f),pending=f.runner.start();
  try{await waitForTest(()=>f.events.includes('play:0:0:0'));const v=f.videos[0],task=f.runner.report.chapters[0].tasks[0];v.simulateMedia({seconds:95,seeking:true},'seeking');v.simulateMedia({seeking:false},'seeked');await waitForTest(()=>task.rollbackCount===1);
   foreground(false);offset+=600000;await delay(10);foreground(true);await waitForTest(()=>!task.foregroundState.waiting);assert.equal(f.runner.report.status,'running');
   finishManual(v);const r=await pending;assert.equal(r.status,'done',r.reason);assert.equal(r.videos,1);assert(task.replayState.elapsed>=600,'诊断时间必须保留真实等待时间');
  }finally{f.runner.stop();await pending;f.close();}
 });
 await test('前台限制：返回时未播前跳至末尾仍停止，平台完成不能绕过',async()=>{
  const f=fixture([{tabs:[video({foreground:true,manual:true,start:100,duration:105})]}]),foreground=foregroundFixture(f),pending=f.runner.start();
  try{await waitForTest(()=>f.events.includes('play:0:0:0'));foreground(false);f.videos[0].simulateMedia({seconds:105,seeking:false,ended:true},'ended');foreground(true);
   const r=await pending;assert.equal(r.status,'stopped');assert.match(r.reason,/进度跳转/);assert.equal(r.videos,0);assertSeekListenersRemoved(f.videos[0]);
  }finally{f.runner.stop();await pending;f.close();}
 });
 for(const action of ['stop','skip','chapter','replace','captcha'])await test(`前台限制：等待期间${action}及时退出并清理媒体监听`,async()=>{
  const f=fixture([{tabs:[video({foreground:true,manual:true})]},{tabs:[video()]}]);foregroundFixture(f,false);const pending=f.runner.start();
  try{await waitForTest(()=>f.runner.report.chapters[0].tasks[0]?.foregroundState?.waiting);const v=f.videos[0];
   if(action==='stop')f.runner.stop();if(action==='skip')f.runner.skip();if(action==='chapter')f.d.querySelector('#cur2 .posCatalog_name').click();
   if(action==='replace')v.remove();if(action==='captcha'){const n=f.doc.createElement('div');n.setAttribute('data-captcha','');f.doc.body.append(n);}
   const r=await pending;assert.equal(r.status,action==='skip'?'done':'stopped');assert.equal(r.videos,action==='skip'?1:0);assertSeekListenersRemoved(v);
  }finally{f.runner.stop();await pending;f.close();}
 });
 await test('没有明确前台限制的后台视频照常完成，未运行时mouseout正常传播',async()=>{
  const f=fixture([{tabs:[video()]}]);foregroundFixture(f,false);try{let received=0;f.w.addEventListener('mouseout',()=>received++);f.w.dispatchEvent(new f.w.MouseEvent('mouseout',{relatedTarget:null}));assert.equal(received,1);
   const r=await f.runner.start();assert.equal(r.status,'done');assert.equal(r.videos,1);assert.equal(r.chapters[0].tasks[0].foregroundState.waitCount,0);
  }finally{f.close();}
 });
 await test('学习设置默认关闭，范围校验与持久化正确，键盘导航新增学习设置页',async()=>{
  const f=fixture([{tabs:[video()]}]);try{const s=f.d.getElementById('cx-ai-study-root').shadowRoot,enable=s.getElementById('course-rest-enabled'),study=s.getElementById('course-study-minutes'),rest=s.getElementById('course-rest-minutes');
   assert(!enable.checked);assert.equal(study.value,'50');assert.equal(rest.value,'10');study.value='9';study.onchange();assert.equal(study.value,'50');assert.match(s.getElementById('course-learning-message').textContent,/范围/);
   rest.value='61';rest.onchange();assert.equal(rest.value,'10');study.value='10';study.onchange();rest.value='1';rest.onchange();enable.checked=true;enable.onchange();
   assert.equal(f.storage.get('cx_course_rest_enabled'),true);assert.equal(f.storage.get('cx_course_study_minutes'),10);assert.equal(f.storage.get('cx_course_rest_minutes'),1);
   f.api.controller.openPanel('model');s.getElementById('settings-tab-model').dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert(!s.getElementById('settings-learning-page').hidden);assert.equal(s.activeElement.id,'settings-tab-learning');
   const p=f.runner.start();await waitForTest(()=>f.runner.busy);assert(enable.disabled&&study.disabled&&rest.disabled);study.value='100';study.onchange();assert.equal(f.storage.get('cx_course_study_minutes'),10);await p;assert(!enable.disabled);
  }finally{f.close();}
 });
 await test('全隐藏运行覆盖课程和测验新建UI，播放、PPT和提交照常完成',async()=>{
  const f=fixture([{tabs:[video(),ppt(),quiz({essay:true,confirm:true})]}]);try{
   f.menus.get('隐藏助手全部界面')();const p=f.runner.start();await waitForTest(()=>f.events.some(e=>e.startsWith('play:')));
   const s=f.d.getElementById('cx-ai-study-root').shadowRoot;assert.equal(f.d.getElementById('cx-ai-study-root').style.display,'none');assert.equal(f.d.getElementById('cx-ai-study-toolbar').style.display,'none');
   const r=await p;assert.equal(r.videos,1);assert.equal(r.documents,1);assert.equal(r.quizzes,1);assert.equal(f.submits,1);assert.equal(f.d.getElementById('cx-ai-study-root').style.display,'none');
   f.menus.get('显示助手界面')();assert(!s.getElementById('panel').hidden);assert.equal(f.d.getElementById('cx-ai-study-toolbar').style.display,'flex');
  }finally{f.close();}
 });
 for(const enabled of [false,true])await test(`学习休息开启=${enabled}：章节边界才休息，期间不播放下一章，最后一章不追加休息`,async()=>{
  let offset=0;const f=fixture([{tabs:[video({manual:true})]},{tabs:[video()]}],{now:()=>Date.now()+offset}),pending=f.runner.start({restEnabled:enabled,studyMinutes:10,restMinutes:1});
  try{await waitForTest(()=>f.events.includes('play:0:0:0'));offset+=600001;finishManual(f.videos[0]);
   if(enabled){await waitForTest(()=>f.d.getElementById('cx-ai-course-lease')?.getAttribute('data-phase')==='course-rest');assert(!f.events.includes('chapter:1'));
    const saved=f.storage.get(f.runner.key);assert.equal(saved.pacing.activeStartedAt,null);assert(saved.pacing.restUntil>Date.now()+offset);assert(f.runner.busy);offset+=60001;}
   const r=await pending;assert.equal(r.status,'done',r.reason);assert.equal(r.videos,2);assert.equal(r.pacing.restUntil,null);
  }finally{f.runner.stop();await pending;f.close();}
 });
 for(const skipped of [true,false])await test(`学习休息：${skipped?'人工跳过':'超时失败'}章节即使活动时间已满也不触发休息`,async()=>{
  let offset=0;const f=fixture([{tabs:[video({manual:true})]},{tabs:[video()]}],{now:()=>Date.now()+offset}),pending=f.runner.start({continueOnTimeout:true,restEnabled:true,studyMinutes:10,restMinutes:1});
  try{await waitForTest(()=>f.events.includes('play:0:0:0'));offset+=600001;if(skipped)f.runner.skip();
   const r=await pending;assert.equal(r.status,'done',r.reason);assert.equal(r.chapters[0].status,skipped?'skipped':'timed-out');assert.equal(r.videos,1);assert.equal(r.pacing.restUntil,null);
  }finally{f.runner.stop();await pending;f.close();}
 });
 await test('学习休息：后续仅剩已学章节时不追加休息',async()=>{
  let offset=0;const f=fixture([{tabs:[video({manual:true})]},{already:true,tabs:[video({learned:true})]}],{now:()=>Date.now()+offset}),pending=f.runner.start({restEnabled:true,studyMinutes:10,restMinutes:1});
  try{await waitForTest(()=>f.events.includes('play:0:0:0'));offset+=600001;finishManual(f.videos[0]);const r=await pending;assert.equal(r.status,'done',r.reason);assert.equal(r.chapters[1].status,'already');assert.equal(r.pacing.restUntil,null);assert(!f.events.includes('chapter:1'));
  }finally{f.runner.stop();await pending;f.close();}
 });
 await test('学习休息：停止立即退出，不跳章；全隐藏不会结束休息',async()=>{
  let offset=0;const f=fixture([{tabs:[video({manual:true})]},{tabs:[video()]}],{now:()=>Date.now()+offset}),pending=f.runner.start({restEnabled:true,studyMinutes:10,restMinutes:1});
  try{await waitForTest(()=>f.events.includes('play:0:0:0'));offset+=600001;finishManual(f.videos[0]);await waitForTest(()=>f.d.getElementById('cx-ai-course-lease')?.getAttribute('data-phase')==='course-rest');
   f.menus.get('隐藏助手全部界面')();assert(f.runner.busy);f.runner.stop();const r=await pending;assert.equal(r.status,'stopped');assert(!f.events.includes('chapter:1'));
  }finally{f.runner.stop();await pending;f.close();}
 });
 await test('学习休息：刷新恢复固定截止时间，不重置休息且不重做已完成章节',async()=>{
  let offset=0,g,q;const chapters=[{tabs:[video({manual:true})]},{tabs:[video()]}],f=fixture(chapters,{now:()=>Date.now()+offset}),p=f.runner.start({restEnabled:true,studyMinutes:10,restMinutes:1});
  try{await waitForTest(()=>f.events.includes('play:0:0:0'));offset+=600001;finishManual(f.videos[0]);await waitForTest(()=>f.d.getElementById('cx-ai-course-lease')?.getAttribute('data-phase')==='course-rest');
   const deadline=f.storage.get(f.runner.key).pacing.restUntil,session=f.w.sessionStorage.getItem('cx-ai-course-session');f.w.dispatchEvent(new f.w.Event('pagehide'));await p;assert.equal(f.storage.get(f.runner.key).status,'running');
   offset+=20000;g=fixture(chapters,{now:()=>Date.now()+offset,session,storage:[...f.storage],noAutoResume:true});q=g.runner.start({resume:true});await waitForTest(()=>g.runner.busy);
   assert.equal(g.storage.get(g.runner.key).pacing.restUntil,deadline);assert(!g.events.some(e=>e.startsWith('play:')));offset+=40001;
   const r=await q;assert.equal(r.status,'done',r.reason);assert(!g.events.includes('play:0:0:0'));assert(g.events.includes('play:1:0:0'));
  }finally{f.runner.stop();await p;g?.runner.stop();if(q)await q;g?.close();f.close();}
 });
 await test('前台等待：播放启动被主动暂停中断时，返回后恢复且加载预算不被等待耗尽',async()=>{
  let offset=0,attempts=0;const f=fixture([{tabs:[video({foreground:true,manual:true})]}],{now:()=>Date.now()+offset}),foreground=foregroundFixture(f),v=f.videos[0],play=v.play;
  v.play=()=>{if(++attempts===1){foreground(false);return Promise.reject(Object.assign(new Error('主动暂停中断启动'),{name:'AbortError'}));}return play();};
  const pending=f.runner.start();try{await waitForTest(()=>f.runner.report.chapters[0].tasks[0]?.foregroundState?.waiting);offset+=120000;await delay(10);assert.equal(f.runner.report.status,'running');assert.equal(attempts,1);foreground(true);
   await waitForTest(()=>f.events.includes('play:0:0:0')||f.runner.report.status!=='running');assert.equal(f.runner.report.status,'running',f.runner.report.reason);finishManual(v);assert.equal((await pending).videos,1);assert.equal(attempts,2);assertSeekListenersRemoved(v);
  }finally{f.runner.stop();await pending;f.close();}
 });
 await test('学习休息：前台等待不累计为活动时长，返回后不能立即触发休息',async()=>{
  let offset=0;const f=fixture([{tabs:[video({foreground:true,manual:true})]},{tabs:[video()]}],{now:()=>Date.now()+offset}),foreground=foregroundFixture(f),pending=f.runner.start({restEnabled:true,studyMinutes:10,restMinutes:1});
  try{await waitForTest(()=>f.events.includes('play:0:0:0'));foreground(false);offset+=700000;await delay(10);foreground(true);await waitForTest(()=>!f.runner.report.chapters[0].tasks[0].foregroundState.waiting);finishManual(f.videos[0]);
   const r=await pending;assert.equal(r.status,'done',r.reason);assert.equal(r.pacing.restUntil,null);assert(r.pacing.activeMs<600000);
  }finally{f.runner.stop();await pending;f.close();}
 });
 await test('旧报告缺新增等待和休息字段仍兼容，新诊断只显示固定字段',async()=>{
  const f=fixture([{tabs:[video()]}]);try{const r=await f.runner.start();assert.match(f.api.courseReportText(r),/全部流程完成/);delete r.pacing;delete r.chapters[0].tasks[0].foregroundState;assert.doesNotThrow(()=>f.api.courseReportText(r));
   r.chapters[0].tasks[0].foregroundState={required:true,evidence:'观看时不可离开页面',waitCount:1,waitMs:1000,waiting:false,url:'https://mock.invalid/?token=secret'};const text=f.api.courseReportText(r);assert.match(text,/前台等待记录/);assert(!text.includes('token=secret'));
  }finally{f.close();}
 });
 await test('完整课程：多视频→PPT→测验确认提交→无视频无测验章节→下一目录',()=>runWith([
  {tabs:[{title:'视频',tasks:[{kind:'video',start:1,duration:4},{kind:'video'}]},ppt(),quiz({essay:true,confirm:true})]},
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
  try{const s=f.d.getElementById('cx-ai-study-root').shadowRoot,toggle=s.getElementById('course-skip-learned');assert(toggle.checked);toggle.checked=false;toggle.dispatchEvent(new f.w.Event('change'));assert.equal(f.storage.get('cx_course_skip_learned'),false);f.api.controller.openPanel('chapters');assert(!toggle.checked);s.getElementById('course-start').click();await waitForTest(()=>toggle.disabled);assert(f.runner.busy);assert(toggle.disabled);assert.equal(f.storage.get(f.runner.key).skipLearned,false);for(let i=0;i<200&&f.runner.report.status==='running';i++)await delay(5);assert.equal(f.runner.report.status,'done');assert.equal(f.runner.report.videos,1);assert(!toggle.disabled);assert(!toggle.checked);}finally{f.close();}
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
  try{f.d.querySelector('#cur2 .posCatalog_name').click();f.events.length=0;const s=f.d.getElementById('cx-ai-study-root').shadowRoot,toggle=s.getElementById('course-from-current');toggle.checked=true;s.getElementById('course-start').click();await waitForTest(()=>toggle.disabled);assert(f.runner.busy);assert(toggle.disabled);for(let i=0;i<200&&f.runner.report.status==='running';i++)await delay(5);const r=f.runner.report;assert.equal(r.status,'done');assert.equal(r.videos,2);assert.deepEqual(Array.from(r.chapters,c=>c.id),['cur2','cur3']);assert(!f.events.includes('chapter:0'));assert(!toggle.disabled);assert.equal(f.storage.get(f.runner.key).startChapterId,'cur2');assert.equal(f.storage.get(f.runner.key).fromCurrent,true);assert(s.getElementById('course-report').textContent.includes('2/2'));assert.equal(s.getElementById('status').textContent,'自动学习已结束');assert(!s.getElementById('status').textContent.includes('视频结束'));}finally{f.close();}
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
  const f=fixture([{tabs:[video({stall:true})]},{tabs:[video()]}],{limits:{stallMs:250}});try{const r=await f.startWithDefaults();assert.equal(r.status,'done');assert.equal(r.chapters[0].status,'timed-out');assert.equal(r.chapters[0].tasks[0].status,'timed-out');assert.equal(r.videos,1);assert(f.videos[0].paused);assert(f.events.includes('chapter:1'));assert.match(f.api.courseReportText(r),/超时跳过 1 个章节（不计为完成）/);assert.match(f.api.courseReportText(r),/遍历结束，仍有待处理章节/);assert.equal(f.storage.get(f.runner.key).continueOnTimeout,true);}finally{f.close();}
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
  const chapters=[{tabs:[video({stall:true})]},{tabs:[video()]}],f=fixture(chapters,{limits:{stallMs:65}});try{const s=f.d.getElementById('cx-ai-study-root').shadowRoot,t=s.getElementById('course-timeout-next');assert(t.checked);t.checked=false;t.dispatchEvent(new f.w.Event('change'));assert.equal(f.storage.get('cx_course_timeout_next'),false);s.getElementById('course-start').click();await waitForTest(()=>t.disabled);assert(t.disabled);for(let i=0;i<100&&f.runner.report.status==='running';i++)await delay(5);assert.equal(f.runner.report.status,'stopped');assert(!t.disabled);assert.equal(f.storage.get(f.runner.key).continueOnTimeout,false);const r=await f.runner.start({resume:true,continueOnTimeout:true});assert.equal(r.status,'stopped');assert(!f.events.includes('chapter:1'));assert.equal(f.storage.get(f.runner.key).continueOnTimeout,false);}finally{f.close();}
 });
 await test('模型请求超时可继续下一章，不预填或提交失败测验',async()=>{
  const f=fixture([{tabs:[quiz()]},{tabs:[video()]}],{error:'timeout'});try{const r=await f.runner.start({continueOnTimeout:true});assert.equal(r.status,'done');assert.equal(r.chapters[0].status,'timed-out');assert.equal(r.quizzes,0);assert.equal(f.submits,0);assert.equal(r.videos,1);assert(f.events.includes('chapter:1'));assert.match(r.chapters[0].reason,/超时/);}finally{f.close();}
 });
 await test('PPT 无末页按钮时逐页到末页，仍需平台完成确认',()=>runWith([{tabs:[ppt({nextOnly:true})]}],{},(f,r)=>{assert.equal(r.status,'done');assert.deepEqual(f.events.filter(x=>x.startsWith('slide:')),['slide:2','slide:3','slide:4']);}));
 await test('Swiper 幻灯片通过原分页按钮到末页，收到任务完成才继续',()=>runWith([{tabs:[ppt({swiper:true}),video()]}],{},(f,r)=>{assert.equal(r.status,'done');assert.equal(r.documents,1);assert.equal(r.videos,1);assert(f.events.includes('slide:3'));assert(f.events.indexOf('slide:3')<f.events.indexOf('tab:0:1'));}));
 await test('末页未获平台确认则停止，不假报完成',()=>runWith([{tabs:[ppt()]}],{noAck:true},(f,r)=>{assert.equal(r.status,'stopped');assert.match(r.reason,/未确认任务完成/);assert.equal(r.documents,0);}));
 await test('手动暂停保持暂停：手动播放后继续完成，助手不恢复或跳章',async()=>{
  const f=fixture([{tabs:[video({start:1,duration:4,pauseAt:2,manualPause:true})]},{tabs:[video()]}],{limits:{stallMs:100}});let pending;
  try{pending=f.runner.start({continueOnTimeout:true});await waitForTest(()=>f.runner.report?.chapters[0].tasks[0]?.pauseState?.waiting);
   await delay(125);assert(f.videos[0].paused);assert.equal(f.runner.report.status,'running');assert.equal(f.events.filter(e=>e.startsWith('play:')).length,1);assert(!f.events.includes('chapter:1'));
   await f.videos[0].play();const r=await pending;assert.equal(r.status,'done',r.reason);assert.equal(r.videos,2);assert.equal(r.chapters[0].tasks[0].resumes,0);assert.equal(r.chapters[0].tasks[0].pauseState.waitCount,1);assert.equal(r.chapters[0].tasks[0].startSeconds,1);assert.equal(f.videos[0].playbackRate,1);
  }finally{f.runner.stop();if(pending)await pending;f.close();}
 });
 await test('来源不明的连续暂停有限重试后等待人工，停止立即退出等待',async()=>{
  const f=fixture([{tabs:[video({pauseOnEveryPlay:true})]},{tabs:[video()]}]);let pending;
  try{pending=f.runner.start({continueOnTimeout:true});await waitForTest(()=>f.runner.report?.chapters[0].tasks[0]?.pauseState?.waiting);
   await delay(25);assert.equal(f.events.filter(e=>e.startsWith('play:')).length,1+LIMITS.maxResumes);assert.equal(f.runner.report.status,'running');f.runner.stop();const r=await pending;
   assert.equal(r.status,'stopped');assert.equal(r.videos,0);assert.equal(r.chapters[0].tasks[0].resumes,LIMITS.maxResumes);assert(!f.events.includes('chapter:1'));assertSeekListenersRemoved(f.videos[0]);
  }finally{f.runner.stop();if(pending)await pending;f.close();}
 });
 await test('手动暂停等待不消耗播放和休息预算，页面返回前台仍需手动播放',async()=>{
  let offset=0;const f=fixture([{tabs:[video({foreground:true,manual:true,duration:5})]}],{now:()=>Date.now()+offset,limits:{stallMs:30}}),foreground=foregroundFixture(f);let pending;
  try{pending=f.runner.start({restEnabled:true,studyMinutes:10,restMinutes:1});await waitForTest(()=>f.events.includes('play:0:0:0'));playerInput(f.videos[0]);f.videos[0].simulateMedia({paused:true},'pause');await waitForTest(()=>f.runner.report.chapters[0].tasks[0].pauseState.waiting);
   foreground(false);offset+=700000;await delay(8);foreground(true);await delay(8);assert(f.videos[0].paused);assert.equal(f.events.filter(e=>e.startsWith('play:')).length,1);assert.equal(f.runner.report.status,'running');
   await f.videos[0].play();finishManual(f.videos[0]);const r=await pending;assert.equal(r.status,'done',r.reason);assert(r.pacing.activeMs<600000);assert(r.chapters[0].tasks[0].pauseState.waitMs>=700000);
  }finally{f.runner.stop();if(pending)await pending;f.close();}
 });
 await test('暂停期间出现明确平台异常立即停止，告警保持在页面',async()=>{
  for(const message of ['异常学习行为','操作频繁，请稍后再试','账号受限','账户已被冻结']){
   const f=fixture([{tabs:[video({pauseOnEveryPlay:true,manualPause:true})]},{tabs:[video()]}]);let pending;
   try{pending=f.runner.start({continueOnTimeout:true});await waitForTest(()=>f.runner.report?.chapters[0].tasks[0]?.pauseState?.waiting);
    const alert=f.doc.createElement('div');alert.setAttribute('role','alert');alert.textContent=message;f.doc.body.append(alert);const r=await pending;
    assert.equal(r.status,'stopped');assert.match(r.reason,/平台提示/);assert(alert.isConnected);assert(!f.events.includes('chapter:1'));assert.equal(f.events.filter(e=>e.startsWith('play:')).length,1);
   }finally{f.runner.stop();if(pending)await pending;f.close();}
  }
 });
 await test('题干与隐藏告警中的异常关键词不冒充实际平台告警',async()=>{
  const f=fixture([{tabs:[quiz()]}]);try{f.doc.querySelector('.fontLabel').textContent='【单选题】什么情况下会提示异常学习、操作频繁或账号受限？';
   const alert=f.doc.createElement('div');alert.setAttribute('role','alert');alert.hidden=true;alert.textContent='操作频繁';f.doc.body.append(alert);
   const r=await f.runner.start();assert.equal(r.status,'done',r.reason);assert.equal(f.submits,1);
  }finally{f.close();}
 });
 await test('暂停时的前后台与缓冲状态记录可复制，停止后监听已移除且不记录网址或令牌',async()=>{
  for(const [visibility,focused] of [['visible',true],['visible',false],['hidden',false]]){const f=fixture([{tabs:[video({pauseOnEveryPlay:true})]}]);try{
   Object.defineProperty(f.d,'visibilityState',{get:()=>visibility,configurable:true});Object.defineProperty(f.d,'hasFocus',{value:()=>focused,configurable:true});for(const v of f.videos){Object.defineProperty(v,'readyState',{get:()=>2,configurable:true});Object.defineProperty(v,'networkState',{get:()=>2,configurable:true});}
   const pending=f.runner.start();await waitForTest(()=>f.runner.report?.chapters[0].tasks[0]?.pauseState?.waiting);f.runner.stop();const r=await pending,task=r.chapters[0].tasks[0];assert.equal(task.lastPause.visibility,visibility);assert.equal(task.lastPause.focused,focused);assert.equal(task.lastPause.readyState,2);assert.equal(task.lastPause.networkState,2);assert.equal(task.lastPause.errorCode,null);assert(task.playbackEvents.length<=12);assert.equal(task.lastPause.seconds,0);
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
 await test('原日志335.63回退328：暂停恢复定位稳定后允许重播完成',()=>manualVideoTest(async(f,pending,v)=>{
  Object.defineProperty(f.d,'visibilityState',{get:()=> 'hidden',configurable:true});Object.defineProperty(f.d,'hasFocus',{value:()=>false,configurable:true});
  v.simulateMedia({paused:true},'pause');
  v.simulateMedia({seconds:328,paused:false,seeking:true,readyState:1},'playing');
  v.simulateMedia({},'seeking');v.simulateMedia({},'waiting');
  v.simulateMedia({paused:true,seeking:false,readyState:4},'pause');v.simulateMedia({},'seeked');await v.play();
  const task=f.runner.report.chapters[0].tasks[0];await waitForTest(()=>task.seekState?.outcome==='rollback'||f.runner.report.status!=='running');assert.equal(task.seekState?.outcome,'rollback',f.runner.report.reason);
  assert.equal(task.seekState.from,335.63);assert.equal(task.seekState.to,328);assert.equal(f.runner.report.status,'running');
  finishManual(v);const r=await pending;assert.equal(r.status,'done',r.reason);assert.equal(r.videos,1);assert.equal(v.playbackRate,1);assertSeekListenersRemoved(v);
 },{},[{tabs:[video({manual:true,start:335.63,duration:350,playedRanges:[[300,335.63]]})]}]));
 await test('暂停恢复短暂定位位置不变：等待稳定后继续，不反复启动',()=>manualVideoTest(async(f,pending,v)=>{
  playerInput(v);v.simulateMedia({paused:true},'pause');await waitForTest(()=>f.runner.report.chapters[0].tasks[0].pauseState.waiting);await v.play();
  v.simulateMedia({seeking:true,readyState:1},'seeking');await delay(12);
  assert.equal(f.runner.report.status,'running');assert.equal(f.events.filter(e=>e.startsWith('play:')).length,2);
  v.simulateMedia({seeking:false,readyState:4},'seeked');await waitForTest(()=>f.runner.report.chapters[0].tasks[0].seekState?.outcome==='continuous');
  finishManual(v);const r=await pending,task=r.chapters[0].tasks[0];assert.equal(r.status,'done',r.reason);assert.equal(r.videos,1);assert.equal(task.seekCount,1);assert.equal(task.seekState.from,100);assert.equal(task.seekState.to,100);assert.equal(v.playbackRate,1);assertSeekListenersRemoved(v);
 }));
 await test('定位结束但 readyState 仍为1：等数据恢复才确认连续进度',()=>manualVideoTest(async(f,pending,v)=>{
  v.simulateMedia({seeking:true,readyState:1},'seeking');v.simulateMedia({seeking:false,seconds:101,playedRanges:[[100,101]]},'seeked');await delay(20);
  const task=f.runner.report.chapters[0].tasks[0];assert.equal(task.seekState.outcome,'pending');assert.equal(f.runner.report.status,'running');
  v.simulateMedia({readyState:4},'canplay');await waitForTest(()=>task.seekState.outcome==='continuous');finishManual(v);assert.equal((await pending).videos,1);
 }));
 await test('后台短暂定位多次出现：保留连续进度，不增加恢复次数',()=>manualVideoTest(async(f,pending,v)=>{
  Object.defineProperty(f.d,'visibilityState',{get:()=> 'hidden',configurable:true});Object.defineProperty(f.d,'hasFocus',{value:()=>false,configurable:true});
  const task=f.runner.report.chapters[0].tasks[0];
  for(let i=0;i<7;i++){v.simulateMedia({seeking:true},'seeking');v.simulateMedia({seeking:false,seconds:100+i*0.1,playedRanges:[[100,100+i*0.1]]},'seeked');await waitForTest(()=>task.seekState.outcome==='continuous');}
  assert.equal(task.seekCount,7);assert.equal(task.resumes,0);assert(task.playbackEvents.length<=12);finishManual(v);assert.equal((await pending).videos,1);
 }));
 await test('后台经过60秒采样延迟：实际前进60秒不误判跳转',async()=>{
  let offset=0;await manualVideoTest(async(f,pending,v)=>{
   v.simulateMedia({seeking:true},'seeking');offset+=60000;v.simulateMedia({seeking:false,seconds:160,playedRanges:[[100,160]]},'seeked');
   const task=f.runner.report.chapters[0].tasks[0];await waitForTest(()=>task.seekState.outcome==='continuous');assert(task.seekState.allowedForward>=62);assert.equal(task.seekState.from,100);finishManual(v);const r=await pending;assert.equal(r.status,'done',r.reason);assert.equal(r.videos,1);assertSeekListenersRemoved(v);
  },{now:()=>Date.now()+offset,limits:{videoSeekTimeoutMs:120000,stallMs:120000}},[{tabs:[video({manual:true,start:100,duration:165})]}]);
 });
 for(const target of [130])await test(`稳定后明显定位至${target}秒：停止且超时继续开关不能绕过`,()=>manualVideoTest(async(f,pending,v)=>{
  v.simulateMedia({seeking:true,seconds:target},'seeking');v.simulateMedia({seeking:false},'seeked');const r=await pending,task=r.chapters[0].tasks[0];
  assert.equal(r.status,'stopped');assert.match(r.reason,/进度跳转/);assert.match(r.reason,new RegExp('100.00 → '+target+'.00'));assert.equal(r.videos,0);assert.equal(task.seekState.outcome,'forward-jump');assert(!f.events.includes('chapter:1'));assertSeekListenersRemoved(v);
 },{},[{tabs:[video({manual:true,start:100,duration:140})]},{tabs:[video()]}],{continueOnTimeout:true}));
 await test('定位期间位置临时回到0：恢复原位置后再判断，不立即停止',()=>manualVideoTest(async(f,pending,v)=>{
  v.simulateMedia({seeking:true,seconds:0,readyState:1},'seeking');await delay(12);assert.equal(f.runner.report.status,'running');
  v.simulateMedia({seeking:false,seconds:100,readyState:4},'seeked');await waitForTest(()=>f.runner.report.chapters[0].tasks[0].seekState.outcome==='continuous');finishManual(v);assert.equal((await pending).videos,1);
 }));
 await test('再次定位或数据下降会重置稳定等待，起点保持不变',async()=>{
  // 使用注入时钟，避免机器负载把12ms等待拉长到35ms稳定窗口之外。
  let clock=0;
  await manualVideoTest(async(f,pending,v)=>{
   const task=f.runner.report.chapters[0].tasks[0];v.simulateMedia({seeking:true},'seeking');v.simulateMedia({seeking:false},'seeked');clock=12;await delay(12);
   v.simulateMedia({seeking:true,seconds:101,playedRanges:[[100,101]]},'seeking');v.simulateMedia({seeking:false,readyState:1},'seeked');clock=57;await delay(45);assert.equal(task.seekState.outcome,'pending');assert.equal(task.seekState.from,100);assert.equal(task.seekCount,1);
   v.simulateMedia({readyState:4},'timeupdate');clock=92;await waitForTest(()=>task.seekState.outcome==='continuous');finishManual(v);assert.equal((await pending).videos,1);
  },{now:()=>clock,limits:{videoSeekStableMs:35,videoSeekTimeoutMs:200}});
 });
 for(const continueOnTimeout of [false,true])await test(`定位持续无响应：超时继续=${continueOnTimeout}，失败视频不计完成`,()=>manualVideoTest(async(f,pending,v)=>{
  v.simulateMedia({seeking:true,readyState:1},'seeking');const repeat=setInterval(()=>v.simulateMedia({},'seeking'),8);
  try{const r=await pending,task=r.chapters[0].tasks[0];assert.equal(r.status,continueOnTimeout?'done':'stopped');assert.match(continueOnTimeout?r.chapters[0].reason:r.reason,/定位长时间未恢复/);assert.equal(task.seekState.outcome,'timeout');assert.equal(task.seekCount,1);assert.equal(task.seekState.from,100);assert.equal(r.videos,continueOnTimeout?1:0);assert.equal(f.events.includes('chapter:1'),continueOnTimeout);assert.equal(f.events.filter(e=>e==='play:0:0:0').length,1);assertSeekListenersRemoved(v);}
  finally{clearInterval(repeat);}
 },{limits:{videoSeekTimeoutMs:45}},[{tabs:[video({manual:true,start:100,duration:140})]},{tabs:[video()]}],{continueOnTimeout}));
 await test('seeking 已结束但数据一直未就绪：仍按定位超时处理',()=>manualVideoTest(async(f,pending,v)=>{
  v.simulateMedia({seeking:true,readyState:1},'seeking');v.simulateMedia({seeking:false},'seeked');const r=await pending;
  assert.equal(r.videos,0);assert.match(r.reason,/定位长时间未恢复/);assert.equal(r.chapters[0].tasks[0].seekState.seeking,false);assert.equal(r.chapters[0].tasks[0].seekState.readyState,1);
 },{limits:{videoSeekTimeoutMs:40}}));
 await test('定位直接到末尾并触发 ended：不得跳过进度判定或计完成',()=>manualVideoTest(async(f,pending,v)=>{
  v.simulateMedia({seeking:true,seconds:140},'seeking');v.simulateMedia({seeking:false,ended:true},'ended');const r=await pending;
  assert.equal(r.status,'stopped');assert.equal(r.videos,0);assert.match(r.reason,/进度跳转/);assert.equal(r.chapters[0].tasks[0].seekState.outcome,'forward-jump');assertSeekListenersRemoved(v);
 },{},[{tabs:[video({manual:true,start:100,duration:140})]}]));
 await test('定位期间停止：及时退出并清理新增监听',()=>manualVideoTest(async(f,pending,v)=>{
  v.simulateMedia({seeking:true},'seeking');f.runner.stop();const r=await pending;assert.equal(r.status,'stopped');assert.equal(r.videos,0);assertSeekListenersRemoved(v);
 }));
 await test('定位期间跳过：原视频不计完成，下一章正常运行',()=>manualVideoTest(async(f,pending,v)=>{
  v.simulateMedia({seeking:true},'seeking');await f.runner.skip();const r=await pending;assert.equal(r.status,'done');assert.equal(r.chapters[0].status,'skipped');assert.equal(r.videos,1);assertSeekListenersRemoved(v);
 },{},[{tabs:[video({manual:true,start:100,duration:140})]},{tabs:[video()]}]));
 await test('定位期间视频节点替换：及时停止，清理原节点监听',()=>manualVideoTest(async(f,pending,v)=>{
  v.simulateMedia({seeking:true},'seeking');v.replaceWith(v.ownerDocument.createElement('video'));const r=await pending;assert.equal(r.videos,0);assert.match(r.reason,/节点已替换/);assertSeekListenersRemoved(v);
 }));
 await test('定位期间课程页离开：取消等待且不产生后续播放',()=>manualVideoTest(async(f,pending,v)=>{
  v.simulateMedia({seeking:true},'seeking');f.w.dispatchEvent(new f.w.Event('pagehide'));await pending;assert.equal(f.runner.report.videos,0);assert.equal(f.events.filter(e=>e.startsWith('play:')).length,1);assertSeekListenersRemoved(v);
 }));
 await test('同章两视频定位状态独立：第二视频不能使用第一视频采样',()=>manualVideoTest(async(f,pending,v)=>{
  v.simulateMedia({seeking:true},'seeking');v.simulateMedia({seeking:false},'seeked');await waitForTest(()=>f.runner.report.chapters[0].tasks[0].seekState.outcome==='continuous');finishManual(v);
  await waitForTest(()=>f.events.includes('play:0:0:1'));const second=f.videos.at(-1);second.simulateMedia({seeking:true,seconds:230},'seeking');second.simulateMedia({seeking:false},'seeked');const r=await pending;
  assert.equal(r.status,'stopped');assert.equal(r.videos,1);assert.equal(r.chapters[0].tasks[1].seekState.from,200);assert.equal(r.chapters[0].tasks[1].seekCount,1);assertSeekListenersRemoved(v);assertSeekListenersRemoved(second);
 },{},[{tabs:[{title:'两个视频',tasks:[{kind:'video',manual:true,start:100,duration:105},{kind:'video',manual:true,start:200,duration:240}]}]}]));
 await test('定位日志限制固定字段：超出事件窗口仍保留判定，兼容缺省速率',()=>manualVideoTest(async(f,pending,v)=>{
  const task=f.runner.report.chapters[0].tasks[0];v.playbackRate=0;
  v.simulateMedia({seeking:true},'seeking');v.simulateMedia({seeking:false},'seeked');await waitForTest(()=>task.seekState.outcome==='continuous');
  task.seekState.url='https://mock.invalid/?secret=mock-only-key';
  for(let i=0;i<16;i++)v.simulateMedia({},'waiting');
  f.runner.stop();const r=await pending,text=f.api.courseReportText(r);assert(task.playbackEvents.length<=12);assert.match(text,/视频定位记录/);assert.match(text,/进度连续/);assert.match(text,/播放速率=1/);assert(!text.includes('mock.invalid'));assert(!text.includes('mock-only-key'));
  v.playbackRate=1;assert.equal(r.status,'stopped');assert.equal(v.playbackRate,1);assertSeekListenersRemoved(v);
 }));
 await test('轮询发现定位而未收到 seeking 事件：仍等待并记录可信起点',()=>manualVideoTest(async(f,pending,v)=>{
  v.simulateMedia({seeking:true});await waitForTest(()=>f.runner.report.chapters[0].tasks[0].seekState?.outcome==='pending');
  v.simulateMedia({seeking:false});await waitForTest(()=>f.runner.report.chapters[0].tasks[0].seekState.outcome==='continuous');finishManual(v);const r=await pending;assert.equal(r.videos,1);assert.equal(r.chapters[0].tasks[0].seekState.from,100);
 }));
 await test('暂停且定位未结束保持等待：手动播放后完成位置判定',()=>manualVideoTest(async(f,pending,v)=>{
  playerInput(v);v.simulateMedia({seeking:true,paused:true,readyState:1},'seeking');await delay(18);assert.equal(f.events.filter(e=>e.startsWith('play:')).length,1);assert.equal(f.runner.report.chapters[0].tasks[0].unstableResumes,0);
  v.simulateMedia({seeking:false,readyState:4},'seeked');await delay(20);assert(v.paused);assert.equal(f.events.filter(e=>e.startsWith('play:')).length,1);await v.play();await waitForTest(()=>f.runner.report.chapters[0].tasks[0].seekState?.outcome==='continuous');finishManual(v);assert.equal((await pending).videos,1);
 }));
 await test('定位等待没有实际进展：不能刷新原有停滞计时',()=>manualVideoTest(async(f,pending,v)=>{
  v.simulateMedia({seeking:true,readyState:1},'seeking');await delay(65);v.simulateMedia({seeking:false,readyState:4},'seeked');const r=await pending;
  assert.equal(r.videos,0);assert.match(r.reason,/长时间没有变化/);assert.equal(r.chapters[0].tasks[0].seekState.outcome,'continuous');
 },{limits:{stallMs:45,videoSeekTimeoutMs:150}}));
 await test('定位稳定期间数据短暂下降：事件先于轮询也重置稳定窗口',async()=>{
  let offset=0;await manualVideoTest(async(f,pending,v)=>{
   const task=f.runner.report.chapters[0].tasks[0];v.simulateMedia({seeking:true},'seeking');v.simulateMedia({seeking:false},'seeked');await delay(20);
   assert.equal(task.seekState.outcome,'pending');v.simulateMedia({readyState:1},'waiting');offset+=60;v.simulateMedia({readyState:4},'playing');await delay(12);assert.equal(task.seekState.outcome,'pending');
   await waitForTest(()=>task.seekState.outcome==='continuous');finishManual(v);assert.equal((await pending).videos,1);
  },{now:()=>Date.now()+offset,limits:{videoSeekStableMs:60,videoSeekTimeoutMs:300}});
 });
 await test('重播大于30秒回退：人工继续与真实播放刷新停滞，助手不自动恢复',async()=>{const clockBase=Date.now();let offset=0;await manualVideoTest(async(f,pending,v)=>{
  v.simulateMedia({seconds:60,seeking:true},'seeking');v.simulateMedia({seeking:false},'seeked');
  offset+=LIMITS.videoSeekStableMs+1;
  const task=f.runner.report.chapters[0].tasks[0];await waitForTest(()=>task.seekState?.outcome==='rollback');
  assert.equal(task.progressState.resumeProgressSeconds,0);assert.equal(task.progressState.frontierSeconds,100);
  for(let i=1;i<=4;i++){
   playerInput(v);v.simulateMedia({paused:true},'pause');await waitForTest(()=>task.pauseState.waiting);await v.play();await waitForTest(()=>!task.pauseState.waiting);assert.equal(task.resumes,0,f.runner.report.reason);
   offset+=100;v.simulateMedia({seconds:60+i,natural:true},'timeupdate');await delay(12);
   assert.equal(f.runner.report.status,'running',f.runner.report.reason);
  }
  assert.equal(task.unstableResumes,0);assert.equal(task.progressState.frontierSeconds,100);
  finishManual(v);const r=await pending;assert.equal(r.videos,1);assert.equal(r.status,'done',r.reason);
 },{now:()=>clockBase+offset,limits:{stallMs:200,resumeProgressSeconds:4}},[{tabs:[video({manual:true,start:100,duration:120,playedRanges:[[0,100]]})]}]);});
 for(const order of ['timeupdate-first','seeked-only','poll-only'])await test(`重播采样顺序${order}：回退起点不能被覆盖`,()=>manualVideoTest(async(f,pending,v)=>{
  const task=f.runner.report.chapters[0].tasks[0];
  if(order==='timeupdate-first'){v.simulateMedia({seconds:92},'timeupdate');v.simulateMedia({seeking:true,readyState:1},'playing');v.simulateMedia({},'seeking');v.simulateMedia({seeking:false,readyState:4},'seeked');}
  else if(order==='seeked-only')v.simulateMedia({seconds:92},'seeked');
  else v.simulateMedia({seconds:92});
  await waitForTest(()=>task.seekState?.outcome==='rollback');assert.equal(task.seekState.from,100);assert.equal(task.seekState.to,92);assert.equal(task.seekCount,1);
  assert.equal(task.progressState.resumeProgressSeconds,0);finishManual(v);assert.equal((await pending).videos,1);
 }));
 for(const event of ['timeupdate',undefined])await test(`重播前跳监测${event||'poll'}：无定位事件也不更新异常位置的可信起点`,()=>manualVideoTest(async(f,pending,v)=>{
  v.simulateMedia({seconds:130},event);v.simulateMedia({},'playing');
  const r=await pending,task=r.chapters[0].tasks[0];assert.equal(r.videos,0);assert.equal(task.seekState.from,100);assert.equal(task.seekState.to,130);assert.equal(task.seekState.outcome,'forward-jump');
  v.simulateMedia({seconds:100},'timeupdate');assert.equal(task.seekState.outcome,'forward-jump');assertSeekListenersRemoved(v);
 },{},[{tabs:[video({manual:true,start:100,duration:140})]}]));
 await test('重播返回已播区间：明显位置前移可接受，但定位位移不增加恢复额度',()=>manualVideoTest(async(f,pending,v)=>{
  const task=f.runner.report.chapters[0].tasks[0];v.simulateMedia({seconds:130,seeking:true},'seeking');v.simulateMedia({seeking:false},'seeked');
  await waitForTest(()=>task.seekState?.outcome==='replay-seek');assert.equal(task.seekState.evidence,'played');assert.equal(task.progressState.resumeProgressSeconds,0);
  finishManual(v);assert.equal((await pending).videos,1);
 },{},[{tabs:[video({manual:true,start:100,duration:140,playedRanges:[[50,140]]})]}]));
 await test('重播区间有洞：即使经过时间足够也不能把下载或可定位区间当作已播放',async()=>{
  let offset=0;await manualVideoTest(async(f,pending,v)=>{
   offset+=30000;v.simulateMedia({seconds:130,seeking:true},'seeking');v.simulateMedia({seeking:false},'seeked');
   const r=await pending;assert.equal(r.videos,0);assert.match(r.reason,/未播区间/);assert.equal(r.chapters[0].tasks[0].seekState.evidence,'played-gap');
  },{now:()=>Date.now()+offset},[{tabs:[video({manual:true,start:100,duration:140,playedRanges:[[100,110],[120,140]]})]}]);
 });
 await test('重播区间辅助接口：空区间、不可读、无效区间、边缘容差与区间缺口',async()=>{
  const f=fixture([{tabs:[video({manual:true})]}]);try{
   const read=f.api.courseVideoPlayedRanges,decide=f.api.courseVideoPositionDecision;
   assert.equal(read({played:{length:0}}).available,true);
   assert.equal(read({get played(){throw Error('不可读');}}).available,false);
   assert.equal(read({played:{length:1,start:()=>NaN,end:()=>2}}).available,false);
   const anchor={at:0,seconds:100,rate:1},current={at:1000,seconds:101,rate:1,duration:140,seeking:false,readyState:4};
   assert.equal(decide(anchor,current,{available:true,ranges:[]},LIMITS).kind,'forward-jump');
   assert.equal(decide(anchor,current,{available:true,ranges:[{start:100.1,end:100.8}]},LIMITS).kind,'continuous');
   assert.equal(decide(anchor,current,{available:true,ranges:[{start:100,end:100.1},{start:100.5,end:101}]},LIMITS).kind,'forward-jump');
   assert.equal(decide(anchor,{...current,rate:2,seconds:104},{available:false},LIMITS).kind,'continuous');
   assert.equal(decide(anchor,{...current,rate:2,seconds:105},{available:false},LIMITS).kind,'forward-jump');
   assert.equal(decide({...anchor,rate:NaN},{...current,rate:0,seconds:104},{available:false},LIMITS).kind,'forward-jump');
   for(const seconds of [NaN,Infinity,-1,141])assert.equal(decide(anchor,{...current,seconds},{available:false},LIMITS).kind,'unready');
   const v=f.videos[0];v.simulateMedia({playedRanges:[[90,100]]});const copy=read(v);v.simulateMedia({playedRanges:[[0,1]]});assert.equal(copy.ranges[0].start,90);
  }finally{f.close();}
 });
 await test('重播区间不可读：实际经过时间内的增长继续，报告标注降级证据',async()=>{
  let offset=0;await manualVideoTest(async(f,pending,v)=>{
   offset+=1000;v.simulateMedia({seconds:101,seeking:true},'seeking');v.simulateMedia({seeking:false},'seeked');
   const task=f.runner.report.chapters[0].tasks[0];await waitForTest(()=>task.seekState?.outcome==='continuous');assert.equal(task.seekState.evidence,'elapsed');
   finishManual(v);const r=await pending;assert.equal(r.videos,1,r.reason);
  },{now:()=>Date.now()+offset},[{tabs:[video({manual:true,start:100,duration:105,playedUnavailable:true})]}]);
 });
 await test('重播区间不可读：超过正常经过时间的前跳仍停止',()=>manualVideoTest(async(f,pending,v)=>{
  v.simulateMedia({seconds:130,seeking:true},'seeking');v.simulateMedia({seeking:false},'seeked');const r=await pending;
  assert.equal(r.videos,0);assert.equal(r.chapters[0].tasks[0].seekState.evidence,'elapsed');assert.match(r.reason,/进度跳转/);
 },{},[{tabs:[video({manual:true,start:100,duration:140,playedUnavailable:true})]}]));
 await test('重播定位晚唤醒：数据恢复后获得一次最终稳定窗口',async()=>{
  let offset=0;await manualVideoTest(async(f,pending,v)=>{
   const task=f.runner.report.chapters[0].tasks[0];v.simulateMedia({seeking:true,readyState:1},'seeking');offset+=200;
   v.simulateMedia({seeking:false,readyState:4},'seeked');await waitForTest(()=>task.seekState?.outcome==='continuous');finishManual(v);assert.equal((await pending).videos,1);
  },{now:()=>Date.now()+offset});
 });
 for(const interruption of ['seeking','waiting'])await test(`重播定位最终窗口再次${interruption}：立即超时且不能续期`,async()=>{
  let offset=0;await manualVideoTest(async(f,pending,v)=>{
   v.simulateMedia({seeking:true,readyState:1},'seeking');offset+=200;v.simulateMedia({seeking:false,readyState:4},'seeked');
   v.simulateMedia(interruption==='seeking'?{seeking:true}:{readyState:1},interruption);v.simulateMedia({seeking:false,readyState:4},'seeked');
   const r=await pending;assert.equal(r.videos,0);assert.match(r.reason,/定位长时间未恢复/);assert.equal(r.chapters[0].tasks[0].seekState.outcome,'timeout');
  },{now:()=>Date.now()+offset});
 });
 for(const continueOnTimeout of [false,true])await test(`重播循环回退超时继续=${continueOnTimeout}：起点和距离不能反复续期`,async()=>{
  let offset=0;await manualVideoTest(async(f,pending,v)=>{
   const task=f.runner.report.chapters[0].tasks[0];v.simulateMedia({seconds:95,seeking:true},'seeking');v.simulateMedia({seeking:false},'seeked');await waitForTest(()=>task.rollbackCount===1);
   const first={...task.replayState};v.simulateMedia({seconds:96,natural:true},'timeupdate');
   v.simulateMedia({seconds:94,seeking:true},'seeking');v.simulateMedia({seeking:false},'seeked');await waitForTest(()=>task.rollbackCount===2);
   assert.equal(task.replayState.startedAt,first.startedAt);assert.equal(task.replayState.deadline,first.deadline);
   offset+=16000;v.simulateMedia({seconds:95,natural:true},'timeupdate');
   const r=await pending;assert.equal(r.status,continueOnTimeout?'done':'stopped');assert.match(continueOnTimeout?r.chapters[0].reason:r.reason,/反复回退/);
   assert.equal(task.replayState.outcome,'timeout');assert.equal(r.videos,continueOnTimeout?1:0);assert.equal(f.events.includes('chapter:1'),continueOnTimeout);assertSeekListenersRemoved(v);
  },{now:()=>Date.now()+offset},[{tabs:[video({manual:true,start:100,duration:120,playedRanges:[[0,100]]})]},{tabs:[video()]}],{continueOnTimeout});
 });
 await test('重播长距离回退：计时包含重播距离，不能套用固定五分钟或旧最高位置停滞',async()=>{
  let offset=0;await manualVideoTest(async(f,pending,v)=>{
   const task=f.runner.report.chapters[0].tasks[0];v.simulateMedia({seconds:0,seeking:true},'seeking');v.simulateMedia({seeking:false},'seeked');await waitForTest(()=>task.rollbackCount===1);
   assert(task.replayState.deadline-task.replayState.startedAt>=110000);offset+=20000;v.simulateMedia({seconds:1,natural:true},'timeupdate');await delay(10);
   assert.equal(f.runner.report.status,'running');assert.equal(task.progressState.frontierSeconds,100);finishManual(v);assert.equal((await pending).videos,1);
  },{now:()=>Date.now()+offset},[{tabs:[video({manual:true,start:100,duration:120,playedRanges:[[0,100]]})]}]);
 });
 await test('重播速率下降按首次距离重算：新增播放达到十秒才结束重播监测',()=>manualVideoTest(async(f,pending,v)=>{
  const task=f.runner.report.chapters[0].tasks[0];v.simulateMedia({seconds:95,seeking:true},'seeking');v.simulateMedia({seeking:false},'seeked');await waitForTest(()=>task.rollbackCount===1);
  const first={...task.replayState};v.playbackRate=0.5;v.simulateMedia({},'ratechange');
  assert.equal(task.replayState.startedAt,first.startedAt);assert(task.replayState.deadline>first.deadline);
  assert.equal(task.progressState.resumeProgressSeconds,0);v.simulateMedia({seconds:96,natural:true},'timeupdate');
  for(let seconds=96.5;seconds<=110;seconds+=0.5)v.simulateMedia({seconds,natural:true},'timeupdate');
  assert.equal(task.replayState.outcome,'advanced');assert.equal(task.progressState.frontierSeconds,110);assert.equal(v.playbackRate,0.5);
  finishManual(v);assert.equal((await pending).videos,1);assert.equal(v.playbackRate,0.5);
 },{},[{tabs:[video({manual:true,start:100,duration:115,playedRanges:[[0,100]]})]}]));
 await test('重播期间停止与报告兼容：新字段过滤、十二条容量、监听清理',()=>manualVideoTest(async(f,pending,v)=>{
  const task=f.runner.report.chapters[0].tasks[0];v.simulateMedia({seconds:92,seeking:true},'seeking');v.simulateMedia({seeking:false},'seeked');await waitForTest(()=>task.rollbackCount===1);
  task.replayState.url='https://mock.invalid/?secret=mock-only-key';task.seekState.evidence='mock-only-key';
  for(let i=0;i<20;i++)v.simulateMedia({},'waiting');f.runner.stop();const r=await pending,text=f.api.courseReportText(r);
  assert(task.playbackEvents.length<=12);assert.match(text,/视频重播记录/);assert.match(text,/回退后重播/);assert(!text.includes('mock.invalid'));assert(!text.includes('mock-only-key'));assert.equal(r.videos,0);assertSeekListenersRemoved(v);
  delete task.seekState.evidence;delete task.seekState.rollbackSeconds;delete task.replayState;task.seekState.outcome='jump';assert.doesNotThrow(()=>f.api.courseReportText(r));assert.match(f.api.courseReportText(r),/确认明显跳转/);
 }));
 await test('重播到末尾但平台未确认：不记完成',()=>manualVideoTest(async(f,pending,v)=>{
  const task=f.runner.report.chapters[0].tasks[0];v.simulateMedia({seconds:92,seeking:true},'seeking');v.simulateMedia({seeking:false},'seeked');await waitForTest(()=>task.rollbackCount===1);
  finishManual(v);const r=await pending;assert.equal(r.videos,0);assert.match(r.reason,/平台未确认/);assertSeekListenersRemoved(v);
 },{noAck:true},undefined,{continueOnTimeout:false}));
 await test('重播普通缓冲位置未变：不误入定位的六十秒超时',async()=>{
  let offset=0;await manualVideoTest(async(f,pending,v)=>{
   const task=f.runner.report.chapters[0].tasks[0];v.simulateMedia({readyState:1},'waiting');offset+=150;v.simulateMedia({},'waiting');await delay(12);
   assert.equal(f.runner.report.status,'running');assert.equal(task.seekCount,0);assert.equal(task.seekState,undefined);
   v.simulateMedia({readyState:4},'canplay');finishManual(v);const r=await pending;assert.equal(r.videos,1,r.reason);assertSeekListenersRemoved(v);
  },{now:()=>Date.now()+offset,limits:{videoSeekTimeoutMs:100,stallMs:500}});
 });
 for(const acknowledged of [true,false])await test(`重播末尾不足十秒且晚唤醒：平台确认=${acknowledged}`,async()=>{
  let offset=0;await manualVideoTest(async(f,pending,v)=>{
   const task=f.runner.report.chapters[0].tasks[0];v.simulateMedia({seconds:95,seeking:true},'seeking');v.simulateMedia({seeking:false},'seeked');await waitForTest(()=>task.rollbackCount===1);
   for(let seconds=95.5;seconds<=105;seconds+=0.5){offset+=500;v.simulateMedia({seconds,natural:true},'timeupdate');}
   v.simulateMedia({ended:true},'ended');assert(Date.now()+offset<task.replayState.deadline);offset+=6000;assert(Date.now()+offset>task.replayState.deadline);
   const r=await pending;assert.equal(r.status,acknowledged?'done':'stopped',r.reason);assert.equal(r.videos,acknowledged?1:0);
   assert.equal(task.replayState.outcome,'ended');assert.match(f.api.courseReportText(r),/已重播至视频结束/);
   if(!acknowledged)assert.match(r.reason,/平台未确认/);assertSeekListenersRemoved(v);
  },{noAck:!acknowledged,now:()=>Date.now()+offset,limits:{stallMs:300000}},undefined,{continueOnTimeout:false});
 });
 await test('重播期限到期时仍在定位：先确认未播末尾前跳，超时开关不能绕过',async()=>{
  let offset=0;await manualVideoTest(async(f,pending,v)=>{
   const task=f.runner.report.chapters[0].tasks[0];v.simulateMedia({seconds:95,seeking:true},'seeking');v.simulateMedia({seeking:false},'seeked');await waitForTest(()=>task.rollbackCount===1);
   v.simulateMedia({seconds:105,seeking:true,readyState:1},'seeking');offset+=16000;await delay(15);
   assert.equal(f.runner.report.status,'running');assert(!f.events.includes('chapter:1'));assert.equal(f.runner.report.videos,0);
   v.simulateMedia({seeking:false,readyState:4},'seeked');v.simulateMedia({ended:true},'ended');const r=await pending;
   assert.equal(r.status,'stopped');assert.equal(r.videos,0);assert.equal(task.seekState.outcome,'forward-jump');assert.match(r.reason,/未播区间/);assert(!f.events.includes('chapter:1'));assertSeekListenersRemoved(v);
  },{now:()=>Date.now()+offset,limits:{stallMs:300000,videoSeekTimeoutMs:60000}},[{tabs:[video({manual:true,start:100,duration:105,playedRanges:[[0,100]]})]},{tabs:[video()]}],{continueOnTimeout:true});
 });
 await test('重播稳定后的等待期间正常结束：晚唤醒超过五分钟不先报停滞',async()=>{
  let offset=0,task,held=false;const sleep=ms=>{
   if(ms===LIMITS.pollMs&&!held&&task?.seekState?.outcome==='rollback'){held=true;return new Promise(()=>{});}return delay(ms);
  };
  await manualVideoTest(async(f,pending,v)=>{
   task=f.runner.report.chapters[0].tasks[0];v.simulateMedia({seconds:95,seeking:true},'seeking');v.simulateMedia({seeking:false},'seeked');await waitForTest(()=>held);
   for(let seconds=95.5;seconds<=105;seconds+=0.5){offset+=500;v.simulateMedia({seconds,natural:true},'timeupdate');}
   v.simulateMedia({ended:true},'ended');assert(Date.now()+offset<task.replayState.deadline);offset+=320000;
   const r=await pending;assert.equal(r.status,'done',r.reason);assert.equal(r.videos,1);assert.equal(task.replayState.outcome,'ended');assertSeekListenersRemoved(v);
  },{sleep,now:()=>Date.now()+offset,limits:{stallMs:300000,videoReplayGraceMs:300000}},undefined,{continueOnTimeout:false});
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
 await test('只读简答转人工，不请求解答并列题号停止',()=>runWith([{tabs:[quiz({essay:true,readonly:true})]}],{},(f,r)=>{assert.equal(r.status,'stopped');assert.equal(f.requests.length,0);assert.equal(f.submits,0);assert.equal(r.chapters[0].issues[0].number,1);}));
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
 await test('默认不自行开始，重复启动互斥，停止两次确认、超时及关闭面板重置',async()=>{
  const f=fixture([{tabs:[video({manual:true,duration:5})]}]);let pending;
  try{
   assert.equal(f.events.length,0);pending=f.runner.start();await f.runner.start();await waitForTest(()=>f.events.some(e=>e.startsWith('play:')));
   const s=f.d.getElementById('cx-ai-study-root').shadowRoot,stop=s.getElementById('course-stop');assert(f.api.courseRunActive());assert(s.getElementById('course-start').disabled);
   let expiry,countdown;const realInterval=f.w.setInterval.bind(f.w);f.w.setInterval=(callback,ms,...args)=>{if(ms===1000)countdown=callback;return realInterval(callback,ms,...args);};const realTimeout=f.w.setTimeout.bind(f.w);f.w.setTimeout=(callback,ms,...args)=>{if(ms===5000)expiry=callback;return realTimeout(callback,ms,...args);};
   stop.click();assert.equal(f.runner.report.status,'running');assert.equal(stop.textContent,'确认停止（5s）');assert(stop.classList.contains('stop-confirm'));assert(expiry);
   assert(countdown);const realNow=f.w.Date.now,base=realNow();
   try{for(let elapsed=1;elapsed<=4;elapsed++){f.w.Date.now=()=>base+elapsed*1000+100;countdown();assert.equal(stop.textContent,`确认停止（${5-elapsed}s）`);assert(f.runner.busy);}}
   finally{f.w.Date.now=realNow;}
   expiry();assert.equal(stop.textContent,'停止');assert(!stop.classList.contains('stop-confirm'));assert(f.runner.busy);
   stop.click();assert.equal(stop.textContent,'确认停止（5s）');s.getElementById('close').click();assert.equal(stop.textContent,'停止');assert(f.runner.busy);f.api.controller.openPanel('chapters');
   stop.click();assert.equal(stop.textContent,'确认停止（5s）');assert(f.runner.busy);stop.click();const r=await pending;
   assert.equal(r.status,'stopped');assert.match(f.api.courseReportText(r),/自动学习已停止/);assert(!f.api.courseRunActive());assert.equal(stop.textContent,'停止');assert(!stop.classList.contains('stop-confirm'));assert(stop.disabled);
  }finally{f.runner.stop();if(pending)await pending;f.close();}
 });
 await test('P0 默认与旧设置均不授予自动提交，重试默认仍跳过测验',async()=>{
  const f=fixture([{tabs:[quiz()]}],{storage:[['deepseek_api_key','mock-only-key'],['cx_model','deepseek-flash'],['cx_course_auto_submit',true]]});
  try{const s=f.d.getElementById('cx-ai-study-root').shadowRoot;assert(!s.getElementById('course-auto-submit').checked);
   const first=await f.startWithDefaults();assert.equal(first.status,'done');assert.equal(first.chapters[0].status,'manual-pending');assert.equal(f.requests.length,0);assert.equal(f.submits,0);assert.equal(f.storage.get(f.runner.key).submit,false);
   const retry=await f.runner.retryIncomplete();assert.equal(retry.status,'done');assert.equal(retry.chapters[0].status,'manual-pending');assert.equal(f.requests.length,0);assert.equal(f.submits,0);assert.equal(f.storage.get(f.runner.key).submit,false);
  }finally{f.close();}
 });
 await test('P0 自动提交须明确选择且仅用于本次，改写勾选状态不能授予权限',async()=>{
  for(const [selected,accepted] of [[false,true],[true,false],[true,true]]){
   const approved=selected&&accepted,f=fixture([{tabs:[quiz()]}],{confirmSubmit:accepted});try{const s=f.d.getElementById('cx-ai-study-root').shadowRoot,box=s.getElementById('course-auto-submit');box.checked=true;
    if(selected)box.dispatchEvent(new f.w.Event('change'));s.getElementById('course-start').click();await waitForTest(()=>f.runner.report?.status==='stopped'||f.runner.report?.status==='done');
    assert.equal(f.submits,approved?1:0);assert.equal(f.storage.get(f.runner.key).submit,approved);assert(!box.checked);assert.equal(f.events.filter(e=>e.startsWith('confirm-auto-submit:')).length,selected?1:0);
   }finally{f.close();}
  }
 });
 await test('P0 原生导航恢复不继承旧记录自动提交权限',async()=>{
  const chapters=[{tabs:[video()]},{tabs:[quiz()]}],first=fixture(chapters,{navigateOut:true});let stored,session;
  try{const r=await first.runner.start({submit:true});assert.equal(r.status,'running');assert.equal(first.storage.get(first.runner.key).submit,true);stored=[...first.storage];session=first.w.sessionStorage.getItem('cx-ai-course-session');}finally{first.close();}
  const next=fixture(chapters,{storage:stored,session,noAutoResume:true});try{const r=await next.runner.resumeIfNeeded();assert.equal(r.status,'done');assert.equal(r.chapters[1].status,'manual-pending');assert.equal(next.requests.length,0);assert.equal(next.submits,0);assert.equal(next.storage.get(next.runner.key).submit,false);}finally{next.close();}
 });
 await test('P0 网页自定义事件与合成点击无法启动、重试、跳过或停止',async()=>{
  const f=fixture([{tabs:[video({manual:true,duration:5})]},{tabs:[video()]}],{genuineActivation:true});let pending;
  try{const s=f.d.getElementById('cx-ai-study-root').shadowRoot,box=s.getElementById('course-auto-submit');box.checked=true;box.onchange({isTrusted:true});assert(!box.checked);
   f.d.dispatchEvent(new f.w.CustomEvent('cx-ai-course-start',{detail:{submit:true}}));s.getElementById('course-start').click();s.getElementById('course-start').onclick({isTrusted:true});await delay(10);assert(!f.runner.busy);assert.equal(f.events.length,0);
   pending=f.runner.start();await waitForTest(()=>f.events.includes('play:0:0:0'));
   for(const action of ['stop','skip','retry','start'])f.d.dispatchEvent(new f.w.CustomEvent('cx-ai-course-'+action,{detail:{token:'forged',submit:true}}));
   s.getElementById('course-skip').click();s.getElementById('course-skip').onclick({isTrusted:true});s.getElementById('course-stop').click();s.getElementById('course-stop').onclick({isTrusted:true});await delay(10);
   assert(f.runner.busy);assert.equal(s.getElementById('course-stop').textContent,'停止');assert(!f.events.includes('chapter:1'));assert.equal(f.runner.report.chapters[0].status,'running');f.runner.stop();await pending;
  }finally{f.runner.stop();if(pending)await pending;f.close();}
 });
 // 三层真实 DOM 所属链；路径只作夹具注记，不请求真实课程。
 const nestWorkQuiz=(f,index=0)=>{
  const cards=f.doc,container=cards.querySelectorAll('[data-course-task]')[index],quizRoot=container.querySelector('.CeYan');
  assert(quizRoot);container.classList.add('ans-attach-ct');
  const icon=cards.createElement('span');icon.className='ans-job-icon';container.append(icon);
  f.d.getElementById('iframe').dataset.simulatedPath='/mooc-ans/knowledge/cards';
  const module=cards.createElement('iframe');module.dataset.simulatedPath='/ananas/modules/work/index.html';container.append(module);
  const paper=module.contentDocument.createElement('iframe');paper.dataset.simulatedPath='/mooc-ans/work/doHomeWorkNew';module.contentDocument.body.append(paper);
  paper.contentDocument.body.append(quizRoot);
  for(const q of quizRoot.querySelectorAll('.singleQuesId')){const body=paper.contentDocument.createElement('div');body.className='TiMu';body.append(...q.childNodes);q.append(body);}
  return {cards,container,module,paper,doc:paper.contentDocument,quizRoot,icon};
 };
 await test('跨iframe归属：包含判断支持同文档与祖先框架，不能覆盖兄弟任务',async()=>{
  const f=fixture([{tabs:[quiz({essay:true})]}]),nested=nestWorkQuiz(f),q=nested.doc.querySelector('.singleQuesId'),other=nested.cards.createElement('div');other.className='ans-attach-ct';nested.cards.body.append(other);
  try{
   assert(f.api.courseTaskContains(nested.quizRoot,q));assert(f.api.courseTaskContains(nested.container,q));assert(f.api.courseTaskContains(nested.module,q));assert(f.api.courseTaskContains(nested.paper,q));
   assert(!f.api.courseTaskContains(other,q));assert(!f.api.courseTaskContains(q,other));assert(!f.api.courseTaskContains(nested.container,nested.cards.createElement('div')));
   assert(!f.api.courseTaskContains(null,q));assert(!f.api.courseTaskContains(nested.container,null));
  }finally{f.close();}
 });
 await test('跨iframe归属：不可访问祖先与循环链不能获得归属',async()=>{
  const f=fixture([{tabs:[quiz({essay:true})]}]),nested=nestWorkQuiz(f),q=nested.doc.querySelector('.singleQuesId'),view=nested.doc.defaultView;
  const descriptor=Object.getOwnPropertyDescriptor(view,'frameElement');
  try{
   Object.defineProperty(view,'frameElement',{configurable:true,get(){throw new f.w.DOMException('blocked','SecurityError');}});assert(!f.api.courseTaskContains(nested.container,q));
   let reads=0;Object.defineProperty(view,'frameElement',{configurable:true,get(){reads++;return q;}});assert(!f.api.courseTaskContains(nested.container,q));assert.equal(reads,1); // Public context detects the invalid/cyclic ancestor immediately, within the same bound.
  }finally{if(descriptor)Object.defineProperty(view,'frameElement',descriptor);else delete view.frameElement;f.close();}
 });
 await test('跨iframe归属：三层单元测试关闭提交后直接继续，无确认等待',async()=>{
  const f=fixture([{tabs:[quiz({essay:true,count:7,manualValue:'用户已有答案'})]},{tabs:[video()]}],{key:''});
  const nested=nestWorkQuiz(f),before=classificationRequests.length;
  try{
   const tree=f.api.courseFrameTree(f.d);assert.equal(tree.documents.length,4);assert.equal(tree.inaccessible.length,0);
   assert.equal(nested.doc.querySelectorAll('.singleQuesId').length,7);assert.equal(nested.doc.querySelectorAll('.TiMu').length,7);assert(!nested.doc.querySelector('.fanyaMarking_left'));
   const found=f.api.coursePageTasks(tree);assert.equal(found.length,1);assert.equal(found[0].type,'quiz');assert.equal(found[0].doc,nested.doc);
   assert.equal(nested.container.contains(found[0].node),false);assert.equal(f.api.courseTaskContainer(found[0].node),nested.container);assert.equal(f.api.courseTaskRequired(found[0].node),true);
   const messages=[],notify=f.api.controller.report;f.api.controller.report=(message,...args)=>{messages.push(message);return notify(message,...args);};
   const r=await f.runner.start({submit:false,skipUnanswerable:false,continueOnTimeout:false});
   assert.equal(r.status,'done',r.reason);assert.equal(r.chapters[0].status,'manual-pending');assert.equal(r.chapters[0].tasks[0].status,'manual-pending');assert.equal(r.videos,1);assert.equal(r.quizzes,0);
   assert(f.events.includes('chapter:1'));assert.equal(f.submits,0);assert.equal(f.requests.length,0);assert.equal(classificationRequests.length,before);
   assert(!messages.some(message=>/等待后续任务|平台完成确认|等待任务控件/.test(message)),messages.join(' / '));
   assert.equal(nested.container.getAttribute('data-completed'),'false');assert(nested.icon.parentElement);assert.equal(nested.quizRoot.querySelector('.testTit_status').textContent,'待完成');
   assert([...nested.doc.querySelectorAll('textarea')].every(input=>input.value==='用户已有答案'));assert.equal(r.protection.consecutiveFailures,0);
  }finally{f.close();}
 });
 for(const layout of ['siblings','shared-container'])await test('跨iframe归属：跳过测验后同页视频PPT继续 '+layout,async()=>{
  const f=fixture([{tabs:[{title:'单元任务',tasks:[{kind:'quiz',essay:true,count:7},{kind:'video'},{kind:'ppt'}]}]},{tabs:[video()]}]);
  const nested=nestWorkQuiz(f);
  if(layout==='shared-container')for(const sibling of [...nested.cards.querySelectorAll('[data-course-task]')].slice(1))nested.container.append(sibling);
  try{const r=await f.runner.start({submit:false});assert.equal(r.status,'done',r.reason);assert.equal(r.chapters[0].status,'manual-pending');assert.equal(r.chapters[0].tasks[0].type,'quiz');assert.equal(r.videos,2);assert.equal(r.documents,1);assert.equal(r.quizzes,0);assert.equal(f.requests.length,0);assert.equal(f.submits,0);assert.equal(nested.container.getAttribute('data-completed'),'false');assert(f.events.includes('chapter:1'));}finally{f.close();}
 });
 for(const kind of ['ppt','video'])await test('跨iframe归属：跳过测验不能忽略独立任务延迟加载 '+kind,async()=>{
  const f=fixture([{tabs:[{title:'混合任务',tasks:[{kind:'quiz',essay:true},{kind}]}]},{tabs:[video()]}]);
  const nested=nestWorkQuiz(f),other=nested.cards.querySelectorAll('[data-course-task]')[1],content=other.firstChild;
  content.remove();other.innerHTML='<span class="ans-job-icon"></span><p>正在加载</p>';let pending;
  try{
   pending=f.runner.start({submit:false});await waitForTest(()=>f.api.controller.state.message.includes('等待后续任务'));
   assert.equal(f.runner.report.chapters[0].tasks[0].status,'manual-pending');assert(!f.events.includes('chapter:1'));assert.equal(other.getAttribute('data-completed'),'false');
   other.append(content);const r=await pending;
   assert.equal(r.status,'done',r.reason);assert.equal(r.chapters[0].status,'manual-pending');assert.equal(r.documents,kind==='ppt'?1:0);assert.equal(r.videos,kind==='video'?2:1);assert.equal(r.quizzes,0);assert.equal(f.submits,0);assert.equal(f.requests.length,0);assert.equal(other.getAttribute('data-completed'),'true');assert(f.events.includes('chapter:1'));
  }finally{f.runner.stop();if(pending)await pending;f.close();}
 });
 await test('跨iframe归属：真实任务持续不加载仍按原等待预算停止',async()=>{
  const f=fixture([{tabs:[{title:'混合任务',tasks:[{kind:'quiz',essay:true},{kind:'ppt'}]}]},{tabs:[video()]}],{limits:{completionMs:70}});
  const nested=nestWorkQuiz(f),other=nested.cards.querySelectorAll('[data-course-task]')[1];other.innerHTML='<span class="ans-job-icon"></span><p>正在加载</p>';
  try{const r=await f.runner.start({submit:false,continueOnTimeout:false});assert.equal(r.status,'stopped');assert.match(r.reason,/未完成任务|后续控件/);assert.equal(r.documents,0);assert.equal(r.quizzes,0);assert.equal(f.submits,0);assert(!f.events.includes('chapter:1'));assert.equal(other.getAttribute('data-completed'),'false');}finally{f.close();}
 });
 await test('跨iframe归属：已完成嵌套测验保持已完成识别且不重复提交',async()=>{
  const f=fixture([{tabs:[quiz({complete:true})]}]);const nested=nestWorkQuiz(f);
  try{const r=await f.runner.start({submit:true,skipLearned:false});assert.equal(r.status,'done',r.reason);assert.equal(r.chapters[0].tasks[0].status,'already');assert.equal(r.quizzes,0);assert.equal(f.submits,0);assert.equal(f.requests.length,0);assert.equal(nested.container.getAttribute('data-completed'),'true');}finally{f.close();}
 });
 await test('跨iframe归属：知识图谱与跳过测验各自识别',async()=>{
  const f=fixture([{tabs:[{title:'章节内容',tasks:[{kind:'quiz',essay:true},{kind:'knowledge-graph'}]}]},{tabs:[video()]}]);nestWorkQuiz(f);
  try{const r=await f.runner.start({submit:false});assert.equal(r.status,'done',r.reason);assert.equal(r.chapters[0].tasks.filter(t=>t.type==='quiz').length,1);assert.equal(r.chapters[0].tasks.filter(t=>t.type==='knowledge-graph').length,1);assert.equal(r.chapters[0].status,'manual-pending');assert.equal(r.videos,1);assert.equal(f.submits,0);assert.equal(f.requests.length,0);}finally{f.close();}
 });
 for(const extra of [{},{essay:true,manualText:'请手写计算过程',manualValue:'用户原答案'},{unknown:true}])await test('关闭自动提交：跳过测验且无分类、求解、预填和提交 '+JSON.stringify(extra),async()=>{
  const f=fixture([{tabs:[quiz(extra)]},{tabs:[video()]}],{key:''});const before=classificationRequests.length;
  try{const r=await f.runner.start({submit:false,skipUnanswerable:false});assert.equal(r.status,'done',r.reason);assert.equal(r.chapters[0].status,'manual-pending');assert.match(r.chapters[0].reason,/已关闭/);assert.equal(r.quizzes,0);assert.equal(r.videos,1);assert.equal(f.submits,0);assert.equal(f.requests.length,0);assert.equal(classificationRequests.length,before);assert(f.events.includes('chapter:1'));assert.equal(r.protection.consecutiveFailures,0);assert.match(f.api.courseReportText(r),/仍有待处理/);assert(!f.doc.querySelector('input:checked'));}finally{f.close();}
 });
 await test('关闭自动提交：同页测验跳过后仍处理视频及资料',async()=>{
  const f=fixture([{tabs:[{title:'混合任务',tasks:[{kind:'quiz'},{kind:'video'},{kind:'ppt'}]}]},{tabs:[video()]}]);
  try{const r=await f.runner.start({submit:false});assert.equal(r.status,'done',r.reason);assert.equal(r.chapters[0].status,'manual-pending');assert.equal(r.videos,2);assert.equal(r.documents,1);assert.equal(r.quizzes,0);assert.equal(f.requests.length,0);assert.equal(f.submits,0);}finally{f.close();}
 });
 await test('关闭自动提交：视频资料测验分标签顺序继续下一章',async()=>{
  const f=fixture([{tabs:[video(),ppt(),quiz({essay:true})]},{tabs:[video()]}]);
  try{const r=await f.runner.start({submit:false});assert.equal(r.status,'done',r.reason);assert.equal(r.chapters[0].status,'manual-pending');assert.equal(r.videos,2);assert.equal(r.documents,1);assert.equal(r.quizzes,0);assert.equal(f.requests.length,0);assert.equal(f.submits,0);assert(f.events.includes('chapter:1'));}finally{f.close();}
 });
 await test('关闭自动提交：保留手工答案且最后测验不等待平台确认',async()=>{
  const f=fixture([{tabs:[quiz({essay:true,manualValue:'用户原答案'})]}]);const input=f.doc.querySelector('textarea');
  try{const r=await f.runner.start({submit:false});assert.equal(r.status,'done',r.reason);assert.equal(input.value,'用户原答案');assert.equal(r.chapters[0].status,'manual-pending');assert.equal(r.quizzes,0);assert.equal(f.requests.length,0);assert.equal(f.submits,0);assert(!f.api.controller.state.busy);}finally{f.close();}
 });
 await test('测验工具栏：不展示自动学习日志，开发者报告仍保留',async()=>{
  const f=fixture([{tabs:[quiz()]}]);try{
   f.api.initQuizAssistant(f.doc);const status=f.doc.getElementById('cx-ai-toolbar').shadowRoot.getElementById('status');
   const r=await f.runner.start({submit:false});assert.equal(r.status,'done',r.reason);
   f.api.controller.report(f.api.courseReportText(r),'done');assert.equal(status.textContent,'');assert(status.hidden);
   assert.match(f.d.getElementById('cx-ai-study-root').shadowRoot.getElementById('course-report').textContent,/已关闭/);
   f.api.controller.report('正在读取题目…','extracting');assert.equal(status.textContent,'');assert(status.hidden);
  }finally{f.close();}
 });
 await test('关闭自动提交：平台已完成测验仍读取为已完成',async()=>{
  const f=fixture([{tabs:[quiz({complete:true})]}]);try{const r=await f.runner.start({submit:false,skipLearned:false});assert.equal(r.status,'done',r.reason);assert.equal(r.chapters[0].tasks[0].status,'already');assert.equal(f.requests.length,0);assert.equal(f.submits,0);}finally{f.close();}
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
  const f=fixture([{tabs:[quiz()]}],{requestMs:35});try{const p=f.runner.start();await delay(10);f.doc.querySelector('.fontLabel').textContent='【单选题】另一道题';const r=await p;assert.equal(r.status,'stopped');assert(JSON.parse(f.api.exportCxDiagnostics()).diagnostics.some(item=>item.code==='CX-PAR-008'));assert.equal(f.submits,0);}finally{f.close();}
 });
 await test('出现验证码或账号切换时中止未完成模型请求',async()=>{
  for(const kind of ['captcha','account']){
   const f=fixture([{tabs:[quiz()]}],{holdModelResponse:true});try{const p=f.runner.start();await waitForTest(()=>f.requests.length===1);
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
 await test('多目录没有总量截断，无视频和测验的文字目录均遍历',()=>runWith(Array.from({length:31},()=>({tabs:[{title:'资料',text:'无需视频的文字材料'}]})),{},(f,r)=>{assert.equal(r.status,'done');assert.equal(r.chapters.length,31);assert.equal(r.chapters.filter(c=>c.status==='no-tasks').length,31);assert(!f.api.courseReportText(r).includes('全部流程完成'));assert.equal(f.requests.length,0);}));
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
 await test('独立题目 iframe 无课程命令权限，主页面操作仍完成到视频',async()=>{
  const f=fixture([{tabs:[quiz({essay:true}),video()]}]);try{
   const child=f.doc.defaultView;child.GM_getValue=withModelFixture(f.w.GM_getValue);child.GM_setValue=f.w.GM_setValue;child.GM_xmlhttpRequest=f.w.GM_xmlhttpRequest;child.GM_getResourceText=f.w.GM_getResourceText;
   child.eval(code);child.courseAPI.initQuizAssistant();child.courseAPI.controller.openPanel('chapters');
   const portal=f.d.getElementById('cx-ai-quiz-panel');assert(portal);assert(portal.shadowRoot.getElementById('course-start').disabled);portal.shadowRoot.getElementById('course-start').click();
   await delay(10);assert(!f.runner.busy);assert.equal(f.requests.length,0);const p=f.runner.start();await delay(10);assert(f.runner.busy);assert(portal.shadowRoot.getElementById('status-spinner').hidden===false);
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
 await test('任务控件尚未加载时仍可跳过，不把待加载任务判作完成',async()=>{
  const f=fixture([{tabs:[{title:'问卷',tasks:[{kind:'survey'}]}]},{tabs:[video()]}]);try{
   f.doc.body.innerHTML='<span class="ans-job-icon"></span>';const p=f.runner.start();await waitForTest(()=>f.runner.canSkip);assert(f.runner.skip());const r=await p;
   assert.equal(r.status,'done');assert.equal(r.chapters[0].status,'skipped');assert.equal(r.videos,1);
  }finally{f.close();}
 });
 await test('最后一章跳过结束遍历，但不会声称全部章节完成',async()=>{
  const f=fixture([{tabs:[{title:'问卷',tasks:[{kind:'survey'}]}]}]);try{
   const p=f.runner.start();await delay(7);assert(f.runner.skip());const r=await p;
   assert.equal(r.status,'done');assert.match(f.api.courseReportText(r),/遍历结束，仍有待处理章节：0\/1/);assert(!f.api.courseReportText(r).includes('全部流程完成'));
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
 await test('独立子测验跳过入口禁用，主页面取消测验后继续下一章',async()=>{
  const f=fixture([{tabs:[quiz()]},{tabs:[video()]}],{requestMs:80});try{
   const child=f.doc.defaultView;child.GM_getValue=withModelFixture(f.w.GM_getValue);child.GM_setValue=f.w.GM_setValue;child.GM_xmlhttpRequest=f.w.GM_xmlhttpRequest;child.GM_getResourceText=f.w.GM_getResourceText;
   child.eval(code);child.courseAPI.initQuizAssistant();child.courseAPI.controller.openPanel('chapters');
   const p=f.runner.start();await delay(10);const button=f.d.getElementById('cx-ai-quiz-panel').shadowRoot.getElementById('course-skip');assert(button.disabled);button.click();assert.equal(f.runner.report.chapters[0].status,'running');f.runner.skip();
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
  try{f.doc.querySelector('.vjs-big-play-button').onclick=()=>{slowPoll=true;};const r=await f.runner.start();assert.equal(r.status,'stopped');assert.equal(r.videos,0);assert.match(r.reason,/启动超时/);assert(!f.events.includes('chapter:1'));assert(!f.events.some(e=>e.startsWith('play:')));
  }finally{f.close();}
 });
 await test('暂停事件唤醒：后台轮询挂起时及时等待手动播放，取消后不继续操作',async()=>{
  let f,pending;const held=[];f=fixture([{tabs:[video({duration:100,pauseAt:2,manualPause:true})]},{tabs:[video()]}],{sleep:ms=>ms===3&&f?.events.includes('play:0:0:0')?new Promise(resolve=>held.push(resolve)):delay(ms)});
  try{Object.defineProperty(f.d,'visibilityState',{get:()=> 'hidden',configurable:true});pending=f.runner.start();await waitForTest(()=>f.runner.report?.chapters[0].tasks[0]?.pauseState?.waiting);
   assert(held.length>0);assert.equal(f.events.filter(e=>e.startsWith('play:')).length,1);assert.equal(f.runner.report.chapters[0].tasks[0].resumes,0);assert.equal(f.videos[0].playbackRate,1);f.runner.stop();const r=await pending;assert.equal(r.status,'stopped');assert.equal(r.videos,0);assert(!f.events.includes('chapter:1'));held.forEach(resolve=>resolve());await delay(5);assert.equal(f.events.filter(e=>e.startsWith('play:')).length,1);
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
 await test('无任务标记但目录仍有未完成任务，不误报整章完成',()=>runWith([{tabs:[{title:'PPT',tasks:[{kind:'scroll',optional:true}]}]}],{optionalPending:true},(f,r)=>{assert.equal(r.status,'done');assert.equal(r.documents,0);assert.equal(r.chapters[0].status,'no-tasks');assert(!f.api.courseReportText(r).includes('全部流程完成'));}));

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
   send('one','read');assert.equal(responses.length,2);send('two','step');assert.equal(doc.documentElement.scrollTop,320);assert.equal(doc.documentElement.getAttribute('data-cx-document-bridge'),'v1.26');
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
  const base=Date.now();let clock=base,counter,resetPending=false,clicks=0,resets=0,safety;
  const f=fixture([{tabs:[ppt({nextOnly:true})]}],{now:()=>clock,limits:{documentMs:25},sleep:async ms=>{
   if(resetPending&&ms===LIMITS.slideMs){counter.value='1';resetPending=false;resets++;}
   await delay(ms);
  }});
  try{
   counter=f.doc.querySelector('[data-slide-current]');
   f.doc.querySelector('[data-slide-next]').onclick=()=>{clicks++;clock+=10;counter.value='2';resetPending=true;};
   const pending=f.runner.start({continueOnTimeout:false});
   safety=setTimeout(()=>f.runner.stop('防止测试挂起'),5000);
   const r=await pending;
   assert.equal(r.status,'stopped');assert.match(r.reason,/阅读超时/);assert.equal(r.documents,0);
   assert.equal(clicks,3);assert.equal(resets,3);assert.equal(clock-base,30);
  }finally{clearTimeout(safety);f.close();}
 });

 await test('首次资料控件延迟加载时等待控件，不当作普通文字或立即停止',async()=>{
  const f=fixture([{tabs:[{title:'PPT',tasks:[{kind:'ppt'}]}]}]);try{const c=f.doc.querySelector('[data-course-task]'),reader=c.firstChild;reader.remove();c.innerHTML='<span class="ans-job-icon"></span>正在加载资料';const p=f.runner.start();await delay(15);c.replaceChildren(reader);const r=await p;assert.equal(r.status,'done');assert.equal(r.documents,1);}finally{f.close();}
 });
 await test('第一任务完成后的等待间隙出现新任务，也继续处理',async()=>{
  const f=fixture([{tabs:[{title:'混合任务',tasks:[{kind:'video'},{kind:'ppt'}]}]}]);try{const late=f.doc.querySelectorAll('[data-course-task]')[1];late.remove();const p=f.runner.start();for(let i=0;i<100&&f.runner.report?.chapters[0].tasks[0]?.status!=='done';i++)await delay(1);assert.equal(f.runner.report.chapters[0].tasks[0].status,'done');await delay(3);f.doc.body.append(late);const r=await p;assert.equal(r.status,'done');assert.equal(r.videos,1);assert.equal(r.documents,1);}finally{f.close();}
 });
 await test('目录行内隐藏完成模板不跳过本章，目录折叠不丢失真实状态',async()=>{
  const f=fixture([{tabs:[video()]}]);try{f.d.querySelector('#cur1').insertAdjacentHTML('beforeend','<span class="icon_Completed" hidden></span>');f.d.querySelector('#coursetree ul').style.display='none';const r=await f.runner.start();assert.equal(r.status,'done');assert.equal(r.videos,1);assert.equal(r.chapters[0].status,'done');}finally{f.close();}
 });
 // 独立审查确认的边界与运行锁回归；共享存储不包含真实账户数据。
 await test('可见任务点先出现，附件视频或PPT晚到仍可完成',async()=>{
  for(const page of [video(),ppt()]){
   const f=fixture([{tabs:[page]}]);let timer;
   try{
    const c=f.doc.querySelector('[data-course-task]'),content=c.firstChild;
    content.remove();c.removeAttribute('data-course-task');c.removeAttribute('data-completed');c.className='ans-attach-ct';
    c.innerHTML='<span class="ans-job-icon"></span>';const p=f.runner.start();timer=setTimeout(()=>{c.append(content);},12);
    const r=await p;assert.equal(r.status,'done',r.reason);assert.equal(r.videos+r.documents,1);assert(!r.chapters[0].tasks.some(t=>t.type==='non-task'));
   }finally{clearTimeout(timer);f.close();}
  }
 });
 await test('无可见任务点的空附件壳直接继续，不伪造平台完成',async()=>{
  const f=fixture([{tabs:[{title:'附件',tasks:[{kind:'video'}]}]}]);try{
   const c=f.doc.querySelector('[data-course-task]');c.replaceChildren();c.removeAttribute('data-course-task');c.removeAttribute('data-completed');c.className='ans-attach-ct';
   const r=await f.runner.start();assert.equal(r.status,'done');assert.equal(r.chapters[0].status,'no-tasks');assert.equal(r.videos,0);assert(r.chapters[0].tasks.some(t=>t.type==='non-task'));assert(!f.api.courseReportText(r).includes('全部流程完成'));
  }finally{f.close();}
 });
 const shareStorage=(a,b)=>{b.w.GM_getValue=withModelFixture((key,fallback)=>a.storage.has(key)?a.storage.get(key):fallback);b.w.GM_setValue=(key,value)=>a.storage.set(key,JSON.parse(JSON.stringify(value)));};
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
  const controls=[['course-skip-learned','cx_course_skip_learned',true],['course-from-current','cx_course_from_current',false],['course-timeout-next','cx_course_timeout_next',true],['course-mute-video','cx_course_mute_video',true],['course-skip-unanswerable','cx_course_skip_unanswerable',false]];
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
  try{const s=f.d.getElementById('cx-ai-study-root').shadowRoot,t=s.getElementById('course-mute-video');assert(!t.checked);s.getElementById('course-start').click();await waitForTest(()=>t.disabled);assert(t.disabled);assert.equal(f.storage.get(f.runner.key).muteVideo,false);for(let i=0;i<200&&f.runner.report.status==='running';i++)await delay(5);assert.equal(f.runner.report.status,'done');assert(!t.disabled);assert(f.videos.every(v=>!v.muted));}finally{f.close();}
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
  for(const config of [{cap:300},{blocked:true}]){const {f,readers:[{acknowledge,state}]}=scrollHarness([config],{limits:{loadMs:35}});try{
   const p=f.runner.start();await waitForTest(()=>state.writes.length>0);acknowledge();const r=await p;assert.equal(r.status,'stopped');assert.equal(r.documents,0);assert.match(r.reason,/滚动没有响应/);assert(!f.events.includes('chapter:1'));
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
 await test('人工题：混合测验先填写支持题，零提交且不进入下一章',async()=>{
  const f=fixture([{tabs:[quiz({count:2,manualText:'请手写计算并拍照上传'})]},{tabs:[quiz()]}]);
  try{const report=await f.runner.start({continueOnTimeout:true});assert.equal(report.status,'stopped');assert.equal(f.requests.length,1);assert.equal(f.submits,0);assert.equal(report.quizzes,0);assert.equal(report.protection.consecutiveFailures,0);assert(!f.events.includes('chapter:1'));assert(f.doc.querySelector('input:checked'));assert.equal(f.doc.querySelector('textarea').value,'');assert(report.chapters[0].issues.some(i=>i.number===2&&/手写/.test(i.reason)));assert(!report.chapters[0].tasks.some(t=>t.submissionStarted));}finally{f.close();}
 });
 await test('人工题：纯人工测验不调用分类或答案，不计超时',async()=>{
  const before=classificationRequests.length,f=fixture([{tabs:[quiz({essay:true,manualText:'绘制一张思维导图'})]}]);
  try{const report=await f.runner.start({continueOnTimeout:true});assert.equal(report.status,'stopped');assert.equal(f.requests.length,0);assert.equal(classificationRequests.length,before);assert.equal(f.submits,0);assert.equal(report.protection.consecutiveFailures,0);assert.match(report.reason,/人工完成/);}finally{f.close();}
 });
 await test('人工题：已有手工内容不能解除提交拦截',async()=>{
  const f=fixture([{tabs:[quiz({essay:true,manualText:'请手写并拍照上传',manualValue:'已写文字'})]}]);
  try{const report=await f.runner.start();assert.equal(report.status,'stopped');assert.equal(f.doc.querySelector('textarea').value,'已写文字');assert.equal(f.submits,0);}finally{f.close();}
 });
 await test('人工题：模型分类为计算题后仍填写客观题并停止',async()=>{
  const f=fixture([{tabs:[quiz({count:2,manualText:'计算下列行列式'})]},{tabs:[quiz()]}],{policyResponse:(request,p)=>request.onload({status:200,responseText:JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({classifications:p.questions.map(q=>({id:q.id,status:'manual',category:'calculation',reason:'需要计算行列式'}))})}}]})})});
  try{const report=await f.runner.start({continueOnTimeout:true});assert.equal(report.status,'stopped');assert.equal(f.requests.length,1);assert.equal(f.submits,0);assert(f.doc.querySelector('input:checked'));assert(!f.events.includes('chapter:1'));assert.equal(report.protection.consecutiveFailures,0);}finally{f.close();}
 });
 await test('人工题：平台已经完成的测验仍跳过，无分类和重复提交',async()=>{
  const f=fixture([{tabs:[quiz({complete:true,essay:true,manualText:'请手写'})]}]);
  try{const report=await f.runner.start();assert.equal(report.status,'done');assert.equal(f.requests.length,0);assert.equal(f.submits,0);}finally{f.close();}
 });

 await test('无法答题跳过：默认关闭，保留原停止与零提交',async()=>{
  const f=fixture([{tabs:[quiz({essay:true,manualText:'请手写拍照上传'})]},{tabs:[video()]}]);
  try{const s=f.d.getElementById('cx-ai-study-root').shadowRoot;assert(!s.getElementById('course-skip-unanswerable').checked);const r=await f.runner.start();assert.equal(r.status,'stopped');assert(!f.events.includes('chapter:1'));assert.equal(f.submits,0);assert.equal(f.storage.get(f.runner.key).skipUnanswerable,false);}finally{f.close();}
 });
 await test('无法答题跳过：纯人工题继续下一章，不调用模型且保留未完成',async()=>{
  const before=classificationRequests.length,f=fixture([{tabs:[quiz({essay:true,manualText:'绘制一张思维导图'})]},{tabs:[video()]}]);
  try{const r=await f.runner.start({skipUnanswerable:true});assert.equal(r.status,'done',r.reason);assert.equal(f.requests.length,0);assert.equal(classificationRequests.length,before);assert.equal(r.videos,1);assert.equal(r.quizzes,0);assert.equal(f.submits,0);assert.equal(r.chapters[0].status,'manual-pending');assert.equal(r.chapters[0].tasks[0].status,'manual-pending');assert(!r.chapters[0].tasks[0].submissionStarted);assert.equal(f.api.coursePendingChapters(r).manual.length,1);assert.match(f.api.courseReportText(r),/遍历结束，仍有待处理章节/);assert.match(f.api.courseReportText(r),/自动跳过 1.*未提交/);assert(!f.api.courseReportText(r).includes('全部流程完成'));assert(f.runner.canRetry);const s=f.d.getElementById('cx-ai-study-root').shadowRoot;assert.match(s.getElementById('course-pending-summary').textContent,/无法答题 1/);assert.match(s.getElementById('course-pending-list').textContent,/未提交/);}finally{f.close();}
 });
 await test('无法答题跳过：混合题支持题预填，人工内容保留，继续视频',async()=>{
  const f=fixture([{tabs:[quiz({count:2,manualText:'请手写计算并拍照上传',manualValue:'已有手工内容'})]},{tabs:[video()]}]);
  try{const radio=f.doc.querySelector('input[value=A]'),area=f.doc.querySelector('textarea');const r=await f.runner.start({skipUnanswerable:true});assert.equal(r.status,'done',r.reason);assert(radio.checked);assert.equal(area.value,'已有手工内容');assert.equal(f.requests.length,1);assert.equal(f.submits,0);assert.equal(r.videos,1);assert(r.chapters[0].issues.some(i=>i.number===2));assert.equal(r.chapters[0].tasks[0].manualQuestions[0].number,2);assert.equal(r.protection.consecutiveFailures,0);}finally{f.close();}
 });
 await test('无法答题跳过：模型无法确定要求时不解答、不提交',async()=>{
  const f=fixture([{tabs:[quiz({essay:true})]},{tabs:[video()]}],{policyResponse:r=>r.onload({status:200,responseText:JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"classifications":[]}'}}]})})});
  try{const r=await f.runner.start({skipUnanswerable:true});assert.equal(r.status,'done',r.reason);assert.equal(r.chapters[0].status,'manual-pending');assert.equal(f.requests.length,0);assert.equal(r.videos,1);assert.equal(f.submits,0);assert.match(r.chapters[0].tasks[0].manualQuestions[0].reason,/人工确认/);}finally{f.close();}
 });
 await test('无法答题跳过：未知题型转待人工，不跳过正常视频任务',async()=>{
  const f=fixture([{tabs:[quiz({unknown:true}),video()]},{tabs:[video()]}]);
  try{const r=await f.runner.start({skipUnanswerable:true});assert.equal(r.status,'done',r.reason);assert.equal(r.videos,2);assert.equal(r.quizzes,0);assert.equal(r.chapters[0].status,'manual-pending');assert.equal(f.requests.length,0);assert.equal(f.submits,0);}finally{f.close();}
 });
 await test('无法答题跳过：同章下一测验仍正常提交，人工测验不冒充完成',async()=>{
  const f=fixture([{tabs:[quiz({essay:true,manualText:'请抄写以下英文'}),quiz()]},{tabs:[video()]}]);
  try{const r=await f.runner.start({skipUnanswerable:true});assert.equal(r.status,'done',r.reason);assert.equal(r.chapters[0].status,'manual-pending');assert.equal(r.quizzes,1);assert.equal(f.submits,1);assert(!f.events.includes('submit:0:0'));assert(f.events.includes('submit:0:1'));assert.equal(r.videos,1);assert.deepEqual(Array.from(r.chapters[0].tasks,t=>t.status),['manual-pending','done']);}finally{f.close();}
 });
 await test('无法答题跳过：没有可靠答案时跳过，不以分类数量记完成',async()=>{
  const f=fixture([{tabs:[quiz()]},{tabs:[video()]}],{invalid:true});
  try{const r=await f.runner.start({skipUnanswerable:true});assert.equal(r.status,'done',r.reason);assert.equal(r.chapters[0].status,'manual-pending');assert.equal(r.videos,1);assert.equal(r.quizzes,0);assert.equal(f.submits,0);}finally{f.close();}
 });
 await test('无法答题跳过：网络错误仍停止，不当作人工题放行',async()=>{
  const f=fixture([{tabs:[quiz()]},{tabs:[video()]}],{error:'network'});
  try{const r=await f.runner.start({skipUnanswerable:true});assert.equal(r.status,'stopped');assert(!f.events.includes('chapter:1'));assert.equal(f.submits,0);assert.equal(r.chapters[0].status,'stopped');}finally{f.close();}
 });
 await test('无法答题跳过：人脸验证与提交不明仍立即停止',async()=>{
  for(const spec of [{page:video({faceOnPlay:true}),opts:{},reason:/人脸/},{page:quiz(),opts:{submitNoAck:true},reason:/提交后未收到/}]){
   const f=fixture([{tabs:[spec.page]},{tabs:[video()]}],spec.opts);try{const r=await f.runner.start({skipUnanswerable:true,continueOnTimeout:true});assert.equal(r.status,'stopped');assert.match(r.reason,spec.reason);assert(!f.events.includes('chapter:1'));assert.equal(f.api.coursePendingChapters(r).manual.length,0);}finally{f.close();}
  }
 });
 await test('无法答题跳过：不增加或清零连续超时，三次超时仍保护停止',async()=>{
  const f=fixture([{tabs:[video({stall:true})]},{tabs:[quiz({essay:true,manualText:'请手写'})]},{tabs:[video({stall:true})]},{tabs:[quiz({essay:true,manualText:'请抄写英文'})]},{tabs:[video({stall:true})]},{tabs:[video()]}],{limits:{stallMs:35}});
  try{const r=await f.runner.start({skipUnanswerable:true,continueOnTimeout:true});assert.equal(r.status,'stopped');assert(r.protection.triggered);assert.equal(r.protection.consecutiveFailures,3);assert.equal(f.api.coursePendingChapters(r).manual.length,2);assert(!f.events.includes('chapter:5'));assert.equal(f.submits,0);}finally{f.close();}
 });
 await test('无法答题跳过：开关保存、运行锁定，正常恢复沿用本次设置',async()=>{
  const f=fixture([{tabs:[quiz({essay:true,manualText:'请手写'})]},{tabs:[video({manual:true})]}]);let pending,saved;
  try{const s=f.d.getElementById('cx-ai-study-root').shadowRoot,t=s.getElementById('course-skip-unanswerable');t.checked=true;t.dispatchEvent(new f.w.Event('change'));assert.equal(f.storage.get('cx_course_skip_unanswerable'),true);s.getElementById('course-start').click();await waitForTest(()=>f.events.some(e=>e.startsWith('play:')));assert(t.disabled);assert.equal(f.storage.get(f.runner.key).skipUnanswerable,true);t.checked=false;t.dispatchEvent(new f.w.Event('change'));assert(t.checked);assert.equal(f.storage.get('cx_course_skip_unanswerable'),true);f.runner.stop();await waitForTest(()=>!f.d.getElementById('cx-ai-course-lease')?.getAttribute('data-run-id'));assert(!t.disabled);saved=[...f.storage];}finally{f.close();}
  const g=fixture([{tabs:[video()]}],{storage:saved});try{assert(g.d.getElementById('cx-ai-study-root').shadowRoot.getElementById('course-skip-unanswerable').checked);}finally{g.close();}
 });
 await test('无法答题跳过：正常导航接力保存开关和人工清单，不重新作答',async()=>{
  const chapters=[{tabs:[quiz({essay:true,manualText:'请手写'})]},{tabs:[video()]}];let saved,session;
  const first=fixture(chapters,{navigateOut:true});try{const r=await first.runner.start({skipUnanswerable:true});assert.equal(r.status,'running');assert.equal(r.chapters[0].status,'manual-pending');saved=[...first.storage];session=first.w.sessionStorage.getItem('cx-ai-course-session');assert.equal(first.storage.get(first.runner.key).skipUnanswerable,true);}finally{first.close();}
  const next=fixture(chapters,{storage:saved,session,noAutoResume:true});try{const r=await next.runner.resumeIfNeeded();assert.equal(r.status,'done',r.reason);assert.equal(r.chapters[0].status,'manual-pending');assert.equal(r.videos,1);assert.equal(next.requests.length,0);assert.equal(next.submits,0);assert.equal(next.storage.get(next.runner.key).skipUnanswerable,true);}finally{next.close();}
 });
 await test('无法答题跳过：人工确认重试使用当前开关，保留上一轮结果',async()=>{
  const chapters=[{tabs:[quiz({essay:true,manualText:'请手写'})]},{tabs:[video()]}],f=fixture(chapters);
  try{await f.runner.start({skipUnanswerable:true});assert(f.runner.canRetry);assert.equal(f.api.courseRetryCandidate(f.d,f.storage.get(f.runner.key)).queue.length,1);
   chapters[0].tabs[0].tasks[0].manualText='解释人民民主的含义';f.storage.set('cx_course_skip_unanswerable',false);
   const r=await f.runner.retryIncomplete(undefined,{submit:true});assert.equal(r.status,'done',r.reason);assert.equal(r.chapters.length,1);assert.equal(r.quizzes,1);assert.equal(f.submits,1);assert.equal(f.storage.get(f.runner.key).skipUnanswerable,false);assert.equal(f.storage.get(f.runner.key).previousReport.chapters[0].status,'manual-pending');assert.equal(r.videos,0);
  }finally{f.close();}
 });
 await test('无法答题跳过：全隐藏时继续，结束不自动显示且清单可恢复',async()=>{
  const f=fixture([{tabs:[quiz({essay:true,manualText:'请手写'})]},{tabs:[video()]}]);try{f.menus.get('隐藏助手全部界面')();const r=await f.runner.start({skipUnanswerable:true});assert.equal(r.status,'done',r.reason);assert.equal(f.d.getElementById('cx-ai-study-root').style.display,'none');f.menus.get('显示助手界面')();assert.equal(f.api.coursePendingChapters(r).manual.length,1);assert.match(f.d.getElementById('cx-ai-study-root').shadowRoot.getElementById('course-pending-list').textContent,/未提交/);}finally{f.close();}
 });

 await test('无法答题跳过：分析期间人工停止，不能继续下一节',async()=>{
  const f=fixture([{tabs:[quiz({count:2,manualText:'请手写'})]},{tabs:[video()]}],{requestMs:80,lateResponse:true});let pending;
  try{pending=f.runner.start({skipUnanswerable:true});await waitForTest(()=>f.requests.length===1);f.runner.stop();const r=await pending;await delay(90);assert.equal(r.status,'stopped');assert.equal(f.submits,0);assert(!f.events.includes('chapter:1'));assert.equal(f.api.coursePendingChapters(r).manual.length,0);}finally{f.runner.stop();if(pending)await pending;f.close();}
 });
 const result={total:logs.length+failures.length,failures,logs};console.log(JSON.stringify(result,null,2));if(!process.env.COURSE_TEST_FILTER)fs.writeFileSync(path.join(__dirname,'course-runner-results.json'),JSON.stringify(result,null,2));process.exitCode=failures.length?1:0;
})().catch(error=>{console.error(error);process.exitCode=1;});
