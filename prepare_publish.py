from pathlib import Path
import shutil
import hashlib
import argparse

parser = argparse.ArgumentParser()
parser.add_argument("--skip-readme", action="store_true")
args = parser.parse_args()

root = Path(__file__).resolve().parent
publish = root / '.publish'
assert (publish / '.git').exists()
paths = ['.gitignore', 'README.md', 'CHANGELOG.md', '学习通AI助手.user.js', 'build_script.py',
         'implementation.js', 'course_catalog.js', 'package.json', 'package-lock.json',
         'prepare_publish.py', 'tests/index.html', 'tests/runner.js', 'tests/build_offline.py',
         'tests/build_course_preview.py', 'tests/build_homework_preview.py',
         'tests/run-dom.cjs', 'tests/study-dom.cjs', 'tests/parser-dom.cjs',
         'tests/media-dom.cjs', 'tests/course-runner-dom.cjs', 'tests/course-preview-dom.cjs',
         'tests/analysis-task-dom.cjs', 'tests/自动课程模拟.html']
paths += [str(p.relative_to(root)) for p in (root / 'sources').iterdir() if p.suffix in ('.js', '.html')]
paths += [str(p.relative_to(root)) for p in (root / 'docs').glob('*.md')]
paths += [str(p.relative_to(root)) for p in (root / 'assets').rglob('*.png')]
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
