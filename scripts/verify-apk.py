"""Fail CI when a standalone APK omits JS/artwork or has an invalid signature."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import zipfile

p = argparse.ArgumentParser()
p.add_argument('apk', type=Path)
p.add_argument('--debug-certificate', type=Path)
a = p.parse_args()
build_tools = sorted((Path(os.environ['ANDROID_HOME']) / 'build-tools').iterdir(),
                     key=lambda x: tuple(int(v) if v.isdigit() else 0 for v in x.name.split('.')))[-1]

def run(*args):
    return subprocess.check_output([str(x) for x in args], text=True)

signature = run(build_tools / 'apksigner', 'verify', '--verbose', '--print-certs', a.apk)
print(signature)
if a.debug_certificate:
    cert = subprocess.check_output(['keytool', '-exportcert', '-keystore', str(a.debug_certificate),
                                    '-storepass', 'android', '-alias', 'androiddebugkey'])
    assert hashlib.sha256(cert).hexdigest() in signature, 'Update APK must retain the existing debug certificate'
manifest = run(build_tools / 'aapt', 'dump', 'badging', a.apk)
print(manifest.splitlines()[0])
assert "name='com.briangitau.workouttimer'" in manifest
version = json.loads(Path("app.json").read_text())["expo"]["android"]["versionCode"]
assert f"versionCode='{version}'" in manifest
assert 'application-debuggable' not in manifest, 'Distributed update must run in release mode'
with zipfile.ZipFile(a.apk) as archive:
    names = archive.namelist()
    assert archive.getinfo('assets/index.android.bundle').file_size > 100_000
    for asset in ['training-focus', 'session-complete', 'history-progress', 'tracker-journal', 'backup-vault', 'recovery']:
        # Metro strips punctuation from Android resource names.
        matches = [n for n in names if n.startswith('res/') and asset.replace('-', '') in n]
        assert len(matches) == 1, (asset, matches)
        actual = archive.read(matches[0])
        expected = (Path('assets/artwork') / (asset + '.jpg')).read_bytes()
        assert actual == expected, f'{asset}: packaged artwork differs from source'
        print(f'Embedded artwork verified: {asset} ({len(actual)} bytes)')
print('APK signature, package, version, release mode, JS, and six local pictures verified.')
