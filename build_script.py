from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent
# 发布版本号每次只增加 0.01：1.00 → 1.01 → 1.02。
VERSION = '1.02'
core = (ROOT / 'sources/assistant-core.js').read_text(encoding='utf-8')
template = (ROOT / 'sources/panel-template.html').read_text(encoding='utf-8')
intro = (ROOT / 'sources/project-intro.html').read_text(encoding='utf-8')
implementation = (ROOT / 'implementation.js').read_text(encoding='utf-8')
catalog = (ROOT / 'course_catalog.js').read_text(encoding='utf-8')

core = re.sub(r'(?m)^// @version\s+[^\r\n]+', f'// @version      {VERSION}', core)
core = re.sub(r'(?m)^// @author\s+[^\r\n]+', '// @author       Hailin', core)
core = re.sub(r"version: '[0-9.]+'", f"version: '{VERSION}'", core)
template = re.sub(r'学习通AI助手 v[0-9.]+', f'学习通AI助手 v{VERSION}', template)
close = '<button type="button" id="close" class="secondary">关闭</button>'
assert close in template
template = template.replace(close, '''<div class="head-actions">
            <button type="button" id="github" class="secondary" title="GitHub 项目主页">GitHub</button>
            <button type="button" id="about-toggle" class="secondary" aria-label="项目介绍" aria-expanded="false" title="项目介绍">?</button>
            <button type="button" id="close" class="secondary">关闭</button>
          </div>''')
anchor = '          <div class="row"><label>DeepSeek</label>'
assert anchor in template
template = template.replace(anchor, intro + '\n' + anchor)
template = template.replace('</style>', '''
          .head-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
          #about-toggle{width:30px;height:30px;min-width:30px;padding:0;border-radius:50%;font-weight:700;font-size:17px;line-height:30px}
          #about{background:#f5f7fc;border:1px solid #e0e6f2;border-radius:9px;padding:12px;margin:8px 0 14px;font-size:13px;overflow-wrap:anywhere}
          #about[hidden]{display:none}#about p{margin:8px 0}.free{color:#1a7448}
        </style>''')
implementation = re.sub(r"version: '[0-9.]+'", f"version: '{VERSION}'", implementation)
implementation = implementation.replace('        /* PANEL_TEMPLATE */', '        shadow.innerHTML = `' + template + '`;')
output = core + catalog + implementation + '\n})();\n'
output = '\n'.join(line.rstrip() for line in output.splitlines()) + '\n'
(ROOT / '学习通AI助手.user.js').write_text(output, encoding='utf-8', newline='\n')
