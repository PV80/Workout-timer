"""Run on a disposable Android emulator, never a user's device.

Check a real in-place update, checkpoint survival, and artwork pixels while offline.
The emulator must be an AOSP/google_apis image with adb root support.
"""
import argparse
import json
from pathlib import Path
import re
import sqlite3
import subprocess
import time
import xml.etree.ElementTree as ET
from PIL import Image
import uiautomator2 as u2

PACKAGE = 'com.briangitau.workouttimer'
OUT = Path('native-evidence')
OUT.mkdir(exist_ok=True)
p = argparse.ArgumentParser()
p.add_argument('--update', required=True, type=Path)
p.add_argument('--baseline', type=Path)
p.add_argument('--release', type=Path)
a = p.parse_args()

def adb(*args, binary=False, check=True):
    result = subprocess.run(['adb', *map(str, args)], capture_output=True, check=check)
    return result.stdout if binary else result.stdout.decode().strip()

def install(apk, replace=False):
    result = adb('install', *(['-r'] if replace else []), apk)
    assert 'Success' in result, result
    print(f'Installed {apk} (replace={replace})', flush=True)

def launch():
    adb('shell', 'pm', 'grant', PACKAGE, 'android.permission.POST_NOTIFICATIONS', check=False)
    adb('shell', 'am', 'start', '-W', '-n', PACKAGE + '/.MainActivity')
    time.sleep(5)

def tree():
    # Live timers continuously emit accessibility updates. Disable UiAutomator's
    # idle wait instead of assuming a workout screen becomes idle for a second.
    raw=device.dump_hierarchy(compressed=False)
    (OUT / 'latest-ui.xml').write_text(raw)
    return ET.fromstring(raw)


def bounds(node):
    return tuple(map(int, re.findall(r'\d+', node.attrib['bounds'])))

def find(label):
    for node in tree().iter('node'):
        if label.casefold() in [(node.get('text') or '').casefold(), (node.get('content-desc') or '').casefold()]:
            x1,y1,x2,y2 = bounds(node)
            if x2 > x1 and y2 > y1:
                return node
    return None

def tap(label, scroll=False):
    for _ in range(8 if scroll else 3):
        node = find(label)
        if node is not None:
            x1, y1, x2, y2 = bounds(node)
            adb('shell', 'input', 'tap', (x1+x2)//2, (y1+y2)//2)
            time.sleep(2)
            return
        if scroll:
            adb('shell', 'input', 'swipe', 500, 1450, 500, 600, 400)
        else:
            time.sleep(1)
    raise AssertionError(f'Native control not found: {label}')

def capture(name):
    path = OUT / (name + '.png')
    path.write_bytes(adb('exec-out', 'screencap', '-p', binary=True))
    return path

def check_artwork(name):
    root = tree()
    card = next((n for n in root.iter('node') if 'artwork-' in n.get('resource-id', '')), None)
    assert card is not None, 'Artwork card missing from native layout'
    kind = card.get('resource-id').split('artwork-')[-1]
    asset = {'training': 'training-focus', 'recovery': 'recovery', 'history': 'history-progress',
             'tracker': 'tracker-journal', 'backup': 'backup-vault', 'complete': 'session-complete'}[kind]
    x1,y1,x2,y2 = bounds(card)
    actual = Image.open(capture(name)).convert('RGB')
    source = Image.open(Path('assets/artwork') / (asset + '.jpg')).convert('RGB')
    w,h = x2-x1,y2-y1
    assert w > 100 and h > 60, (w,h)
    scale = max(w/source.width, h/source.height)
    resized = source.resize((round(source.width*scale), round(source.height*scale)), Image.Resampling.BILINEAR)
    left,top = (resized.width-w)//2, (resized.height-h)//2
    expected = resized.crop((left,top,left+w,top+h))
    errors=[]
    blank_errors=[]
    text_bounds=[bounds(n) for n in root.iter('node') if n.get('text')]
    # Compare picture pixels, excluding actual native text bounds. Select
    # source pixels that visibly differ from a blank card so missing pictures
    # cannot pass merely because both the asset and card have dark backgrounds.
    for x in range(round(w*.52), round(w*.95), 5):
        fraction=x/w
        opacity = (.9 + (.5-.9)*(fraction/.6)) if fraction < .6 else (.5 + (.05-.5)*((fraction-.6)/.4))
        for y in range(round(h*.1), round(h*.9), 5):
            if any(l-3 <= x1+x <= r+3 and t-3 <= y1+y <= b+3 for l,t,r,b in text_bounds):
                continue
            rgb=expected.getpixel((x,y))
            shaded=[rgb[c]*(1-opacity)+[11,16,16][c]*opacity for c in range(3)]
            blank=[abs(shaded[c]-[11,16,16][c]) for c in range(3)]
            if sum(blank)/3 < 20:
                continue
            seen=actual.getpixel((x1+x,y1+y))
            errors.extend(abs(seen[c]-shaded[c]) for c in range(3))
            blank_errors.extend(blank)
    assert len(errors) >= 90, f'{kind}: too few unobscured picture pixels to verify'
    error=sum(errors)/len(errors)
    blank_error=sum(blank_errors)/len(blank_errors)
    assert error < 18 and error < blank_error*.6, f'{kind}: picture pixels differ from cover crop (mean error {error:.2f}, blank {blank_error:.2f})'
    print(f'Offline native artwork verified: {kind}; mean RGB error {error:.2f}', flush=True)

def assert_scene_above_buttons(label):
    root=tree()
    scene=next((n for n in root.iter('node') if n.get('resource-id', '').endswith('exercise-animation')), None)
    button=find(label)
    assert scene is not None and button is not None
    assert bounds(scene)[3] <= bounds(button)[1], 'Animation overlaps the workout action button'
    print('Native animation card fits above the workout button.', flush=True)

def read_storage(label):
    adb('shell', 'am', 'force-stop', PACKAGE)
    folder=OUT / label
    folder.mkdir(exist_ok=True)
    prefix=f'/data/data/{PACKAGE}/databases/RKStorage'
    for suffix in ['', '-wal', '-shm']:
        result=subprocess.run(['adb','exec-out','cat',prefix+suffix],capture_output=True)
        if result.returncode == 0:
            (folder / ('RKStorage'+suffix)).write_bytes(result.stdout)
    with sqlite3.connect(folder/'RKStorage') as db:
        return dict(db.execute('SELECT key,value FROM catalystLocalStorage'))

try:
    adb('root')
    adb('wait-for-device')
    device=u2.connect()
    device.jsonrpc.setConfigurator({'waitForIdleTimeout': 0, 'waitForSelectorTimeout': 0})
    adb('shell', 'settings', 'put', 'global', 'animator_duration_scale', '0')
    adb('shell', 'settings', 'put', 'global', 'transition_animation_scale', '0')
    adb('shell', 'settings', 'put', 'global', 'window_animation_scale', '0')
    adb('shell', 'svc', 'wifi', 'disable')
    adb('shell', 'svc', 'data', 'disable')
    if a.baseline:
        install(a.baseline)
        launch()
        capture('baseline-home')
        tap('Start monday workout', scroll=True)
        if find('Not now') is not None:
            tap('Not now')
        tap('DONE')
        tap('START NEXT SET')
        tap('Pause timer')
        assert find('PAUSED') is not None
        before=read_storage('before-update')
        prior=json.loads(before['active_workout'])['state']
        assert prior['currentSetNumber']==2 and len(prior['setRecords'])==1
        install(a.update, replace=True)
        after=read_storage('after-update')
        assert before == after, 'Updating the APK changed saved workout/history data'
        launch()
        assert find('PAUSED') is not None, 'Paused workout did not resume after upgrade'
        capture('upgraded-paused-workout')
        restored=read_storage('after-relaunch')
        checkpoint=json.loads(restored['active_workout'])['state']
        for field in ['sessionId', 'setRecords', 'currentSetNumber', 'pausedAt', 'phaseStartedAt']:
            assert prior[field] == checkpoint[field], f'Upgrade changed {field}'
        print('In-place upgrade and cold-start recovery preserved the earlier set and paused second set.', flush=True)
        # Clear only the disposable emulator fixture for independent fresh-screen checks.
        adb('shell','pm','clear',PACKAGE)
    else:
        install(a.update)
        print('No prior artifact available; upgrade regression was not exercised.', flush=True)
    launch()
    check_artwork('compatible-home')
    tap('History')
    check_artwork('compatible-history')
    tap('Back')
    tap('Tracker')
    check_artwork('compatible-tracker')
    if a.release:
        # The keys deliberately differ. Production release is tested as a clean
        # install; it must not be offered as an update to debug-signed users.
        adb('uninstall',PACKAGE)
        install(a.release)
        launch()
        check_artwork('release-home')
        tap('History')
        check_artwork('release-history')
    print('Native Android smoke checks passed.', flush=True)
finally:
    capture('last-screen')
    (OUT/'logcat.txt').write_text(adb('logcat','-d','-t','1500'))
