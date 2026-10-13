const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createHash, webcrypto} = require('node:crypto');
const {JSDOM} = require('jsdom');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '学习通AI助手.user.js'), 'utf8').replace(/\r\n/g, '\n');
const entry = "    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startQuizObserver, { once: true });\n    else startQuizObserver();";
assert(source.includes(entry));
assert(source.includes('function createBrandedModelPicker'), '必须测试带官方标识列表的新构建');
const instrumented = source.replace(entry, 'globalThis.logoAPI={getModelProvider,initQuizAssistant,refreshBrandedModelPickers,readProviderConfiguration};');
const hash = data => createHash('sha256').update(data).digest('hex');
const logs = [], failures = [];
async function test(name, run) {
  try {await run(); logs.push(`PASS ${name}`);} catch(error) {failures.push(`${name}: ${error.stack}`);}
}
function fixture() {
  const dom = new JSDOM('<div class="TiMu" questionid="logo-test"><h3 class="stem">【简答题】解释数据库概念</h3><textarea></textarea></div>', {url:'https://mooc1.chaoxing.com/work/doHomeWorkNew',runScripts:'outside-only',pretendToBeVisual:true});
  const w = dom.window, storage = new Map(), requests = [];
  w.GM_getValue = (key, fallback) => storage.has(key) ? storage.get(key) : fallback;
  w.GM_setValue = (key,value) => storage.set(key,value);
  w.GM_deleteValue = key => storage.delete(key);
  w.GM_getResourceText = () => '{}';
  w.GM_registerMenuCommand = () => {};
  w.GM_xmlhttpRequest = request => {requests.push(request); return {abort(){}};};
  Object.defineProperty(w.crypto, 'subtle', {value:webcrypto.subtle});
  w.eval(instrumented); w.logoAPI.initQuizAssistant();
  const s = w.document.getElementById('cx-ai-study-root').shadowRoot;
  return {w,s,storage,requests,api:w.logoAPI,close(){w.dispatchEvent(new w.Event('pagehide'));w.close();}};
}
function key(f,id,value) {f.s.getElementById(`${id}-picker`).dispatchEvent(new f.w.KeyboardEvent('keydown',{key:value,bubbles:true}));}
function choose(f,provider) {
  f.s.getElementById('provider-picker').click();
  const rows = [...f.s.getElementById('provider-listbox').children];
  const options = [...f.s.getElementById('provider').options];
  rows[options.findIndex(option => option.value === provider)].click();
}
async function main() {
  await test('五个官方标识与原始文件校验一致，内嵌资源无需请求网络', () => {
    const f = fixture();
    try {
      const provenance = JSON.parse(fs.readFileSync(path.join(root,'assets/provider-logos/provenance.json')));
      assert.equal(provenance.length,5);
      for (const asset of provenance) {
        const dir = path.join(root,'assets/provider-logos');
        assert.equal(hash(fs.readFileSync(path.join(dir,asset.originalFile))),asset.originalSHA256);
        const logo = f.api.getModelProvider(asset.provider).logo;
        assert.match(logo,/^data:image\/(png|svg\+xml);base64,/);
        assert.equal(hash(Buffer.from(logo.split(',')[1],'base64')),asset.runtimeSHA256);
        assert.equal(hash(fs.readFileSync(path.join(dir,asset.runtimeFile))),asset.runtimeSHA256);
      }
      assert.equal(f.api.getModelProvider('custom').logo,undefined);
      assert.equal(f.requests.length,0);
    } finally {f.close();}
  });
  await test('平台及两个模型列表每一行都显示所属平台标识，自定义无标识', () => {
    const f = fixture();
    try {
      const providerRows = [...f.s.getElementById('provider-listbox').children];
      assert.equal(providerRows.length,6);
      assert.equal(providerRows.filter(row => row.querySelector('img')).length,5);
      assert.equal(providerRows.at(-1).querySelector('img'),null);
      for (const provider of ['deepseek','openai','qwen','kimi','glm']) {
        choose(f,provider);
        assert.equal(f.api.readProviderConfiguration().provider,provider);
        for (const id of ['provider','model','info-model']) {
          assert.equal(f.s.getElementById(`${id}-picker`).querySelector('img').src,f.api.getModelProvider(provider).logo);
          if (id === 'provider') continue;
          for (const row of f.s.getElementById(`${id}-listbox`).children) {
            assert.equal(row.querySelector('img').src,f.api.getModelProvider(provider).logo);
            assert.equal(row.querySelector('img').alt,'');
          }
        }
      }
      choose(f,'custom');
      assert.equal(f.s.getElementById('provider-picker').querySelector('img'),null);
      assert.equal(f.s.getElementById('info-model-picker').querySelector('img'),null);
      assert.equal(f.s.getElementById('preset-model-block').hidden,true);
      assert.equal(f.s.getElementById('custom-model-block').hidden,false);
      assert.equal(f.requests.length,0);
    } finally {f.close();}
  });
  await test('键盘导航与取消不改配置，确认同步原生字段和可访问状态', () => {
    const f = fixture();
    try {
      const button = f.s.getElementById('provider-picker'),list = f.s.getElementById('provider-listbox');
      assert.equal(button.getAttribute('role'),'combobox');
      assert.equal(button.getAttribute('aria-controls'),list.id);
      assert.equal(list.getAttribute('role'),'listbox');
      assert.equal(f.s.querySelector('label[for="provider-picker"]').textContent,'平台');
      assert.equal(f.s.getElementById('provider').hidden,true);
      key(f,'provider','ArrowDown'); assert.equal(button.getAttribute('aria-expanded'),'true');
      key(f,'provider','End'); assert.equal(button.getAttribute('aria-activedescendant'),'provider-option-5');
      key(f,'provider','Escape'); assert.equal(list.hidden,true); assert.equal(f.api.readProviderConfiguration().provider,'deepseek');
      key(f,'provider','ArrowDown'); key(f,'provider','ArrowDown'); key(f,'provider','Enter');
      assert.equal(f.s.getElementById('provider').value,'openai');
      assert.equal(f.api.readProviderConfiguration().provider,'openai');
      assert.equal(button.getAttribute('aria-expanded'),'false');
      assert.equal(f.s.activeElement,button);
      key(f,'model','End'); key(f,'model','Enter'); assert.equal(f.storage.get('cx_provider_openai_model'),'gpt-4.1');
      key(f,'model','Home'); key(f,'model','Enter'); assert.equal(f.storage.get('cx_provider_openai_model'),'gpt-4.1-mini');
      key(f,'info-model','End'); key(f,'info-model','Enter'); assert.equal(f.storage.get('cx_provider_openai_infoModel'),'gpt-4.1');
    } finally {f.close();}
  });
  await test('禁用状态、动态模型列表及菜单互斥保持同步', async () => {
    const f = fixture();
    try {
      f.s.getElementById('provider-picker').click(); f.s.getElementById('model-picker').click();
      assert.equal(f.s.getElementById('provider-listbox').hidden,true);
      const select = f.s.getElementById('model'); select.disabled = true;
      await Promise.resolve();
      assert.equal(f.s.getElementById('model-picker').disabled,true);
      assert.equal(f.s.getElementById('model-listbox').hidden,true);
      key(f,'model','Enter'); assert.equal(f.s.getElementById('model-listbox').hidden,true);
      select.disabled = false;
      const option = f.w.document.createElement('option'); option.value = 'new-provider-model'; option.textContent = '新模型'; select.append(option);
      await Promise.resolve();
      const row = f.s.getElementById('model-listbox').lastElementChild;
      assert.equal(row.textContent,'新模型'); assert.equal(row.querySelector('img').src,f.api.getModelProvider('deepseek').logo);
      f.s.getElementById('model-picker').click(); row.click();
      assert.equal(select.value,'new-provider-model'); assert.equal(f.storage.get('cx_model'),'new-provider-model');
      f.s.getElementById('provider-picker').click(); key(f,'provider','Tab'); assert.equal(f.s.getElementById('provider-listbox').hidden,true);
    } finally {f.close();}
  });
  console.log(logs.join('\n'));
  if (failures.length) {console.error(failures.join('\n'));process.exitCode=1;}
}
main().catch(error => {console.error(error);process.exitCode=1;});
