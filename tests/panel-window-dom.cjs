const {withModelFixture}=require('./model-fixture.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const {webcrypto} = require('node:crypto');
const {policyInput,respondPolicy}=require('./answer-policy-mock.cjs');
const classificationRequests=[];
const {JSDOM, VirtualConsole} = createRequire(path.join(__dirname, '../package.json'))('jsdom');

// Exercise the generated script rather than rebuilding an imitation of the window state.
const source = fs.readFileSync(process.env.CX_WINDOW_SOURCE || path.join(__dirname, '../学习通AI助手.user.js'), 'utf8').replace(/\r\n/g, '\n').replace('/* TRUSTED_ASSISTANT_ACTIVATION */','return true; /* test harness only: jsdom cannot generate user activation */');
const entry = "    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startQuizObserver, { once: true });\n    else startQuizObserver();";
assert(source.includes(entry), '候选脚本入口定位失败');
const instrumented = source.replace(entry, `globalThis.windowTestAPI={initQuizAssistant,runAnswerFlow,initAssistantVisibility,registerAssistantUiHost,setAssistantUiHidden,createEndedCourseFilter,assistantAccountIdentifiers,assistantAccountProfile,get controller(){return controller}};`);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const logs = [], failures = [];
async function check(name, fn) {
  try {await fn(); logs.push(`PASS ${name}`);console.log(`PASS ${name}`);}
  catch (error) {failures.push(`${name}: ${error.stack}`);console.error(`FAIL ${name}: ${error.message}`);}
}
async function until(fn, description) {
  for (let i=0; i<200; i++) {if(fn())return;await delay(5);}
  throw Error(description || '等待条件超时');
}
function fixture(opts={}) {
  const errors = [], console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM('<div class="TiMu" questionid="window-q1"><h3 class="stem">【简答题】解释数据库概念</h3><textarea></textarea></div>', {
    url:'https://mooc1.chaoxing.com/work/doHomeWorkNew',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:console
  });
  const w=dom.window, requests=[], storage=opts.hub?.storage || new Map([['deepseek_api_key','mock-window-key'],['cx_model','deepseek-flash'],...(opts.storage||[])]);
  installElementScrolling(w);
  const hub=opts.hub || {storage,listeners:new Map(),writes:0,nextId:0},menus=new Map();
  let aborts=0;
  w.GM_getValue=withModelFixture((key,fallback)=>storage.has(key)?storage.get(key):fallback);
  w.GM_setValue=(key,value)=>{const old=storage.get(key);storage.set(key,value);hub.writes++;for(const record of hub.listeners.values())if(record.key===key)record.fn(key,old,value,record.w!==w);};
  w.GM_registerMenuCommand=(name,fn)=>{assert(!menus.has(name),'菜单重复注册');menus.set(name,fn);};
  w.GM_addValueChangeListener=(key,fn)=>{const id=++hub.nextId;hub.listeners.set(id,{key,fn,w});return id;};
  w.GM_removeValueChangeListener=id=>hub.listeners.delete(id);
  w.GM_deleteValue=key=>storage.delete(key);
  w.GM_getResourceText=()=> '{}';
  w.GM_xmlhttpRequest=request=>{const input=policyInput(request);if(input){classificationRequests.push(request);queueMicrotask(()=>respondPolicy(request,input));return {abort(){aborts++;request.onabort?.();}};}requests.push(request);return {abort(){aborts++;request.onabort?.();}};};
  Object.defineProperty(w.crypto,'subtle',{value:webcrypto.subtle});
  w.eval(instrumented);w.windowTestAPI.initQuizAssistant();
  const api=w.windowTestAPI, d=w.document, host=d.getElementById('cx-ai-study-root'), s=host.shadowRoot;
  const panel=s.getElementById('panel'), launcher=s.getElementById('floating-launcher');
  assert(launcher, '完整脚本尚未包含悬浮入口，请重新构建');
  const panelRect=()=>{const left=parseFloat(host.style.left)||40,top=parseFloat(host.style.top)||30,width=parseFloat(panel.style.width)||600,height=parseFloat(panel.style.height)||450;return {left,top,width,height,right:left+width,bottom:top+height};};
  panel.getBoundingClientRect=panelRect;host.getBoundingClientRect=panelRect;
  launcher.getBoundingClientRect=()=>({left:parseFloat(launcher.style.left)||0,top:parseFloat(launcher.style.top)||0,width:44,height:44,right:0,bottom:0});
  let minimizeRect={left:760,top:260,width:28,height:28};
  s.getElementById('minimize').getBoundingClientRect=()=>typeof minimizeRect==='function'?minimizeRect():minimizeRect;
  return {w,d,s,host,panel,launcher,api,requests,errors,storage,hub,menus,get aborts(){return aborts;},
    setURL(url){dom.reconfigure({url});},
    setMinimizeRect(rect){minimizeRect=rect;},
    open(view){api.controller.openPanel(view);},
    close(){w.dispatchEvent(new w.Event('pagehide'));w.close();}};
}
function pointer(f,node,type,x,y,id=1) {
  const event=new f.w.MouseEvent(type,{button:0,clientX:x,clientY:y,bubbles:true,cancelable:true});
  Object.defineProperty(event,'pointerId',{value:id});node.dispatchEvent(event);
}
function drag(f,node,dx,dy,id=1,end='pointerup') {
  pointer(f,node,'pointerdown',100,100,id);pointer(f,node,'pointermove',100+dx,100+dy,id);pointer(f,node,end,100+dx,100+dy,id);
}
function arrow(f,node,key) {node.dispatchEvent(new f.w.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));}
function mouseClick(f,node) {node.dispatchEvent(new f.w.MouseEvent('click',{detail:1,bubbles:true,cancelable:true}));}
function position(f) {return {left:parseFloat(f.launcher.style.left),top:parseFloat(f.launcher.style.top)};}
function visible(f, main, floating) {assert.equal(f.panel.hidden,!main);assert.equal(f.launcher.hidden,!floating);}
function reply(request) {
  const payload=JSON.parse(request.data), user=payload.messages.find(item=>item.role==='user').content;
  const input=JSON.parse(Array.isArray(user)?user.find(item=>item.type==='text').text:user);
  request.onload({status:200,responseText:JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({answers:input.questions.map(question=>({id:question.id,answer:['悬浮状态完成的模拟答案'],reason:'模拟验证'}))})}}]})});
}
function assertNoErrors(f) {assert.deepEqual(f.errors,[]);}
function installElementScrolling(w) {
  // jsdom has no element scrolling API; only mirror coordinates used by the read-only queue wheel.
  w.HTMLElement.prototype.scrollTo=function(options){if(Number.isFinite(options?.top))this.scrollTop=options.top;if(Number.isFinite(options?.left))this.scrollLeft=options.left;};
}
function courseFixtureDOM(url, errors) {
  const console=new VirtualConsole();console.on('jsdomError',error=>errors.push(error.message));
  // Reuse the existing synthetic course, but exercise this build rather than its archived embedded script.
  const html=fs.readFileSync(path.join(__dirname,'自动课程模拟.html'),'utf8').replace(/\r\n/g,'\n');
  const start=html.indexOf('<script>const code='),end=html.indexOf(';\nclass JSDOM',start);
  assert(start>=0&&end>start,'离线课程脚本定位失败');
  const code=source.replace(entry,'globalThis.courseAPI={initStudyAssistant,createCourseRunner,courseTabs,courseFrameTree,courseDocumentReader,courseSubmitButton,courseQuizComplete,courseReportText,courseRunActive,get controller(){return controller},replaceRunner(r){courseRunner=r}};')
    .replace('function pageURL(doc) {',"function pageURL(doc) { if(doc === window.top.document) return new URL('https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=mock-demo-course&clazzid=mock-demo-class&cpi=mock-demo-account');");
  const current=html.slice(0,start)+'<script>const code='+JSON.stringify(code).replace(/<\//g,'<\\/')+html.slice(end);
  return new JSDOM(current,{url,runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:console,beforeParse:installElementScrolling});
}
async function nestedFixture() {
  const errors=[];
  // The preview embeds a pageURL override. Real child IIFEs deliberately do not;
  // use the real route shape with mock identifiers so parent discovery is exercised.
  const dom=courseFixtureDOM('https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=mock-course&clazzid=mock-class&cpi=mock-account&scene=no-task',errors);
  try {await until(()=>dom.window.courseDemo,`离线课程未初始化：${errors.join('；')}`);}
  catch(error){try{dom.window.courseDemo?.close();dom.window.dispatchEvent(new dom.window.Event('pagehide'));}finally{dom.window.close();}throw error;}
  const f=dom.window.courseDemo;
  const parent=f.d.getElementById('cx-ai-study-root').shadowRoot;
  const initializeChild=()=>{
    const doc=f.doc,w=doc.defaultView,node=doc.createElement('div');node.className='TiMu';node.setAttribute('questionid','nested-window-q1');
    installElementScrolling(w);
    node.innerHTML='<h3 class="stem">【简答题】解释嵌套测验的数据库概念</h3><textarea></textarea>';doc.body.append(node);
    const requests=[];let aborts=0;
    w.GM_getValue=withModelFixture((key,fallback)=>f.storage.has(key)?f.storage.get(key):fallback);
    w.GM_setValue=(key,value)=>f.storage.set(key,value);w.GM_deleteValue=key=>f.storage.delete(key);w.GM_getResourceText=()=> '{}';
    f.attachUiStorage(w);
    w.GM_xmlhttpRequest=request=>{const input=policyInput(request);if(input){classificationRequests.push(request);queueMicrotask(()=>respondPolicy(request,input));return {abort(){aborts++;request.onabort?.();}};}requests.push(request);return {abort(){aborts++;request.onabort?.();}};};
    Object.defineProperty(w.crypto,'subtle',{value:webcrypto.subtle});w.eval(instrumented);w.windowTestAPI.initQuizAssistant();
    const api=w.windowTestAPI,host=doc.getElementById('cx-ai-study-root'),s=host.shadowRoot;
    return {w,doc,host,s,api,requests,get aborts(){return aborts;}};
  };
  const active=()=>[...f.d.querySelectorAll('*')].filter(host=>host.shadowRoot?.getElementById('panel')).flatMap(host=>{
    const s=host.shadowRoot,result=[];if(!s.getElementById('panel').hidden)result.push({host,kind:'panel'});if(!s.getElementById('floating-launcher').hidden)result.push({host,kind:'floating'});return result;
  });
  return {dom,f,parent,initializeChild,active,errors,async close(){try{f.close();await until(()=>!f.runner.busy,'模拟 runner 停止收尾超时');await delay(20);}finally{f.w.dispatchEvent(new f.w.Event('pagehide'));dom.window.close();}}};
}
function assertSingleWindow(n,host,kind) {
  const active=n.active();assert.equal(active.length,1,'同一课程页只能显示一个助手窗口或悬浮入口');assert.equal(active[0].host,host);assert.equal(active[0].kind,kind);
}

async function main() {
  await check('设置位于主导航第四位，底部账号对应独立内容页',async()=>{
    const f=fixture();try{
      const tabs=f.s.querySelector('.nav-tabs'),settings=f.s.getElementById('nav-model'),account=f.s.getElementById('nav-account');
      assert.equal(tabs.lastElementChild,settings);assert.equal(tabs.nextElementSibling,account);assert(account.classList.contains('nav-account-bottom'));assert(!settings.classList.contains('nav-model-bottom'));assert.equal(account.dataset.panelView,'account');assert.equal(account.getAttribute('aria-controls'),'view-account');assert(!f.s.getElementById('account-dialog'));assert.equal(f.requests.length,0);assertNoErrors(f);
    }finally{f.close();}
  });
  await check('账号资料仅读取数字标识和原生资料，令牌不进入展示对象',async()=>{
    const f=fixture();try{
      for(const [name,value] of [['UID','100001'],['_uid','100001'],['fid','2001'],['spaceRoleId','3'],['cx_p_token','fake-secret-token'],['JSESSIONID','fake-session']])f.d.cookie=`${name}=${value}`;
      const ids=f.api.assistantAccountIdentifiers(f.d);assert.equal(ids.uid,'100001');assert.equal(ids.fid,'2001');assert.equal(ids.roleId,'3');assert(!JSON.stringify(ids).includes('secret'));assert(!JSON.stringify(ids).includes('session'));
      const source=new f.w.DOMParser().parseFromString('<div class="user-block"><img class="head-img" src="https://photo.chaoxing.com/p/100001_80?temp=123&unrelated=drop"><p class="user-name">示例用户</p></div><h3 id="siteName">示例大学(学生)</h3>','text/html');
      const profile=f.api.assistantAccountProfile(source,ids,'https://i.chaoxing.com/base');assert.equal(profile.name,'示例用户');assert.equal(profile.school,'示例大学');assert.equal(profile.role,'学生');assert.equal(profile.avatar,'https://photo.chaoxing.com/p/100001_80?temp=123');assert.equal(f.api.assistantAccountProfile(source,ids,'https://example.invalid/base').name,'');
      source.querySelector('img').setAttribute('src','https://photo.chaoxing.com/p/100002_80');assert.throws(()=>f.api.assistantAccountProfile(source,ids,'https://i.chaoxing.com/base'),/账号已变化/);assertNoErrors(f);
    }finally{f.close();}
  });
  await check('账号页展示本页资料，支持导航切换与全隐藏且没有弹窗',async()=>{
    const f=fixture();try{
      f.open('other');f.setURL('https://i.chaoxing.com/base');f.d.cookie='UID=100001';f.d.cookie='fid=2001';
      f.d.body.insertAdjacentHTML('beforeend','<div class="user-block"><img class="head-img" src="https://photo.chaoxing.com/p/100001_80"><p class="user-name">示例用户</p></div><h3 id="siteName">示例大学(学生)</h3>');
      const page=f.s.getElementById('view-account'),trigger=f.s.getElementById('nav-account');
      trigger.click();assert.equal(f.panel.dataset.activeView,'account');assert(!page.hidden);assert.equal(trigger.getAttribute('aria-selected'),'true');assert.equal(f.s.getElementById('account-name').textContent,'示例用户');assert(f.s.getElementById('account-details').textContent.includes('100001'));assert.equal(f.requests.length,0);assert(!f.s.getElementById('account-dialog'));
      f.open('other');assert(page.hidden);assert(!f.panel.hidden);assert.equal(trigger.getAttribute('aria-selected'),'false');
      trigger.click();arrow(f,trigger,'ArrowUp');assert.equal(f.panel.dataset.activeView,'model');assert(page.hidden);
      trigger.click();f.menus.get('隐藏助手全部界面')();assert(!f.s.querySelector('dialog[open]'));assert.equal(f.host.style.display,'none');assertNoErrors(f);
    }finally{f.close();}
  });
  await check('隐藏头像默认关闭，通用图标不会被资料刷新或图片错误覆盖且设置同步',async()=>{
    const a=fixture(),b=fixture({hub:a.hub});try{
      a.setURL('https://i.chaoxing.com/base');a.d.cookie='UID=100001';a.d.body.insertAdjacentHTML('beforeend','<div class="user-block"><img class="head-img" src="https://photo.chaoxing.com/p/100001_80"><p class="user-name">示例用户</p></div><h3 id="siteName">示例大学(学生)</h3>');a.s.getElementById('nav-account').click();
      const control=a.s.getElementById('account-hide-avatar'),nav=a.s.getElementById('nav-account'),generic=a.s.getElementById('account-nav-generic'),image=a.s.getElementById('account-nav-image');assert(!control.checked);assert.equal(a.w.getComputedStyle(generic).display,'none');
      control.checked=true;control.dispatchEvent(new a.w.Event('change'));assert.equal(a.storage.get('cx_account_hide_avatar'),true);assert(b.s.getElementById('account-hide-avatar').checked);assert.equal(a.w.getComputedStyle(generic).display,'flex');assert.equal(a.w.getComputedStyle(image).display,'none');assert.equal(nav.title,'账号信息');assert.equal(a.s.getElementById('account-name').textContent,'示例用户');assert.notEqual(a.w.getComputedStyle(a.s.getElementById('account-image')).display,'none');
      image.dispatchEvent(new a.w.Event('error'));a.w.dispatchEvent(new a.w.Event('focus'));assert.equal(a.w.getComputedStyle(generic).display,'flex');assert.equal(a.w.getComputedStyle(image.nextElementSibling).display,'none');
      control.checked=false;control.dispatchEvent(new a.w.Event('change'));assert.equal(a.w.getComputedStyle(generic).display,'none');assert(!b.s.getElementById('account-hide-avatar').checked);assert(nav.title.includes('示例用户'));assertNoErrors(a);assertNoErrors(b);
    }finally{b.close();a.close();}
  });
  await check('其他功能导航位于章节下方，两个开关默认关闭并支持键盘切换',async()=>{
    const f=fixture();try{
      assert.deepEqual([...f.s.querySelectorAll('[data-panel-view]')].map(x=>x.dataset.panelView),['questions','chapters','other','model','account']);f.open('other');assert(!f.s.getElementById('view-other').hidden);assert.equal(f.s.getElementById('nav-other').getAttribute('aria-selected'),'true');assert(!f.s.getElementById('other-hide-platform-ai').checked);assert(!f.s.getElementById('other-keep-video-playing').checked);
      arrow(f,f.s.getElementById('nav-other'),'ArrowUp');assert.equal(f.panel.dataset.activeView,'chapters');arrow(f,f.s.getElementById('nav-chapters'),'ArrowDown');assert.equal(f.panel.dataset.activeView,'other');assertNoErrors(f);
    }finally{f.close();}
  });
  await check('平台助教统一隐藏大小形态、气泡和侧栏，通用resizer及助手不受影响',async()=>{
    const f=fixture();try{
      f.d.body.insertAdjacentHTML('beforeend','<div class="cx-robot-wrapper" style="color:red"><div class="figure-wrapper">小黄人</div><div class="anchor-figure">AI助教</div><div class="resizer">缩放</div></div><div class="cx-robot-side">侧栏</div><div class="cx-robot-side-tips">气泡</div><div class="resizer" id="unrelated-resizer">其他缩放</div><div data-face-verification>验证</div>');
      const roots=[...f.d.querySelectorAll('.cx-robot-wrapper,.cx-robot-side,.cx-robot-side-tips')],styles=roots.map(n=>n.getAttribute('style')),control=f.s.getElementById('other-hide-platform-ai');control.checked=true;control.dispatchEvent(new f.w.Event('change'));
      for(const node of roots)assert.equal(f.w.getComputedStyle(node).display,'none');assert.notEqual(f.w.getComputedStyle(f.d.getElementById('unrelated-resizer')).display,'none');assert.notEqual(f.w.getComputedStyle(f.d.querySelector('[data-face-verification]')).display,'none');assert.notEqual(f.host.style.display,'none');
      const late=f.d.createElement('div');late.className='cx-robot-wrapper';f.d.body.append(late);assert.equal(f.w.getComputedStyle(late).display,'none');control.checked=false;control.dispatchEvent(new f.w.Event('change'));assert.notEqual(f.w.getComputedStyle(late).display,'none');assert.deepEqual(roots.map(n=>n.getAttribute('style')),styles);assertNoErrors(f);
    }finally{f.close();}
  });
  await check('视频文字水印默认保留，开启后仅隐藏精确覆盖层，关闭恢复原样',async()=>{
    const f=fixture();try{
      const control=f.s.getElementById('other-hide-video-watermark');assert(!control.checked);
      Object.defineProperty(f.d,'URL',{configurable:true,value:'https://mooc1.chaoxing.com/ananas/modules/video/index.html'});
      f.d.body.insertAdjacentHTML('beforeend','<div id="video" class="video-js"><div id="mask_div00" class="mask_div" style="display:block">fixture watermark</div><button class="vjs-play-control">play</button><div class="vjs-text-track-display">subtitle</div><div data-face-verification>verification</div></div><div class="mask_div" id="unrelated-mask">other</div>');
      const mask=f.d.getElementById('mask_div00'),original=mask.getAttribute('style');assert.notEqual(f.w.getComputedStyle(mask).display,'none');
      control.checked=true;control.dispatchEvent(new f.w.Event('change'));assert.equal(f.w.getComputedStyle(mask).display,'none');
      for(const selector of ['.vjs-play-control','.vjs-text-track-display','[data-face-verification]','#unrelated-mask'])assert.notEqual(f.w.getComputedStyle(f.d.querySelector(selector)).display,'none');
      const late=f.d.createElement('div');late.id='mask_div01';late.className='mask_div';mask.parentElement.append(late);assert.equal(f.w.getComputedStyle(late).display,'none');
      control.checked=false;control.dispatchEvent(new f.w.Event('change'));assert.notEqual(f.w.getComputedStyle(mask).display,'none');assert.notEqual(f.w.getComputedStyle(late).display,'none');assert.equal(mask.getAttribute('style'),original);
      Object.defineProperty(f.d,'URL',{configurable:true,value:'https://mooc1.chaoxing.com/work/doHomeWorkNew'});control.checked=true;control.dispatchEvent(new f.w.Event('change'));assert(!f.d.getElementById('cx-ai-video-watermark-style'));assertNoErrors(f);
    }finally{f.close();}
  });
  await check('已结课筛选只认封面标记，无入口卡片、动态更新和关闭恢复均保持',async()=>{
    const f=fixture(),list=new JSDOM('<div id="courseList"><div id="courselistArea"><div class="course learnCourse" id="active">任务点进度：15/15，课程已结束说明</div><div class="course" id="ended" style="display:block"><span class="not-open-tip">课程已结束</span></div><div class="course" id="template"><span class="not-open-tip" hidden>课程已结束</span></div></div></div><div class="course" id="outside"><span class="not-open-tip">课程已结束</span></div>',{url:'https://mooc2-ans.chaoxing.com/visit/interaction',pretendToBeVisual:true});
    const d=list.window.document,style=n=>list.window.getComputedStyle(d.getElementById(n)).display;
    let filter;try{
      assert.equal(f.api.createEndedCourseFilter(f.d),null);filter=f.api.createEndedCourseFilter(d);filter.apply(false);assert.notEqual(style('ended'),'none');
      filter.apply(true);assert.equal(style('ended'),'none');for(const id of ['active','template','outside'])assert.notEqual(style(id),'none');
      d.getElementById('courselistArea').insertAdjacentHTML('beforeend','<div class="course" id="late"><span class="not-open-tip">课程已结束</span></div>');await delay(0);assert.equal(style('late'),'none');
      d.querySelector('#ended .not-open-tip').firstChild.data='进行中';await delay(0);assert.notEqual(style('ended'),'none');assert.equal(d.getElementById('ended').getAttribute('style'),'display:block');
      const old=d.getElementById('courselistArea'),replacement=d.createElement('div');replacement.id='courselistArea';replacement.innerHTML='<div class="course" id="replacement"><span class="not-open-tip">课程已结束</span></div>';old.replaceWith(replacement);await delay(0);assert.equal(style('replacement'),'none');assert(!old.querySelector('#late').hasAttribute('data-cx-ai-ended-course-hidden'));
      filter.apply(false);assert.notEqual(style('replacement'),'none');assert(!d.getElementById('cx-ai-ended-courses-style'));assert(!d.getElementById('replacement').hasAttribute('data-cx-ai-ended-course-hidden'));assertNoErrors(f);
    }finally{filter?.close();list.window.close();f.close();}
  });
  await check('结课隐藏开关默认关闭，保存后跨面板及新实例同步',async()=>{
    const a=fixture(),b=fixture({hub:a.hub});let c;try{
      const control=a.s.getElementById('other-hide-ended-courses');assert(!control.checked);control.checked=true;control.dispatchEvent(new a.w.Event('change'));assert.equal(a.storage.get('cx_other_features').hideEndedCourses,true);assert(b.s.getElementById('other-hide-ended-courses').checked);
      c=fixture({hub:a.hub});assert(c.s.getElementById('other-hide-ended-courses').checked);control.checked=false;control.dispatchEvent(new a.w.Event('change'));assert(!b.s.getElementById('other-hide-ended-courses').checked);assert(!c.s.getElementById('other-hide-ended-courses').checked);assertNoErrors(a);assertNoErrors(b);assertNoErrors(c);
    }finally{c?.close();b.close();a.close();}
  });
  await check('其他功能持久化与跨实例同步无写入循环，全隐藏不取消功能配置',async()=>{
    const a=fixture(),b=fixture({hub:a.hub});let c;try{
      const writes=a.hub.writes,hide=a.s.getElementById('other-hide-platform-ai'),keep=a.s.getElementById('other-keep-video-playing');hide.checked=true;hide.dispatchEvent(new a.w.Event('change'));keep.checked=true;keep.dispatchEvent(new a.w.Event('change'));assert.equal(a.hub.writes,writes+2);assert(b.s.getElementById('other-hide-platform-ai').checked);assert(b.s.getElementById('other-keep-video-playing').checked);a.menus.get('隐藏助手全部界面')();assert.equal(a.storage.get('cx_other_features').keepVideoPlaying,true);c=fixture({hub:a.hub});assert(c.s.getElementById('other-hide-platform-ai').checked);assert(c.s.getElementById('other-keep-video-playing').checked);assert.equal(c.host.style.display,'none');assertNoErrors(a);assertNoErrors(b);assertNoErrors(c);
    }finally{c?.close();b.close();a.close();}
  });
  await check('全隐藏菜单隐藏主面板、悬浮球及测验工具栏，显示后保留内容和位置',async()=>{
    const f=fixture();try {
      f.open('model');const view=f.panel.dataset.activeView,position=f.host.style.cssText;
      f.s.getElementById('custom-model').value='unsaved-hidden-input';f.s.getElementById('output').textContent='隐藏期间保留';
      f.menus.get('隐藏助手全部界面')();
      for(const host of [f.host,f.d.getElementById('cx-ai-toolbar')]){assert.equal(host.style.display,'none');assert.equal(host.style.getPropertyPriority('display'),'important');}
      assert.equal(f.storage.get('cx_ui_hidden'),true);f.open('questions');assert.equal(f.panel.dataset.activeView,view);
      f.s.getElementById('minimize').click();assert.equal(f.launcher.hidden,true);f.api.controller.report('运行异常','error');assert.equal(f.host.style.display,'none');
      f.menus.get('显示助手界面')();visible(f,true,false);assert.equal(f.host.style.cssText,position);assert.equal(f.d.getElementById('cx-ai-toolbar').style.display,'block');
      assert.equal(f.s.getElementById('custom-model').value,'unsaved-hidden-input');assert.equal(f.s.getElementById('output').textContent,'隐藏期间保留');assert.equal(f.storage.get('cx_ui_hidden'),false);assertNoErrors(f);
    }finally{f.close();}
  });
  await check('隐藏配置首次创建即生效，新 UI 宿主插入前已隐藏并正确恢复原样式优先级',async()=>{
    const f=fixture({storage:[['cx_ui_hidden',true]]});try {
      assert.equal(f.host.style.display,'none');assert.equal(f.d.getElementById('cx-ai-toolbar').style.display,'none');
      const node=f.d.createElement('div');node.style.setProperty('display','flex','important');f.api.registerAssistantUiHost(node);
      assert.equal(node.style.display,'none');f.d.body.append(node);f.api.registerAssistantUiHost(node);
      f.menus.get('显示助手界面')();assert.equal(node.style.display,'flex');assert.equal(node.style.getPropertyPriority('display'),'important');assertNoErrors(f);
    }finally{f.close();}
  });
  await check('跨实例隐藏同步无写入循环，刷新沿用隐藏状态，pagehide 清理监听且菜单不重复',async()=>{
    const a=fixture(),b=fixture({hub:a.hub});let c;try {
      a.api.initAssistantVisibility();assert.equal(a.menus.size,2);const writes=a.hub.writes;
      a.menus.get('隐藏助手全部界面')();assert.equal(a.hub.writes,writes+1);assert.equal(b.host.style.display,'none');
      c=fixture({hub:a.hub});assert.equal(c.host.style.display,'none');
      b.menus.get('显示助手界面')();assert.equal(a.host.style.display,'');assert.equal(c.host.style.display,'');
      a.w.dispatchEvent(new a.w.Event('pagehide'));assert(![...a.hub.listeners.values()].some(r=>r.w===a.w&&r.key==='cx_ui_hidden'));
      a.w.dispatchEvent(new a.w.Event('pageshow'));assert.equal(a.menus.size,2);assert.equal([...a.hub.listeners.values()].filter(r=>r.w===a.w&&r.key==='cx_ui_hidden').length,1);assertNoErrors(a);assertNoErrors(b);
    }finally{a.close();b.close();c?.close();}
  });
  await check('隐藏期间分析继续且不会自动弹出，完成后仍隐藏，恢复可查看答案',async()=>{
    const f=fixture();try {
      f.open();const flow=f.api.runAnswerFlow({autoPrefill:false});await until(()=>f.requests.length===1);
      f.menus.get('隐藏助手全部界面')();const task=f.api.controller.task;reply(f.requests[0]);await flow;
      assert.equal(task.status,'complete');assert.equal(f.aborts,0);assert.equal(f.host.style.display,'none');
      f.menus.get('显示助手界面')();visible(f,true,false);assert.match(f.s.getElementById('output').textContent,/悬浮状态完成/);assertNoErrors(f);
    }finally{f.close();}
  });
  await check('最小化按钮保留 SVG 和可访问名称，透明 PNG 悬浮入口初始隐藏',async()=>{
    const f=fixture();try {
      const minimize=f.s.getElementById('minimize'),close=f.s.getElementById('close');
      assert.equal(minimize.nextElementSibling,close);assert(minimize.querySelector('svg'));assert(!minimize.textContent.includes('_'));
      assert.match(minimize.getAttribute('aria-label')||minimize.title,/最小化|缩小/);
      assert.equal(f.launcher.tagName,'BUTTON');assert.equal(f.launcher.type,'button');assert(f.launcher.getAttribute('aria-label')||f.launcher.title);
      const css=[...f.s.querySelectorAll('style')].map(node=>node.textContent).join('\n'),launcherRule=css.match(/#floating-launcher\s*\{([^}]+)\}/)?.[1];
      assert(launcherRule,'交付脚本中缺少悬浮样式');assert.match(launcherRule,/border:\s*0(?:;|$)/);assert.match(launcherRule,/border-radius:\s*0(?:;|$)/);assert.match(launcherRule,/background:\s*transparent(?:;|$)/);assert.match(launcherRule,/box-shadow:\s*none(?:;|$)/);
      assert.match(launcherRule,/width:44px;height:44px/);assert.match(css,/width:min\(640px/);assert.match(css,/height:min\(540px/);
      const icon=f.launcher.querySelector('img.launcher-icon'),iconRule=css.match(/#floating-launcher \.launcher-icon\s*\{([^}]+)\}/)?.[1];
      assert(icon,'缺少透明书本 PNG');assert.match(icon.src,/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);
      assert.deepEqual(Buffer.from(icon.src.split(',')[1],'base64').subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
      assert.equal(icon.alt,'');assert.equal(icon.getAttribute('aria-hidden'),'true');assert.equal(icon.draggable,false);
      assert.match(iconRule,/width:44px;height:44px/);assert.match(iconRule,/object-fit:\s*contain/);assert.match(iconRule,/pointer-events:\s*none/);
      assert(f.launcher.hidden);assert.equal(f.requests.length,0);assertNoErrors(f);
    }finally{f.close();}
  });
  await check('最小化与恢复保留激活页、未保存输入、输出节点以及用户窗口位置尺寸',async()=>{
    const f=fixture();try {
      f.open('model');f.s.getElementById('settings-tab-developer').click();
      f.s.getElementById('custom-model').value='unsaved-window-input';const output=f.s.getElementById('output');output.textContent='保留输出内容';
      drag(f,f.s.querySelector('[data-resize=corner]'),-80,-60);drag(f,f.s.querySelector('.head'),30,20);
      const state={left:f.host.style.left,top:f.host.style.top,width:f.panel.style.width,height:f.panel.style.height,view:f.panel.dataset.activeView};
      f.s.getElementById('minimize').click();visible(f,false,true);assert.equal(f.s.getElementById('custom-model').value,'unsaved-window-input');
      f.launcher.click();visible(f,true,false);assert.equal(f.s.getElementById('output'),output);assert.equal(output.textContent,'保留输出内容');
      assert(!f.s.getElementById('settings-developer-page').hidden);assert.equal(f.s.getElementById('custom-model').value,'unsaved-window-input');
      assert.deepEqual({left:f.host.style.left,top:f.host.style.top,width:f.panel.style.width,height:f.panel.style.height,view:f.panel.dataset.activeView},state);
      assert.equal(f.requests.length,0);assertNoErrors(f);
    }finally{f.close();}
  });
  await check('普通作业页的居中 transform 在悬浮时撤销，恢复和关闭时保留原窗口样式',async()=>{
    const f=fixture();try {
      f.open();assert.match(f.host.style.transform,/translateX/);const original={left:f.host.style.left,top:f.host.style.top,transform:f.host.style.transform};
      f.s.getElementById('minimize').click();visible(f,false,true);assert.equal(f.host.style.left,'0px');assert.equal(f.host.style.top,'0px');assert.equal(f.host.style.transform,'none');
      f.launcher.click();visible(f,true,false);assert.deepEqual({left:f.host.style.left,top:f.host.style.top,transform:f.host.style.transform},original);
      f.s.getElementById('minimize').click();arrow(f,f.launcher,'Escape');visible(f,false,false);
      assert.deepEqual({left:f.host.style.left,top:f.host.style.top,transform:f.host.style.transform},original);assertNoErrors(f);
    }finally{f.close();}
  });
  await check('悬浮圆心对齐最小化按钮中心，按钮坐标在隐藏面板和 host 归零前读取',async()=>{
    const f=fixture();try {
      f.open();const before={left:f.host.style.left,top:f.host.style.top,transform:f.host.style.transform},reads=[];
      f.setMinimizeRect(()=>{reads.push({left:f.host.style.left,top:f.host.style.top,transform:f.host.style.transform,hidden:f.panel.hidden});return {left:420,top:120,width:28,height:28};});
      f.s.getElementById('minimize').click();visible(f,false,true);assert.deepEqual(position(f),{left:412,top:112});
      assert.equal(position(f).left+22,420+14);assert.equal(position(f).top+22,120+14);assert.equal(reads.length,1);
      assert.deepEqual(reads[0],{...before,hidden:false});assert.equal(f.host.style.transform,'none');assert.equal(f.host.style.left,'0px');assert.equal(f.host.style.top,'0px');
      f.launcher.click();assert.deepEqual({left:f.host.style.left,top:f.host.style.top,transform:f.host.style.transform},before);assertNoErrors(f);
    }finally{f.close();}
  });
  await check('恢复并移动主窗口后再次缩小返回展开前的悬浮位置',async()=>{
    const f=fixture();try {
      f.open();f.setMinimizeRect({left:400,top:220,width:28,height:28});f.s.getElementById('minimize').click();assert.deepEqual(position(f),{left:392,top:212});
      drag(f,f.launcher,150,90);const dragged=position(f);mouseClick(f,f.launcher);visible(f,false,true);f.launcher.click();visible(f,true,false);
      drag(f,f.s.querySelector('.head'),60,40);f.setMinimizeRect({left:650,top:250,width:28,height:28});f.s.getElementById('minimize').click();
      assert.deepEqual(position(f),dragged);assertNoErrors(f);
    }finally{f.close();}
  });
  await check('最小化按钮位于视口四角时，44 像素悬浮圆仍被钳制在当前视口',async()=>{
    let f=fixture();try {
      const cases=[
        [{left:-10,top:-20,width:28,height:28},{left:0,top:0}],
        [{left:f.w.innerWidth-10,top:10,width:28,height:28},{left:f.w.innerWidth-44,top:2}],
        [{left:10,top:f.w.innerHeight-10,width:28,height:28},{left:2,top:f.w.innerHeight-44}],
        [{left:f.w.innerWidth-10,top:f.w.innerHeight-10,width:28,height:28},{left:f.w.innerWidth-44,top:f.w.innerHeight-44}]
      ];
      for(const [rect,expected]of cases){f.close();f=fixture();f.open();f.setMinimizeRect(rect);f.s.getElementById('minimize').click();assert.deepEqual(position(f),expected);visible(f,false,true);f.launcher.click();}
      assertNoErrors(f);
    }finally{f.close();}
  });
  await check('最小化按钮无可用尺寸时使用主窗口右上区域作锚点，产生有限且可恢复的位置',async()=>{
    const f=fixture();try {
      f.open();drag(f,f.s.querySelector('.head'),60,40);const box=f.panel.getBoundingClientRect();f.setMinimizeRect({left:0,top:0,width:0,height:0});
      f.s.getElementById('minimize').click();const p=position(f);assert(Number.isFinite(p.left)&&Number.isFinite(p.top));
      assert(p.left>=box.left+box.width/2&&p.left+44<=f.w.innerWidth);assert(p.top>=0&&p.top<box.top+80);f.launcher.click();visible(f,true,false);assertNoErrors(f);
    }finally{f.close();}
  });
  await check('关闭与 Escape 隐藏主面板和悬浮入口，外部 openPanel 可再次正常打开',async()=>{
    const f=fixture();try {
      f.open();f.s.getElementById('close').click();visible(f,false,false);f.open();visible(f,true,false);
      arrow(f,f.panel,'Escape');visible(f,false,false);f.open();f.s.getElementById('minimize').click();visible(f,false,true);
      arrow(f,f.launcher,'Escape');visible(f,false,false);f.open('questions');visible(f,true,false);
      assert.equal(f.panel.dataset.activeView,'questions');assert.equal(f.requests.length,0);assertNoErrors(f);
    }finally{f.close();}
  });
  await check('controller.openPanel 从最小化恢复，可指定页面且不会产生第二个悬浮入口',async()=>{
    const f=fixture();try {
      f.open('model');f.s.getElementById('minimize').click();f.open('questions');visible(f,true,false);
      assert.equal(f.panel.dataset.activeView,'questions');f.s.getElementById('minimize').click();f.open();visible(f,true,false);
      assert.equal(f.s.querySelectorAll('#floating-launcher').length,1);assert.equal(f.requests.length,0);assertNoErrors(f);
    }finally{f.close();}
  });
  await check('原题目工具栏从最小化恢复，而不是隐藏全部或创建重复面板',async()=>{
    const f=fixture();try {
      f.open();f.s.getElementById('minimize').click();const toolbar=f.d.getElementById('cx-ai-toolbar').shadowRoot;
      toolbar.getElementById('settings').click();visible(f,true,false);assert.equal(toolbar.getElementById('settings').getAttribute('aria-expanded'),'true');
      assert.equal(f.d.querySelectorAll('#cx-ai-study-root').length,1);assert.equal(f.requests.length,0);assertNoErrors(f);
    }finally{f.close();}
  });
  await check('悬浮按钮普通点击恢复；轻微指针移动仍保留点击行为',async()=>{
    const f=fixture();try {
      f.open();f.s.getElementById('minimize').click();pointer(f,f.launcher,'pointerdown',20,20);pointer(f,f.launcher,'pointermove',21,21);pointer(f,f.launcher,'pointerup',21,21);
      f.launcher.click();visible(f,true,false);f.s.getElementById('minimize').click();f.launcher.click();visible(f,true,false);assertNoErrors(f);
    }finally{f.close();}
  });
  await check('悬浮按钮拖动后抑制一次误点击，后续点击可恢复',async()=>{
    const f=fixture();try {
      f.open();f.s.getElementById('minimize').click();const before=position(f);drag(f,f.launcher,-80,30);const after=position(f);
      assert(after.left!==before.left||after.top!==before.top);mouseClick(f,f.launcher);visible(f,false,true);mouseClick(f,f.launcher);visible(f,true,false);assertNoErrors(f);
    }finally{f.close();}
  });
  await check('悬浮拖动被视口钳制，不匹配的指针事件不会移动入口',async()=>{
    const f=fixture();try {
      f.open();f.s.getElementById('minimize').click();pointer(f,f.launcher,'pointerdown',100,100,7);const before=position(f);
      pointer(f,f.launcher,'pointermove',10000,10000,8);assert.deepEqual(position(f),before);
      pointer(f,f.launcher,'pointermove',10000,10000,7);pointer(f,f.launcher,'pointerup',10000,10000,7);
      let p=position(f);assert(p.left>=0&&p.left+44<=f.w.innerWidth);assert(p.top>=0&&p.top+44<=f.w.innerHeight);
      drag(f,f.launcher,-10000,-10000);p=position(f);assert(p.left>=0&&p.top>=0);assertNoErrors(f);
    }finally{f.close();}
  });
  await check('指针取消及捕获丢失后停止拖动，不因后续 move 残留拖拽状态',async()=>{
    const f=fixture();try {
      f.open();f.s.getElementById('minimize').click();drag(f,f.launcher,-40,0,1,'pointercancel');let p=position(f);
      pointer(f,f.launcher,'pointermove',300,300,1);assert.deepEqual(position(f),p);
      pointer(f,f.launcher,'pointerdown',100,100,2);const lost=new f.w.Event('lostpointercapture');Object.defineProperty(lost,'pointerId',{value:2});f.launcher.dispatchEvent(lost);p=position(f);
      pointer(f,f.launcher,'pointermove',400,400,2);assert.deepEqual(position(f),p);assertNoErrors(f);
    }finally{f.close();}
  });
  await check('方向键微调悬浮入口位置并受视口限制',async()=>{
    const f=fixture();try {
      f.open();f.s.getElementById('minimize').click();drag(f,f.launcher,-180,-120);mouseClick(f,f.launcher);visible(f,false,true);const initial=position(f);
      arrow(f,f.launcher,'ArrowLeft');let p=position(f);assert(p.left<initial.left);assert.equal(p.top,initial.top);
      arrow(f,f.launcher,'ArrowUp');assert(position(f).top<p.top);p=position(f);arrow(f,f.launcher,'ArrowRight');assert(position(f).left>p.left);
      p=position(f);arrow(f,f.launcher,'ArrowDown');assert(position(f).top>p.top);
      for(let i=0;i<200;i++)arrow(f,f.launcher,'ArrowLeft');assert(position(f).left>=0);assertNoErrors(f);
    }finally{f.close();}
  });
  await check('最小化时视口 resize 重新钳制悬浮入口，不修改保留的窗口尺寸',async()=>{
    const f=fixture();try {
      f.open();drag(f,f.s.querySelector('[data-resize=corner]'),-80,-60);f.s.getElementById('minimize').click();drag(f,f.launcher,10000,10000);
      const dimensions={width:f.panel.style.width,height:f.panel.style.height};
      Object.defineProperty(f.w,'innerWidth',{value:240,configurable:true});Object.defineProperty(f.w,'innerHeight',{value:180,configurable:true});f.w.dispatchEvent(new f.w.Event('resize'));
      const p=position(f);assert(p.left>=0&&p.left+44<=240);assert(p.top>=0&&p.top+44<=180);
      assert.deepEqual({width:f.panel.style.width,height:f.panel.style.height},dimensions);assert(f.panel.hidden);assertNoErrors(f);
    }finally{f.close();}
  });
  await check('悬浮位置单独保存，拖动入口不覆盖用户主窗口位置',async()=>{
    const f=fixture();try {
      f.open();drag(f,f.s.querySelector('.head'),55,35);const mainPosition={left:f.host.style.left,top:f.host.style.top};
      f.s.getElementById('minimize').click();drag(f,f.launcher,-90,60);mouseClick(f,f.launcher);f.launcher.click();visible(f,true,false);
      assert.deepEqual({left:f.host.style.left,top:f.host.style.top},mainPosition);assertNoErrors(f);
    }finally{f.close();}
  });
  await check('AI 请求等待期间最小化不取消或重发，完成保持悬浮并在恢复后展示同一结果',async()=>{
    const f=fixture();try {
      f.open('questions');const flow=f.api.runAnswerFlow({autoPrefill:false});await until(()=>f.requests.length===1,'没有产生模拟 AI 请求');
      const task=f.api.controller.task;assert(f.api.controller.state.busy);f.s.getElementById('minimize').click();visible(f,false,true);
      assert.equal(f.api.controller.task,task);assert(f.api.controller.state.busy);assert.equal(f.aborts,0);reply(f.requests[0]);await flow;
      visible(f,false,true);assert.equal(f.requests.length,1);assert.equal(f.aborts,0);assert.equal(f.api.controller.task,task);assert.equal(task.status,'complete');
      f.launcher.click();visible(f,true,false);assert.match(f.s.getElementById('output').textContent,/悬浮状态完成的模拟答案/);assert.equal(f.d.querySelector('textarea').value,'');assertNoErrors(f);
    }finally{f.close();}
  });
  await check('关闭仅影响窗口显示，待完成 AI 请求继续且重新打开不会重发',async()=>{
    const f=fixture();try {
      f.open();const flow=f.api.runAnswerFlow({autoPrefill:false});await until(()=>f.requests.length===1);f.s.getElementById('close').click();visible(f,false,false);
      assert.equal(f.aborts,0);reply(f.requests[0]);await flow;visible(f,false,false);f.open();visible(f,true,false);
      assert.equal(f.requests.length,1);assert.equal(f.api.controller.task.status,'complete');assertNoErrors(f);
    }finally{f.close();}
  });

  await check('跨iframe全隐藏同步：父子宿主与新建测验均隐藏，菜单恢复当前子面板',async()=>{
    const n=await nestedFixture();try {
      n.f.menus.get('隐藏助手全部界面')();const child=n.initializeChild();assert.equal(n.f.menus.size,2);
      for(const host of [n.f.d.getElementById('cx-ai-study-root'),n.f.d.getElementById('cx-ai-study-toolbar'),child.host,child.doc.getElementById('cx-ai-toolbar')])assert.equal(host.style.display,'none');
      child.api.controller.openPanel('questions');assert.equal(child.host.ownerDocument,child.doc);assert(child.s.getElementById('panel').hidden);
      n.f.menus.get('显示助手界面')();assert.equal(child.host.ownerDocument,n.f.d);assertSingleWindow(n,child.host,'panel');assert.equal(child.host.style.display,'');assert.equal(n.f.d.getElementById('cx-ai-study-toolbar').style.display,'flex');assert.deepEqual(n.errors,[]);
    }finally{await n.close();}
  });
  await check('全隐藏清除停止确认倒计时，恢复后仍须重新两次确认',async()=>{
    const n=await nestedFixture();try {
      n.parent.getElementById('course-start').click();await until(()=>n.f.runner.busy);const stop=n.parent.getElementById('course-stop');stop.click();assert.match(stop.textContent,/确认停止/);
      n.f.menus.get('隐藏助手全部界面')();assert.equal(stop.textContent,'停止');assert(n.f.runner.busy);n.f.menus.get('显示助手界面')();stop.click();assert(n.f.runner.busy);assert.match(stop.textContent,/确认停止/);stop.click();await until(()=>n.f.runner.report.status==='stopped');assert(!n.f.runner.busy);assert.deepEqual(n.errors,[]);
    }finally{await n.close();}
  });
  await check('全隐藏期间取消悬浮拖动，恢复后旧move不再移动位置',async()=>{
    const f=fixture();try {
      f.open();f.s.getElementById('minimize').click();pointer(f,f.launcher,'pointerdown',100,100);const before=position(f);f.menus.get('隐藏助手全部界面')();f.menus.get('显示助手界面')();
      pointer(f,f.launcher,'pointermove',250,200);assert.deepEqual(position(f),before);assertNoErrors(f);
    }finally{f.close();}
  });
  for(const action of ['launcher','toolbar'])await check(`自动学习运行中最小化后由${action==='launcher'?'悬浮按钮':'课程工具栏'}恢复，不停止或重复启动视频`,async()=>{
    const errors=[],dom=courseFixtureDOM('https://offline-demo.invalid/course-demo.html?scene=no-task',errors);
    let f;try {
      await until(()=>dom.window.courseDemo,'离线课程未初始化');f=dom.window.courseDemo;
      const s=f.d.getElementById('cx-ai-study-root').shadowRoot,panel=s.getElementById('panel'),launcher=s.getElementById('floating-launcher');assert(launcher,'离线课程模拟仍是旧脚本，请重建');
      s.getElementById('course-start').click();await until(()=>f.events.some(event=>event.startsWith('play:')),'模拟视频未开始');
      const runner=f.runner,report=runner.report,beforePlays=f.events.filter(event=>event.startsWith('play:')).length;
      s.getElementById('minimize').click();assert(panel.hidden&&!launcher.hidden);assert(runner.busy);assert.equal(runner.report,report);
      if(action==='launcher')launcher.click();else f.d.getElementById('cx-ai-study-toolbar').shadowRoot.getElementById('settings').click();
      assert(!panel.hidden&&launcher.hidden);assert(runner.busy);assert.equal(f.runner,runner);assert.equal(runner.report,report);assert.equal(f.events.filter(event=>event.startsWith('play:')).length,beforePlays);
      assert(!s.getElementById('video-progress-wrap').hidden);assert.equal(f.requests.length,0);assert.deepEqual(errors,[]);
    }finally{if(f){f.close();await until(()=>!f.runner.busy,'模拟 runner 停止收尾超时');await delay(20);}dom.window.close();}
  });

  for(const action of ['toolbar','controller'])await check(`父课程面板最小化后由子测验${action==='toolbar'?'工具栏':'controller.openPanel'}接管，父悬浮关闭且只有子主窗口`,async()=>{
    const n=await nestedFixture();try {
      const child=n.initializeChild();n.parent.getElementById('minimize').click();assertSingleWindow(n,n.f.d.getElementById('cx-ai-study-root'),'floating');
      if(action==='toolbar')child.doc.getElementById('cx-ai-toolbar').shadowRoot.getElementById('settings').click();else child.api.controller.openPanel('questions');
      assert.equal(child.host.ownerDocument,n.f.d,'子面板须迁移到课程 owner document');assertSingleWindow(n,child.host,'panel');
      assert(n.parent.getElementById('panel').hidden&&n.parent.getElementById('floating-launcher').hidden);assert.equal(child.requests.length,0);assert.deepEqual(n.errors,[]);
    }finally{await n.close();}
  });
  await check('子测验已迁移并最小化后，父 openPanel 接管关闭子悬浮，保持各自页面状态',async()=>{
    const n=await nestedFixture();try {
      const child=n.initializeChild();child.api.controller.openPanel('model');child.s.getElementById('settings-tab-developer').click();child.s.getElementById('minimize').click();assertSingleWindow(n,child.host,'floating');
      n.f.api.controller.openPanel('chapters');assertSingleWindow(n,n.f.d.getElementById('cx-ai-study-root'),'panel');
      assert(child.s.getElementById('panel').hidden&&child.s.getElementById('floating-launcher').hidden);assert(!child.s.getElementById('settings-developer-page').hidden);
      child.api.controller.openPanel();assertSingleWindow(n,child.host,'panel');assert(!child.s.getElementById('settings-developer-page').hidden);assert.deepEqual(n.errors,[]);
    }finally{await n.close();}
  });
  await check('迁移到父课程页的子面板按 owner 视口内按钮位置缩小，并在 host 归零前取坐标',async()=>{
    const n=await nestedFixture();try {
      const child=n.initializeChild();Object.defineProperty(n.f.w,'innerWidth',{value:640,configurable:true});Object.defineProperty(n.f.w,'innerHeight',{value:400,configurable:true});
      child.api.controller.openPanel('questions');assert.equal(child.host.ownerDocument,n.f.d);const original={left:child.host.style.left,top:child.host.style.top,transform:child.host.style.transform},reads=[];
      child.s.getElementById('floating-launcher').getBoundingClientRect=()=>({left:0,top:0,width:44,height:44});
      child.s.getElementById('minimize').getBoundingClientRect=()=>{reads.push({left:child.host.style.left,top:child.host.style.top,transform:child.host.style.transform,hidden:child.s.getElementById('panel').hidden});return {left:620,top:390,width:28,height:28};};
      child.s.getElementById('minimize').click();assertSingleWindow(n,child.host,'floating');
      assert.deepEqual({left:parseFloat(child.s.getElementById('floating-launcher').style.left),top:parseFloat(child.s.getElementById('floating-launcher').style.top)},{left:596,top:356});
      assert.deepEqual(reads,[{...original,hidden:false}]);child.s.getElementById('floating-launcher').click();assertSingleWindow(n,child.host,'panel');assert.deepEqual(n.errors,[]);
    }finally{await n.close();}
  });
  await check('父子交替最小化始终只有一个悬浮入口，隐藏面板按钮不能重新抢占显示',async()=>{
    const n=await nestedFixture();try {
      const child=n.initializeChild();child.api.controller.openPanel();n.f.api.controller.openPanel('chapters');n.parent.getElementById('minimize').click();
      const parentHost=n.f.d.getElementById('cx-ai-study-root');assertSingleWindow(n,parentHost,'floating');child.s.getElementById('minimize').click();assertSingleWindow(n,parentHost,'floating');
      child.api.controller.openPanel();child.s.getElementById('minimize').click();assertSingleWindow(n,child.host,'floating');
      assert(n.parent.getElementById('panel').hidden&&n.parent.getElementById('floating-launcher').hidden);
      n.f.api.controller.openPanel();n.parent.getElementById('minimize').click();assertSingleWindow(n,parentHost,'floating');assert.deepEqual(n.errors,[]);
    }finally{await n.close();}
  });
  await check('子 AI 请求期间父窗口接管不 abort、不重发；完成不重新抢占父窗口',async()=>{
    const n=await nestedFixture();try {
      const child=n.initializeChild();child.api.controller.openPanel('questions');const flow=child.api.runAnswerFlow({autoPrefill:false});await until(()=>child.requests.length===1,'子测验未产生模拟 AI 请求');
      const task=child.api.controller.task;child.s.getElementById('minimize').click();n.f.api.controller.openPanel('chapters');assertSingleWindow(n,n.f.d.getElementById('cx-ai-study-root'),'panel');
      assert.equal(child.api.controller.task,task);assert(child.api.controller.state.busy);assert.equal(child.aborts,0);reply(child.requests[0]);await flow;
      assert.equal(child.requests.length,1);assert.equal(child.aborts,0);assert.equal(task.status,'complete');assertSingleWindow(n,n.f.d.getElementById('cx-ai-study-root'),'panel');
      child.api.controller.openPanel('questions');assertSingleWindow(n,child.host,'panel');assert.match(child.s.getElementById('output').textContent,/悬浮状态完成的模拟答案/);assert.deepEqual(n.errors,[]);
    }finally{await n.close();}
  });
  await check('父课程后台播放时子窗口接管只切换显示，运行任务与播放次数保持不变',async()=>{
    const n=await nestedFixture();try {
      n.parent.getElementById('course-start').click();await until(()=>n.f.events.some(event=>event.startsWith('play:')),'父视频未开始');
      const child=n.initializeChild(),runner=n.f.runner,report=runner.report,plays=n.f.events.filter(event=>event.startsWith('play:')).length;
      n.parent.getElementById('minimize').click();child.api.controller.openPanel('questions');assertSingleWindow(n,child.host,'panel');
      assert(runner.busy);assert.equal(runner.report,report);assert.equal(n.f.runner,runner);assert.equal(n.f.events.filter(event=>event.startsWith('play:')).length,plays);
      assert.equal(child.requests.length,0);assert.equal(n.f.requests.length,0);assert.deepEqual(n.errors,[]);
    }finally{await n.close();}
  });
}
main().then(()=>{
  for(const failure of failures)console.error(`FAIL ${failure}`);
  console.log(`Panel window checks: ${logs.length} passed, ${failures.length} failed`);if(failures.length)process.exitCode=1;
}).catch(error=>{console.error(error.stack);process.exitCode=1;});
