const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { setImmediate } = require('node:timers/promises');
const { runInNewContext } = require('node:vm');

const source = readFileSync(join(__dirname, '../sources/course-list.js'), 'utf8');
const parentURL = 'https://i.chaoxing.com/base';
const frameURL = 'https://mooc2-ans.chaoxing.com/visit/interaction';
const channel = 'cx-ai-course-list-v1';

test('课程子页就绪立即连接，首次 load 复用请求，晚到的旧快照不能恢复旧列表', async () => {
    const sent = [], records = new Map(), listeners = new Map();
    const parentEvents = new Map(), documentEvents = new Map();
    const frame = {
        id: 'frame_content', isConnected: true, getAttribute: () => frameURL,
        contentWindow: { postMessage: ({ id }) => sent.push(id) }
    };
    const window = { Event, addEventListener: (type, fn) => parentEvents.set(type, fn) };
    window.top = window;
    const document = {
        baseURI: parentURL, defaultView: window, documentElement: { dataset: {} },
        getElementById: id => id === frame.id ? frame : null,
        addEventListener: (type, fn) => documentEvents.set(type, fn), dispatchEvent() {}
    };
    const list = runInNewContext(source + '\n({initCourseListTransport, mountCourseListBridge, courseListSnapshot})', {
        window, document, URL, Event, crypto: { randomUUID },
        pageURL: doc => new URL(doc.baseURI), COURSE_HOME_ORIGIN: new URL(frameURL).origin,
        COURSE_HOME_CATALOG_UPDATE: 'catalog-update', courseHomeTab: async () => ({ cxCourseTabId: randomUUID() }),
        courseHomeUUID: value => /^[\da-f-]{36}$/i.test(value),
        isCourseStudyHost: host => host === 'mooc2-ans.chaoxing.com',
        courseURLContext: url => Object.fromEntries(url.searchParams),
        sameCourseHomeIdentity: (a, b) => ['course', 'classroom', 'student'].every(key => a[key] === b[key]),
        GM_addValueChangeListener(key, fn) { listeners.set(key, fn); return key; },
        GM_removeValueChangeListener: key => listeners.delete(key),
        set: (key, value) => records.set(key, value), GM_deleteValue: key => records.delete(key),
        setInterval: () => 1, clearInterval() {}
    });
    list.initCourseListTransport();
    list.mountCourseListBridge(document);
    await setImmediate();
    assert.equal(sent.length, 1);
    const id = sent[0], key = `cx_course_list:${id}`, initialRequest = records.get(key);
    parentEvents.get('message')({ data: { channel, kind: 'list-ready' },
        origin: new URL(frameURL).origin, source: frame.contentWindow });
    assert.equal(sent.length, 2, '子页通知不依赖下一次轮询');
    documentEvents.get('load')({ target: frame });
    assert.equal(sent.length, 3);
    assert.equal(sent.at(-1), id);
    assert.strictEqual(records.get(key), initialRequest, '首次 load 不重置请求有效期');

    const receive = listeners.get(`${key}:snapshot`);
    const snapshot = {
        id, url: frameURL, documentId: randomUUID(), revision: 1, ready: true,
        items: [{ key: '1:2:3', title: '示例课程', ended: false, completed: 1, total: 2,
            identity: { course: '1', classroom: '2', student: '3' },
            href: 'https://mooc2-ans.chaoxing.com/visit/stucoursemiddle?course=1&classroom=2&student=3' }]
    };
    receive(null, null, snapshot);
    assert.equal(list.courseListSnapshot().items[0].key, '1:2:3');
    documentEvents.get('load')({ target: frame });
    assert.equal(list.courseListSnapshot(), null);
    await setImmediate();
    assert.notEqual(sent.at(-1), id, '已有列表的 iframe 重载后必须重新绑定');
    receive(null, null, { ...snapshot, revision: 2 });
    assert.equal(list.courseListSnapshot(), null, '旧文档回调无法恢复已失效的列表');
});

test('没有课程工具栏时，子页也在正文出现后通知父页', () => {
    const messages = [], documentEvents = new Map();
    const parent = { postMessage: (message, origin) => messages.push({ message, origin }) };
    const window = { parent, top: parent, addEventListener() {} };
    const document = {
        baseURI: frameURL, referrer: parentURL, defaultView: window, body: null,
        addEventListener: (type, fn) => documentEvents.set(type, fn)
    };
    const init = runInNewContext(source + '\ninitCourseListTransport', {
        window, document, URL, pageURL: doc => new URL(doc.baseURI), COURSE_HOME_ORIGIN: new URL(frameURL).origin
    });
    init();
    assert.equal(messages.length, 0);
    document.body = {};
    documentEvents.get('DOMContentLoaded')();
    assert.equal(messages.length, 1);
    assert.equal(messages[0].origin, new URL(parentURL).origin);
    assert.equal(messages[0].message.channel, channel);
    assert.equal(messages[0].message.kind, 'list-ready');
});
