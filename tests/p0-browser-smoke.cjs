// Optional browser smoke test: install Playwright separately; no real courses or model APIs.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const project = path.resolve(__dirname, '..');
const requireProject = createRequire(path.join(project, 'package.json'));
const { chromium } = requireProject('playwright');
const file = path.join(project, '学习通AI助手.user.js');
const source = fs.readFileSync(file, 'utf8');
const sha = crypto.createHash('sha256').update(source).digest('hex');
assert(source.includes('const assistantConfirm = window.confirm.bind(window);'), 'Latest native confirm must be built');
assert(source.includes('policyPauseExpected'), 'Latest pause fix must be built');
const entry = "    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startQuizObserver, { once: true });\n    else startQuizObserver();";
assert(source.includes(entry));
const code = source.replace(entry, 'globalThis.nativeSmokeAPI={initQuizAssistant,initStudyAssistant,readProviderConfiguration,courseRunController,studyOwnerDocument,get controller(){return controller}};');
const checks = [];
const question = '<div class="singleQuesId" data="q1"><div class="Zy_TItle"><div class="fontLabel">【单选题】模拟题目</div></div><label><input type="radio" name="q1" value="A">A、甲</label><label><input type="radio" name="q1" value="B">B、乙</label></div>';
const standaloneHTML = `<button id="unrelated">Unrelated action</button><input id="unrelated-checkbox" type="checkbox">${question}`;
const studyHTML = '<button id="unrelated">Unrelated action</button><input id="unrelated-checkbox" type="checkbox"><div id="mainid"><input id="curChapterId" value="1"><div id="prev_tab"><li id="dct1" class="active">测验</li></div><iframe id="iframe"></iframe></div><div id="content1"><div id="coursetree"><ul><li><div class="posCatalog_select posCatalog_active" id="cur1"><span class="posCatalog_name" title="模拟章节"><em class="posCatalog_sbar">1</em>模拟章节</span><span class="orangeNew">1</span></div></li></ul></div></div>';
async function mockGlobals(page) {
  await page.evaluate(() => {
    globalThis.smokeRequests = [];
    globalThis.smokeMenus = new Map();
    const values = new Map([['deepseek_api_key', 'mock-native-key'], ['cx_model', 'deepseek-flash'], ['cx_auto_context', false]]);
    globalThis.GM_getValue = (name, fallback) => values.has(name) ? values.get(name) : fallback;
    globalThis.GM_setValue = (name, value) => values.set(name, value);
    globalThis.GM_deleteValue = name => values.delete(name);
    globalThis.GM_getResourceText = () => '{}';
    globalThis.GM_registerMenuCommand = (name, callback) => { smokeMenus.set(name, callback); return smokeMenus.size; };
    globalThis.GM_addValueChangeListener = () => 1;
    globalThis.GM_removeValueChangeListener = () => {};
    globalThis.GM_xmlhttpRequest = request => {
      smokeRequests.push({method: request.method, url: request.url});
      queueMicrotask(() => {
        const payload = JSON.parse(request.data);
        const content = payload.messages.find(message => message.role === 'user').content;
        const text = Array.isArray(content) ? content.find(part => part.type === 'text').text : content;
        const data = JSON.parse(text);
        const result = data.task === 'answer-policy'
          ? {classifications: data.questions.map(item => ({id:item.id,status:'auto',category:'objective',reason:'本地模拟',evidence:item.question}))}
          : {answers: data.questions.map(item => ({id:item.id,answer:['A'],reason:'本地模拟'}))};
        request.onload({status:200,responseText:JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]})});
      });
      return {abort(){request.onabort?.();}};
    };
  });
}
async function test(name, action) { await action(); checks.push(name); console.log('PASS ' + name); }
(async () => {
  const browser = await chromium.launch({headless:true,executablePath:process.env.CHAOXING_BROWSER_EXECUTABLE || '/usr/bin/chromium',args:['--no-sandbox']});
  const context = await browser.newContext({viewport:{width:1280,height:900}});
  await context.route('**/*', route => route.fulfill({status:200,contentType:'text/html',body:route.request().url().includes('studentstudy') ? studyHTML : standaloneHTML}));
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto('https://mooc1.chaoxing.com/work/doHomeWorkNew');
    await mockGlobals(page);
    await page.addScriptTag({content:code});
    await page.evaluate(() => { nativeSmokeAPI.initQuizAssistant(); nativeSmokeAPI.controller.openPanel('questions'); });
    await test('Synthetic click and spoofed handler cannot request model', async () => {
      const result = await page.evaluate(() => {
        const solve = document.getElementById('cx-ai-study-root').shadowRoot.getElementById('solve');
        solve.click();
        solve.onclick({isTrusted:true,currentTarget:solve,type:'click',composedPath(){return [solve];}});
        return smokeRequests.length;
      });
      assert.equal(result,0);
    });
    await test('Forwarded genuine unrelated click cannot request model', async () => {
      await page.evaluate(() => {
        document.getElementById('unrelated').onclick = event => {
          globalThis.forwardedClickTrusted = event.isTrusted;
          document.getElementById('cx-ai-study-root').shadowRoot.getElementById('solve').onclick(event);
        };
      });
      await page.locator('#unrelated').click();
      assert.equal(await page.evaluate(() => forwardedClickTrusted),true);
      assert.equal(await page.evaluate(() => smokeRequests.length),0);
    });
    await test('Genuine assistant model click performs mock analysis', async () => {
      await page.locator('#cx-ai-study-root').locator('#solve').click();
      await page.waitForFunction(() => !nativeSmokeAPI.controller.state.busy && nativeSmokeAPI.controller.result?.answers?.length === 1);
      assert.equal(await page.evaluate(() => smokeRequests.length),1);
    });
    await test('Genuine keyboard Enter activation performs mock analysis', async () => {
      await page.locator('#cx-ai-study-root').locator('#solve').focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => !nativeSmokeAPI.controller.state.busy && smokeRequests.length === 2);
    });
    await page.goto('https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=mock-course&clazzid=mock-class&cpi=mock-account');
    await mockGlobals(page);
    await page.addScriptTag({content:code});
    await page.evaluate(() => { nativeSmokeAPI.initStudyAssistant(); nativeSmokeAPI.controller.openPanel('chapters'); });
    await test('Forwarded genuine unrelated checkbox change cannot authorize submit', async () => {
      let dialogs = 0;
      const unexpected = async dialog => { dialogs++; await dialog.dismiss(); };
      page.on('dialog',unexpected);
      await page.evaluate(() => {
        document.getElementById('unrelated-checkbox').onchange = event => {
          globalThis.forwardedChangeTrusted = event.isTrusted;
          const submit = document.getElementById('cx-ai-study-root').shadowRoot.getElementById('course-auto-submit');
          submit.checked = true;
          submit.onchange(event);
        };
      });
      await page.locator('#unrelated-checkbox').check();
      page.off('dialog',unexpected);
      assert.equal(await page.evaluate(() => forwardedChangeTrusted),true);
      assert.equal(await page.locator('#cx-ai-study-root').locator('#course-auto-submit').isChecked(),false);
      assert.equal(dialogs,0);
    });
    await test('Genuine submit checkbox decline keeps automatic submit off', async () => {
      let message = '';
      page.once('dialog',async dialog => {message=dialog.message();await dialog.dismiss();});
      await page.locator('#cx-ai-study-root').locator('#course-auto-submit').click();
      assert.match(message,/自动提交章节测验/);
      assert.equal(await page.locator('#cx-ai-study-root').locator('#course-auto-submit').isChecked(),false);
    });
    await test('Genuine submit checkbox accept authorizes current selection', async () => {
      page.once('dialog',async dialog => {await dialog.accept();});
      await page.locator('#cx-ai-study-root').locator('#course-auto-submit').click();
      assert.equal(await page.locator('#cx-ai-study-root').locator('#course-auto-submit').isChecked(),true);
    });
    await test('Later webpage confirm replacement cannot bypass captured native confirm', async () => {
      await page.locator('#cx-ai-study-root').locator('#course-auto-submit').uncheck();
      await page.evaluate(() => { globalThis.replacementConfirmCalls=0;window.confirm=()=>{replacementConfirmCalls++;return true;}; });
      page.once('dialog',async dialog => {await dialog.dismiss();});
      await page.locator('#cx-ai-study-root').locator('#course-auto-submit').click();
      assert.equal(await page.evaluate(() => replacementConfirmCalls),0);
      assert.equal(await page.locator('#cx-ai-study-root').locator('#course-auto-submit').isChecked(),false);
    });
    await test('Separate main course controls remain reachable while child quiz exists', async () => {
      const child = page.frames().find(frame => frame !== page.mainFrame());
      await child.evaluate(questionHTML => {document.body.innerHTML=questionHTML;}, question);
      await mockGlobals(child);
      await child.addScriptTag({content:code});
      await child.evaluate(() => nativeSmokeAPI.initQuizAssistant());
      await page.locator('#cx-ai-study-toolbar').locator('#settings').click();
      assert.equal(await page.locator('#cx-ai-quiz-panel').locator('#panel').isVisible(),true);
      assert.equal(await page.locator('#cx-ai-quiz-panel').locator('#course-start').isDisabled(),true);
      await page.locator('#cx-ai-quiz-panel').locator('#nav-chapters').click();
      assert.equal(await page.locator('#cx-ai-study-root').locator('#panel').isVisible(),true);
      assert.equal(await page.locator('#cx-ai-study-root').locator('#course-start').isDisabled(),false);
    });
    await test('Adopted child panel mouse activation passes native Event guard across realms', async () => {
      const child = page.frames().find(frame => frame !== page.mainFrame());
      await child.evaluate(() => nativeSmokeAPI.controller.openPanel('questions'));
      await page.locator('#cx-ai-quiz-panel').locator('#solve').click();
      await child.waitForFunction(() => !nativeSmokeAPI.controller.state.busy && nativeSmokeAPI.controller.result?.answers?.length === 1);
      assert.equal(await child.evaluate(() => smokeRequests.length),1);
    });
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:checks.length,sourceSha256:sha,browser:await browser.version(),limitations:'No Tampermonkey extension or real platform/API was exercised.'},null,2));
  } finally { await context.close(); await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
