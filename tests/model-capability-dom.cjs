const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),core=fs.readFileSync(path.join(root,'sources/assistant-core.js'),'utf8');
const source=core.slice(core.indexOf('    const ROOT_ID'))+
 fs.readFileSync(path.join(root,'sources/provider-logos.js'),'utf8')+
 fs.readFileSync(path.join(root,'sources/model-providers.js'),'utf8')+
 fs.readFileSync(path.join(root,'sources/question-media.js'),'utf8')+
 fs.readFileSync(path.join(root,'sources/model-capability.js'),'utf8')+
 ';({detectModelImageCapability,imageCapabilityCache,verifiedModelImages,rememberedImageModels,readProviderConfiguration,providerModelCapabilities,modelOptionLabel,modelSupportsImages,endpointFingerprint,KEY_MODEL_IMAGE_CAPABILITIES})';
const logs=[],failures=[];
async function test(name,action){try{await action();logs.push('PASS '+name);}catch(error){failures.push({name,error:error.stack});}}
function fixture(options={}) {
 const storage=new Map(options.storage || []),writes=[],requests=[],canvasCalls=[];
 let paintedCode='',guardActive=true;
 const canvas={width:0,height:0,getContext(){if(options.noContext)return null;return{
  fillRect(...args){canvasCalls.push(['fillRect',...args]);},fillText(code,...args){paintedCode=code;canvasCalls.push(['fillText',code,...args]);}};},
  toDataURL(type){canvasCalls.push(['toDataURL',type]);if(options.tainted)throw new Error('tainted');return options.image || 'data:image/png;base64,'+Buffer.from('test image pixels').toString('base64');}};
 const api=vm.runInNewContext(source,{URL,Blob,Uint32Array,Math,AbortController,console,setTimeout,clearTimeout,crypto:options.crypto,
  document:{createElement(tag){assert.equal(tag,'canvas');return canvas;}},
  GM_getValue:(key,fallback)=>storage.has(key)?storage.get(key):fallback,GM_setValue:(key,value)=>{storage.set(key,value);writes.push({key,value});},
  GM_xmlhttpRequest:request=>{const record={request,aborted:false};requests.push(record);return{abort(){record.aborted=true;request.onabort?.();}};}
 });
 const settings={...api.readProviderConfiguration(options.settings?.provider || 'deepseek'),model:'new-model',key:'mock-capability-key',...options.settings};
 const signal=new AbortController();
 const run=overrides=>api.detectModelImageCapability(settings,{signal:signal.signal,guard:()=>{if(!guardActive)throw new Error('changed');},canvasFactory:()=>canvas,random:()=>0.123456,...overrides});
 const respond=(record=requests.at(-1),content,finish='stop')=>record.request.onload({status:200,responseText:JSON.stringify({choices:[{finish_reason:finish,message:{content:content === undefined ? JSON.stringify({code:paintedCode}) : content}}]})});
 return{api,storage,writes,requests,canvasCalls,canvas,settings,signal,run,respond,
  get code(){return paintedCode;},invalidate(){guardActive=false;}};
}
(async()=>{
 await test('未知型号实测只发送一次，验证码只画在图片且90秒超时',async()=>{
  const f=fixture(),pending=f.run();assert.equal(f.requests.length,1);const request=f.requests[0].request,body=JSON.parse(request.data);
  assert.equal(request.timeout,90000);assert.equal(request.url,'https://api.deepseek.com/chat/completions');assert.equal(body.model,'new-model');assert.equal(body.stream,false);
  assert.deepEqual(Object.keys(body).sort(),['max_tokens','messages','model','stream']);assert.equal(request.headers.Authorization,'Bearer mock-capability-key');
  assert.equal(f.canvas.width,420);assert.equal(f.canvas.height,120);assert.equal(f.code,'123456');assert.equal(f.canvasCalls.filter(item=>item[0]==='fillText').length,1);
  const text=body.messages.flatMap(message=>typeof message.content==='string'?[message.content]:message.content.filter(part=>part.type==='text').map(part=>part.text)).join('\n');
  assert(!text.includes(f.code));assert.equal(body.messages[1].content.find(part=>part.type==='image_url').image_url.detail,'original');f.respond();assert.equal((await pending).images,true);
  assert.equal(f.requests.length,1);assert.equal(f.writes.length,1);
 });
 await test('缓存只保存脱敏白名单，换Key后仍保留精确型号能力',async()=>{
  const f=fixture(),pending=f.run();f.respond();await pending;const saved=f.storage.get(f.api.KEY_MODEL_IMAGE_CAPABILITIES);assert.equal(saved.length,1);
  assert.deepEqual(Object.keys(saved[0]).sort(),['checkedAt','endpointFingerprint','evidence','images','model','provider']);assert.equal(saved[0].images,true);assert.equal(saved[0].evidence,'image-test');
  assert.equal(saved[0].model,'new-model');assert.equal(saved[0].provider,'deepseek');assert(Number.isFinite(saved[0].checkedAt));
  const rendered=JSON.stringify(saved);for(const secret of [f.settings.key,f.code,'api.deepseek.com','data:image'])assert(!rendered.includes(secret));
  assert(f.api.verifiedModelImages('deepseek','new-model'));assert(!f.api.verifiedModelImages('deepseek','NEW-model'));assert(!f.api.verifiedModelImages('openai','new-model'));
  assert(f.api.imageCapabilityCache({...f.settings,key:'another-key'}));assert.deepEqual(Array.from(f.api.rememberedImageModels('deepseek')),['new-model']);
 });
 for(const [provider,url,detail]of [['openai','https://api.openai.com/v1/chat/completions','high'],['qwen','https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',undefined],
  ['kimi','https://api.moonshot.cn/v1/chat/completions',undefined],['glm','https://open.bigmodel.cn/api/paas/v4/chat/completions',undefined],['custom','https://proxy.example/prefix/v1/chat/completions',undefined]])
 await test(`${provider}新型号不受旧白名单限制且使用同平台端点/Key`,async()=>{
  const f=fixture({settings:{provider,baseURL:provider==='custom'?'https://proxy.example/prefix/v1':'https://ignored.example',model:'brand-new-vision',images:false,key:'mock-'+provider}}),pending=f.run();
  assert.equal(f.requests.length,1);const request=f.requests[0].request,body=JSON.parse(request.data);assert.equal(request.url,url);assert.equal(request.headers.Authorization,'Bearer mock-'+provider);
  assert.equal(body.model,'brand-new-vision');assert.equal(body.thinking,undefined);assert.equal(body.enable_thinking,undefined);assert.equal(body.response_format,undefined);
  assert.equal(body.messages[1].content[1].image_url.detail,detail);f.respond();assert.equal((await pending).images,true);assert(f.api.verifiedModelImages(provider,'brand-new-vision',f.settings.baseURL));
 });
 await test('自定义端点按规范化地址隔离，同型号不能跨地址借用能力',async()=>{
  const f=fixture({settings:{provider:'custom',baseURL:'https://proxy.example/v1/',model:'same-model'}}),pending=f.run();f.respond();await pending;
  assert(f.api.verifiedModelImages('custom','same-model','https://proxy.example/v1'));assert(!f.api.verifiedModelImages('custom','same-model','https://other.example/v1'));
  assert(!f.api.verifiedModelImages('custom','same-model','https://proxy.example/v2'));assert.deepEqual(Array.from(f.api.rememberedImageModels('custom','https://other.example/v1')),[]);
  f.storage.set('cx_provider_custom_baseURL','https://proxy.example/v1');assert(f.api.verifiedModelImages('custom','same-model'));
 });
 await test('前导零必须作为字符串原样返回',async()=>{
  const f=fixture(),pending=f.run({random:()=>0.000042});assert.equal(f.code,'000042');f.respond();assert.equal((await pending).images,true);
  const g=fixture(),wrong=g.run({random:()=>0.000042});g.respond(undefined,'{"code":42}');const result=await wrong;assert.equal(result.images,null);assert.equal(g.writes.length,0);
 });
 await test('默认canvas和crypto随机路径不在prompt泄露随机数字',async()=>{
  let randomCalls=0;const f=fixture({crypto:{getRandomValues(array){randomCalls++;array.set([8,7,6,5,4,3]);return array;}}}),pending=f.run({canvasFactory:undefined,random:undefined});
  assert.equal(randomCalls,1);assert.equal(f.code,'876543');assert(!f.requests[0].request.data.includes('876543'));f.respond();assert.equal((await pending).images,true);
 });
 await test('不正确数字、猜测文本、额外字段、非法JSON与截断均保留unknown',async()=>{
  for(const [content,finish]of [['{"code":"654321"}','stop'],['123456','stop'],['{"code":"123456","note":"guess"}','stop'],['not json','stop'],['{"code":"123456"}','length'],['null','stop'],['[]','stop']]) {
   const f=fixture(),pending=f.run();f.respond(undefined,content,finish);const result=await pending;assert.equal(result.images,null);assert.equal(result.evidence,'unknown');assert.equal(f.writes.length,0);assert(!f.api.verifiedModelImages('deepseek','new-model'));
  }
 });
 await test('HTTP鉴权、未知图片错误、网络及超时均不写false，回显Key不泄露',async()=>{
  for(const problem of [401,400,500,'network','timeout','json']) {
   const f=fixture(),pending=f.run(),request=f.requests[0].request;if(typeof problem==='number')request.onload({status:problem,responseText:JSON.stringify({error:{message:f.settings.key+' '+f.code+' https://private.example'}})});
   else if(problem==='network')request.onerror();else if(problem==='timeout')request.ontimeout();else request.onload({status:200,responseText:'invalid '+f.settings.key});
   const result=await pending;assert.equal(result.images,null);assert.equal(f.writes.length,0);assert(!JSON.stringify(result).includes(f.settings.key));assert(!JSON.stringify(result).includes(f.code));assert(!JSON.stringify(result).includes('private.example'));
  }
 });
 await test('失败的重测不清除已成功的能力记录',async()=>{
  const f=fixture(),first=f.run();f.respond();await first;const cached=JSON.stringify(f.storage.get(f.api.KEY_MODEL_IMAGE_CAPABILITIES));
  const second=f.run();f.respond(undefined,'{"code":"999999"}');assert.equal((await second).images,null);assert.equal(JSON.stringify(f.storage.get(f.api.KEY_MODEL_IMAGE_CAPABILITIES)),cached);assert.equal(f.writes.length,1);
 });
 await test('预先取消零请求，进行中取消中止一次且晚到响应不缓存',async()=>{
  const before=fixture();before.signal.abort();assert.equal((await before.run()).images,null);assert.equal(before.requests.length,0);assert.equal(before.writes.length,0);
  const f=fixture(),pending=f.run();f.signal.abort();assert.equal((await pending).images,null);assert(f.requests[0].aborted);f.respond();assert.equal(f.writes.length,0);
 });
 await test('换平台/配置guard前后失效均不得缓存或操作旧页面',async()=>{
  const before=fixture();before.invalidate();assert.equal((await before.run()).images,null);assert.equal(before.requests.length,0);
  const f=fixture(),pending=f.run();f.invalidate();f.respond();assert.equal((await pending).images,null);assert.equal(f.writes.length,0);
 });
 await test('canvas未就绪、污染、错误dataURI与无效随机值都不发请求',async()=>{
  for(const options of [{noContext:true},{tainted:true},{image:'data:text/plain;base64,MTIzNDU2'}]){const f=fixture(options);assert.equal((await f.run()).images,null);assert.equal(f.requests.length,0);assert.equal(f.writes.length,0);}
  for(const random of [()=>-1,()=>1,()=>NaN]){const f=fixture();assert.equal((await f.run({random})).images,null);assert.equal(f.requests.length,0);}
 });
 await test('JPEG图片也能实测且缺Key/模型/自定义地址均零请求',async()=>{
  const jpeg=fixture({image:'data:image/jpeg;base64,'+Buffer.from('pixels').toString('base64')}),pending=jpeg.run();jpeg.respond();assert.equal((await pending).images,true);
  for(const settings of [{key:''},{model:''},{provider:'custom',baseURL:'http://unsafe.example'},{provider:'custom',baseURL:'https://unsafe.example/v1/chat/completions'},{provider:'invalid'}]){const f=fixture({settings});assert.equal((await f.run()).images,null);assert.equal(f.requests.length,0);}
 });
 await test('请求大小超过全局44MiB或Qwen16MiB限制在发起前安全拒绝',async()=>{
  for(const [provider,bytes]of [['deepseek',45*1024*1024],['qwen',17*1024*1024]]) {
   const f=fixture({settings:{provider},image:'data:image/png;base64,'+'A'.repeat(bytes)});assert.equal((await f.run()).images,null);assert.equal(f.requests.length,0);assert.equal(f.writes.length,0);
  }
 });
 await test('未知型号图片实测不改变平台参数与已保存的思考选项',async()=>{
  const f=fixture();assert.equal(f.api.providerModelCapabilities('deepseek','new-model').images,false);assert.equal(f.api.modelSupportsImages('new-model',f.settings),false);
  const before=f.api.providerModelCapabilities('deepseek','new-model'),thinking=f.api.readProviderConfiguration().thinking;
  const pending=f.run();f.respond();await pending;const cap=f.api.providerModelCapabilities('deepseek','new-model');assert.equal(cap.images,true);assert.equal(cap.known,false);assert.equal(cap.thinking,before.thinking);assert.equal(f.api.readProviderConfiguration().thinking,thinking);assert.equal(cap.imageEvidence,'image-test');
  assert.equal(f.api.modelSupportsImages('new-model',f.settings),true);assert.match(f.api.modelOptionLabel('deepseek','new-model'),/已实测|已通过图片识别测试/);
 });
 await test('损坏、negative和未经验证metadata缓存不被信任；公开读取返回白名单副本',async()=>{
  const f=fixture(),fp=f.api.endpointFingerprint('https://api.deepseek.com'),key=f.api.KEY_MODEL_IMAGE_CAPABILITIES;
  f.storage.set(key,[{provider:'deepseek',model:'new-model',endpointFingerprint:fp,images:false,checkedAt:123,evidence:'image-test'},
   {provider:'deepseek',model:'new-model',endpointFingerprint:fp,images:true,checkedAt:123,evidence:'model-metadata'},
   {provider:'invalid',model:'new-model',endpointFingerprint:fp,images:true,checkedAt:123,evidence:'image-test'}]);
  assert.equal(f.api.imageCapabilityCache(f.settings),null);
  f.storage.set(key,[{provider:'deepseek',model:'new-model',endpointFingerprint:fp,images:true,checkedAt:123,evidence:'image-test',key:'sensitive',image:'sensitive'}]);
  const record=f.api.imageCapabilityCache(f.settings);assert(record);assert.equal(record.key,undefined);record.model='changed';assert(f.api.verifiedModelImages('deepseek','new-model'));
  f.storage.set(key,'broken');assert.equal(f.api.imageCapabilityCache(f.settings),null);assert.deepEqual(Array.from(f.api.rememberedImageModels('unknown')),[]);
 });
 await test('重复成功更新同条记录，缓存有200条上限',async()=>{
  const f=fixture(),key=f.api.KEY_MODEL_IMAGE_CAPABILITIES,fp=f.api.endpointFingerprint('https://api.deepseek.com');
  f.storage.set(key,Array.from({length:210},(_,i)=>({provider:'deepseek',model:'old-'+i,endpointFingerprint:fp,images:true,checkedAt:100+i,evidence:'image-test'})));
  const first=f.run();f.respond();await first;assert.equal(f.storage.get(key).length,200);assert(f.api.verifiedModelImages('deepseek','new-model'));
  const second=f.run();f.respond();await second;assert.equal(f.storage.get(key).filter(item=>item.model==='new-model').length,1);assert.equal(f.storage.get(key).length,200);
 });
 const report={passed:logs.length,failures,logs};console.log(JSON.stringify(report,null,2));process.exitCode=failures.length?1:0;
})().catch(error=>{console.error(error);process.exitCode=1;});
