const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '../学习通AI助手.user.js'), 'utf8').replace(/\r\n/g, '\n');
const entry = "    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startQuizObserver, { once: true });\n    else startQuizObserver();";
assert(source.includes(entry));
assert(source.includes('function initCredentialSettingsMenu'), '必须验证包含凭据菜单的当前构建产物');
const instrumented = source.replace(entry, 'globalThis.credentialTestAPI={initQuizAssistant,initCredentialSettingsMenu,readProviderConfiguration,saveProviderSetting,fetchConfiguredModels,renderModelSettings,get controller(){return controller}};');
const names = {save:'设置 / 替换模型 API Key',clear:'清除模型 API Key'};
let count = 0;
async function test(name, run) {await run(); count++; console.log(`PASS ${name}`);}
function fixture(initial = {}, options = {}) {
  const questions='<div class="TiMu" questionid="q1"><h3 class="stem">【简答题】模拟题目</h3><textarea></textarea></div>';
  const dom = new JSDOM(options.iframe?'<iframe id="quiz" src="https://mooc1.chaoxing.com/work/doHomeWorkNew"></iframe>':questions, {
    url:options.iframe?'https://external-lms.example/course':'https://mooc1.chaoxing.com/work/doHomeWorkNew',runScripts:'outside-only',pretendToBeVisual:true
  });
  const w=options.iframe?dom.window.document.getElementById('quiz').contentWindow:dom.window;
  if(options.iframe){w.document.open();w.document.write(questions);w.document.close();}
  const storage=new Map(Object.entries(initial)),menus=new Map(),answers=[],prompts=[],alerts=[],requests=[],listeners=new Map();
  let confirmation=true;
  w.GM_getValue=(key,fallback)=>storage.has(key)?storage.get(key):fallback;
  w.GM_setValue=(key,value)=>storage.set(key,value);
  w.GM_deleteValue=key=>storage.delete(key);
  w.GM_getResourceText=()=> '{}';
  w.GM_registerMenuCommand=(name,callback)=>{menus.set(name,callback);return menus.size;};
  w.GM_addValueChangeListener=(key,callback)=>{listeners.set(key,callback);return key;};
  w.GM_removeValueChangeListener=key=>listeners.delete(key);
  w.GM_xmlhttpRequest=request=>{requests.push(request);return {abort(){request.onabort?.();}};};
  w.prompt=(message,value)=>{prompts.push({message,value});return answers.length?answers.shift():null;};
  w.confirm=()=>confirmation;
  w.alert=message=>alerts.push(message);
  w.eval(instrumented);
  const api=w.credentialTestAPI;
  api.initQuizAssistant();
  return {w,storage,menus,answers,prompts,alerts,requests,listeners,api,
    get shadow(){return w.document.getElementById('cx-ai-study-root').shadowRoot;},
    denyConfirmation(){confirmation=false;},
    close(){w.dispatchEvent(new w.Event('pagehide'));dom.window.close();}};
}
async function main() {
  await test('元数据收紧到已知域名并请求 DOM 隔离环境', async()=>{
    assert.match(source,/^\/\/ @sandbox\s+DOM$/m);
    assert(!/^\/\/ @connect\s+\*$/m.test(source));
    for(const domain of ['api.deepseek.com','api.openai.com','dashscope.aliyuncs.com','api.moonshot.cn','open.bigmodel.cn','self','chaoxing.com']) {
      assert(source.includes(`// @connect      ${domain}\n`));
    }
  });
  await test('课程页面只有凭据状态，没有 Key 编辑控件或保存的 mock Key', async()=>{
    const f=fixture({deepseek_api_key:'mock-page-hidden-key'});
    try {
      for(const id of ['ds-key','save-ds','clear-ds'])assert.equal(f.shadow.getElementById(id),null);
      assert.equal(f.shadow.querySelector('input[type="password"]'),null);
      assert.match(f.shadow.getElementById('api-key-status').textContent,/DeepSeek Key 已保存/);
      assert(!f.shadow.innerHTML.includes('mock-page-hidden-key'));
      assert(!f.w.document.documentElement.innerHTML.includes('mock-page-hidden-key'));
    } finally {f.close();}
  });
  await test('受信菜单逐个选择六个平台且不会从页面选择框决定凭据归属', async()=>{
    const f=fixture({cx_provider_custom_baseURL:'https://approved.example/v1',cx_provider_custom_model:'mock-model'});
    try {
      const ids=['deepseek','openai','qwen','kimi','glm','custom'];
      for(const [index,id] of ids.entries()) {
        f.shadow.getElementById('provider').value=id==='deepseek'?'openai':'deepseek';
        f.answers.push(String(index+1),`mock-menu-${id}`);f.menus.get(names.save)();
        assert.equal(f.api.readProviderConfiguration(id).key,`mock-menu-${id}`);
        assert(!f.shadow.innerHTML.includes(`mock-menu-${id}`));
      }
      assert(f.prompts.every(prompt=>prompt.value===''));
      assert(f.prompts.filter(prompt=>prompt.message.includes('输入 custom')).length===0);
      assert(f.prompts.some(prompt=>prompt.message.includes('授权的 API 地址：https://approved.example/v1')));
      const menuCount=f.menus.size;f.api.initCredentialSettingsMenu();assert.equal(f.menus.size,menuCount);
    } finally {f.close();}
  });
  await test('取消、无效平台、空白输入和取消清除均保留旧 mock Key', async()=>{
    const f=fixture({deepseek_api_key:'mock-old-key'});
    try {
      for(const responses of [[null],['7'],['1',null],['1','  ']]) {
        f.answers.push(...responses);f.menus.get(names.save)();assert.equal(f.storage.get('deepseek_api_key'),'mock-old-key');
      }
      f.denyConfirmation();f.answers.push('1');f.menus.get(names.clear)();
      assert.equal(f.storage.get('deepseek_api_key'),'mock-old-key');
      assert(!JSON.stringify(f.prompts).includes('mock-old-key'));
    } finally {f.close();}
  });
  await test('页面替换 prompt 或伪造旧凭据事件不能截获或修改 mock Key', async()=>{
    const f=fixture({deepseek_api_key:'mock-old-key'});
    try {
      let intercepted=0;f.w.prompt=()=>{intercepted++;return 'attacker-value';};
      f.w.document.dispatchEvent(new f.w.CustomEvent('cx-ai-save-api-key',{detail:{provider:'deepseek',key:'injected-key'}}));
      assert.equal(f.storage.get('deepseek_api_key'),'mock-old-key');
      f.answers.push('1','mock-new-key');f.menus.get(names.save)();
      assert.equal(intercepted,0);assert.equal(f.storage.get('deepseek_api_key'),'mock-new-key');
      assert(!f.shadow.innerHTML.includes('mock-new-key'));
    } finally {f.close();}
  });
  await test('运行中的任务阻止凭据菜单修改，停止后可清除且不改变其他平台', async()=>{
    const f=fixture({deepseek_api_key:'mock-old-key',cx_provider_openai_key:'mock-openai-key'});
    try {
      f.api.controller.state.busy=true;f.answers.push('1','mock-busy-key');f.menus.get(names.save)();
      assert.equal(f.prompts.length,0);assert.equal(f.storage.get('deepseek_api_key'),'mock-old-key');
      f.answers.length=0;f.api.controller.state.busy=false;f.answers.push('1');f.menus.get(names.clear)();
      assert.equal(f.storage.get('deepseek_api_key'),'');assert.equal(f.storage.get('cx_provider_openai_key'),'mock-openai-key');
      assert.match(f.shadow.getElementById('api-key-status').textContent,/尚未配置/);
    } finally {f.close();}
  });
  await test('旧自定义 Key 必须授权具体地址，页面改地址后不向新目的地发送 Key', async()=>{
    const f=fixture({cx_provider:'custom',cx_provider_custom_key:'mock-legacy-custom-key',cx_provider_custom_baseURL:'https://approved.example/v1',cx_provider_custom_model:'mock-model'});
    try {
      assert.equal(f.api.readProviderConfiguration().key,'');assert.equal(f.api.readProviderConfiguration().credentialNeedsApproval,true);
      await assert.rejects(f.api.fetchConfiguredModels(f.api.readProviderConfiguration()),/API Key/);assert.equal(f.requests.length,0);
      f.answers.push('6','mock-approved-key');f.menus.get(names.save)();
      assert.equal(f.api.readProviderConfiguration().key,'mock-approved-key');
      f.shadow.getElementById('custom-base').value='https://unapproved.example/v2';f.shadow.getElementById('save-custom').click();
      assert.equal(f.api.readProviderConfiguration().baseURL,'https://approved.example/v1','页面合成点击不能保存目的地');
      // jsdom 无法产生真人点击；单独通过测试 API 模拟合法地址更改，以验证凭据绑定。
      f.api.saveProviderSetting('baseURL','https://unapproved.example/v2','custom');f.api.renderModelSettings(f.api.controller);
      const settings=f.api.readProviderConfiguration();assert.equal(settings.baseURL,'https://unapproved.example/v2');
      assert.equal(settings.key,'');assert.equal(settings.configured,false);
      await assert.rejects(f.api.fetchConfiguredModels(settings),/API Key/);assert.equal(f.requests.length,0);
      assert.match(f.shadow.getElementById('api-key-status').textContent,/尚未授权/);
      f.answers.push('6','mock-reapproved-key');f.menus.get(names.save)();
      assert.equal(f.api.readProviderConfiguration().configured,true);assert.equal(f.storage.get('cx_provider_custom_keyBaseURL'),'https://unapproved.example/v2');
    } finally {f.close();}
  });
  await test('跨页凭据变更只刷新状态，清理页面时移除监听器', async()=>{
    const f=fixture();
    try {
      assert.equal(f.listeners.size,7); // 六个凭据监听器与原有界面显隐监听器。
      f.storage.set('deepseek_api_key','mock-remote-key');f.listeners.get('deepseek_api_key')('deepseek_api_key','','mock-remote-key',true);
      assert.match(f.shadow.getElementById('api-key-status').textContent,/已保存/);
      assert(!f.shadow.innerHTML.includes('mock-remote-key'));
      f.w.dispatchEvent(new f.w.Event('pagehide'));assert.equal(f.listeners.size,0);
    } finally {f.close();}
  });
  await test('不匹配脚本的顶层页面内，题目 iframe 仍有独立凭据菜单且只注册一次', async()=>{
    const f=fixture({}, {iframe:true});
    try {
      assert.notEqual(f.w,f.w.top);
      const save=[...f.menus.keys()].filter(name=>name.startsWith(names.save));
      const clear=[...f.menus.keys()].filter(name=>name.startsWith(names.clear));
      assert.equal(save.length,1);assert.equal(clear.length,1);assert.notEqual(save[0],names.save);
      assert.match(save[0],/（题目页 [0-9a-f]{8}）$/);
      const count=f.menus.size;f.api.initCredentialSettingsMenu();f.api.initQuizAssistant();assert.equal(f.menus.size,count);
      f.answers.push('2','mock-iframe-key');f.menus.get(save[0])();
      assert.equal(f.api.readProviderConfiguration('openai').key,'mock-iframe-key');
      assert(!f.shadow.innerHTML.includes('mock-iframe-key'));
    } finally {f.close();}
  });
  console.log(`\n${count} credential settings checks passed`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
