"""Scoped offline font/logo build integrity checks in disposable D-drive copies."""
from pathlib import Path
from tempfile import TemporaryDirectory
import hashlib
import json
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / 'work/conservative-three-20261025/font-build-integrity'
WORK.mkdir(parents=True, exist_ok=True)
TABLE_SHA = 'fbc6ae3c795a46ca2bd0994e68e7cb90ca4d9a046f335512657760d9a4fdf875'
SENTINEL = b'previous-installable-artifact\n'
logs = []


def isolated(case):
    directory = WORK / case
    directory.mkdir()
    for name in ['build_script.py', 'implementation.js', 'course_catalog.js']:
        shutil.copyfile(ROOT / name, directory / name)
    shutil.copytree(ROOT / 'sources', directory / 'sources')
    shutil.copytree(ROOT / 'vendor/font', directory / 'vendor/font')
    (directory / 'assets').mkdir()
    for name in ['logo.png', 'runtime-logo-manifest.json', 'logo-runtime.png', 'logo-metadata.png']:
        shutil.copyfile(ROOT / 'assets' / name, directory / 'assets' / name)
    return directory


def build(directory):
    return subprocess.run([sys.executable, 'build_script.py'], cwd=directory,
                          capture_output=True, text=True, encoding='utf-8')


def rejected(directory, case):
    artifact = directory / '学习通AI助手.user.js'
    artifact.write_bytes(SENTINEL)
    process = build(directory)
    assert process.returncode != 0, f'{case}: invalid build input was accepted'
    assert artifact.read_bytes() == SENTINEL, f'{case}: old artifact changed'
    assert not list(directory.glob('*.tmp')), f'{case}: temporary output leaked'
    logs.append({'case': case, 'passed': True, 'exitCode': process.returncode,
                 'diagnostic': (process.stderr or process.stdout).strip().splitlines()[-1]})


with TemporaryDirectory(prefix='run-', dir=WORK) as temporary:
    temporary = Path(temporary).resolve()
    temporary.relative_to(WORK.resolve())  # Cleanup is confined to this test's D-drive workspace.
    original_work = WORK
    WORK = temporary

    valid = isolated('valid')
    process = build(valid)
    assert process.returncode == 0, process.stderr
    assert (valid / '学习通AI助手.user.js').read_bytes() == (ROOT / '学习通AI助手.user.js').read_bytes()
    logs.append({'case': 'valid-isolated-build-matches-root-artifact', 'passed': True})

    missing = isolated('missing-table')
    (missing / 'vendor/font/table.json').unlink()
    rejected(missing, 'missing-table-preserves-old-artifact')

    mismatch = isolated('hash-mismatch')
    table_path = mismatch / 'vendor/font/table.json'
    raw = table_path.read_bytes()
    assert len(raw) == 355427 and hashlib.sha256(raw).hexdigest() == TABLE_SHA
    number = re.search(rb':\s*(\d+)', raw)
    assert number
    index = number.start(1)
    corrupted = raw[:index] + (b'1' if raw[index:index + 1] != b'1' else b'2') + raw[index + 1:]
    assert len(corrupted) == len(raw) and json.loads(corrupted) != json.loads(raw)
    table_path.write_bytes(corrupted)
    rejected(mismatch, 'valid-json-hash-mismatch-preserves-old-artifact')

    invalid = isolated('invalid-json')
    table_path = invalid / 'vendor/font/table.json'
    malformed = b'!' + table_path.read_bytes()[1:]
    table_path.write_bytes(malformed)
    # Only the disposable manifest accepts the synthetic digest, so JSON validation is exercised independently.
    manifest = invalid / 'vendor/font/manifest.json'
    content = manifest.read_text(encoding='utf-8')
    assert TABLE_SHA in content, 'The table digest must be declared in the font manifest'
    manifest.write_text(content.replace(TABLE_SHA, hashlib.sha256(malformed).hexdigest()), encoding='utf-8')
    rejected(invalid, 'malformed-json-preserves-old-artifact')
    assert 'json' in logs[-1]['diagnostic'].lower(), logs[-1]['diagnostic']

    missing_logo = isolated('missing-logo')
    (missing_logo / 'assets/logo-runtime.png').unlink()
    rejected(missing_logo, 'missing-floating-logo-preserves-old-artifact')

    damaged_logo = isolated('damaged-logo')
    logo_path = damaged_logo / 'assets/logo-metadata.png'
    logo = logo_path.read_bytes()
    logo_path.write_bytes(logo[:-1] + bytes([logo[-1] ^ 1]))
    rejected(damaged_logo, 'damaged-metadata-logo-preserves-old-artifact')
    assert 'checksum' in logs[-1]['diagnostic'].lower(), logs[-1]['diagnostic']

    WORK = original_work

receipt = {'total': len(logs), 'passed': len(logs), 'checks': logs,
           'scope': 'isolated offline font/logo builds only; root resources and root artifact remain unchanged'}
(WORK / 'results.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
for result in logs:
    print('PASS ' + result['case'])
print(f'PASS {len(logs)} font build integrity checks')
