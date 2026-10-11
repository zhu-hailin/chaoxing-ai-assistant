from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent
# 正式发布版本；每次升级增加 0.01。
VERSION = '1.11'
core = (ROOT / 'sources/assistant-core.js').read_text(encoding='utf-8')
template = (ROOT / 'sources/panel-template.html').read_text(encoding='utf-8')
intro = (ROOT / 'sources/project-intro.html').read_text(encoding='utf-8')
implementation = (ROOT / 'implementation.js').read_text(encoding='utf-8')
catalog = (ROOT / 'course_catalog.js').read_text(encoding='utf-8')
providers = (ROOT / 'sources/model-providers.js').read_text(encoding='utf-8')
model_capability = (ROOT / 'sources/model-capability.js').read_text(encoding='utf-8')
course_context = (ROOT / 'sources/course-context.js').read_text(encoding='utf-8')
video_info = (ROOT / 'sources/course-video-info.js').read_text(encoding='utf-8')
parser = (ROOT / 'sources/question-parser.js').read_text(encoding='utf-8')
media = (ROOT / 'sources/question-media.js').read_text(encoding='utf-8')
course_adapter = (ROOT / 'sources/course-page-adapter.js').read_text(encoding='utf-8')
course_bridge = (ROOT / 'sources/course-document-bridge.js').read_text(encoding='utf-8')
course_runner = (ROOT / 'sources/course-runner.js').read_text(encoding='utf-8')

core = re.sub(r'(?m)^// @version\s+[^\r\n]+', f'// @version      {VERSION}', core)
core = re.sub(r'(?m)^// @author\s+[^\r\n]+', '// @author       Hailin', core)
core = re.sub(r"version: '[0-9.]+'", f"version: '{VERSION}'", core)
template = re.sub(r'学习通AI助手 v[0-9.]+', f'学习通AI助手 v{VERSION}', template)
intro_placeholder = '<!-- PROJECT_INTRO -->'
assert template.count(intro_placeholder) == 1
template = template.replace(intro_placeholder, intro)
implementation = re.sub(r"version: '[0-9.]+'", f"version: '{VERSION}'", implementation)
implementation = implementation.replace('        /* PANEL_TEMPLATE */', '        shadow.innerHTML = `' + template + '`;')
output = core + providers + model_capability + parser + media + course_context + video_info + catalog + course_bridge + course_adapter + course_runner + implementation + '\n})();\n'
output = '\n'.join(line.rstrip() for line in output.splitlines()) + '\n'
(ROOT / '学习通AI助手.user.js').write_text(output, encoding='utf-8', newline='\n')
