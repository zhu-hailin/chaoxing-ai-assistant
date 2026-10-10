const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'自动课程模拟.html'),'utf8');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const logs=[],failures=[];
(async()=>{
 for(const mode of ['layout','running']){
  let dom;const label=mode==='layout'?'章节双页：默认学习控制、右侧目录数据、键盘切换和状态保留':'运行中切换章节双页不重复启动，仍可返回停止';
  try{
   const errors=[],console=new VirtualConsole();console.on('jsdomError',e=>errors.push(e.message));
   dom=new JSDOM(html,{url:'https://offline-demo.invalid/course-demo.html?scene=no-task',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:console});
   const w=dom.window;for(let i=0;i<100&&!w.courseDemo;i++)await delay(10);
   const f=w.courseDemo,s=w.document.getElementById('cx-ai-study-root').shadowRoot,run=s.getElementById('chapter-run-page'),catalog=s.getElementById('chapter-catalog-page');
   assert(!run.hidden&&catalog.hidden);assert(run.contains(s.getElementById('course-start')));assert(!run.contains(s.getElementById('course-report')));assert(s.getElementById('settings-developer-page').contains(s.getElementById('course-report')));
   for(const id of ['catalog-search','catalog-status','catalog-list'])assert(catalog.contains(s.getElementById(id)));
   assert(s.getElementById('catalog-refresh').hidden);
   if(mode==='running'){
    s.getElementById('course-start').click();for(let i=0;i<80&&s.getElementById('video-progress-wrap').hidden;i++)await delay(10);
    assert(f.runner.busy);assert(!s.getElementById('video-progress-wrap').hidden);
    const progress=s.getElementById('video-progress'),v=f.videos[f.videos.length-1];assert.equal(progress.max,v.duration);assert(progress.value>=0&&progress.value<=v.currentTime);
   }
   s.getElementById('chapter-tab-catalog').click();assert(run.hidden&&!catalog.hidden);assert(!s.getElementById('catalog-refresh').hidden);assert.equal(s.getElementById('chapter-tab-catalog').getAttribute('aria-selected'),'true');
   const search=s.getElementById('catalog-search');search.value='后续';search.dispatchEvent(new w.Event('input'));assert(s.getElementById('catalog-list').textContent.includes('后续视频'));
   s.getElementById('chapter-tab-catalog').dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));assert(!run.hidden&&catalog.hidden);assert.equal(s.activeElement.id,'chapter-tab-run');
   if(mode==='running'){
    assert(f.runner.busy);assert.equal(f.events.filter(x=>x.startsWith('play:')).length,1);s.getElementById('course-stop').click();
    for(let i=0;i<50&&f.runner.report?.status==='running';i++)await delay(10);assert(!f.runner.busy);assert.equal(f.runner.report.status,'stopped');assert(s.getElementById('video-progress-wrap').hidden);
   }else assert.equal(f.requests.length,0);
   s.getElementById('chapter-tab-run').dispatchEvent(new w.KeyboardEvent('keydown',{key:'End',bubbles:true}));assert(!catalog.hidden);assert.equal(search.value,'后续');
   s.getElementById('nav-questions').click();s.getElementById('nav-chapters').click();assert(!catalog.hidden);assert.equal(s.getElementById('course-nav').dataset.activeView,'catalog');
   assert.deepEqual(errors,[]);logs.push(`PASS ${label}`);
  }catch(error){failures.push(`${label}: ${error.stack}`);}finally{if(dom?.window.courseDemo?.runner.report?.status==='running'){dom.window.courseDemo.runner.stop();await delay(200);}dom?.window.courseDemo?.close();dom?.window.close();}
 }
 for(const mode of ['idle','running']){
  let dom;const label=mode==='idle'?'设置双页：齿轮入口、键盘切换、配置入口与报告复制':'运行中浏览设置与开发者报告：保留视频进度且不重复启动';
  try{
   const errors=[],console=new VirtualConsole();console.on('jsdomError',e=>errors.push(e.message));
   dom=new JSDOM(html,{url:'https://offline-demo.invalid/course-demo.html?scene=normal',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:console});
   const w=dom.window;for(let i=0;i<100&&!w.courseDemo;i++)await delay(10);
   const f=w.courseDemo,s=w.document.getElementById('cx-ai-study-root').shadowRoot,model=s.getElementById('settings-model-page'),developer=s.getElementById('settings-developer-page'),nav=s.getElementById('nav-model');
   assert.equal(nav.getAttribute('aria-label'),'设置');assert(nav.querySelector('svg circle'));assert.equal(s.getElementById('chapter-tab-run').textContent,'自动刷课');assert(model.contains(s.getElementById('ds-key')));assert(developer.contains(s.getElementById('course-copy-report')));assert(!s.getElementById('chapter-run-page').contains(s.getElementById('course-copy-report')));assert(developer.hidden&&!model.hidden);
   if(mode==='running'){s.getElementById('course-start').click();for(let i=0;i<80&&s.getElementById('video-progress-wrap').hidden;i++)await delay(10);assert(f.runner.busy);}
   nav.click();assert(!s.getElementById('view-model').hidden);assert(!model.hidden&&developer.hidden);const input=s.getElementById('ds-key'),value=input.value;
   s.getElementById('settings-tab-model').dispatchEvent(new w.KeyboardEvent('keydown',{key:'End',bubbles:true}));assert(model.hidden&&!developer.hidden);assert.equal(s.activeElement.id,'settings-tab-developer');assert.equal(s.getElementById('settings-tab-developer').getAttribute('aria-selected'),'true');
   let copied;Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async text=>{copied=text}},configurable:true});s.getElementById('course-copy-report').click();await delay(5);assert.equal(copied,f.api.courseReportText(f.runner.report));assert(!copied.includes('mock-preview-key'));
   s.getElementById('nav-questions').click();nav.click();assert(!developer.hidden);s.getElementById('close').click();f.api.controller.openPanel();assert(!developer.hidden);
   s.getElementById('settings-tab-developer').dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));assert(!model.hidden&&developer.hidden);assert.equal(input.value,value);assert.equal(s.activeElement.id,'settings-tab-model');
   s.getElementById('settings-tab-developer').click();f.api.controller.openPanel('model');assert(!model.hidden&&developer.hidden);
   if(mode==='running'){assert(input.disabled);assert(f.runner.busy);assert.equal(f.events.filter(e=>e.startsWith('play:')).length,1);assert(!s.getElementById('video-progress-wrap').hidden);s.getElementById('nav-chapters').click();s.getElementById('course-stop').click();for(let i=0;i<50&&f.runner.report?.status==='running';i++)await delay(10);assert(!f.runner.busy);assert.equal(f.runner.report.status,'stopped');assert(s.getElementById('video-progress-wrap').hidden);assert(!input.disabled);}
   assert.equal(f.requests.length,0);assert.deepEqual(errors,[]);logs.push(`PASS ${label}`);
  }catch(error){failures.push(`${label}: ${error.stack}`);}finally{if(dom?.window.courseDemo?.runner.report?.status==='running'){dom.window.courseDemo.runner.stop();await delay(200);}dom?.window.courseDemo?.close();dom?.window.close();}
 }
 for(const mode of ['progress','resize']){
  let dom;const label=mode==='progress'?'视频进度：秒数钳制、未知时长隐藏、非视频和结束隐藏':'窗口尺寸：边缘与角落拖拽、最小值、视口限制、键盘和重新打开';
  try{
   dom=new JSDOM(html,{url:'https://offline-demo.invalid/course-demo.html?scene=no-task',runScripts:'dangerously',pretendToBeVisual:true});
   const w=dom.window;for(let i=0;i<100&&!w.courseDemo;i++)await delay(10);
   const f=w.courseDemo,s=w.document.getElementById('cx-ai-study-root').shadowRoot;
   if(mode==='progress'){
    const lease=w.document.createElement('div');lease.id='cx-ai-course-lease';lease.setAttribute('data-run-id','mock-progress');w.document.body.append(lease);
    const draw=(phase,elapsed,duration)=>{lease.setAttribute('data-phase',phase);lease.setAttribute('data-video-current',elapsed);lease.setAttribute('data-video-duration',duration);w.document.dispatchEvent(new w.Event('cx-ai-course-update'));};
    const bar=s.getElementById('video-progress'),wrap=s.getElementById('video-progress-wrap');
    draw('course-video','536','672');assert(!wrap.hidden);assert.equal(bar.max,672);assert.equal(bar.value,536);assert.equal(s.getElementById('video-progress-text').textContent,'79%');assert.match(bar.getAttribute('aria-valuetext'),/536 \/ 672/);
    draw('course-video','900','672');assert.equal(bar.value,672);draw('course-video','-1','672');assert.equal(bar.value,0);
    for(const duration of ['NaN','Infinity','0','-5','']){draw('course-video','2',duration);assert(wrap.hidden);}
    draw('course-document','2','672');assert(wrap.hidden);draw('course-video','536','672');s.getElementById('chapter-tab-catalog').click();assert(!wrap.hidden);
    lease.remove();w.document.dispatchEvent(new w.Event('cx-ai-course-update'));assert(wrap.hidden);assert.equal(bar.value,0);
   }else{
    const panel=s.getElementById('panel'),host=w.document.getElementById('cx-ai-study-root');
    const rect=()=>({left:parseFloat(host.style.left)||40,top:parseFloat(host.style.top)||30,width:parseFloat(panel.style.width)||720,height:parseFloat(panel.style.height)||500});
    panel.getBoundingClientRect=rect;host.getBoundingClientRect=rect;
    const drag=(dir,dx,dy,cancel=false)=>{const handle=s.querySelector(`[data-resize="${dir}"]`);for(const [type,x,y]of [['pointerdown',0,0],['pointermove',dx,dy],[cancel?'pointercancel':'pointerup',dx,dy]]){const e=new w.MouseEvent(type,{button:0,clientX:x,clientY:y,bubbles:true});Object.defineProperty(e,'pointerId',{value:1});handle.dispatchEvent(e);}};
    drag('corner',-100,-100);assert.equal(panel.style.width,'620px');assert.equal(panel.style.height,'400px');
    drag('right',40,200);assert.equal(panel.style.width,'660px');assert.equal(panel.style.height,'400px');
    drag('bottom',200,50);assert.equal(panel.style.width,'660px');assert.equal(panel.style.height,'450px');
    drag('corner',-10000,-10000,true);assert.equal(panel.style.width,'320px');assert.equal(panel.style.height,'260px');
    s.querySelector('[data-resize=corner]').dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.equal(panel.style.width,'330px');
    s.getElementById('close').click();f.api.controller.openPanel('chapters');assert.equal(panel.style.width,'330px');
    drag('corner',10000,10000);const box=rect();assert(box.left+box.width<=w.innerWidth);assert(box.top+box.height<=w.innerHeight);
    Object.defineProperty(w,'innerWidth',{value:375,configurable:true});w.dispatchEvent(new w.Event('resize'));assert(parseFloat(panel.style.width)<=349);
   }
   assert.equal(f.requests.length,0);logs.push(`PASS ${label}`);
  }catch(error){failures.push(`${label}: ${error.stack}`);}finally{if(dom?.window.courseDemo?.runner.report?.status==='running'){dom.window.courseDemo.runner.stop();await delay(200);}dom?.window.courseDemo?.close();dom?.window.close();}
 }
 for(const [scene,label]of [['normal','完整交互模拟：开始、视频、PPT、提交、下一目录、最终报告'],['face','交互模拟：人脸识别停止并保留验证层'],['unanswered','交互模拟：无法自动作答显示题号报告'],['survey','交互模拟：跳过问卷继续视频'],['no-task','交互模拟：无任务点资料直接下一节']]){
  let dom;
  try{
   const errors=[];const console=new VirtualConsole();console.on('jsdomError',error=>errors.push(error.message));
   dom=new JSDOM(html,{url:`https://offline-demo.invalid/course-demo.html?scene=${scene}`,runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:console});
   const w=dom.window;for(let i=0;i<100&&!w.courseDemo;i++)await delay(10);
   assert(w.courseDemo,'离线页面未初始化');const f=w.courseDemo,s=w.document.getElementById('cx-ai-study-root').shadowRoot;
   assert.equal(s.getElementById('panel').dataset.activeView,'chapters');assert(!s.getElementById('course-start').disabled);
   assert.equal(f.requests.length,0,'预览自行开始或发起请求');s.getElementById('course-start').click();
   if(scene==='survey'){await delay(100);assert(!s.getElementById('course-skip').disabled);s.getElementById('course-skip').click();}
   for(let i=0;i<200;i++){await delay(100);if(!f.runner.busy)break;}
   assert(!f.runner.busy,'预览流程超时');const report=f.runner.report;
   assert.equal(report.status,['normal','survey','no-task'].includes(scene)?'done':'stopped');assert(s.getElementById('settings-developer-page').hidden,'结束后不应自动切换开发者模式');assert(s.getElementById('view-model').hidden);
   if(scene==='normal'){assert.equal(report.videos,3);assert.equal(report.quizzes,1);assert.equal(report.documents,1);assert.equal(report.chapters.length,3);assert(s.getElementById('course-report').textContent.includes('全部流程完成'));}
   if(scene==='face'){assert.match(report.reason,/人脸识别/);assert(f.doc.querySelector('.chapterVideoFaceMaskDiv'));}
   if(scene==='unanswered'){assert(s.getElementById('course-report').textContent.includes('第 1 题'));assert.equal(f.submits,0);}
   if(scene==='survey'){assert.equal(report.chapters[0].status,'skipped');assert.equal(report.videos,1);assert(s.getElementById('course-report').textContent.includes('用户跳过'));}
   if(scene==='no-task'){assert.equal(report.chapters[0].status,'no-tasks');assert.equal(report.documents,0);assert.equal(report.videos,1);}
   assert.equal(errors.length,0,errors.join('\n'));logs.push(`PASS ${label}`);
  }catch(error){failures.push(`${label}: ${error.stack}`);}finally{if(dom?.window.courseDemo?.runner.report?.status==='running'){dom.window.courseDemo.runner.stop();await delay(200);}dom?.window.courseDemo?.close();dom?.window.close();}
 }
 const report={total:logs.length+failures.length,failures,logs};console.log(JSON.stringify(report,null,2));fs.writeFileSync(path.join(__dirname,'course-preview-results.json'),JSON.stringify(report,null,2));process.exitCode=failures.length?1:0;
})().catch(error=>{console.error(error);process.exitCode=1;});
