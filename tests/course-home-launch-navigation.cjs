const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { setImmediate } = require('node:timers/promises');
const { runInNewContext } = require('node:vm');
const { JSDOM } = require('jsdom');

const source = readFileSync(join(__dirname, '../sources/course-home-launch.js'), 'utf8');
const origin = 'https://mooc2-ans.chaoxing.com';
const path = '/mooc2-ans/mycourse';
const query = 'courseid=1&clazzid=2&cpi=3';

async function fixture(t, { duplicate = false, selected = false, status = 'preparing' } = {}) {
    const link = `<a data-url="${path}/studentcourse">章节</a>`;
    const dom = new JSDOM(`<ul class="stuNavigationList"><li id="tasks" class="${selected ? '' : 'curNav'}">任务</li>
        <li id="chapters" dataname="zj" class="${selected ? 'curNav' : ''}">${link}${duplicate ? link : ''}</li></ul>
        <iframe id="frame_content-zj" src="${path}/studentcourse?${query}" ${selected ? '' : 'hidden'}></iframe>`,
        { url: `${origin}${path}/stu?${query}` });
    t.after(() => dom.window.close());
    const { window } = dom, { document } = window;
    Object.defineProperty(window.navigator, 'locks', { value: {} });
    const launchId = randomUUID(), tab = { cxCourseTabId: randomUUID(), cxCourseLaunchId: launchId };
    const key = `cx_course_launch:${launchId}`;
    let now = 1000, poll;
    const storage = new Map([[key, { id: launchId, sourceTab: tab.cxCourseTabId, createdAt: now, expiresAt: now + 120000,
        status, identity: { course: '1', classroom: '2', student: '3' }, options: { mode: 'study' }, message: '正在准备课程入口' }]]);
    const ctl = { state: {}, report(message, phase, busy) { this.state = { message, phase, busy }; },
        openPanel(view) { this.view = view; } };
    const frame = document.getElementById('frame_content-zj');
    const messages = [];
    frame.contentWindow.postMessage = (message, target) => messages.push({ message, target });
    let clicks = 0;
    document.getElementById('chapters').addEventListener('click', () => clicks++);
    const launcher = runInNewContext(source + '\nresolveCourseHomeCatalog=()=>null; createCourseHomeLauncher(document, ctl);', {
        window, document, ctl, URL, COURSE_SCORE_PREFIX: 'score:', COURSE_MENU_HIDE_ATTRIBUTE: 'data-cx-ai-menu-hidden',
        Date: { now: () => now }, pageURL: doc => new URL(doc.URL),
        courseURLContext: url => ({ course: url.searchParams.get('courseid'), classroom: url.searchParams.get('clazzid'), student: url.searchParams.get('cpi') }),
        courseBlocker: () => null, courseElementVisible: node => node.isConnected && !node.closest('[hidden]'),
        platformMenuVisible: node => !node.closest('[hidden]'),
        get: (name, fallback) => storage.get(name) ?? fallback, set: (name, value) => storage.set(name, value),
        GM_getTab: callback => callback(tab), GM_saveTab() {},
        setInterval: fn => { poll = fn; return 1; }, clearInterval: () => { poll = null; },
        setTimeout: () => 1, clearTimeout() {}
    });
    await setImmediate();
    return { document, frame, messages, launcher, ctl, get clicks() { return clicks; },
        advance(ms) { now += ms; poll?.(); } };
}

test('任务栏目隐藏的章节页不会收到交接，切换失败后仅重试一次', async t => {
    const f = await fixture(t);
    f.advance(0);
    assert.equal(f.clicks, 1);
    assert.equal(f.messages.length, 0);
    f.advance(2000);
    assert.equal(f.clicks, 2);
    f.frame.hidden = false;
    f.advance(2000);
    assert.equal(f.messages.length, 0, '即使 iframe 已显示，任务栏目仍选中时也不交接');
    assert.equal(f.clicks, 2);
    f.document.getElementById('tasks').classList.remove('curNav');
    f.document.getElementById('chapters').classList.add('curNav');
    f.advance(500);
    assert.equal(f.messages.length, 1);
    assert.equal(f.messages[0].message.kind, 'navigate');
    assert.equal(f.messages[0].target, origin);
    f.launcher.cancel();
    f.advance(500);
    assert.equal(f.messages.length, 1);
});

test('已在章节时直接交接，重复的章节入口最终给出明确提示', async t => {
    const selected = await fixture(t, { selected: true });
    assert.equal(selected.clicks, 0);
    assert.equal(selected.messages.length, 1);
    const duplicate = await fixture(t, { duplicate: true });
    duplicate.advance(10000);
    assert.equal(duplicate.clicks, 0);
    assert.equal(duplicate.launcher.pending, false);
    assert.equal(duplicate.ctl.view, 'chapters');
    assert.match(duplicate.ctl.state.message, /请手动打开「章节」后重试/);
});

test('已点击章节但没离开目录时，超时后显示交接失败', async t => {
    const f = await fixture(t, { selected: true, status: 'navigating' });
    f.advance(120001);
    assert.equal(f.launcher.pending, false);
    assert.equal(f.ctl.view, 'chapters');
    assert.match(f.ctl.state.message, /已点击章节，但未进入学习页/);
    assert.equal(f.messages.length, 0);
});

function chapterFixture(t, status = 'available') {
    const dom = new JSDOM(`<div id="cur10" onclick="toOld('1','10','2')">第 1 节</div>`,
        { url: `${origin}${path}/studentcourse?${query}`, referrer: `${origin}${path}/stu?${query}` });
    t.after(() => dom.window.close());
    const document = dom.window.document, row = document.getElementById('cur10');
    const id = randomUUID(), tab = { cxCourseTabId: randomUUID(), cxCourseLaunchId: id };
    const identity = { course: '1', classroom: '2', student: '3' };
    const key = `cx_course_launch:${id}`;
    let now = 1000, clicks = 0, reads = 0, reply;
    let record = { id, sourceTab: tab.cxCourseTabId, createdAt: now, expiresAt: now + 120000,
        status: 'preparing', identity, options: { mode: 'study', skipLearned: true } };
    row.addEventListener('click', () => clicks++);
    const navigate = runInNewContext(source + '\ncourseHomeNavigate', {
        window: { top: {} }, document, unsafeWindow: dom.window, URL,
        Date: { now: () => now }, pageURL: doc => new URL(doc.URL), courseURLContext: () => identity,
        courseBlocker: () => null, isCourseStudyHost: host => host === 'mooc1.chaoxing.com',
        readCourseCatalog: () => ({ ready: true, entries: [{ chapterId: '10', node: row, title: row.textContent,
            navigation: { status } }] }),
        get: (name, fallback) => name === key ? record : fallback,
        set: (name, value) => { assert.equal(name, key); record = value; },
        GM_getTab: callback => { reads++; reply = callback; },
        GM_saveTab() { assert.fail('章节不应重写已绑定的标签页记录'); },
        setTimeout: () => 1, clearTimeout() {}
    });
    return { dom, get clicks() { return clicks; }, get reads() { return reads; }, get record() { return record; },
        advance(ms) { now += ms; }, wake: () => navigate(id), reply: () => reply(tab),
        cancel() { record = { ...record, status: 'cancelled' }; } };
}

test('目录先显示，原生函数与服务器随后就绪，只点击一次', async t => {
    const f = chapterFixture(t);
    const first = f.wake();
    await f.wake();
    assert.equal(f.reads, 1);
    f.reply();
    await first;
    assert.equal(f.clicks, 0);
    assert.match(f.record.message, /原生入口就绪/);
    f.dom.window.ServerHost = { mooc1Domain: 'https://mooc1.chaoxing.com' };
    const withoutHandler = f.wake(); f.reply(); await withoutHandler;
    assert.equal(f.clicks, 0);
    f.dom.window.toOld = () => {};
    const ready = f.wake(); f.reply(); await ready;
    assert.equal(f.record.chapterId, '10');
    assert.equal(f.record.status, 'navigating');
    await f.wake();
    assert.equal(f.clicks, 1);
});

test('入口超时、明确锁定或核对期间取消时不点击', async t => {
    const stalled = chapterFixture(t);
    const first = stalled.wake(); stalled.reply(); await first;
    stalled.advance(10000);
    const expired = stalled.wake(); stalled.reply(); await expired;
    assert.equal(stalled.clicks, 0);
    assert.match(stalled.record.message, /原生入口未就绪/);

    const locked = chapterFixture(t, 'sequence-locked');
    const blocked = locked.wake(); locked.reply(); await blocked;
    assert.equal(locked.clicks, 0);
    assert.equal(locked.record.navigationBoundary.status, 'sequence-locked');

    const cancelled = chapterFixture(t);
    const pending = cancelled.wake(); cancelled.cancel(); cancelled.reply(); await pending;
    assert.equal(cancelled.clicks, 0);
    assert.equal(cancelled.record.status, 'cancelled');
});
