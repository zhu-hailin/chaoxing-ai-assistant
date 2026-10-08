from pathlib import Path
import json

root = Path(__file__).resolve().parent.parent
html = (root / 'tests/index.html').read_text(encoding='utf-8')
source = json.dumps((root / '学习通AI助手.user.js').read_text(encoding='utf-8'), ensure_ascii=False).replace('</', '<\\/')
runner = (root / 'tests/runner.js').read_text(encoding='utf-8').replace('</script', '<\\/script')
html = html.replace('<script src="runner.js"></script>', '<script>window.deliverySource = ' + source + ';</script><script>' + runner + '</script>')
(root / 'tests/离线验证.html').write_text(html, encoding='utf-8')
