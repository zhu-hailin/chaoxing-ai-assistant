const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../学习通AI助手.user.js'), 'utf8');
const delay = () => new Promise(resolve => setTimeout(resolve, 140));
const logs = [], failures = [];
async function test(name, run) {
    try { await run(); logs.push(`PASS ${name}`); }
    catch (error) { failures.push(`${name}: ${error.message}`); }
}
function fixture(type, url = 'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=mock-course&clazzid=mock-class&cpi=mock-account') {
    const dom = new JSDOM(`<div id="mainid"><h1>章节</h1><div id="prev_tab" style="padding:0 100px"><div id="dct1">${type}</div></div><iframe id="iframe"></iframe></div>`, { url, runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window;
    const requests = [];
    w.GM_getValue = (_, fallback) => fallback;
    w.GM_setValue = () => {};
    w.GM_getResourceText = () => '{}';
    w.GM_xmlhttpRequest = request => { requests.push(request); };
    w.eval(source);
    return { dom, w, requests, close() { w.dispatchEvent(new w.Event('pagehide')); w.close(); } };
}
(async () => {
    for (const type of ['视频', '资料']) await test(`${type}页内容上方助手入口，设置可打开关闭，无题目时禁止分析`, async () => {
        const f = fixture(type);
        try {
            await delay();
            const d = f.w.document;
            const entry = d.getElementById('cx-ai-study-toolbar');
            assert(entry);
            assert.equal(entry.nextElementSibling.id, 'iframe');
            assert.equal(entry.style.paddingRight, '100px');
            assert.equal(entry.style.paddingLeft, '100px');
            assert.equal(entry.style.boxSizing, 'border-box');
            d.getElementById('prev_tab').style.padding = '0 24px';
            f.w.dispatchEvent(new f.w.Event('resize'));
            assert.equal(entry.style.paddingRight, '24px');
            assert.equal(d.getElementById('cx-ai-toolbar'), null);
            const button = entry.shadowRoot.getElementById('settings');
            assert.equal(button.textContent, '学习通AI助手');
            button.click();
            const s = d.getElementById('cx-ai-study-root').shadowRoot;
            assert.equal(s.getElementById('panel').hidden, false);
            assert.equal(button.getAttribute('aria-expanded'), 'true');
            assert(s.getElementById('course-nav').hidden);
            assert(s.getElementById('extract').disabled && s.getElementById('solve').disabled);
            assert.equal(s.getElementById('ds-key').disabled, false);
            s.getElementById('nav-chapters').click();
            assert.equal(s.getElementById('course-nav').hidden, false);
            s.getElementById('close').click();
            assert(s.getElementById('panel').hidden);
            assert.equal(button.getAttribute('aria-expanded'), 'false');
            assert.equal(f.requests.length, 0);
        } finally { f.close(); }
    });
    await test('章节内容动态替换后入口重新挂载，面板不重复创建', async () => {
        const f = fixture('视频');
        try {
            await delay();
            const d = f.w.document, root = d.getElementById('cx-ai-study-root');
            d.getElementById('mainid').innerHTML = '<h1>资料章节</h1><div id="prev_tab" style="padding:0 48px"></div><iframe id="iframe"></iframe>';
            await delay();
            assert.equal(d.querySelectorAll('#cx-ai-study-toolbar').length, 1);
            assert.equal(d.getElementById('cx-ai-study-toolbar').nextElementSibling.id, 'iframe');
            assert.equal(d.getElementById('cx-ai-study-root'), root);
            assert.equal(d.getElementById('cx-ai-study-toolbar').style.paddingRight, '48px');
            assert.equal(f.requests.length, 0);
        } finally { f.close(); }
    });
    await test('嵌入播放器和其他页面不额外创建学习页入口', async () => {
        const f = fixture('视频', 'https://mooc1.chaoxing.com/ananas/modules/video/index.html');
        try {
            await delay();
            assert.equal(f.w.document.getElementById('cx-ai-study-toolbar'), null);
            const embedded = f.w.document.getElementById('iframe').contentWindow;
            embedded.document.body.innerHTML = '<div id="mainid"><iframe id="iframe"></iframe></div>';
            embedded.GM_getValue = (_, fallback) => fallback;
            embedded.GM_setValue = () => {};
            embedded.eval(source);
            await delay();
            assert.equal(embedded.document.getElementById('cx-ai-study-toolbar'), null);
            assert.equal(f.requests.length, 0);
        } finally { f.close(); }
    });
    await test('顶部入口打开嵌套测验助手，可提取和分析；测验仅保留生成按钮', async () => {
        const f = fixture('章节测验');
        try {
            await delay();
            const d = f.w.document;
            const card = d.getElementById('iframe').contentWindow;
            card.document.body.innerHTML = '<iframe id="quiz-frame"></iframe>';
            const quiz = card.document.getElementById('quiz-frame').contentWindow;
            quiz.document.body.innerHTML = `<div class="CeYan"><div class="ceyan_name"><h3>测验</h3></div><div class="singleQuesId" data="1"><div class="Zy_TItle"><div class="fontLabel">【单选题】请选择甲</div></div><ul class="Zy_ulTop"><li><span class="num_option" data="A">A</span><a class="after">甲</a></li><li><span class="num_option" data="B">B</span><a class="after">乙</a></li></ul><input type="hidden" name="answer1"></div></div>`;
            const requests = [];
            quiz.GM_getValue = (key, fallback) => key === 'deepseek_api_key' ? 'mock-key' : fallback;
            quiz.GM_setValue = () => {};
            quiz.GM_getResourceText = () => '{}';
            quiz.GM_xmlhttpRequest = request => requests.push(request);
            quiz.eval(source);
            await delay();
            const lower = quiz.document.getElementById('cx-ai-toolbar').shadowRoot;
            assert(lower.getElementById('settings').hidden);
            assert.equal(lower.getElementById('generate').hidden, false);
            const upper = d.getElementById('cx-ai-study-toolbar').shadowRoot.getElementById('settings');
            upper.click();
            const portal = d.getElementById('cx-ai-quiz-panel');
            assert(portal && portal.ownerDocument === d, '测验窗口应显示在主页面');
            const panel = portal.shadowRoot;
            assert.equal(panel.getElementById('panel').hidden, false);
            const head = panel.querySelector('.head');
            const sendPointer = (target, type, x, y) => {
                const event = new f.w.MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
                Object.defineProperty(event, 'pointerId', { value: 7 });
                target.dispatchEvent(event);
            };
            sendPointer(head, 'pointerdown', 20, 20);
            sendPointer(head, 'pointermove', 120, 100);
            sendPointer(head, 'pointerup', 120, 100);
            assert.equal(portal.style.left, '100px');
            assert.equal(portal.style.top, '80px');
            const fullHeight = parseFloat(panel.getElementById('panel').style.getPropertyValue('--content-height'));
            Object.defineProperty(f.w, 'innerHeight', { value: 420, configurable: true });
            f.w.dispatchEvent(new f.w.Event('resize'));
            const smallHeight = parseFloat(panel.getElementById('panel').style.getPropertyValue('--content-height'));
            assert(smallHeight < fullHeight && smallHeight > 0, '目录高度未随可用视口缩小');
            panel.getElementById('nav-chapters').click();
            assert.equal(panel.getElementById('course-nav').hidden, false);
            panel.getElementById('nav-model').click();

            f.w.dispatchEvent(new f.w.Event('resize'));
            assert.equal(portal.style.top, '80px');
            sendPointer(panel.getElementById('github'), 'pointerdown', 20, 20);
            sendPointer(head, 'pointermove', 220, 200);
            assert.equal(portal.style.top, '80px');

            assert(d.getElementById('cx-ai-study-root').shadowRoot.getElementById('panel').hidden);
            assert.equal(panel.getElementById('extract').disabled, false);
            assert.equal(panel.getElementById('solve').disabled, false);
            panel.getElementById('extract').click();
            await delay();
            assert(panel.getElementById('output').textContent.includes('请选择甲'));
            panel.getElementById('solve').click();
            await delay();
            assert.equal(requests.length, 1);
            requests[0].onload({ status: 200, responseText: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ answers: [{ id: '1', answer: ['A'], reason: '模拟解析' }] }) } }] }) });
            await delay();
            assert(panel.getElementById('output').textContent.includes('模拟解析'));
            panel.getElementById('close').click();
            assert.equal(upper.getAttribute('aria-expanded'), 'false');
            upper.click();
            assert.equal(panel.getElementById('panel').hidden, false);
            upper.click();
            assert(panel.getElementById('panel').hidden);
            quiz.dispatchEvent(new quiz.Event('pagehide'));
        } finally { f.close(); }
    });
    const report = { total: logs.length + failures.length, failures, logs };
    fs.writeFileSync(path.join(__dirname, 'study-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = failures.length ? 1 : 0;
})();
