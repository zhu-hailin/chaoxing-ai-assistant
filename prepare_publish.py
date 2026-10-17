from pathlib import Path
import shutil
import hashlib
import argparse

parser = argparse.ArgumentParser()
parser.add_argument("--skip-readme", action="store_true")
parser.add_argument("--source-root", type=Path, help="从已验证的隔离副本发布，保留开发目录中的未发布修改")
args = parser.parse_args()

project = Path(__file__).resolve().parent
root = args.source_root.resolve() if args.source_root else project
publish = project / '.publish'
assert (publish / '.git').exists()
paths = ['.gitignore', 'AGENTS.md', 'README.md', 'CHANGELOG.md', '学习通AI助手.user.js', 'build_script.py',
         'implementation.js', 'course_catalog.js', 'package.json', 'package-lock.json',
         'prepare_publish.py', 'tests/index.html', 'tests/runner.js', 'tests/build_offline.py',
         'tests/build_course_preview.py', 'tests/build_homework_preview.py',
         'tests/run-dom.cjs', 'tests/study-dom.cjs', 'tests/parser-dom.cjs',
         'tests/media-dom.cjs', 'tests/course-runner-dom.cjs', 'tests/course-preview-dom.cjs',
         'tests/analysis-task-dom.cjs', 'tests/model-providers-dom.cjs', 'tests/course-context-dom.cjs', 'tests/course-video-info-dom.cjs', 'tests/model-capability-dom.cjs', 'tests/course-info-integration-dom.cjs', 'tests/panel-window-dom.cjs', 'tests/credential-settings-dom.cjs', 'tests/provider-logos-dom.cjs', 'tests/p0-page-actions-dom.cjs', 'tests/p0-browser-smoke.cjs', 'tests/自动课程模拟.html']
paths += [str(p.relative_to(root)) for p in (root / 'sources').iterdir() if p.suffix in ('.js', '.html')]
paths += [str(p.relative_to(root)) for p in (root / 'docs').glob('*.md')]
paths += ['docs/脚本使用风险分析图.html', 'docs/v1.20发布验证.json']
paths += ['tests/video-quiz-dom.cjs', 'tests/video-quiz-results.json']
paths += ['tests/task-locator-results.json', 'docs/快速任务定位与其他功能回归结果.json']
paths += ['tests/task-locator-fast-results.json', 'docs/秒级任务定位回归结果.json']
paths += ['tests/fixtures/task-probe-' + name + '.html' for name in ['video', 'static', 'work', 'insertbbs']]
paths += ['tests/video-speed-dom.cjs', 'tests/video-speed-fixture.cjs', 'tests/video-speed-results.json', 'docs/倍速与启动更新回归结果.json']
paths += ['tests/assistant-updates-dom.cjs', 'tests/assistant-updates-results.json']
paths += ['tests/model-fixture.cjs', 'tests/ui-model-fixes-dom.cjs', 'tests/ui-model-fixes-results.json']
paths += ['tests/answer-policy-dom.cjs', 'tests/answer-policy-mock.cjs', 'tests/answer-policy-results.json']
paths += [str(p.relative_to(root)) for p in (root / 'assets').rglob('*') if p.is_file()]
paths += [str(p.relative_to(root)) for p in (root / 'vendor/font').rglob('*') if p.is_file()]
paths += ['tests/font-dependencies-dom.cjs']
paths += ['tests/fixtures/video-quiz-tktopic.html']
paths += ['tests/fixtures/video-speed-chaoxing-menu.html', 'docs/倍速菜单兼容回归结果.json']
paths += ['tests/errors-dom.cjs', 'tests/question-context-dom.cjs',
          'tests/question-graph-dom.cjs', 'tests/question-actions-dom.cjs',
          'tests/architecture-integration-dom.cjs',
          'tests/question-context-results.json', 'tests/question-graph-results.json',
          'tests/question-actions-results.json', 'tests/architecture-integration-results.json',
          'docs/架构升级回归结果.json']
paths += ['tests/' + name + '.json' for name in ['results', 'study-results', 'parser-results',
          'media-results', 'course-runner-results', 'course-preview-results', 'analysis-task-results']]
if args.skip_readme:
    paths.remove("README.md")
for relative in paths:
    original, target = root / relative, publish / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(original, target)
    assert hashlib.sha256(original.read_bytes()).digest() == hashlib.sha256(target.read_bytes()).digest()
print(f'Prepared {len(paths)} exact file copies for publishing.')
