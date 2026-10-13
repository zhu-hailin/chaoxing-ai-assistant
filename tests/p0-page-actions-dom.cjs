const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {JSDOM, VirtualConsole} = require('jsdom');

// Exercise production activation checks unchanged. Other jsdom UI regressions
// explicitly instrument activation because synthetic events are never trusted.
const source = fs.readFileSync(path.join(__dirname, '../学习通AI助手.user.js'), 'utf8');
const entry = "    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startQuizObserver, { once: true });\n    else startQuizObserver();";
assert(source.includes(entry));
const code = source.replace(entry, 'globalThis.activationTestAPI={initQuizAssistant,trustedAssistantActivation,get controller(){return controller}};');
const errors = [], requests = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', error => errors.push(error.message));
const dom = new JSDOM('<div class="TiMu" questionid="activation-q1"><h3 class="stem">【简答题】解释数据库概念</h3><textarea></textarea></div>', {
    url:'https://mooc1.chaoxing.com/work/doHomeWorkNew', runScripts:'outside-only', pretendToBeVisual:true, virtualConsole
});
const w = dom.window;
w.GM_getValue = (key, fallback) => key === 'deepseek_api_key' ? 'mock-activation-key' : fallback;
w.GM_setValue = () => {};
w.GM_getResourceText = () => '{}';
w.GM_xmlhttpRequest = request => { requests.push(request); return {abort(){}}; };
w.eval(code);
w.activationTestAPI.initQuizAssistant();
const s = w.document.getElementById('cx-ai-study-root').shadowRoot;
try {
    assert.equal(w.activationTestAPI.trustedAssistantActivation({isTrusted:true}), false);
    assert.equal(w.activationTestAPI.trustedAssistantActivation(new w.Event('click')), false);
    const foreign = new JSDOM('');
    assert.equal(w.activationTestAPI.trustedAssistantActivation(new foreign.window.Event('click')), false);
    foreign.window.close();
    for (const id of ['solve','models','detect-images','prefill','analysis-resume','save-custom']) {
        const button = s.getElementById(id);
        button.click();
        button.onclick({isTrusted:true});
        button.dispatchEvent(new w.MouseEvent('click', {bubbles:true}));
    }
    const generate = w.document.getElementById('cx-ai-toolbar').shadowRoot.getElementById('generate');
    generate.click();generate.onclick({isTrusted:true});
    assert.equal(requests.length, 0, '网页合成操作不得发起模型请求');
    assert.equal(w.activationTestAPI.controller.state.busy, false);
    assert.equal(w.document.querySelector('textarea').value, '');
    assert.equal(s.querySelector('input[type="password"]'), null);
    assert.equal(s.getElementById('ds-key'), null);
    assert.deepEqual(errors, []);
    console.log('PASS 生产激活校验拒绝伪造对象和合成事件，页面不能请求模型或预填，DOM 不含 Key 输入');
} finally {
    w.dispatchEvent(new w.Event('pagehide'));w.close();
}
