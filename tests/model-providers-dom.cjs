const {fixtureImageCapabilities}=require('./model-fixture.cjs');
const {policyInput,respondPolicy}=require('./answer-policy-mock.cjs');
const classificationRequests=[];
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { webcrypto } = require('node:crypto');
const projectRequire = createRequire(path.join(__dirname, '../package.json'));
const { JSDOM } = projectRequire('jsdom');
const candidatePath = path.join(__dirname, '../学习通AI助手.user.js');
const source = fs.readFileSync(candidatePath, 'utf8').replace(/\r\n/g, '\n');
const entry = "    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startQuizObserver, { once: true });\n    else startQuizObserver();";
assert(source.includes(entry), '仅执行已构建候选脚本，入口定位必须成功');
assert(source.includes('function getModelProvider'), '候选脚本尚未包含多模型升级，禁止测试旧源');
const instrumented = source.replace('/* TRUSTED_ASSISTANT_ACTIVATION */','return true; /* test harness only: jsdom cannot generate user activation */').replace(entry, `globalThis.providersAPI={getModelProvider,providerModelCapabilities,readProviderConfiguration,readModelConfiguration,readProviderSetting,saveProviderSetting,saveProviderKey,normalizeModelBaseURL,modelConfigurationSignature,modelOptionLabel,modelSupportsImages,buildConfiguredAnswerPayload,assertConfiguredRequestSize,askConfiguredModel,fetchConfiguredModels,createCourseVideoInfo,extract,prepareQuestionMedia,initQuizAssistant,runAnswerFlow,resumeAnalysisTask,stopAnalysisTask,get controller(){return controller},get credentialEditor(){return credentialView}};`);
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+XGnQAAAAASUVORK5CYII=';
const DATA = `data:image/png;base64,${PNG}`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const logs = [], failures = [];
async function test(name, run) {
  try { await run(); logs.push(`PASS ${name}`); }
  catch (error) { failures.push(`${name}: ${error.stack}`); }
}
function fixture(html = '', options = {}) {
  const dom = new JSDOM(html, {url: options.url || 'https://mooc1.chaoxing.com/work/doHomeWorkNew', runScripts: 'outside-only', pretendToBeVisual: true});
  const w = dom.window, requests = [], writes = [], storage = new Map(Object.entries(options.storage || {}));
  const menus = new Map(), prompts = [], promptAnswers = [], alerts = [];
  w.GM_registerMenuCommand = (name, callback) => menus.set(name, callback);
  w.prompt = (message, initial) => {prompts.push({message, initial}); return promptAnswers.length ? promptAnswers.shift() : null;};
  w.confirm = () => true;
  w.alert = message => alerts.push(message);
  let aborts = 0;
  w.GM_getValue = (key, fallback) => storage.has(key) ? storage.get(key) : fallback;
  w.GM_setValue = (key, value) => { storage.set(key, value); writes.push({key, value}); };
  w.GM_deleteValue = key => storage.delete(key);
  w.GM_getResourceText = () => '{}';
  w.GM_xmlhttpRequest = request => {
    const policy=policyInput(request);if(policy){classificationRequests.push(request);queueMicrotask(()=>respondPolicy(request,policy));return {abort(){request.onabort?.();}};}

    requests.push(request);
    if(options.respond) queueMicrotask(() => options.respond(request));
    return {abort() {aborts++; request.onabort?.();}};
  };
  Object.defineProperty(w.crypto, 'subtle', {value: webcrypto.subtle});
  w.Image = class {set src(value) {if (!value) return; queueMicrotask(() => {this.naturalWidth = 1; this.naturalHeight = 1; this.onload?.();});}};
  w.eval(instrumented);
  return {w, d: w.document, api: w.providersAPI, requests, writes, storage, menus, prompts, promptAnswers, alerts,
    get aborts() {return aborts;},
    close() {w.dispatchEvent(new w.Event('pagehide')); w.close();}};
}
const essay = (id, text = '解释数据库概念') => `<div class="TiMu" questionid="${id}"><h3 class="stem">【简答题】${text}</h3><textarea></textarea></div>`;
function questions(f) {return f.api.extract().questions;}
function plain(value) {return JSON.parse(JSON.stringify(value));}
function response(request, content, extra = {}) {
  request.onload({status: 200, responseText: JSON.stringify({choices: [{finish_reason: 'stop', message: {content}, ...extra}]})});
}
function respondAnswers(request) {
  const payload = JSON.parse(request.data), content = payload.messages.find(m => m.role === 'user').content;
  const text = Array.isArray(content) ? content.find(part => part.type === 'text').text : content;
  const sent = JSON.parse(text);
  response(request, JSON.stringify({answers: sent.questions.map(q => ({id: q.id, answer: ['模拟答案'], reason: '模拟验证'}))}));
  return {payload, sent};
}
async function pending(f, method = 'POST') {
  for (let i = 0; i < 100; i++) {
    const request = f.requests.find(r => r.method === method);
    if (request) return request;
    await pause(5);
  }
  throw new Error(`没有产生预期 ${method} 模型请求`);
}
async function requestAt(f, index) {
  for(let i=0;i<100;i++) {if(f.requests[index])return f.requests[index];await pause(5);}
  throw new Error(`没有产生预期第 ${index+1} 个请求`);
}
function panel(f) {return f.d.getElementById('cx-ai-study-root').shadowRoot;}
async function waitIdle(f) {
  for(let i=0;i<200;i++){if(!f.api.controller.state.busy)return;await pause(5);}
  throw new Error('模型操作未恢复空闲状态');
}
function mockChallengeCanvas(f) {
  const codes=[];
  f.w.HTMLCanvasElement.prototype.getContext=()=>({fillRect(){},fillText(value){codes.push(value);}});
  f.w.HTMLCanvasElement.prototype.toDataURL=()=>DATA;
  return codes;
}
function config(f, provider, model, values = {}) {
  f.storage.set('cx_provider', provider);
  if(model)f.api.saveProviderSetting('model',model,provider);
  for(const [field,value] of Object.entries(values))if(field!=='key')f.api.saveProviderSetting(field,value,provider);
  f.api.saveProviderKey(values.key || `${provider}-mock-key`, provider);
  return f.api.readProviderConfiguration();
}
const imageEssay = id => essay(id, `根据图回答<img src="${DATA}" alt="测试表格">`);
async function main() {
  await test('默认 DeepSeek 沿用原有 Key、模型和设置，不写入迁移值',async()=>{
    const f=fixture('',{storage:{deepseek_api_key:'legacy-key',cx_model:'deepseek-v4-pro',cx_thinking:true,cx_reasoning_effort:'max',cx_search:true}});
    try {
      const settings=f.api.readProviderConfiguration();
      assert.equal(settings.provider,'deepseek');assert.equal(settings.key,'legacy-key');assert.equal(settings.model,'deepseek-v4-pro');
      assert.equal(settings.thinking,true);assert.equal(settings.effort,'max');assert.equal(settings.search,true);assert.equal(settings.configured,true);
      assert.equal(f.writes.length,0);
    } finally {f.close();}
  });
  await test('五个平台与一个自定义配置的 Key、模型、思考和搜索隔离',async()=>{
    const f=fixture();
    try {
      const profiles=[['deepseek','deepseek-flash'],['openai','gpt-4.1-mini'],['qwen','qwen-plus'],['kimi','kimi-k2.6'],['glm','glm-5.3'],['custom','my-model']];
      f.api.saveProviderSetting('baseURL','https://gateway.example/v1','custom');
      for(const [id,model] of profiles) {
        f.api.saveProviderKey(`key-${id}`,id);f.api.saveProviderSetting('model',model,id);
        f.api.saveProviderSetting('thinking',true,id);f.api.saveProviderSetting('search',true,id);
      }
      for(const [id,model] of profiles) {
        const cfg=f.api.readProviderConfiguration(id);
        assert.equal(cfg.key,`key-${id}`);assert.equal(cfg.model,model);
        assert.equal(f.api.readProviderSetting(id,'thinking'),true);assert.equal(f.api.readProviderSetting(id,'search'),true);
        assert.equal(cfg.search,id==='deepseek');
      }
      f.api.saveProviderKey('new-openai','openai');
      assert.equal(f.api.readProviderConfiguration('deepseek').key,'key-deepseek');
      assert.equal(f.api.readProviderConfiguration('openai').key,'new-openai');
    } finally {f.close();}
  });
  await test('具体型号不内置能力，未经实测的旧型号与新 ID 均未知',async()=>{
    const f=fixture();
    try {
      const cases=[['deepseek','deepseek-flash',true],['deepseek','deepseek-v4-pro',false],['openai','gpt-4.1-mini',true],['qwen','qwen-plus',false],['qwen','qwen3-vl-plus',true],['kimi','kimi-k2.6',true],['glm','glm-5.3',false],['glm','glm-5.3-flash',true]];
      for(const [provider,model,images] of cases) {
        const caps=f.api.providerModelCapabilities(provider,model);
        assert.equal(caps.known,false);assert.equal(caps.images,false);
        assert.match(f.api.modelOptionLabel(provider,model),/未确认/);
      }
      for(const provider of ['deepseek','openai','qwen','kimi','glm']) {
        const caps=f.api.providerModelCapabilities(provider,'unverified-vision-super-model');
        assert.equal(caps.known,false);assert.equal(caps.images,false);
        assert.match(f.api.modelOptionLabel(provider,'unverified-vision-super-model'),/未确认/);
      }
    } finally {f.close();}
  });
  await test('DeepSeek 历史视觉别名不再自动放行且平台能力不串用',async()=>{
    const f=fixture();
    try {
      assert.equal(f.api.providerModelCapabilities('deepseek','deepseek-v4-flash').images,false);
      assert.equal(f.api.providerModelCapabilities('deepseek','deepseek-v4-flash-vision-exp').images,false);
      assert.equal(f.api.providerModelCapabilities('openai','deepseek-flash').images,false);
    } finally {f.close();}
  });
  await test('不支持思考和搜索的平台有效设置禁用，但保留原始选项',async()=>{
    const f=fixture();
    try {
      for(const [id,model] of [['openai','gpt-4.1-mini'],['qwen','qwen-plus'],['kimi','kimi-k2.6']]) {
        const cfg=config(f,id,model,{thinking:true,search:true});
        assert.equal(cfg.thinking,false);assert.equal(cfg.search,false);
        assert.equal(f.api.readProviderSetting(id,'thinking'),true);assert.equal(f.api.readProviderSetting(id,'search'),true);
      }
      assert.equal(config(f,'glm','glm-5.3',{thinking:false}).thinking,false);
    } finally {f.close();}
  });
  await test('自定义只保存一个配置，图片能力默认关闭并需明确开启',async()=>{
    const f=fixture();
    try {
      let cfg=config(f,'custom','my-vision-model',{baseURL:'https://first.example/v1'});
      assert.equal(cfg.configured,true);assert.equal(cfg.images,false);assert.equal(f.api.modelSupportsImages(cfg.model,cfg),false);
      f.api.saveProviderSetting('images',true,'custom');cfg=f.api.readProviderConfiguration();assert.equal(cfg.images,true);
      f.api.saveProviderSetting('baseURL','https://second.example/v2/','custom');f.api.saveProviderSetting('model','replacement','custom');
      cfg=f.api.readProviderConfiguration();assert.equal(cfg.baseURL,'https://second.example/v2');assert.equal(cfg.model,'replacement');
      assert.equal([...f.storage.keys()].filter(key=>key==='cx_provider_custom_model').length,1);
    } finally {f.close();}
  });
  await test('自定义地址拒绝 HTTP、凭据、查询、锚点和完整资源端点',async()=>{
    const f=fixture();
    try {
      for(const invalid of ['http://example.com/v1','https://user:pass@example.com/v1','https://example.com/v1?key=secret','https://example.com/v1#secret','https://example.com/v1/chat/completions','https://example.com/v1/models/','not a URL']) {
        assert.throws(()=>f.api.saveProviderSetting('baseURL',invalid,'custom'));
      }
      assert.equal(f.writes.length,0);
      assert.equal(f.api.normalizeModelBaseURL(' https://gateway.example/api/v1/// '),'https://gateway.example/api/v1');
      assert.throws(()=>f.api.saveProviderSetting('baseURL','https://example.com/v1','openai'));
    } finally {f.close();}
  });
  await test('缺失 Key、模型或有效自定义地址不能视为配置完成',async()=>{
    const f=fixture();
    try {
      assert.equal(f.api.readProviderConfiguration().configured,false);
      assert.throws(()=>f.api.saveProviderKey('custom-key','custom'));
      f.storage.set('cx_provider_custom_key','custom-key');assert.equal(f.api.readProviderConfiguration('custom').configured,false);
      f.api.saveProviderSetting('model','custom-model','custom');assert.equal(f.api.readProviderConfiguration('custom').configured,false);
      f.storage.set('cx_provider_custom_baseURL','http://bad.example/v1');assert.equal(f.api.readProviderConfiguration('custom').baseURL,'');
      assert.equal(f.api.readProviderConfiguration('custom').configured,false);
    } finally {f.close();}
  });
  await test('配置签名不保存 Key 或接口明文；Key 替换可恢复，其他配置变更能识别',async()=>{
    const f=fixture();
    try {
      const cfg=config(f,'custom','my-model',{baseURL:'https://private-gateway.example/v1',key:'secret-test-key'});
      const signature=plain(f.api.modelConfigurationSignature(cfg)), serialized=JSON.stringify(signature);
      assert(!serialized.includes(cfg.key));assert(!serialized.includes(cfg.baseURL));assert(!serialized.includes('private-gateway'));
      assert.deepEqual(plain(f.api.modelConfigurationSignature({...cfg,key:'replacement-key'})),signature);
      for(const delta of [{provider:'openai'},{model:'other'},{images:true},{baseURL:'https://other.example/v1'},{thinking:true},{effort:'max'},{search:true},{videoInfoEnabled:true},{infoModel:'other-info-model'},{videoInfoIntervalSeconds:45}])
        assert.notDeepEqual(plain(f.api.modelConfigurationSignature({...cfg,...delta})),signature);
    } finally {f.close();}
  });
  await test('课程视觉模型与截图间隔按平台隔离，默认选当前平台视觉预置',async()=>{
    const f=fixture();
    try {
      for(const [id,model] of [['deepseek','deepseek-flash'],['openai','gpt-4.1-mini'],['qwen','qwen3-vl-plus'],['kimi','kimi-k2.6'],['glm','glm-5.3-flash']]) {
        assert.equal(f.api.readProviderConfiguration(id).infoModel,'');assert.equal(f.api.readProviderConfiguration(id).videoInfoIntervalSeconds,30);
      }
      f.api.saveProviderSetting('infoModel','gpt-4.1','openai');f.api.saveProviderSetting('videoInfoIntervalSeconds',45,'openai');
      assert.equal(f.api.readProviderConfiguration('openai').infoModel,'gpt-4.1');assert.equal(f.api.readProviderConfiguration('openai').videoInfoIntervalSeconds,45);
      assert.equal(f.api.readProviderConfiguration('deepseek').infoModel,'');assert.equal(f.api.readProviderConfiguration('deepseek').videoInfoIntervalSeconds,30);
    } finally {f.close();}
  });
  await test('截图间隔严格保存 5–300 秒边界，非法输入不覆盖原值',async()=>{
    const f=fixture();
    try {
      for(const value of [5,300]){f.api.saveProviderSetting('videoInfoIntervalSeconds',value,'openai');assert.equal(f.api.readProviderConfiguration('openai').videoInfoIntervalSeconds,value);}
      for(const value of [4,301,'not-number',Infinity,NaN,''])assert.throws(()=>f.api.saveProviderSetting('videoInfoIntervalSeconds',value,'openai'),/5.*300/);
      assert.equal(f.api.readProviderConfiguration('openai').videoInfoIntervalSeconds,300);
      f.storage.set('cx_provider_openai_videoInfoIntervalSeconds',999);assert.equal(f.api.readProviderConfiguration('openai').videoInfoIntervalSeconds,300);
      f.storage.set('cx_provider_openai_videoInfoIntervalSeconds',-1);assert.equal(f.api.readProviderConfiguration('openai').videoInfoIntervalSeconds,5);
      f.storage.set('cx_provider_openai_videoInfoIntervalSeconds','broken');assert.equal(f.api.readProviderConfiguration('openai').videoInfoIntervalSeconds,30);
    } finally {f.close();}
  });
  await test('自动识别信息默认开启，关闭持久化且切换平台不会重置',async()=>{
    const f=fixture(essay('q1'));let saved;
    try {
      config(f,'openai','gpt-4.1-mini');f.api.initQuizAssistant();const s=panel(f);
      assert.equal(s.getElementById('auto-context').checked,true);assert.equal(f.api.readModelConfiguration().videoInfoEnabled,true);
      s.getElementById('auto-context').checked=false;s.getElementById('auto-context').dispatchEvent(new f.w.Event('change'));
      assert.equal(f.storage.get('cx_auto_course_context'),false);assert.equal(s.getElementById('info-model').disabled,true);assert.equal(s.getElementById('info-interval').disabled,true);
      s.getElementById('provider').value='qwen';s.getElementById('provider').dispatchEvent(new f.w.Event('change'));
      assert.equal(s.getElementById('auto-context').checked,false);assert.equal(f.api.readModelConfiguration().videoInfoEnabled,false);
      assert.equal(f.requests.length,0);saved=Object.fromEntries(f.storage);
    } finally {f.close();}
    const restored=fixture(essay('q1'),{storage:saved});
    try {restored.api.initQuizAssistant();assert.equal(panel(restored).getElementById('auto-context').checked,false);}finally{restored.close();}
  });
  await test('没有接口列表和视觉实测时不预置任何识别模型',async()=>{
    const f=fixture(essay('q1'));
    try {
      f.api.initQuizAssistant();const s=panel(f);
      for(const id of ['deepseek','openai','qwen','kimi','glm']) {
        s.getElementById('provider').value=id;s.getElementById('provider').dispatchEvent(new f.w.Event('change'));
        const values=[...s.getElementById('info-model').options].map(o=>o.value);
        const expected=f.api.getModelProvider(id).models.filter(m=>m.images).map(m=>m.id);
        assert.equal(values.join(','),expected.join(','));assert.equal(s.getElementById('info-model').disabled,false);
        for(const model of values.filter(Boolean))assert.equal(f.api.providerModelCapabilities(id,model).images,true);
      }
      assert.equal(f.requests.length,0);
    } finally {f.close();}
  });
  await test('识别间隔 UI 保存有效值，非法输入反馈并恢复已保存值',async()=>{
    const f=fixture(essay('q1'));
    try {
      config(f,'openai','gpt-4.1-mini');f.api.initQuizAssistant();const s=panel(f),input=s.getElementById('info-interval');
      for(const value of [5,300]){input.value=String(value);input.dispatchEvent(new f.w.Event('change'));assert.equal(f.api.readModelConfiguration().videoInfoIntervalSeconds,value);}
      for(const value of ['4','301','']) {
        input.value=value;input.dispatchEvent(new f.w.Event('change'));assert.equal(f.api.readModelConfiguration().videoInfoIntervalSeconds,300);
        assert.match(f.api.controller.state.message,/5.*300/);assert.equal(input.value,'300');
      }
    } finally {f.close();}
  });
  await test('旧存量识别模型不在当前视觉白名单时不截图、不发 OCR 请求',async()=>{
    const f=fixture('<video></video>');
    try {
      for(const model of ['qwen-plus','unknown-vision-model','gpt-4.1-mini']) {
        const cfg=config(f,'qwen','qwen-plus',{infoModel:model});let captures=0;
        const worker=f.api.createCourseVideoInfo({...cfg,videoInfoEnabled:true},{capture:()=>{captures++;return {image:'data:image/jpeg;base64,YQ=='};}});
        assert.equal(worker.state.enabled,false);worker.observe(f.d.querySelector('video'),{force:true});await worker.flush();worker.close();assert.equal(captures,0);
      }
      assert.equal(f.requests.length,0);
    } finally {f.close();}
  });
  await test('自定义视频识别沿用当前模型且必须明确声明视觉能力',async()=>{
    const f=fixture('<video></video>'+essay('q1'));
    try {
      let cfg=config(f,'custom','custom-vision',{baseURL:'https://gateway.example/v1',infoModel:'different-old-profile'});
      let worker=f.api.createCourseVideoInfo({...cfg,videoInfoEnabled:true});assert.equal(worker.state.enabled,false);worker.close();
      f.api.saveProviderSetting('images',true,'custom');cfg=f.api.readProviderConfiguration();worker=f.api.createCourseVideoInfo({...cfg,videoInfoEnabled:true});
      assert.equal(worker.state.enabled,true);assert.equal(worker.state.model,'custom-vision');worker.close();
      f.api.initQuizAssistant();assert.equal(panel(f).getElementById('info-model').disabled,true);
      assert.equal(f.requests.length,0);
    } finally {f.close();}
  });
  for(const [provider,model,url] of [
    ['deepseek','deepseek-flash','https://api.deepseek.com/chat/completions'],
    ['openai','gpt-4.1-mini','https://api.openai.com/v1/chat/completions'],
    ['qwen','qwen-plus','https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'],
    ['kimi','kimi-k2.6','https://api.moonshot.cn/v1/chat/completions'],
    ['glm','glm-5.3','https://open.bigmodel.cn/api/paas/v4/chat/completions'],
    ['glm','glm-5.3-flash','https://open.bigmodel.cn/api/paas/v4/chat/completions'],
    ['custom','my-model','https://gateway.example/v1/chat/completions']
  ])await test(`${provider}/${model} 使用本平台端点和独立 Key，非流式请求解析为原题答案`,async()=>{
    const f=fixture(essay('q1'));
    try {
      const cfg=config(f,provider,model,provider==='custom'?{baseURL:'https://gateway.example/v1'}:{});
      const flow=f.api.askConfiguredModel(cfg,questions(f),{}), request=await pending(f);
      assert.equal(request.url,url);assert.equal(request.headers.Authorization,`Bearer ${cfg.key}`);
      const {payload}=respondAnswers(request);
      assert.equal(payload.model,model);assert.notEqual(payload.stream,true);
      if(provider==='qwen'){assert.equal(payload.enable_thinking,undefined);assert.equal(payload.thinking,undefined);}
      if(provider==='kimi'){assert.equal(payload.thinking,undefined);assert.equal(payload.temperature,undefined);}
      if(provider!=='deepseek')assert.equal(payload.response_format,undefined);
      else assert.deepEqual(payload.response_format,{type:'json_object'});
      if(provider!=='deepseek')assert.equal(payload.reasoning_effort,undefined);
      const result=await flow;assert.equal(result.answers.length,1);assert.equal(result.answers[0].answer[0],'模拟答案');
    } finally {f.close();}
  });
  for(const [provider,model,detail] of [['deepseek','deepseek-flash','original'],['openai','gpt-4.1-mini','high'],['qwen','qwen3-vl-plus',undefined],['kimi','kimi-k2.6',undefined],['glm','glm-5.3-flash',undefined],['custom','my-model',undefined]])await test(`${provider} 图文内容携带 Base64，不携带资源地址或其他平台 detail`,async()=>{
    const f=fixture(imageEssay('q1'));
    try {
      f.storage.set('cx_model_image_capabilities',fixtureImageCapabilities());
      const cfg=config(f,provider,model,provider==='custom'?{baseURL:'https://gateway.example/v1',images:true}:{});
      const extracted=f.api.extract(),prepared=await f.api.prepareQuestionMedia(extracted.media,()=>{},()=>{});
      const payload=plain(f.api.buildConfiguredAnswerPayload(cfg,extracted.questions,{},prepared));
      const content=payload.messages.find(m=>m.role==='user').content;
      assert(Array.isArray(content));const images=content.filter(part=>part.type==='image_url');assert.equal(images.length,1);
      assert.equal(images[0].image_url.url,DATA);assert.equal(images[0].image_url.detail,detail);
      const manifest=JSON.parse(content.find(part=>part.type==='text').text);
      assert.equal(manifest.questions.length,1);assert.equal(manifest.imageManifest.length,1);
      assert(!JSON.stringify(payload).includes('mooc1.chaoxing.com'));
    } finally {f.close();}
  });
  await test('文本与未知模型直接拒绝图片请求，不产生请求或自动切换平台',async()=>{
    const f=fixture(imageEssay('q1'));
    try {
      for(const [id,model] of [['qwen','qwen-plus'],['glm','glm-5.3'],['openai','unverified-vision'],['custom','looks-like-vision']]) {
        const cfg=config(f,id,model,id==='custom'?{baseURL:'https://gateway.example/v1'}:{});
        await assert.rejects(f.api.askConfiguredModel(cfg,questions(f),{}),error=>error.cxCode==='CX-CFG-004');
      }
      assert.equal(f.requests.length,0);
    } finally {f.close();}
  });
  await test('混合题用非视觉模型仅分析文字题，图片预览与题序保留',async()=>{
    const f=fixture(essay('text')+imageEssay('image'),{respond:request=>respondAnswers(request)});
    try {
      config(f,'qwen','qwen-plus');f.api.initQuizAssistant();await f.api.runAnswerFlow({autoPrefill:false});
      assert.equal(f.requests.length,1);assert.match(f.requests[0].url,/dashscope/);
      const sent=JSON.parse(JSON.parse(f.requests[0].data).messages.find(m=>m.role==='user').content);
      assert.equal(sent.questions.length,1);assert.equal(sent.questions[0].id,'text');
      const result=f.api.controller.result;assert.equal(result.questions.length,2);assert.equal(result.media.length,1);
      assert.equal(result.analyzedCount,1);assert.equal(result.skippedQuestions[0].id,'image');assert.equal(result.answers[0].id,'text');assert.equal(result.answers[1].id,'image');
      assert.equal(result.answers[1].answer.length,0);assert(panel(f).querySelector('img'));
      assert.equal(f.api.readProviderConfiguration().model,'qwen-plus');
    } finally {f.close();}
  });
  await test('获取外部模型列表使用平台地址；未知模型依然不标为视觉',async()=>{
    const f=fixture();
    try {
      const cfg=config(f,'openai','gpt-4.1-mini'), flow=f.api.fetchConfiguredModels(cfg),request=await pending(f,'GET');
      assert.equal(request.url,'https://api.openai.com/v1/models');assert.equal(request.headers.Authorization,'Bearer openai-mock-key');assert.equal(request.data,undefined);
      request.onload({status:200,responseText:JSON.stringify({data:[{id:'new-vision-model',name:'<img src=x onerror=evil()>'},{id:'  '},{id:4}]})});
      const list=await flow;assert.equal(list.length,1);assert.equal(list[0].id,'new-vision-model');
      assert.equal(f.api.providerModelCapabilities('openai',list[0].id).images,false);
    } finally {f.close();}
  });
  await test('外部列表未知视觉名称在界面明确标为未确认，名称只按文字显示',async()=>{
    const f=fixture(essay('q1'));
    try {
      config(f,'openai','gpt-4.1-mini');f.api.initQuizAssistant();const loading=f.api.controller.loadModels();
      const request=await pending(f,'GET');request.onload({status:200,responseText:JSON.stringify({data:[{id:'unknown-vision-model',name:'<img src=x onerror=evil()>'}]})});await loading;
      const s=panel(f),option=[...s.getElementById('model').options].find(o=>o.value==='unknown-vision-model');
      assert(option);assert.match(option.textContent,/图片能力未确认/);assert.match(option.textContent,/<img/);assert.equal(option.querySelector('img'),null);
      s.getElementById('model').value=option.value;s.getElementById('model').dispatchEvent(new f.w.Event('change'));
      assert.equal(f.api.readProviderConfiguration().images,false);assert.equal(s.getElementById('model').disabled,false);
    } finally {f.close();}
  });
  await test('未知列表模型主动图片实测仅发一次请求，通过后界面和识别模型列表持久可用',async()=>{
    const f=fixture(essay('q1'));let saved;
    try {
      config(f,'openai','gpt-4.1-mini');f.api.initQuizAssistant();const codes=mockChallengeCanvas(f),s=panel(f),loading=f.api.controller.loadModels();
      (await pending(f,'GET')).onload({status:200,responseText:JSON.stringify({data:[{id:'unknown-image-model'}]})});await loading;
      s.getElementById('model').value='unknown-image-model';s.getElementById('model').dispatchEvent(new f.w.Event('change'));
      assert.equal(f.api.readProviderConfiguration().images,false);s.getElementById('detect-images').click();s.getElementById('detect-images').click();
      const request=await requestAt(f,1),payload=JSON.parse(request.data);assert.equal(f.requests.length,2);assert.equal(codes.length,1);assert.match(codes[0],/^\d{6}$/);
      assert.equal(payload.model,'unknown-image-model');assert.equal(payload.stream,false);assert.equal(request.url,'https://api.openai.com/v1/chat/completions');
      const text=payload.messages.flatMap(m=>typeof m.content==='string'?[m.content]:m.content.filter(p=>p.type==='text').map(p=>p.text)).join('\n');
      assert(!text.includes(codes[0]));assert.equal(payload.messages[1].content.filter(p=>p.type==='image_url').length,1);
      response(request,JSON.stringify({code:codes[0]}));await waitIdle(f);
      assert.equal(f.api.readProviderConfiguration().images,true);assert.match(s.getElementById('model').selectedOptions[0].textContent,/已实测/);
      assert([...s.getElementById('info-model').options].some(option=>option.value==='unknown-image-model'));
      assert.equal(f.api.providerModelCapabilities('openai','unknown-image-model').thinking,false);
      f.api.controller.openPanel('model');assert.match(s.getElementById('model-capability').textContent,/已通过/);saved=Object.fromEntries(f.storage);
    } finally {f.close();}
    const reopened=fixture(essay('q1'),{storage:saved});
    try {reopened.api.initQuizAssistant();const s=panel(reopened);assert.equal(reopened.api.readProviderConfiguration().images,true);assert.match(s.getElementById('model').selectedOptions[0].textContent,/已实测/);assert([...s.getElementById('info-model').options].some(option=>option.value==='unknown-image-model'));assert.equal(reopened.requests.length,0);}finally{reopened.close();}
  });
  await test('图片能力实测取消后晚成功响应不缓存，恢复控件并允许重试',async()=>{
    const f=fixture(essay('q1'));
    try {
      config(f,'openai','unknown-image-model');f.api.initQuizAssistant();const codes=mockChallengeCanvas(f),s=panel(f);
      s.getElementById('detect-images').click();const request=await pending(f);assert.equal(s.getElementById('detect-images').disabled,true);assert.equal(s.getElementById('cancel-images').hidden,false);
      s.getElementById('cancel-images').click();await waitIdle(f);response(request,JSON.stringify({code:codes[0]}));await pause(2);
      assert.equal(f.aborts,1);assert.equal(f.api.readProviderConfiguration().images,false);assert.equal(f.storage.get('cx_model_image_capabilities'),undefined);
      assert.equal(s.getElementById('detect-images').disabled,false);assert.equal(s.getElementById('provider').disabled,false);assert.equal(s.getElementById('cancel-images').hidden,true);
      assert.match(f.api.controller.state.message,/已取消/);assert.equal(f.requests.length,1);
    } finally {f.close();}
  });
  await test('旧型号也必须通过图片实测，不能凭内置名字免测',async()=>{
    for(const model of ['qwen-plus','qwen3-vl-plus']) {
      const f=fixture(essay('q1'));
      try {config(f,'qwen',model);f.api.initQuizAssistant();const codes=mockChallengeCanvas(f);panel(f).getElementById('detect-images').click();
        const request=await pending(f);assert.equal(codes.length,1);assert.equal(f.requests.length,1);
        response(request,JSON.stringify({code:codes[0]}));await waitIdle(f);
        assert.equal(f.api.readProviderConfiguration().images,true);assert.equal(f.api.controller.state.busy,false);
      }finally{f.close();}
    }
  });
  await test('图片选项的题目可在视觉平台分析，返回的选项字母与原题绑定',async()=>{
    const html=`<div class="TiMu" questionid="choice"><h3 class="stem">【单选题】选择图中的答案</h3><label><input type="radio" value="A" name="choice"><img src="${DATA}" alt="A图"></label><label><input type="radio" value="B" name="choice">B 另一项</label></div>`;
    const f=fixture(html);
    try {
      f.storage.set('cx_model_image_capabilities',fixtureImageCapabilities());config(f,'openai','gpt-4.1-mini');f.api.initQuizAssistant();const flow=f.api.runAnswerFlow({autoPrefill:false}),request=await pending(f);
      const payload=JSON.parse(request.data),content=payload.messages.find(m=>m.role==='user').content;
      assert(Array.isArray(content));assert.equal(content.filter(p=>p.type==='image_url').length,1);
      response(request,JSON.stringify({answers:[{id:'choice',answer:['A'],reason:'模拟识图'}]}));await flow;
      const result=f.api.controller.result;assert.equal(result.answers[0].answer[0],'A');assert.equal(result.media[0].location,'option');assert.equal(result.media[0].optionKey,'A');
      assert.equal(f.d.querySelector('input[value="A"]').checked,false);
    } finally {f.close();}
  });
  await test('视觉平台读取超星图片的 GET 不携带模型 Key，POST 才用本平台 Key',async()=>{
    const f=fixture(essay('q1','解释表格<img src="https://p.ananas.chaoxing.com/test-table.png">'));
    try {
      f.storage.set('cx_model_image_capabilities',fixtureImageCapabilities());config(f,'openai','gpt-4.1-mini');f.api.initQuizAssistant();const flow=f.api.runAnswerFlow({autoPrefill:false});
      const media=await requestAt(f,0);assert.equal(media.method,'GET');assert.equal(media.responseType,'arraybuffer');
      assert.equal(media.headers?.Authorization,undefined);assert.equal(media.headers?.['x-api-key'],undefined);
      assert(!JSON.stringify(media).includes('openai-mock-key'));
      const bytes=Uint8Array.from(Buffer.from(PNG,'base64'));media.onload({status:200,response:bytes.buffer,finalUrl:media.url});
      const request=await requestAt(f,1);assert.equal(request.method,'POST');assert.equal(request.headers.Authorization,'Bearer openai-mock-key');
      respondAnswers(request);await flow;assert.equal(f.api.controller.result.analyzedCount,1);
    } finally {f.close();}
  });
  await test('Qwen 独立 16 MiB 上限在发送前拒绝，其他平台仍用通用限制',async()=>{
    const f=fixture();
    try {
      const payload={messages:[{content:'x'.repeat(16*1024*1024)}]};
      assert.throws(()=>f.api.assertConfiguredRequestSize({provider:'qwen'},payload),/16 MiB/);
      assert.doesNotThrow(()=>f.api.assertConfiguredRequestSize({provider:'openai'},payload));
      assert.equal(f.requests.length,0);
    } finally {f.close();}
  });
  for(const [name,content,extra,code] of [['非法 JSON','not-json',{},'CX-RES-005'],['截断输出','{"answers":[]}',{finish_reason:'length'},'CX-RES-004'],['空内容','',{},'CX-RES-003']])await test(`模型响应 ${name} 无法形成可预填答案`,async()=>{
    const f=fixture(essay('q1'));
    try {
      const flow=f.api.askConfiguredModel(config(f,'glm','glm-5.3-flash'),questions(f),{}),reject=assert.rejects(flow,error=>error.cxCode===code);
      response(await pending(f),content,extra);await reject;assert.equal(f.d.querySelector('textarea').value,'');
    } finally {f.close();}
  });
  await test('返回未知题号拒绝整个响应，不套用到其他题目',async()=>{
    const f=fixture(essay('q1'));
    try {
      const flow=f.api.askConfiguredModel(config(f,'glm','glm-5.3-flash'),questions(f),{});
      const rejected=assert.rejects(flow,error=>error.cxCode==='CX-RES-006');
      response(await pending(f),JSON.stringify({answers:[{id:'foreign',answer:['错误归属答案']}]}));
      await rejected;
      assert.equal(f.d.querySelector('textarea').value,'');
    } finally {f.close();}
  });
  await test('取消待返回请求执行 abort，晚到有效答案不恢复结果',async()=>{
    const f=fixture(essay('q1'));
    try {
      const abort=new f.w.AbortController(),flow=f.api.askConfiguredModel(config(f,'openai','gpt-4.1-mini'),questions(f),{},new Map(),abort.signal);
      const rejected=assert.rejects(flow,error=>error.name==='AbortError'),request=await pending(f);abort.abort();respondAnswers(request);await rejected;
      assert.equal(f.aborts,1);assert.equal(f.d.querySelector('textarea').value,'');
      await assert.rejects(f.api.askConfiguredModel(f.api.readProviderConfiguration(),questions(f),{},new Map(),abort.signal),error=>error.name==='AbortError');
      assert.equal(f.requests.length,1);
    } finally {f.close();}
  });
  await test('401 服务端回显当前 mock Key 时对外错误脱敏，HTTP 状态和错误码保留',async()=>{
    const f=fixture(essay('q1'));
    try {
      const cfg=config(f,'openai','gpt-4.1-mini',{key:'mock.key+$provider-test'});
      const flow=f.api.askConfiguredModel(cfg,questions(f),{});
      const rejected=assert.rejects(flow,error=>{
        assert.equal(error.code,'HTTP');assert.equal(error.status,401);assert.match(error.message,/HTTP 401/);
        assert(!error.message.includes(cfg.key));return true;
      });
      (await pending(f)).onload({status:401,responseText:JSON.stringify({error:{message:`invalid key ${cfg.key}; echoed twice ${cfg.key}`}})});
      await rejected;
    } finally {f.close();}
  });
  await test('认证错误报告不显示服务端回显的当前 mock Key',async()=>{
    const f=fixture(essay('q1'));
    try {
      const cfg=config(f,'openai','gpt-4.1-mini',{key:'mock-reported-provider-key'});f.api.initQuizAssistant();
      const flow=f.api.runAnswerFlow({autoPrefill:false});
      (await pending(f)).onload({status:401,responseText:JSON.stringify({error:{message:`invalid key ${cfg.key}`}})});await flow;
      assert.equal(f.api.controller.task.status,'failed');assert.equal(f.api.controller.state.busy,false);
      assert(!f.api.controller.state.message.includes(cfg.key));assert(!panel(f).textContent.includes(cfg.key));
    } finally {f.close();}
  });
  await test('其他平台保留 DeepSeek 搜索配置但实际不会向 DeepSeek 发送请求',async()=>{
    const f=fixture(essay('q1'),{storage:{deepseek_api_key:'deepseek-secret',cx_search:true},respond:request=>respondAnswers(request)});
    try {
      config(f,'openai','gpt-4.1-mini',{search:true});f.api.initQuizAssistant();await f.api.runAnswerFlow({autoPrefill:false});
      assert.equal(f.requests.length,1);assert.match(f.requests[0].url,/api\.openai\.com/);
      assert.equal(f.requests[0].headers.Authorization,'Bearer openai-mock-key');assert.equal(f.api.controller.result.searchEnabled,false);
      assert.equal(f.api.readProviderConfiguration('deepseek').search,true);assert.equal(f.storage.get('deepseek_api_key'),'deepseek-secret');
    } finally {f.close();}
  });
  await test('未配置时显示模型提示，不启动分析或付费请求',async()=>{
    const f=fixture(essay('q1'));
    try {
      f.api.initQuizAssistant();await f.api.runAnswerFlow({autoPrefill:false});
      assert.equal(f.requests.length,0);assert.equal(f.api.controller.state.busy,false);
      assert.match(f.api.controller.state.message,/先配置模型/);assert.equal(panel(f).getElementById('model-setup-notice').hidden,false);
    } finally {f.close();}
  });
  await test('分析期间平台、Key 和自定义配置锁定，程序触发 change 也不会串 Key',async()=>{
    const f=fixture(essay('q1'));
    try {
      f.storage.set('cx_model_image_capabilities',fixtureImageCapabilities());config(f,'openai','gpt-4.1-mini');f.api.initQuizAssistant();const flow=f.api.runAnswerFlow({autoPrefill:false});
      const request=await pending(f),s=panel(f);
      for(const id of ['provider','model','custom-base','custom-model','custom-images','save-custom','auto-context','info-model','info-interval'])assert.equal(s.getElementById(id).disabled,true);
      assert(f.api.credentialEditor.input.disabled);f.api.credentialEditor.input.value='busy-replacement-key';f.api.credentialEditor.save.click();
      assert.equal(f.prompts.length,0);assert.equal(f.api.readProviderConfiguration().key,'openai-mock-key');
      s.getElementById('provider').value='glm';s.getElementById('provider').dispatchEvent(new f.w.Event('change'));
      assert.equal(f.api.readProviderConfiguration().provider,'openai');assert.equal(request.headers.Authorization,'Bearer openai-mock-key');
      respondAnswers(request);await flow;assert.equal(s.getElementById('provider').disabled,false);
      assert.equal(f.api.controller.state.busy,false);
    } finally {f.close();}
  });
  await test('课程运行锁定自动识别、识别模型和间隔，程序 change 也不能写入配置',async()=>{
    const f=fixture('<div id="mainid"><iframe id="iframe"></iframe></div>'+essay('q1'),{url:'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=mock-course&clazzid=mock-class&cpi=mock-account'});
    try {
      f.storage.set('cx_model_image_capabilities',fixtureImageCapabilities());config(f,'openai','gpt-4.1-mini');const lease=f.d.createElement('div');lease.id='cx-ai-course-lease';lease.setAttribute('data-run-id','mock-active-run');f.d.body.append(lease);
      f.api.initQuizAssistant();const s=panel(f),before=f.writes.length;
      for(const id of ['auto-context','info-model','info-interval','detect-images'])assert.equal(s.getElementById(id).disabled,true);
      s.getElementById('auto-context').checked=false;s.getElementById('info-model').value='gpt-4.1';s.getElementById('info-interval').value='45';
      for(const id of ['auto-context','info-model','info-interval'])s.getElementById(id).dispatchEvent(new f.w.Event('change'));
      s.getElementById('detect-images').click();
      assert.equal(f.writes.length,before);assert.equal(f.api.readModelConfiguration().videoInfoEnabled,true);assert.equal(f.api.readModelConfiguration().infoModel,'gpt-4.1-mini');assert.equal(f.api.readModelConfiguration().videoInfoIntervalSeconds,30);
      lease.removeAttribute('data-run-id');f.d.dispatchEvent(new f.w.Event('cx-ai-course-update'));
      for(const id of ['auto-context','info-model','info-interval'])assert.equal(s.getElementById(id).disabled,false);
      assert.equal(f.requests.length,0);
    } finally {f.close();}
  });
  await test('完成后切换平台使旧分析过期并撤销预填资格',async()=>{
    const f=fixture(essay('q1'),{respond:request=>respondAnswers(request)});
    try {
      config(f,'openai','gpt-4.1-mini');f.api.initQuizAssistant();await f.api.runAnswerFlow({autoPrefill:false});
      assert(f.api.controller.last);const s=panel(f);s.getElementById('provider').value='glm';s.getElementById('provider').dispatchEvent(new f.w.Event('change'));
      assert.equal(f.api.controller.last,null);assert.equal(f.api.controller.task.status,'stale');assert.equal(s.getElementById('prefill').disabled,true);
      assert.equal(s.getElementById('search').disabled,true);assert.equal(s.getElementById('thinking').disabled,true);
    } finally {f.close();}
  });
  await test('自定义未保存的视觉开关不改变配置，明确保存后才允许图片',async()=>{
    const f=fixture(essay('q1'));
    try {
      config(f,'custom','my-model',{baseURL:'https://gateway.example/v1'});f.api.initQuizAssistant();const s=panel(f);
      assert.equal(s.getElementById('preset-model-block').hidden,true);assert.equal(s.getElementById('custom-model-block').hidden,false);
      s.getElementById('custom-images').checked=true;s.getElementById('custom-images').dispatchEvent(new f.w.Event('change'));
      assert.equal(f.api.readProviderConfiguration().images,false);s.getElementById('save-custom').click();
      assert.equal(f.api.readProviderConfiguration().images,true);assert.match(s.getElementById('model-capability').textContent,/视觉/);
      assert.equal(f.requests.length,0);
    } finally {f.close();}
  });
  await test('认证失败后更正同平台 Key 可重试未完成批次，成功批次保留且不重发',async()=>{
    const f=fixture(Array.from({length:11},(_,i)=>essay(`q${i+1}`)).join(''));
    try {
      config(f,'openai','gpt-4.1-mini');f.api.initQuizAssistant();const firstFlow=f.api.runAnswerFlow({autoPrefill:false});
      respondAnswers(await requestAt(f,0));const failed=await requestAt(f,1);
      failed.onload({status:401,responseText:JSON.stringify({error:{message:'invalid mock key'}})});await firstFlow;
      assert.equal(f.api.controller.task.status,'failed');assert.equal(f.api.controller.result.analyzedCount,10);assert.equal(f.api.controller.last,null);
      f.api.credentialEditor.input.value='corrected-key';f.api.credentialEditor.save.click();
      assert.equal(f.api.controller.task.status,'failed');assert.equal(f.api.readProviderConfiguration().key,'corrected-key');
      const resumed=f.api.resumeAnalysisTask(),request=await requestAt(f,2);assert.equal(request.headers.Authorization,'Bearer corrected-key');
      const {sent}=respondAnswers(request);assert.equal(sent.questions.length,1);assert.equal(sent.questions[0].id,'q11');await resumed;
      assert.equal(f.requests.length,3);assert.equal(f.api.controller.result.analyzedCount,11);assert.equal(f.api.controller.task.status,'complete');
      assert.equal(f.api.controller.result.answers.map(a=>a.id).join(','),Array.from({length:11},(_,i)=>`q${i+1}`).join(','));
      assert.equal(f.api.controller.state.busy,false);
    } finally {f.close();}
  });
}
main().then(() => {
  for (const line of logs) console.log(line);
  for (const failure of failures) console.error(`FAIL ${failure}`);
  console.log(`Model provider checks: ${logs.length} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
}).catch(error => {console.error(error.stack); process.exitCode = 1;});
