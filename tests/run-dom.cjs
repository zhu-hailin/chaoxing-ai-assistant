const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', error => errors.push(error.message));
const dom = new JSDOM(fs.readFileSync(path.join(__dirname, '离线验证.html'), 'utf8'), {
  runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole,
  beforeParse(w) {
    // jsdom 没有实现 iframe srcdoc；用标准 document.write 构造相同子文档。
    Object.defineProperty(w.HTMLIFrameElement.prototype, 'srcdoc', {
      set(html) {
        const d = this.contentDocument;
        d.open(); d.write(html); d.close();
        w.setTimeout(() => this.dispatchEvent(new w.Event('load')), 0);
      }
    });
  }
});
// 此看门狗覆盖整组多 iframe UI 用例，不代表任何生产等待或单个断言的放宽。
const deadline = Date.now() + 90000;
const timer = setInterval(() => {
  const result = dom.window.testResults;
  if (!result && Date.now() < deadline) return;
  clearInterval(timer);
  const report = result || { failures: ['测试超时'], errors, progress: dom.window.document.getElementById('results')?.textContent };
  console.log(JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(report, null, 2));
  dom.window.close();
  process.exitCode = report.failures.length ? 1 : 0;
}, 100);
