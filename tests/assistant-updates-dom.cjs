const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'../学习通AI助手.user.js'),'utf8').replace(/\r\n/g,'\n');
const entry="    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startQuizObserver, { once: true });\n    else startQuizObserver();";
assert(source.includes(entry));
const logs=[],failures=[];const delay=()=>new Promise(r=>setTimeout(r,0));
async function test(name,fn){try{await fn();logs.push('PASS '+name);}catch(e){failures.push(name+': '+e.stack);}}
const release=(tag='v1.17')=>script(tag.replace(/^v/,''));
const script=(version='1.17')=>`// ==UserScript==\n// @namespace    local.chaoxing.quiz\n// @version      ${version}\n// ==/UserScript==\n(()=>{})();\n`;
function fixture(initial={},strict=false){
 const errors=[],vconsole=new VirtualConsole();vconsole.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM('<div class="TiMu" questionid="q1"><h3 class="stem">【简答题】模拟题目</h3><textarea></textarea></div>',{url:'https://mooc1.chaoxing.com/work/doHomeWorkNew',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vconsole});
 const w=dom.window,storage=new Map([['deepseek_api_key','mock-private-key'],...Object.entries(initial)]),requests=[],opened=[],listeners=new Map();
 let aborts=0;
 w.GM_getValue=(k,f)=>storage.has(k)?storage.get(k):f;w.GM_setValue=(k,v)=>{storage.set(k,v);listeners.get(k)?.(k,null,v,false);};w.GM_getResourceText=()=> '{}';
 w.GM_registerMenuCommand=()=>{};w.GM_addValueChangeListener=(k,fn)=>{listeners.set(k,fn);return k;};w.GM_removeValueChangeListener=k=>listeners.delete(k);
 w.GM_xmlhttpRequest=r=>{requests.push(r);return {abort(){aborts++;r.onabort?.();}};};w.open=(url,target,features)=>{opened.push({url,target,features});return null;};w.alert=()=>{};
 let code=source.replace(entry,'globalThis.updateAPI={initQuizAssistant,checkAssistantUpdates,assistantVersionIsNewer,assistantUpdateDownloadURL,renderAssistantUpdates,setAssistantUiHidden,get pending(){return assistantUpdatePending},get controller(){return controller}};');
 if(!strict)code=code.replace('/* TRUSTED_ASSISTANT_ACTIVATION */','return true; /* fixture only */');
 w.eval(code);w.updateAPI.initQuizAssistant();
 return {w,api:w.updateAPI,requests,storage,opened,listeners,errors,get s(){return w.document.getElementById('cx-ai-study-root').shadowRoot;},get aborts(){return aborts;},
  reply(index,body,status=200,extra={}){const r=requests[index];assert(r,'request missing '+index);r.onload({status,responseText:typeof body==='string'?body:JSON.stringify(body),...extra});},
  async newer(){const done=this.api.checkAssistantUpdates(true);this.reply(0,release());await delay();assert.equal(requests.length,2);this.reply(1,script());await done;},
  close(){w.dispatchEvent(new w.Event('pagehide'));dom.window.close();}};
}
(async()=>{
 await test('项目版本比较支持两位小数和跨主版本，不接受伪造标签',()=>{const f=fixture();try{for(const value of ['v1.17','2.00'])assert(f.api.assistantVersionIsNewer(value));for(const value of ['v1.16','1.09','v1.17-beta','1.0.13','<img>'])assert(!f.api.assistantVersionIsNewer(value));}finally{f.close();}});
 await test('未检查时图标隐藏，设置有检查入口，渲染与合成点击不自动请求',async()=>{const f=fixture({},true);try{
  assert(f.s.getElementById('download-update').hidden);assert.equal(f.requests.length,0);f.s.getElementById('check-update').click();f.s.getElementById('check-update').onclick({isTrusted:true});await delay();assert.equal(f.requests.length,0);assert.equal(f.opened.length,0);
 }finally{f.close();}});
 await test('检查当前版本仅读取更新来源、不显示更新图标',async()=>{const f=fixture();try{const done=f.api.checkAssistantUpdates(true);f.reply(0,release('v1.16'));await done;assert.equal(f.requests.length,1);assert(f.s.getElementById('download-update').hidden);assert.match(f.s.getElementById('update-status').textContent,/暂无新版/);}finally{f.close();}});
 await test('新版脚本核验完成前图标隐藏，确认后标题栏与设置都可下载',async()=>{const f=fixture();try{
  const done=f.api.checkAssistantUpdates(true);f.reply(0,release());await delay();assert.equal(f.requests.length,2);assert(f.s.getElementById('download-update').hidden);
  assert.equal(f.requests[1].url,f.api.assistantUpdateDownloadURL('1.17'));f.reply(1,script());await done;
  assert(!f.s.getElementById('download-update').hidden);assert(!f.s.getElementById('install-update').hidden);assert.match(f.s.getElementById('download-update').title,/1\.17/);
  f.s.getElementById('download-update').click();assert.equal(f.opened[0].url,f.requests[1].url);assert.match(f.opened[0].features,/noopener,noreferrer/);
 }finally{f.close();}});
 await test('公开检查匿名发送且不含模型 Key、账号、课程参数或请求体',async()=>{const f=fixture();try{await f.newer();for(const request of f.requests){assert.equal(request.method,'GET');assert.equal(request.anonymous,true);assert(!Object.hasOwn(request.headers,'Authorization'));assert(!Object.hasOwn(request,'data'));assert(!JSON.stringify(request).includes('mock-private-key'));assert.match(request.url,/^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//);assert(!request.url.includes('courseid'));}}finally{f.close();}});
 await test('重复检查共享同一请求，手动入口可以绕过一天缓存',async()=>{const f=fixture();try{const a=f.api.checkAssistantUpdates(true),b=f.api.checkAssistantUpdates(true);assert.equal(a,b);assert.equal(f.requests.length,1);f.reply(0,release('v1.16'));await a;await f.api.checkAssistantUpdates();assert.equal(f.requests.length,1);const c=f.api.checkAssistantUpdates(true);assert.equal(f.requests.length,2);f.reply(1,release('v1.16'));await c;}finally{f.close();}});
 await test('刷新实例沿用已核验的版本与一天缓存，失败也限制自动频率',async()=>{
  const data={status:'verified',version:'1.17',checkedAt:Date.now(),attemptedAt:Date.now()};const f=fixture({cx_assistant_update:data});try{assert(!f.s.getElementById('download-update').hidden);await f.api.checkAssistantUpdates();assert.equal(f.requests.length,0);}finally{f.close();}
  const failed=fixture();try{const p=failed.api.checkAssistantUpdates();failed.requests[0].onerror();await p;await failed.api.checkAssistantUpdates();assert.equal(failed.requests.length,1);assert.match(failed.s.getElementById('update-status').textContent,/检查失败/);}finally{failed.close();}
 });
 await test('预发布版本、非法版本和无效元数据不能提供下载',async()=>{for(const body of [script('1.17-beta'),script('1.0.13'),script().replace('local.chaoxing.quiz','other.project'),'bad metadata']){const f=fixture();try{const p=f.api.checkAssistantUpdates(true);f.reply(0,body);await p;assert.equal(f.requests.length,1);assert(f.s.getElementById('download-update').hidden);assert.equal(f.storage.get('cx_assistant_update').status,'');}finally{f.close();}}});
 await test('新版来源或版本不一致、片段脚本都不能显示下载入口',async()=>{for(const body of [script('1.18'),script().replace('local.chaoxing.quiz','other.project'),script().replace('(()=>{})();','truncated')]){const f=fixture();try{const p=f.api.checkAssistantUpdates(true);f.reply(0,release());await delay();f.reply(1,body);await p;assert(f.s.getElementById('download-update').hidden);assert.match(f.s.getElementById('update-status').textContent,/尚未就绪/);}finally{f.close();}}});
 await test('公开脚本缺失、限流、网络和超时分别显示真实状态',async()=>{for(const mode of [404,403,429,'network','timeout']){const f=fixture();try{const p=f.api.checkAssistantUpdates(true);if(typeof mode==='number')f.reply(0,{},mode);else f.requests[0][mode==='network'?'onerror':'ontimeout']();await p;assert(f.s.getElementById('download-update').hidden);assert(!f.s.getElementById('check-update').disabled);assert.match(f.s.getElementById('update-status').textContent,mode===404?/尚未找到公开脚本/:mode==='timeout'?/超时/:mode==='network'?/检查失败/:/受限/);}finally{f.close();}}});
 await test('响应跳转到其他地址时拒绝，不使用远端提供的安装 URL',async()=>{const f=fixture();try{const p=f.api.checkAssistantUpdates(true);f.reply(0,release(),200,{finalUrl:'https://attacker.example/release'});await p;assert(f.s.getElementById('download-update').hidden);assert.match(f.s.getElementById('update-status').textContent,/地址发生变化/);}finally{f.close();}const clean=fixture();try{const p=clean.api.checkAssistantUpdates(true);clean.reply(0,release().replace('// @namespace','// @downloadURL https://attacker.example/file.user.js\n// @namespace'));await delay();assert.match(clean.requests[1].url,/raw\.githubusercontent\.com\/zhu-hailin\/chaoxing-ai-assistant\/v1\.17\//);clean.reply(1,script());await p;}finally{clean.close();}});
 await test('临时失败保留此前已核验的更新，不伪称已是最新',async()=>{const f=fixture({cx_assistant_update:{status:'verified',version:'1.17',checkedAt:Date.now(),attemptedAt:Date.now()}});try{const p=f.api.checkAssistantUpdates(true);f.requests[0].onerror();await p;assert(!f.s.getElementById('download-update').hidden);assert.match(f.s.getElementById('update-status').textContent,/检查失败/);}finally{f.close();}});
 await test('隐藏时只更新状态，不自动打开主窗口；跨实例同步无额外请求',async()=>{const f=fixture();try{f.api.setAssistantUiHidden(true);await f.newer();assert(f.s.getElementById('panel').hidden);assert.equal(f.opened.length,0);const n=f.requests.length;f.listeners.get('cx_assistant_update')('cx_assistant_update',null,f.storage.get('cx_assistant_update'),true);assert.equal(f.requests.length,n);f.api.setAssistantUiHidden(false);assert(!f.s.getElementById('download-update').hidden);}finally{f.close();}});
 await test('pagehide 取消请求、清理监听，迟到响应不能修改缓存或界面',async()=>{const f=fixture();try{const p=f.api.checkAssistantUpdates(true),cache=JSON.stringify(f.storage.get('cx_assistant_update'));f.w.dispatchEvent(new f.w.Event('pagehide'));assert.equal(f.aborts,1);assert.equal(f.listeners.size,0);f.reply(0,release());await p;assert.equal(JSON.stringify(f.storage.get('cx_assistant_update')),cache);assert.equal(f.requests.length,1);}finally{f.close();}});
 const result={total:logs.length+failures.length,failures,logs};fs.writeFileSync(path.join(__dirname,'assistant-updates-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exitCode=failures.length?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
