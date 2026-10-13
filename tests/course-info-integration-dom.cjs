const {policyInput,respondPolicy}=require('./answer-policy-mock.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),Module=require('node:module');
// 复用现有脱敏课程夹具，严格截断测试 IIFE，绝不执行其结果文件写入。
const fixturePath=path.join(__dirname,'course-runner-dom.cjs');
const fixtureSource=fs.readFileSync(fixturePath,'utf8').replace(/\r\n/g,'\n');
const boundary=fixtureSource.indexOf('\n(async()=>{');
assert(boundary>0,'课程夹具边界不存在，停止而不是执行完整测试文件');
let prefix=fixtureSource.slice(0,boundary);
assert(!prefix.includes('writeFileSync')&&!prefix.includes('\n(async()=>{'),'不得执行旧测试 IIFE 或文件写入');
const exportAnchor='globalThis.courseAPI={';
assert.equal(prefix.split(exportAnchor).length,2,'课程 API 导出入口必须唯一');
prefix=prefix.replace(exportAnchor,'globalThis.courseAPI={captureCurrentCourseContext,chapterContextIdentity,chapterContextStore,readModelConfiguration,createCourseVideoInfo,');
const videoAnchor='videos.push(video);';
assert.equal(prefix.split(videoAnchor).length,2);
prefix=prefix.replace(videoAnchor,`videos.push(video);
    Object.defineProperty(video,'textTracks',{value:task.subtitles?[{kind:'subtitles',label:'模拟字幕',cues:task.subtitles.map(text=>({text}))}]:[]});
    if(task.frames){
      Object.defineProperties(video,{videoWidth:{value:640},videoHeight:{value:360}});
      doc.defaultView.HTMLCanvasElement.prototype.getContext=()=>({drawImage(){}});
      doc.defaultView.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/jpeg;base64,'+Buffer.from('mock-frame-'+time).toString('base64');
    }`);
const scrollAnchor="container.innerHTML='<div class=\"continuous-reader\" style=\"overflow-y:auto\"><img id=\"img\" class=\"imglook\" src=\"data:image/png;base64,mock\"></div>';";
assert(prefix.includes(scrollAnchor));
prefix=prefix.replace(scrollAnchor,scrollAnchor+`
    if(task.materialText){const layer=doc.createElement('div');layer.className='textLayer';layer.textContent=task.materialText;container.firstChild.append(layer);}`);
const docAnchor='  return doc;\n };';
assert(prefix.includes(docAnchor));
prefix=prefix.replace(docAnchor,`  if(page.notes!==undefined){const note=doc.createElement('div');note.setAttribute('data-course-notes','');note.setAttribute('data-chapter-id',String(ci+1));note.innerHTML=page.notes;doc.body.append(note);}
  return doc;
 };`);
prefix+='\nmodule.exports={fixture,video,ppt,quiz,waitForTest,delay};';
const fixtureModule=new Module(fixturePath,module);
fixtureModule.filename=fixturePath;
fixtureModule.paths=Module._nodeModulePaths(path.resolve(__dirname,'..'));
fixtureModule._compile(prefix,fixturePath);
const {fixture,video,quiz,waitForTest,delay}=fixtureModule.exports;
const logs=[],failures=[];
async function test(name,run){try{await run();logs.push('PASS '+name);}catch(error){failures.push(name+': '+error.stack);}}
function installMock(f,{holdOCR=false}={}){
  const pendingOCR=[],aborted=[];
  f.w.GM_xmlhttpRequest=request=>{
    const classification=policyInput(request);if(classification){respondPolicy(request,classification);return;}
    f.requests.push(request);let cancelled=false;
    const payload=JSON.parse(request.data),content=payload.messages.find(m=>m.role==='user').content;
    const isOCR=Array.isArray(content);
    const complete=(ignoreAbort=false)=>{
      if(cancelled&&!ignoreAbort)return;
      let result;
      if(isOCR){result={segments:content.filter(part=>part.type==='text').map(part=>({frameId:part.text.match(/画面 ID：(.*)；/)[1],text:'模拟画面文字'}))};}
      else {const input=JSON.parse(content);result={answers:input.questions.map(q=>({id:q.id,answer:q.type==='essay'?['模拟简答']:['A'],reason:'模拟资料分析'}))};}
      request.onload({status:200,responseText:JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]})});
    };
    if(isOCR&&holdOCR)pendingOCR.push({request,complete});else queueMicrotask(()=>complete());
    return {abort(){cancelled=true;aborted.push(request);request.onabort?.();}};
  };
  return {pendingOCR,aborted};
}
function quizInputs(f){return f.requests.map(request=>JSON.parse(request.data)).filter(payload=>typeof payload.messages[1].content==='string').map(payload=>JSON.parse(payload.messages[1].content));}
const documentPage=(text,notes='')=>({title:'PPT',notes,tasks:[{kind:'scroll',materialText:text}]});
async function main(){
  await test('真实 runner 同章视频字幕进入后续测验请求，题目仍正常预填与提交',async()=>{
    const f=fixture([{tabs:[video({subtitles:['关系代数包含选择、投影与连接']}),quiz()]}]);
    try{installMock(f);const report=await f.runner.start();assert.equal(report.status,'done');assert.equal(report.videos,1);assert.equal(report.quizzes,1);assert.equal(f.submits,1);
      const inputs=quizInputs(f);assert.equal(inputs.length,1);assert(inputs[0].courseContext.some(item=>item.kind==='subtitle'&&item.text.includes('选择、投影与连接')));
      assert(!JSON.stringify(inputs[0].courseContext).includes('mock-account'));assert.equal(f.requests.length,1);
    }finally{f.close();}
  });
  await test('PPT/PDF 文字层进入测验，空富文本笔记和占位文字省略',async()=>{
    const f=fixture([{tabs:[documentPage('数据完整性包括实体、参照与用户定义完整性','<p><br></p>'),documentPage('SQL 查询可以使用分组','暂无课堂笔记'),quiz()]}]);
    try{installMock(f);const report=await f.runner.start();assert.equal(report.status,'done');assert.equal(report.documents,2);const materials=quizInputs(f)[0].courseContext;
      assert(materials.some(item=>item.kind==='document'&&item.text.includes('数据完整性')));assert(materials.some(item=>item.kind==='document'&&item.text.includes('分组')));assert(!materials.some(item=>item.kind==='note'));
    }finally{f.close();}
  });
  await test('关闭自动识别后视频、课件、笔记均不发送 courseContext 或 OCR',async()=>{
    const f=fixture([{tabs:[video({subtitles:['不应发送字幕'],frames:true}),documentPage('不应发送课件','真实笔记也不发送'),quiz()]}],{storage:[['deepseek_api_key','mock-only-key'],['cx_model','deepseek-flash'],['cx_auto_course_context',false]]});
    try{installMock(f);const report=await f.runner.start();assert.equal(report.status,'done');assert.equal(f.requests.length,1);assert.equal(Object.hasOwn(quizInputs(f)[0],'courseContext'),false);
    }finally{f.close();}
  });
  await test('同章多个视频字幕独立保留，供该章测验共同引用',async()=>{
    const f=fixture([{tabs:[{title:'视频',tasks:[{kind:'video',subtitles:['第一段视频：主键唯一']},{kind:'video',subtitles:['第二段视频：外键参照']}]},quiz()]}]);
    try{installMock(f);const report=await f.runner.start();assert.equal(report.status,'done');assert.equal(report.videos,2);const subtitles=quizInputs(f)[0].courseContext.filter(item=>item.kind==='subtitle');
      assert.equal(subtitles.length,2);assert(subtitles.some(item=>item.text.includes('主键唯一')));assert(subtitles.some(item=>item.text.includes('外键参照')));
    }finally{f.close();}
  });
  await test('遍历两章时后章测验不含前章视频资料',async()=>{
    const f=fixture([{tabs:[video({subtitles:['章一独有材料']}),quiz()]},{tabs:[video({subtitles:['章二独有材料']}),quiz()]}]);
    try{installMock(f);const report=await f.runner.start();assert.equal(report.status,'done');assert.equal(f.submits,2);const inputs=quizInputs(f);assert.equal(inputs.length,2);
      assert(JSON.stringify(inputs[0].courseContext).includes('章一独有材料'));assert(!JSON.stringify(inputs[1].courseContext).includes('章一独有材料'));assert(JSON.stringify(inputs[1].courseContext).includes('章二独有材料'));
    }finally{f.close();}
  });
  await test('旧章已脱离文档树的视频及其晚到字幕不能填入新章缓存',async()=>{
    const f=fixture([{tabs:[video({subtitles:['旧章字幕']})]},{tabs:[video({subtitles:['新章字幕']})]}]);
    try{const identity=f.api.chapterContextIdentity(f.d),oldVideo=f.videos[0];const initial=f.api.captureCurrentCourseContext(f.d,{video:oldVideo,expectedIdentity:identity.id});assert(initial.some(item=>item.text==='旧章字幕'));
      f.d.querySelector('#cur2 .posCatalog_name').click();assert.equal(oldVideo.isConnected,false);
      assert.equal(f.api.captureCurrentCourseContext(f.d,{video:oldVideo,expectedIdentity:identity.id}).length,0);
      assert.equal(f.api.captureCurrentCourseContext(f.d,{video:oldVideo}).length,0);
      const next=f.api.captureCurrentCourseContext(f.d,{video:f.videos.at(-1)});assert(next.some(item=>item.text==='新章字幕'));assert(!next.some(item=>item.text==='旧章字幕'));
    }finally{f.close();}
  });
  await test('账号身份变化拒绝旧身份的字幕回调，并重建独立空缓存',async()=>{
    const f=fixture([{tabs:[video({subtitles:['旧账号材料']})]}]);
    try{const identity=f.api.chapterContextIdentity(f.d);f.api.captureCurrentCourseContext(f.d,{video:f.videos[0],expectedIdentity:identity.id});
      f.w.history.replaceState({},'',f.w.location.href.replace('mock-account','new-mock-account'));
      assert.notEqual(f.api.chapterContextIdentity(f.d).id,identity.id);assert.equal(f.api.captureCurrentCourseContext(f.d,{video:f.videos[0],expectedIdentity:identity.id}).length,0);
      assert.equal(f.api.chapterContextStore(f.d).store.items.length,0);assert.equal(f.requests.length,0);
    }finally{f.close();}
  });
  await test('视频末尾 OCR flush 时停止立即取消，晚响应不进入缓存或测验',async()=>{
    const f=fixture([{tabs:[video({duration:1,frames:true}),quiz()]}]);
    try{const mock=installMock(f,{holdOCR:true}),pending=f.runner.start();await waitForTest(()=>mock.pendingOCR.length===1,'未进入末尾 OCR flush');
      assert.equal(f.submits,0);f.runner.stop();const report=await pending;assert.equal(report.status,'stopped');assert.equal(mock.aborted.length,1);assert.equal(f.api.controller.state.busy,false);
      mock.pendingOCR[0].complete(true);await delay(2);assert.equal(quizInputs(f).length,0);assert.equal(f.api.captureCurrentCourseContext(f.d).filter(item=>item.kind==='video-frame').length,0);
    }finally{f.close();}
  });
  await test('正常末尾 OCR 画面文字合入同章测验，识别与答题请求分开且不发送视频地址',async()=>{
    const f=fixture([{tabs:[video({duration:1,frames:true}),quiz()]}]);
    try{installMock(f);const report=await f.runner.start();assert.equal(report.status,'done');assert.equal(f.requests.length,2);
      const first=JSON.parse(f.requests[0].data);assert(Array.isArray(first.messages[1].content));assert.equal(first.messages[1].content.filter(part=>part.type==='image_url').length,1);
      const input=quizInputs(f)[0];assert(input.courseContext.some(item=>item.kind==='video-frame'&&item.text==='模拟画面文字'));
      assert(!JSON.stringify(input).includes('data:image/'));assert(!JSON.stringify(input.courseContext).includes('mooc1.chaoxing.com'));assert.equal(f.submits,1);
    }finally{f.close();}
  });
  await test('视频末尾 OCR flush 时跳过该章，晚旧画面不串入下一章测验',async()=>{
    const f=fixture([{tabs:[video({duration:1,frames:true}),quiz()]},{tabs:[quiz()]}]);
    try{const mock=installMock(f,{holdOCR:true}),pending=f.runner.start();await waitForTest(()=>mock.pendingOCR.length===1,'未进入末尾 OCR flush');
      assert.equal(f.runner.skip(),true);await waitForTest(()=>quizInputs(f).length===1,'跳章后未进入新章测验');mock.pendingOCR[0].complete(true);
      const report=await pending;assert.equal(report.status,'done');assert.equal(report.chapters[0].status,'skipped');assert.equal(mock.aborted.length,1);assert.equal(f.submits,1);
      assert.equal(Object.hasOwn(quizInputs(f)[0],'courseContext'),false);assert.equal(f.api.captureCurrentCourseContext(f.d).length,0);
    }finally{f.close();}
  });
}
main().then(()=>{for(const line of logs)console.log(line);for(const failure of failures)console.error('FAIL '+failure);console.log(`Course information integration checks: ${logs.length} passed, ${failures.length} failed`);if(failures.length)process.exitCode=1;}).catch(error=>{console.error(error.stack);process.exitCode=1;});
