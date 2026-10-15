// Offline contract tests: no browser, provider or course network requests.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../sources/assistant-errors.js'),'utf8');
const providers=fs.readFileSync(path.join(__dirname,'../sources/model-providers.js'),'utf8');
const core=fs.readFileSync(path.join(__dirname,'../sources/assistant-core.js'),'utf8');
const requestSource=core.slice(core.indexOf('    let assistantRequestSequence'),core.indexOf('    async function fetchModels('));
let passed=0,failed=0;
function fixture() {
  const requests=[];
  const runtime={URL,Blob,Map,Set,WeakMap,Math,Date,Object,Number,String,JSON,
    PROVIDER_LOGOS:{},DEEPSEEK_BASE:'https://api.deepseek.com',KEY_DS:'key',KEY_MODEL:'model',KEY_THINKING:'thinking',KEY_EFFORT:'effort',KEY_SEARCH:'search',
    get:(_key,fallback)=>fallback,set(){},clean:value=>String(value??'').replace(/\s+/g,' ').trim(),
    throwIfAborted(signal){if(signal?.aborted){const error=new Error('cancelled');error.name='AbortError';error.code='ABORTED';throw error;}},
    assertRequestSize(){},questionLocalAnswerPolicy:q=>q.answerPolicy || {status:'needs-classification'},
    requestJSON:async request=>{requests.push(request);return runtime.response;}};
  vm.runInNewContext(source+'\n'+providers+'\nthis.api={createCxError,normalizeCxError,recordCxDiagnostic,exportCxDiagnostics,CX_ERROR_CATALOG,configuredModelJSON,detectConfiguredModelConnection,fetchConfiguredModels,normalizeAnswerPolicies,assertConfiguredCredentials};',runtime);
  return {api:runtime.api,runtime,requests};
}
const settings={provider:'openai',baseURL:'https://api.openai.com/v1',key:'never-export-secret',model:'remote-list-model'};
const payload={model:settings.model,messages:[{role:'user',content:'test'}]};
async function test(name,run) {try{await run();passed++;console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name+'\n'+error.stack);}}
function exported(f){return JSON.parse(f.api.exportCxDiagnostics()).diagnostics;}
function requestFixture() {
  const requests=[];let aborts=0;
  const runtime={URL,Blob,Map,Set,WeakMap,Math,Date,Object,Number,String,JSON,assertRequestSize(){},
    GM_xmlhttpRequest(request){requests.push(request);return {abort(){aborts++;request.onabort?.();}};}};
  vm.runInNewContext(source+'\n'+requestSource+'\nthis.api={requestJSON,normalizeCxError};',runtime);
  return {api:runtime.api,requests,get aborts(){return aborts;}};
}
async function main() {
  await test('完整固定目录可创建且消息只能来自目录',()=>{
    const f=fixture();for(const [code,message] of Object.entries(f.api.CX_ERROR_CATALOG)){
      const error=f.api.createCxError(code);assert.equal(error.cxCode,code);assert.equal(error.code,code);assert.equal(error.message,message);
    }
  });
  for(const [legacy,cx] of Object.entries({NETWORK:'CX-NET-001',TIMEOUT:'CX-NET-002',BAD_JSON:'CX-RES-001',BAD_RESPONSE:'CX-RES-002',
    EMPTY_REPLY:'CX-RES-003',MODEL_ERROR:'CX-RES-007',NO_API_KEY:'CX-CFG-001',NO_MODEL:'CX-CFG-002',NO_ENDPOINT:'CX-CFG-003',
    ENDPOINT_NOT_APPROVED:'CX-CFG-005',ABORTED:'CX-EXE-005',COURSE_TIMEOUT:'CX-EXE-007',COURSE_FAILURE_LIMIT:'CX-EXE-008',COURSE_FRAME_UNAVAILABLE:'CX-MAT-004'})) {
    await test('旧错误 '+legacy+' 保留控制语义并映射 '+cx,()=>{
      const f=fixture(),original={code:legacy,message:'unsafe server content'};
      const diag=f.api.normalizeCxError(original);assert.equal(diag.code,cx);assert.equal(diag.legacyCode,legacy);assert.equal(original.code,legacy);
      const created=f.api.createCxError(cx,{}, {legacyCode:legacy});assert.equal(created.code,legacy);assert.equal(created.cxCode,cx);
    });
  }
  await test('非 JSON HTTP 401/500 仍保持 HTTP 主语义',()=>{
    const f=fixture();for(const status of [401,500,599]){
      const error=f.api.createCxError(`CX-HTTP-${status}`,{json:false},{legacyCode:'HTTP',status});
      const diag=f.api.normalizeCxError(error);assert.equal(error.code,'HTTP');assert.equal(diag.code,`CX-HTTP-${status}`);assert.equal(diag.httpStatus,status);assert.match(diag.message,new RegExp('HTTP '+status));
    }
  });
  for(const [status,body,code,legacy] of [[401,'<html>unauthorized partial-key</html>','CX-HTTP-401','HTTP'],[500,'bad gateway raw secret','CX-HTTP-500','HTTP'],[200,'not-json','CX-RES-001','BAD_JSON'],[0,'','CX-NET-001','NETWORK']]){
    await test(`真实 requestJSON HTTP ${status} 优先分类且不泄漏原响应`,async()=>{
      const f=requestFixture(),promise=f.api.requestJSON({method:'POST',url:'https://gateway.example/v1',key:'key'});
      const rejection=assert.rejects(promise,error=>{assert.equal(error.code,legacy);assert.equal(error.cxCode,code);assert(!error.message.includes('partial-key'));assert(!error.message.includes('raw secret'));return true;});
      f.requests[0].onload({status,responseText:body});await rejection;
    });
  }
  await test('真实 requestJSON onerror 不因内容或离线猜测具体失败',async()=>{
    const f=requestFixture(),promise=f.api.requestJSON({method:'GET',url:'https://gateway.example/models',key:'key'});
    const rejection=assert.rejects(promise,e=>e.code==='NETWORK' && e.cxCode==='CX-NET-001');
    f.requests[0].onerror({message:'DNS permission denied offline'});await rejection;
  });
  await test('真实 requestJSON 超时保留 TIMEOUT 供原重试逻辑使用',async()=>{
    const f=requestFixture(),promise=f.api.requestJSON({method:'GET',url:'https://gateway.example/models',key:'key'});
    const rejection=assert.rejects(promise,e=>e.code==='TIMEOUT' && e.cxCode==='CX-NET-002');f.requests[0].ontimeout();await rejection;
  });
  await test('真实 requestJSON 取消后迟到响应不能恢复请求',async()=>{
    const f=requestFixture(),controller=new AbortController(),promise=f.api.requestJSON({method:'POST',url:'https://gateway.example/v1',key:'key',signal:controller.signal});
    const rejection=assert.rejects(promise,e=>e.name==='AbortError' && e.code==='ABORTED' && e.cxCode==='CX-EXE-005');
    controller.abort();f.requests[0].onload({status:200,responseText:'{}'});await rejection;assert.equal(f.aborts,1);
  });
  await test('未知 onerror/离线辅助值/原始文本不猜测底层原因',()=>{
    const f=fixture();for(const message of ['offline permission denied DNS TLS connection refused','白名单错误 网络断开','https://secret.invalid/?token=KEY']){
      const result=f.api.normalizeCxError({code:'NETWORK',message},{online:false});assert.equal(result.code,'CX-NET-001');assert.equal(result.diagnostics.online,false);assert(!result.message.includes(message));
    }
    assert.equal(f.api.normalizeCxError({code:'toString'}).code,'CX-SYS-002');
  });
  await test('只保留可靠显式网络证据对应的已分类错误',()=>{
    const f=fixture();for(let n=3;n<=7;n++){const code=`CX-NET-00${n}`;assert.equal(f.api.normalizeCxError(f.api.createCxError(code)).code,code);}
  });
  await test('取消和人工处理不是普通失败，429 不扩大自动重试范围',()=>{
    const f=fixture();const cancelled=f.api.createCxError('CX-EXE-005',{}, {legacyCode:'ABORTED'});assert.equal(cancelled.name,'AbortError');assert.equal(f.api.normalizeCxError(cancelled).severity,'info');
    assert.equal(f.api.normalizeCxError({code:'COURSE_MANUAL_ANSWER_REQUIRED'}).severity,'info');
    assert.equal(f.api.normalizeCxError({code:'HTTP',status:429}).retryable,false);
    for(const status of [502,503,504])assert.equal(f.api.normalizeCxError({code:'HTTP',status}).retryable,true);
  });
  await test('完整和部分 Key/账号/URL 参数/题目/答案/响应/HTML 均不导出',()=>{
    const f=fixture(),secret='sk-full-secret-abcdef',partial='secret-abcdef',raw='<div>题目全文 答案 私人账号</div>';
    const error=f.api.createCxError('CX-NET-001',{module:'request',operation:'request',taskId:secret,requestId:partial,
      endpoint:'https://gateway.example/v1?token='+secret,questionCount:2,rawResponse:raw,headers:{Authorization:'Bearer '+secret},
      message:partial,reason:raw,evidence:[raw,'frame-chain'],url:secret,phase:secret,accountId:raw},{legacyCode:'NETWORK',cause:new Error(raw)});
    error.response=raw;error.stack=secret;f.api.recordCxDiagnostic(error,{module:secret,operation:partial,question:raw,answer:raw});
    const json=f.api.exportCxDiagnostics();for(const forbidden of [secret,partial,raw,'Authorization','token=','/v1','rawResponse','accountId'])assert(!json.includes(forbidden),forbidden);
    const entry=exported(f)[0];assert.equal(entry.diagnostics.endpointHost,'gateway.example');assert.equal(entry.diagnostics.questionCount,2);assert.deepEqual(entry.diagnostics.evidence,['frame-chain']);assert.equal(entry.module,'request');
    assert(!Object.hasOwn(error,'cause'));assert(!Object.hasOwn(error,'context'));
  });
  await test('不可信诊断对象无法注入公共消息或任意字段',()=>{
    const f=fixture();f.api.recordCxDiagnostic({code:'CX-RES-003',message:'secret-msg',legacyCode:'secret-code',severity:'secret',module:'secret-module',diagnostics:{answer:'secret-answer',bytes:20}});
    assert(!f.api.exportCxDiagnostics().includes('secret'));assert.equal(exported(f)[0].diagnostics.bytes,20);
  });
  await test('同一异常传播只记录一次，记录不可被调用者注入',()=>{
    const f=fixture(),error=f.api.createCxError('CX-PAR-008',{module:'context',operation:'snapshot',evidence:['node-replaced']});
    const a=f.api.recordCxDiagnostic(error),b=f.api.recordCxDiagnostic(error),c=f.api.recordCxDiagnostic(a);
    assert.equal(a,b);assert.equal(a,c);assert.equal(exported(f).length,1);assert(Object.isFrozen(a));assert(Object.isFrozen(a.diagnostics.evidence));
  });
  await test('100 条内存环形缓冲丢弃最旧，刷新实例清空',()=>{
    const f=fixture();for(let i=0;i<105;i++)f.api.recordCxDiagnostic(f.api.createCxError('CX-NET-001',{count:i}));
    assert.equal(exported(f).length,100);assert.equal(exported(f)[0].diagnostics.count,5);assert.equal(exported(f).at(-1).diagnostics.count,104);
    assert.equal(exported(fixture()).length,0);
  });
  await test('安全的本地关联 ID/阶段/计数可导出',()=>{
    const f=fixture();f.api.recordCxDiagnostic(f.api.createCxError('CX-PAR-008',{module:'context',operation:'snapshot',taskId:'cx-task-example-123',requestId:'cx-request-example-456',phase:'analyzing',count:3,elapsedMs:5,batchIndex:2,batchCount:3,evidence:['ancestor-frame-container']}));
    const item=exported(f)[0];assert.equal(item.taskId,'cx-task-example-123');assert.equal(item.requestId,'cx-request-example-456');assert.equal(item.elapsedMs,5);assert.equal(item.diagnostics.phase,'analyzing');assert.equal(item.diagnostics.batchIndex,2);assert.equal(item.diagnostics.batchCount,3);assert.deepEqual(item.diagnostics.evidence,['ancestor-frame-container']);
  });
  for(const [name,response,code] of [
    ['业务错误',{error:{message:'raw key: partial-secret',code:'vendor-secret'}},'CX-RES-007'],
    ['缺少必要响应字段',{},'CX-RES-002'],
    ['缺少 message',{choices:[{finish_reason:'stop'}]},'CX-RES-002'],
    ['缺少 finish_reason',{choices:[{message:{content:'{"answers":[]}'}}]},'CX-RES-002'],
    ['缺少 content',{choices:[{finish_reason:'stop',message:{}}]},'CX-RES-002'],
    ['非法 content 类型',{choices:[{finish_reason:'stop',message:{content:{unexpected:true}}}]},'CX-RES-005'],
    ['截断',{choices:[{finish_reason:'length',message:{content:'{"answers":[]}'}}]},'CX-RES-004'],
    ['未知结束状态',{choices:[{finish_reason:'tool_calls',message:{content:'{"answers":[]}'}}]},'CX-RES-005'],
    ['空消息',{choices:[{finish_reason:'stop',message:{content:''}}]},'CX-RES-003'],
    ['模型消息非法 JSON',{choices:[{finish_reason:'stop',message:{content:'not JSON'}}]},'CX-RES-005'],
    ['模型结构为 null',{choices:[{finish_reason:'stop',message:{content:'null'}}]},'CX-RES-005']]) {
    await test('HTTP 成功 '+name+' 使用独立响应错误',async()=>{
      const f=fixture();f.runtime.response=response;
      await assert.rejects(f.api.configuredModelJSON(settings,payload),error=>{assert.equal(error.cxCode,code);assert(!error.message.includes('partial-secret'));return true;});
      assert.equal(f.requests.length,1);
    });
  }
  await test('有效 JSON 响应保持协议和 usage',async()=>{
    const f=fixture();f.runtime.response={choices:[{finish_reason:'stop',message:{content:'{"answers":[]}'}}],usage:{total_tokens:2}};
    const result=await f.api.configuredModelJSON(settings,payload);assert.equal(result.parsed.answers.length,0);assert.equal(result.usage.total_tokens,2);
  });
  await test('检测消息保留 Hi 且业务错误文本不泄漏',async()=>{
    const f=fixture();f.runtime.response={error:{message:'partial-secret'}};
    await assert.rejects(f.api.detectConfiguredModelConnection(settings),error=>error.code==='MODEL_ERROR' && error.cxCode==='CX-RES-007' && !error.message.includes('partial-secret'));
    assert.equal(f.requests[0].data.messages[0].content,'Hi');
  });
  await test('模型列表业务错误/缺字段不冒充网络错误',async()=>{
    const f=fixture();f.runtime.response={error:{message:'unsafe'}};await assert.rejects(f.api.fetchConfiguredModels(settings),e=>e.cxCode==='CX-RES-007');
    f.runtime.response={data:[]};await assert.rejects(f.api.fetchConfiguredModels(settings),e=>e.cxCode==='CX-RES-002');
  });
  await test('缺 Key/模型/端点及明确凭据未授权不发送请求',()=>{
    const f=fixture();for(const [change,code] of [[{key:''},'CX-CFG-001'],[{model:''},'CX-CFG-002'],[{provider:'custom',baseURL:''},'CX-CFG-003'],[{credentialNeedsApproval:true},'CX-CFG-005']]){
      assert.throws(()=>f.api.assertConfiguredCredentials({...settings,...change}),e=>e.cxCode===code);
    }
    assert.equal(f.requests.length,0);
  });
  await test('分类重复 ID/遗漏降级人工并只记录安全数量',()=>{
    const f=fixture(),questions=[{id:'q1'},{id:'q2'}];
    const policy={id:'q1',status:'auto',category:'knowledge',reason:'valid'};
    const result=f.api.normalizeAnswerPolicies({classifications:[policy,policy]},questions);
    assert.equal(result.get('q1').status,'uncertain');assert.equal(result.get('q2').status,'uncertain');
    assert.equal(exported(f)[0].code,'CX-RES-006');assert(!f.api.exportCxDiagnostics().includes('q1'));
  });
  await test('本地已拦截人工题不被计入分类请求数量',()=>{
    const f=fixture(),manual={status:'manual',category:'handwriting',reason:'manual'},questions=[{id:'q1'},{id:'q2',answerPolicy:manual}];
    const result=f.api.normalizeAnswerPolicies({classifications:[{id:'q1',status:'auto',category:'knowledge',reason:'valid'}]},questions);
    assert.equal(result.get('q1').status,'auto');assert.equal(result.get('q2').status,'manual');assert.equal(exported(f).length,0);
  });
  console.log(`Error checks: ${passed} passed, ${failed} failed`);if(failed)process.exitCode=1;
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
