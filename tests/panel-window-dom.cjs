const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const {webcrypto} = require('node:crypto');
const {policyInput,respondPolicy}=require('./answer-policy-mock.cjs');
const classificationRequests=[];
const {JSDOM, VirtualConsole} = createRequire(path.join(__dirname, '../package.json'))('jsdom');

// Exercise the generated script rather than rebuilding an imitation of the window state.
const source = fs.readFileSync(path.join(__dirname, '../学习通AI助手.user.js'), 'utf8').replace(/\r\n/g, '\n');
const entry = "    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startQuizObserver, { once: true });\n    else startQuizObserver();";
assert(source.includes(entry), '候选脚本入口定位失败');
const instrumented = source.replace(entry, `globalThis.windowTestAPI={initQuizAssistant,runAnswerFlow,initAssistantVisibility,registerAssistantUiHost,setAssistantUiHidden,get controller(){return controller}};`);
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
  const hub=opts.hub || {storage,listeners:new Map(),writes:0,nextId:0},menus=new Map();
  let aborts=0;
  w.GM_getValue=(key,fallback)=>storage.has(key)?storage.get(key):fallback;
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
async function nestedFixture() {
  const console=new VirtualConsole(),errors=[];console.on('jsdomError',error=>errors.push(error.message));
  const html=fs.readFileSync(path.join(__dirname,'自动课程模拟.html'),'utf8');
  // The preview embeds a pageURL override. Real child IIFEs deliberately do not;
  // use the real route shape with mock identifiers so parent discovery is exercised.
  const dom=new JSDOM(html,{url:'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=mock-course&clazzid=mock-class&cpi=mock-account&scene=no-task',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:console});
  await until(()=>dom.window.courseDemo,'离线课程未初始化');const f=dom.window.courseDemo;
  const parent=f.d.getElementById('cx-ai-study-root').shadowRoot;
  const initializeChild=()=>{
    const doc=f.doc,w=doc.defaultView,node=doc.createElement('div');node.className='TiMu';node.setAttribute('questionid','nested-window-q1');
    node.innerHTML='<h3 class="stem">【简答题】解释嵌套测验的数据库概念</h3><textarea></textarea>';doc.body.append(node);
    const requests=[];let aborts=0;
    w.GM_getValue=(key,fallback)=>f.storage.has(key)?f.storage.get(key):fallback;
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
  return {dom,f,parent,initializeChild,active,errors,async close(){f.close();await until(()=>!f.runner.busy,'模拟 runner 停止收尾超时');await delay(20);f.w.dispatchEvent(new f.w.Event('pagehide'));f.w.close();dom.window.close();}};
}
function assertSingleWindow(n,host,kind) {
  const active=n.active();assert.equal(active.length,1,'同一课程页只能显示一个助手窗口或悬浮入口');assert.equal(active[0].host,host);assert.equal(active[0].kind,kind);
}

async function main() {
  await check('全隐藏菜单隐藏主面板、悬浮球及测验工具栏，显示后保留内容和位置',async()=>{
    const f=fixture();try {
      f.open('model');const view=f.panel.dataset.activeView,position=f.host.style.cssText;
      f.s.getElementById('ds-key').value='unsaved-hidden-input';f.s.getElementById('output').textContent='隐藏期间保留';
      f.menus.get('隐藏助手全部界面')();
      for(const host of [f.host,f.d.getElementById('cx-ai-toolbar')]){assert.equal(host.style.display,'none');assert.equal(host.style.getPropertyPriority('display'),'important');}
      assert.equal(f.storage.get('cx_ui_hidden'),true);f.open('questions');assert.equal(f.panel.dataset.activeView,view);
      f.s.getElementById('minimize').click();assert.equal(f.launcher.hidden,true);f.api.controller.report('运行异常','error');assert.equal(f.host.style.display,'none');
      f.menus.get('显示助手界面')();visible(f,true,false);assert.equal(f.host.style.cssText,position);assert.equal(f.d.getElementById('cx-ai-toolbar').style.display,'block');
      assert.equal(f.s.getElementById('ds-key').value,'unsaved-hidden-input');assert.equal(f.s.getElementById('output').textContent,'隐藏期间保留');assert.equal(f.storage.get('cx_ui_hidden'),false);assertNoErrors(f);
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
  await check('最小化按钮位于关闭左侧，使用 SVG 图标和可访问名称；悬浮入口初始隐藏',async()=>{
    const f=fixture();try {
      const minimize=f.s.getElementById('minimize'),close=f.s.getElementById('close');
      assert.equal(minimize.nextElementSibling,close);assert(minimize.querySelector('svg'));assert(!minimize.textContent.includes('_'));
      assert.match(minimize.getAttribute('aria-label')||minimize.title,/最小化|缩小/);
      assert.equal(f.launcher.tagName,'BUTTON');assert.equal(f.launcher.type,'button');assert(f.launcher.getAttribute('aria-label')||f.launcher.title);
      const css=[...f.s.querySelectorAll('style')].map(node=>node.textContent).join('\n'),launcherRule=css.match(/#floating-launcher\s*\{([^}]+)\}/)?.[1];
      assert(launcherRule,'交付脚本中缺少悬浮样式');assert.match(launcherRule,/border-radius:\s*50%/);assert.match(launcherRule,/background:\s*#d94a4a\b/i);assert.match(launcherRule,/color:\s*#fff\b/i);
      assert.match(launcherRule,/width:44px;height:44px/);assert.match(css,/width:min\(640px/);assert.match(css,/height:min\(540px/);
      assert(f.launcher.querySelector('svg path[stroke="currentColor"]'));assert(f.launcher.querySelector('svg path[fill="currentColor"]'));
      assert(f.launcher.hidden);assert.equal(f.requests.length,0);assertNoErrors(f);
    }finally{f.close();}
  });
  await check('最小化与恢复保留激活页、未保存输入、输出节点以及用户窗口位置尺寸',async()=>{
    const f=fixture();try {
      f.open('model');f.s.getElementById('settings-tab-developer').click();
      f.s.getElementById('ds-key').value='unsaved-window-input';const output=f.s.getElementById('output');output.textContent='保留输出内容';
      drag(f,f.s.querySelector('[data-resize=corner]'),-80,-60);drag(f,f.s.querySelector('.head'),30,20);
      const state={left:f.host.style.left,top:f.host.style.top,width:f.panel.style.width,height:f.panel.style.height,view:f.panel.dataset.activeView};
      f.s.getElementById('minimize').click();visible(f,false,true);assert.equal(f.s.getElementById('ds-key').value,'unsaved-window-input');
      f.launcher.click();visible(f,true,false);assert.equal(f.s.getElementById('output'),output);assert.equal(output.textContent,'保留输出内容');
      assert(!f.s.getElementById('settings-developer-page').hidden);assert.equal(f.s.getElementById('ds-key').value,'unsaved-window-input');
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
  await check('恢复并移动主窗口后再次缩小重新取按钮位置，不继承上次悬浮拖动坐标',async()=>{
    const f=fixture();try {
      f.open();f.setMinimizeRect({left:400,top:220,width:28,height:28});f.s.getElementById('minimize').click();assert.deepEqual(position(f),{left:392,top:212});
      drag(f,f.launcher,150,90);const dragged=position(f);mouseClick(f,f.launcher);visible(f,false,true);f.launcher.click();visible(f,true,false);
      drag(f,f.s.querySelector('.head'),60,40);f.setMinimizeRect({left:650,top:250,width:28,height:28});f.s.getElementById('minimize').click();
      assert.deepEqual(position(f),{left:642,top:242});assert.notDeepEqual(position(f),dragged);assertNoErrors(f);
    }finally{f.close();}
  });
  await check('最小化按钮位于视口四角时，44 像素悬浮圆仍被钳制在当前视口',async()=>{
    const f=fixture();try {
      const cases=[
        [{left:-10,top:-20,width:28,height:28},{left:0,top:0}],
        [{left:f.w.innerWidth-10,top:10,width:28,height:28},{left:f.w.innerWidth-44,top:2}],
        [{left:10,top:f.w.innerHeight-10,width:28,height:28},{left:2,top:f.w.innerHeight-44}],
        [{left:f.w.innerWidth-10,top:f.w.innerHeight-10,width:28,height:28},{left:f.w.innerWidth-44,top:f.w.innerHeight-44}]
      ];
      for(const [rect,expected]of cases){f.open();f.setMinimizeRect(rect);f.s.getElementById('minimize').click();assert.deepEqual(position(f),expected);visible(f,false,true);f.launcher.click();}
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
    const console=new VirtualConsole(),errors=[];console.on('jsdomError',error=>errors.push(error.message));
    const html=fs.readFileSync(path.join(__dirname,'自动课程模拟.html'),'utf8');
    const dom=new JSDOM(html,{url:'https://offline-demo.invalid/course-demo.html?scene=no-task',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:console});
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
