from pathlib import Path
import re
import json
import hashlib

ROOT = Path(__file__).resolve().parent
# 正式发布版本；每次升级增加 0.01。
VERSION = '1.28'
def bundled_font_dependencies():
    # Offline and pinned: never download JavaScript during build or execution.
    directory = ROOT / 'vendor/font'
    manifest = json.loads((directory / 'manifest.json').read_text(encoding='utf-8'))
    contents = {}
    for entry in manifest['files']:
        name = entry['file']
        if Path(name).name != name:
            raise ValueError('Invalid font dependency filename')
        raw = (directory / name).read_bytes()
        if hashlib.sha256(raw).hexdigest() != entry['sha256']:
            raise ValueError(f'Font dependency checksum mismatch: {name}')
        contents[name] = raw.decode('utf-8')
    notices = '\n'.join(contents[name] for name in manifest['notices'])
    sources = '\n;\n'.join(contents[name] for name in manifest['scripts'])
    # The upstream scripts expect a classic-script this and optional UMD exports.
    # A private receiver + masked AMD/CommonJS exports keeps globals untouched;
    # the assistant itself remains in its separate strict closure.
    return ('/* Bundled font dependencies: original pinned sources; MIT notices.\n'
            + notices + '\n*/\n'
            + 'const bundledFontDependencies = (function (define, module) {\n'
            + sources + '\n;return { Typr: Typr, md5: this.md5 };\n'
            + '}).call(Object.create(null), undefined, undefined);\n')

core = (ROOT / 'sources/assistant-core.js').read_text(encoding='utf-8')
font_marker = '/* BUNDLED_FONT_DEPENDENCIES */'
if core.count(font_marker) != 1 or re.search(r'^// @require\b', core, re.M):
    raise ValueError('Missing font bundle marker or unexpected remote JavaScript dependency')
core = core.replace(font_marker, bundled_font_dependencies())
template = (ROOT / 'sources/panel-template.html').read_text(encoding='utf-8')
intro = (ROOT / 'sources/project-intro.html').read_text(encoding='utf-8')
implementation = (ROOT / 'implementation.js').read_text(encoding='utf-8')
catalog = (ROOT / 'course_catalog.js').read_text(encoding='utf-8')
errors = (ROOT / 'sources/assistant-errors.js').read_text(encoding='utf-8')
question_context = (ROOT / 'sources/question-context.js').read_text(encoding='utf-8')
actions = (ROOT / 'sources/question-actions.js').read_text(encoding='utf-8')
providers = (ROOT / 'sources/model-providers.js').read_text(encoding='utf-8')
provider_logos = (ROOT / 'sources/provider-logos.js').read_text(encoding='utf-8')
model_picker = (ROOT / 'sources/model-picker.js').read_text(encoding='utf-8')
credential_settings = (ROOT / 'sources/credential-settings.js').read_text(encoding='utf-8')
updates = (ROOT / 'sources/assistant-updates.js').read_text(encoding='utf-8')
model_capability = (ROOT / 'sources/model-capability.js').read_text(encoding='utf-8')
course_context = (ROOT / 'sources/course-context.js').read_text(encoding='utf-8')
video_info = (ROOT / 'sources/course-video-info.js').read_text(encoding='utf-8')
parser = (ROOT / 'sources/question-parser.js').read_text(encoding='utf-8')
media = (ROOT / 'sources/question-media.js').read_text(encoding='utf-8')
course_adapter = (ROOT / 'sources/course-page-adapter.js').read_text(encoding='utf-8')
course_bridge = (ROOT / 'sources/course-document-bridge.js').read_text(encoding='utf-8')
video_quiz = (ROOT / 'sources/course-video-quiz.js').read_text(encoding='utf-8')
course_runner = (ROOT / 'sources/course-runner.js').read_text(encoding='utf-8')
other_features = (ROOT / 'sources/other-features.js').read_text(encoding='utf-8')

core = re.sub(r'(?m)^// @version\s+[^\r\n]+', f'// @version      {VERSION}', core)
core = re.sub(r'(?m)^// @author\s+[^\r\n]+', '// @author       Hailin', core)
core = re.sub(r"version: '[0-9.]+'", f"version: '{VERSION}'", core)
core = re.sub(r"const ASSISTANT_VERSION = '[0-9.]+'", f"const ASSISTANT_VERSION = '{VERSION}'", core)
template = re.sub(r'学习通AI助手 v[0-9.]+', f'学习通AI助手 v{VERSION}', template)
intro_placeholder = '<!-- PROJECT_INTRO -->'
assert template.count(intro_placeholder) == 1
template = template.replace(intro_placeholder, intro)
implementation = re.sub(r"version: '[0-9.]+'", f"version: '{VERSION}'", implementation)
implementation = implementation.replace('        /* PANEL_TEMPLATE */', '        shadow.innerHTML = `' + template + '`;')
output = core + errors + question_context + provider_logos + providers + credential_settings + updates + model_capability + parser + media + actions + course_context + video_info + catalog + course_bridge + course_adapter + video_quiz + course_runner + other_features + model_picker + implementation + '\n})();\n})();\n'
output = '\n'.join(line.rstrip() for line in output.splitlines()) + '\n'
(ROOT / '学习通AI助手.user.js').write_text(output, encoding='utf-8', newline='\n')
