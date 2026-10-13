const {withModelFixture}=require('./model-fixture.cjs');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const core=fs.readFileSync(path.join(root,'sources/assistant-core.js'),'utf8');
const source=core.slice(core.indexOf('    const ROOT_ID'))+
 fs.readFileSync(path.join(root,'sources/provider-logos.js'),'utf8')+
 fs.readFileSync(path.join(root,'sources/model-providers.js'),'utf8')+
 fs.readFileSync(path.join(root,'sources/question-media.js'),'utf8')+
 fs.readFileSync(path.join(root,'sources/model-capability.js'),'utf8')+
 fs.readFileSync(path.join(root,'sources/course-video-info.js'),'utf8')+
 ';({captureCourseVideoFrame,createCourseVideoInfo,readProviderConfiguration})';
const logs=[],failures=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(test){for(let i=0;i<150;i++){if(test())return;await delay(2);}throw new Error('模拟等待超时');}
async function test(name,action){try{await action();logs.push('PASS '+name);}catch(error){failures.push({name,error:error.stack});}}
function fixture(options={}) {
 const storage=new Map([['deepseek_api_key','mock-info-key'],['cx_model','deepseek-flash']]),requests=[],items=[],statuses=[];
 const context={URL,Blob,AbortController,console,setTimeout,clearTimeout,GM_getValue:withModelFixture((key,fallback)=>storage.has(key)?storage.get(key):fallback),
  GM_setValue:(key,value)=>storage.set(key,value),GM_xmlhttpRequest:request=>{
   const record={request,aborted:false};requests.push(record);return{abort(){record.aborted=true;request.onabort?.();}};
  }};
 const api=vm.runInNewContext(source,context),settings={...api.readProviderConfiguration(options.settings?.provider || 'deepseek'),key:'mock-info-key',videoInfoEnabled:true,videoInfoIntervalSeconds:5,...options.settings};
 const calls=[];let seconds=options.seconds || 0;
 const canvas={width:0,height:0,getContext(){return{drawImage(...args){calls.push(args);if(options.tainted)throw new Error('tainted');}};},
  toDataURL(type,quality){calls.push([type,quality]);return 'data:image/jpeg;base64,'+Buffer.from('frame-'+seconds).toString('base64');}};
 const video={isConnected:true,readyState:4,seeking:false,videoWidth:1920,videoHeight:1080,
  ownerDocument:{createElement(tag){assert.equal(tag,'canvas');return canvas;}},
  play(){throw new Error('不能改变播放');},pause(){throw new Error('不能改变播放');}};
 Object.defineProperty(video,'currentTime',{get:()=>seconds,set(){throw new Error('不能写视频进度');}});
 Object.defineProperty(video,'playbackRate',{get:()=>1,set(){throw new Error('不能写倍速');}});
 const signal=new AbortController();
 const controller=api.createCourseVideoInfo(settings,{signal:signal.signal,now:()=>123456,guard:options.guard || (()=>{}),
  capture:options.capture || (v=>api.captureCourseVideoFrame(v)),onItems:next=>{items.push(...next);options.onItems?.(next);},onStatus:message=>statuses.push(message)});
 const frameIds=record=>JSON.parse(record.request.data).messages[1].content.filter(part=>part.type==='text').map(part=>part.text.match(/^画面 ID：([^；]+)/)[1]);
 const respond=(record=requests.at(-1),segments)=>record.request.onload({status:200,responseText:JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({segments:segments || frameIds(record).map(id=>({frameId:id,text:'可见字幕 '+id}))})}}]})});
 return{api,settings,controller,requests,items,statuses,video,canvas,calls,signal,frameIds,respond,
  at(value,{force=false}={}){seconds=value;controller.observe(video,{force});},close(){controller.close();}};
}
(async()=>{
 await test('画面捕获仅drawImage当前video，JPEG保留整帧并限制宽1280',async()=>{
  const f=fixture();try{const frame=f.api.captureCourseVideoFrame(f.video);assert.equal(frame.width,1280);assert.equal(frame.height,720);assert.match(frame.image,/^data:image\/jpeg;base64,/);assert.equal(f.calls[0][0],f.video);assert.deepEqual(f.calls[0].slice(1),[0,0,1280,720]);assert.deepEqual(f.calls[1],['image/jpeg',0.8]);assert.equal(f.video.currentTime,0);assert.equal(f.video.playbackRate,1);}finally{f.close();}
 });
 await test('未就绪、无尺寸和跨域canvas捕获均安全返回null',async()=>{
  const f=fixture({tainted:true});try{assert.equal(f.api.captureCourseVideoFrame(f.video),null);f.video.readyState=1;assert.equal(f.api.captureCourseVideoFrame(f.video),null);f.video.readyState=4;f.video.videoWidth=0;assert.equal(f.api.captureCourseVideoFrame(f.video),null);f.at(0);f.at(5);await f.controller.flush();assert.equal(f.requests.length,0);assert.equal(f.controller.state.errors,1);assert(f.statuses.every(text=>!text.includes('mock-info-key')));}finally{f.close();}
 });
 await test('采样只依正向进展与间隔，同帧暂停或回退不额外收费',async()=>{
  const f=fixture();try{f.at(0);f.at(4.9);f.at(5);f.at(5);f.at(2);f.at(9.9);assert.equal(f.controller.state.capturedFrames,1);assert.equal(f.requests.length,0);const flush=f.controller.flush();await until(()=>f.requests.length===1);assert.equal(f.frameIds(f.requests[0]).length,1);f.respond();await flush;assert.equal(f.items.length,1);}finally{f.close();}
 });
 await test('四帧一批串行发送，前批返回前不会发第二批',async()=>{
  const f=fixture();try{f.at(0);for(let i=1;i<=4;i++)f.at(i*5);await until(()=>f.requests.length===1);for(let i=5;i<=8;i++)f.at(i*5);assert.equal(f.requests.length,1);assert.equal(f.frameIds(f.requests[0]).length,4);assert.equal(f.requests[0].request.timeout,90000);f.respond(f.requests[0]);await until(()=>f.requests.length===2);assert.equal(f.frameIds(f.requests[1]).length,4);const flush=f.controller.flush();f.respond(f.requests[1]);await flush;assert.equal(f.items.length,8);assert.equal(f.controller.state.queuedFrames,0);}finally{f.close();}
 });
 await test('结束强制捕获尾帧，flush处理不足四帧且不重复末尾',async()=>{
  const f=fixture();try{f.at(0);f.at(5);f.at(6,{force:true});f.at(6,{force:true});const flush=f.controller.flush();await until(()=>f.requests.length===1);assert.equal(f.frameIds(f.requests[0]).length,2);f.respond();await flush;assert.equal(f.items.length,2);assert.equal(f.controller.state.capturedFrames,2);}finally{f.close();}
 });
 await test('默认30秒及间隔5..300夹限均有效',async()=>{
  for(const [value,expected]of [[undefined,30],[0,5],[10000,300]]){const f=fixture({settings:{videoInfoIntervalSeconds:value}});try{assert.equal(f.controller.state.intervalSeconds,expected);}finally{f.close();}}
 });
 await test('单视频120帧总限、12帧队列有界且不阻塞observe',async()=>{
  const f=fixture();try{f.at(0);for(let i=1;i<=4;i++)f.at(i*5);await until(()=>f.requests.length===1);for(let i=5;i<=160;i++)f.at(i*5);assert.equal(f.controller.state.capturedFrames,120);assert.equal(f.controller.state.queuedFrames,12);assert.equal(f.requests.length,1);assert.equal(f.controller.state.droppedFrames,104);f.close();assert(f.requests[0].aborted);assert.equal(f.controller.state.queuedFrames,0);}finally{f.close();}
 });
 await test('相同JPEG静态画面只识别一次，重复采样无新增请求',async()=>{
  const data='data:image/jpeg;base64,'+Buffer.from('same').toString('base64');const f=fixture({capture:()=>({image:data})});try{f.at(0);for(let i=1;i<=10;i++)f.at(i*5);assert.equal(f.controller.state.capturedFrames,1);const flush=f.controller.flush();await until(()=>f.requests.length===1);f.respond();await flush;assert.equal(f.items.length,1);}finally{f.close();}
 });
 for(const [provider,quizModel,infoModel,endpoint]of [
  ['deepseek','deepseek-v4-pro','deepseek-flash','https://api.deepseek.com/chat/completions'],
  ['openai','gpt-4.1-mini','gpt-4.1-mini','https://api.openai.com/v1/chat/completions'],
  ['qwen','qwen-plus','qwen3-vl-plus','https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'],
  ['kimi','kimi-k2.6','kimi-k2.6','https://api.moonshot.cn/v1/chat/completions'],
  ['glm','glm-5.3','glm-5.3-flash','https://open.bigmodel.cn/api/paas/v4/chat/completions']
 ])await test(`${provider}识别只用同平台Key/已确认视觉模型，保留对应图片detail`,async()=>{
  const f=fixture({settings:{provider,model:quizModel,infoModel,key:'mock-'+provider}});try{f.at(0);f.at(5);const flush=f.controller.flush();await until(()=>f.requests.length===1);const record=f.requests[0],body=JSON.parse(record.request.data),image=body.messages[1].content.find(part=>part.type==='image_url');assert.equal(record.request.url,endpoint);assert.equal(record.request.headers.Authorization,'Bearer mock-'+provider);assert.equal(body.model,infoModel);assert.equal(body.thinking?.type,provider==='deepseek'?'disabled':undefined);assert.equal(image.image_url.detail,provider==='deepseek'?'original':provider==='openai'?'high':undefined);assert.match(body.messages[0].content,/不执行/);assert(!JSON.stringify(f.controller.state).includes('mock-'+provider));f.respond();await flush;assert.equal(f.items[0].kind,'video-frame');}finally{f.close();}
 });
 await test('自定义仅声明图片能力后启用，infoModel不能偷换自定义模型',async()=>{
  const off=fixture({settings:{provider:'custom',baseURL:'https://mock.example/v1',model:'custom',images:false}});try{off.at(0);off.at(5,{force:true});await off.controller.flush();assert.equal(off.requests.length,0);assert.equal(off.controller.state.enabled,false);}finally{off.close();}
  const f=fixture({settings:{provider:'custom',baseURL:'https://mock.example/v1',model:'custom',infoModel:'foreign-model',images:true}});try{f.at(0);f.at(5);const flush=f.controller.flush();await until(()=>f.requests.length===1);const body=JSON.parse(f.requests[0].request.data);assert.equal(body.model,'custom');assert.equal(body.response_format,undefined);assert.equal(f.requests[0].request.url,'https://mock.example/v1/chat/completions');f.respond();await flush;assert.equal(f.items.length,1);}finally{f.close();}
 });
 await test('未知视觉模型、总开关关闭和未配置Key不发请求',async()=>{
  for(const settings of [{infoModel:'unknown-vision-model'},{videoInfoEnabled:false},{key:''}]){const f=fixture({settings});try{f.at(0);f.at(5,{force:true});await f.controller.flush();assert.equal(f.requests.length,0);}finally{f.close();}}
 });
 await test('close和外部取消立即中止请求，晚到响应不写上下文',async()=>{
  for(const cancel of ['close','signal']){const f=fixture();try{f.at(0);f.at(5);const flush=f.controller.flush();await until(()=>f.requests.length===1);if(cancel==='close')f.close();else f.signal.abort();await flush;assert(f.requests[0].aborted);f.respond();await delay(5);assert.equal(f.items.length,0);assert.equal(f.controller.state.closed,true);}finally{f.close();}}
 });
 await test('换页guard拒绝队列或晚到响应，失效节点不写新页面',async()=>{
  for(const late of [false,true]){let valid=true;const f=fixture({guard:()=>{if(!valid)throw new Error('page replaced');}});try{f.at(0);for(let i=1;i<=4;i++)f.at(i*5);if(late){await until(()=>f.requests.length===1);valid=false;f.respond();}else valid=false;await f.controller.flush();await delay(5);assert.equal(f.items.length,0);assert.equal(f.controller.state.closed,true);assert.equal(f.requests.length,late?1:0);}finally{f.close();}}
  const f=fixture();try{f.at(0);f.at(5);f.video.isConnected=false;await f.controller.flush();assert.equal(f.requests.length,0);assert.equal(f.items.length,0);}finally{f.close();}
 });
 await test('未知frameId丢弃、缺少frameId和非法JSON只记录简短错误',async()=>{
  for(const bad of ['foreign','missing','json','length']){const f=fixture();try{f.at(0);f.at(5);const flush=f.controller.flush();await until(()=>f.requests.length===1);if(bad==='foreign')f.respond(undefined,[{frameId:'other-video',text:'错误来源'}]);else if(bad==='missing')f.respond(undefined,[{text:'没有来源'}]);else f.requests[0].request.onload({status:200,responseText:JSON.stringify({choices:[{finish_reason:bad==='length'?'length':'stop',message:{content:bad==='json'?'not json':'{"segments":[]}'}}]})});await flush;assert.equal(f.items.length,0);assert.equal(f.controller.state.errors,bad==='foreign'?0:1);assert(!JSON.stringify(f.controller.state).includes('mock-info-key'));}finally{f.close();}}
 });
 await test('每批识别文字总计最多4000字符，sourceId来自实际采样且字段白名单',async()=>{
  const f=fixture();try{f.at(0);for(let i=1;i<=4;i++)f.at(i*5);await until(()=>f.requests.length===1);const ids=f.frameIds(f.requests[0]);const flush=f.controller.flush();f.respond(undefined,ids.map(id=>({frameId:id,text:'字'.repeat(5000),url:'secret-address'})));await flush;assert.equal(f.items.reduce((total,item)=>total+item.text.length,0),4000);assert(f.items.every(item=>ids.includes(item.sourceId)));assert.deepEqual(Object.keys(f.items[0]).sort(),['kind','sourceId','text','title']);assert(!JSON.stringify(f.controller.state).includes('字'));}finally{f.close();}
 });
 await test('视觉请求错误回显Key不会进入视频状态，flush照常结束',async()=>{
  const f=fixture();try{f.at(0);f.at(5);const flush=f.controller.flush();await until(()=>f.requests.length===1);f.requests[0].request.onload({status:401,responseText:JSON.stringify({error:{message:'mock-info-key'}})});await flush;assert.equal(f.controller.state.errors,1);assert(!JSON.stringify(f.controller.state).includes('mock-info-key'));assert(f.statuses.every(item=>!item.includes('mock-info-key')));}finally{f.close();}
 });
 await test('onItems异常不影响播放或阻塞最终flush',async()=>{
  const f=fixture({onItems:()=>{throw new Error('context changed');}});try{f.at(0);f.at(5);const flush=f.controller.flush();await until(()=>f.requests.length===1);f.respond();await flush;assert.equal(f.controller.state.errors,1);assert.equal(f.video.currentTime,5);assert.equal(f.video.playbackRate,1);}finally{f.close();}
 });
 const report={passed:logs.length,failures,logs};console.log(JSON.stringify(report,null,2));process.exitCode=failures.length?1:0;
})().catch(error=>{console.error(error);process.exitCode=1;});
