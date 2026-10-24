from pathlib import Path
import re
import json
import hashlib
import base64

ROOT = Path(__file__).resolve().parent
# 正式发布版本；每次升级增加 0.01。
VERSION = '1.31'
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

# Declarations still share the original userscript closure. Keep the bootstrap last:
# the document-start playback guard depends on hoisted function declarations.
IMPLEMENTATION_FILES = (
    'sources/background-playback.js',
    'sources/font-decoder.js',
    'sources/question-workflow.js',
    'sources/assistant-window-context.js',
    'sources/assistant-results.js',
    'sources/assistant-navigation.js',
    'sources/course-context-collector.js',
    'sources/model-settings.js',
    'sources/assistant-window.js',
    'sources/assistant-status.js',
    'sources/analysis-session.js',
    'sources/assistant-controller.js',
    'implementation.js',
)
SOURCE_FILES = (
    'sources/assistant-core.js',
    'sources/assistant-errors.js',
    'sources/analysis-scheduler.js',
    'sources/analysis-history.js',
    'sources/question-context.js',
    'sources/provider-logos.js',
    'sources/model-providers.js',
    'sources/credential-settings.js',
    'sources/control-feedback.js',
    'sources/assistant-updates.js',
    'sources/model-capability.js',
    'sources/question-parser.js',
    'sources/question-media.js',
    'sources/question-actions.js',
    'sources/course-context.js',
    'sources/course-video-info.js',
    'course_catalog.js',
    'sources/course-document-bridge.js',
    'sources/course-page-adapter.js',
    'sources/course-video-quiz.js',
    'sources/course-runner.js',
    'sources/course-home-launch.js',
    'sources/course-list.js',
    'sources/course-queue.js',
    'sources/course-run-preview.js',
    'sources/course-controls.js',
    'sources/platform-menu.js',
    'sources/other-features.js',
    'sources/model-picker.js',
) + IMPLEMENTATION_FILES
if len(SOURCE_FILES) != len(set(SOURCE_FILES)):
    raise ValueError('Duplicate source in build order')
modules = {name: (ROOT / name).read_text(encoding='utf-8') for name in SOURCE_FILES}
core = modules['sources/assistant-core.js']
font_marker = '/* BUNDLED_FONT_DEPENDENCIES */'
if core.count(font_marker) != 1 or re.search(r'^// @require\b', core, re.M):
    raise ValueError('Missing font bundle marker or unexpected remote JavaScript dependency')
core = core.replace(font_marker, bundled_font_dependencies())
template = (ROOT / 'sources/panel-template.html').read_text(encoding='utf-8')
launcher_icon = base64.b64encode((ROOT / 'assets/logo.png').read_bytes()).decode('ascii')
template = template.replace('__FLOATING_LAUNCHER_ICON__', 'data:image/png;base64,' + launcher_icon)
intro = (ROOT / 'sources/project-intro.html').read_text(encoding='utf-8')

core = re.sub(r'(?m)^// @version\s+[^\r\n]+', f'// @version      {VERSION}', core)
core = re.sub(r'(?m)^// @author\s+[^\r\n]+', '// @author       Hailin', core)
core = re.sub(r"version: '[0-9.]+'", f"version: '{VERSION}'", core)
core = re.sub(r"const ASSISTANT_VERSION = '[0-9.]+'", f"const ASSISTANT_VERSION = '{VERSION}'", core)
template = re.sub(r'学习通AI助手 v[0-9.]+', f'学习通AI助手 v{VERSION}', template)
intro_placeholder = '<!-- PROJECT_INTRO -->'
assert template.count(intro_placeholder) == 1
template = template.replace(intro_placeholder, intro)
modules['sources/assistant-core.js'] = core
panel_marker = '        /* PANEL_TEMPLATE */'
if sum(modules[name].count(panel_marker) for name in IMPLEMENTATION_FILES) != 1:
    raise ValueError('Missing or duplicate panel template marker')
for name in IMPLEMENTATION_FILES:
    content = re.sub(r"version: '[0-9.]+'", f"version: '{VERSION}'", modules[name])
    modules[name] = content.replace(panel_marker, '        shadow.innerHTML = `' + template + '`;')
output = ''.join(modules[name] for name in SOURCE_FILES) + '\n})();\n})();\n'
output = '\n'.join(line.rstrip() for line in output.splitlines()) + '\n'
(ROOT / '学习通AI助手.user.js').write_text(output, encoding='utf-8', newline='\n')
