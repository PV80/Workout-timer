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

def find(label, root=None):
    for node in (root if root is not None else tree()).iter('node'):
        if label.casefold() in [(node.get('text') or '').casefold(), (node.get('content-desc') or '').casefold()]:
            x1,y1,x2,y2 = bounds(node)
            if x2 > x1 and y2 > y1:
                return node
    return None

def tap(label, scroll=False):
    for _ in range(12):
        root=tree()
        node = find(label, root)
        if node is not None:
            x1, y1, x2, y2 = bounds(node)
            adb('shell', 'input', 'tap', (x1+x2)//2, (y1+y2)//2)
            time.sleep(2)
            return
        # Exact-alarm permission is checked asynchronously after navigation.
        # Dismiss the known optional prompt even if it appears after our first poll.
        dialog=find('Not now', root)
        if dialog is not None:
            x1,y1,x2,y2=bounds(dialog)
            adb('shell','input','tap',(x1+x2)//2,(y1+y2)//2)
            time.sleep(1)
            continue
        if scroll:
            adb('shell', 'input', 'swipe', 500, 1450, 500, 600, 400)
        else:
            time.sleep(1)
    visible=[n.get('text') or n.get('content-desc') for n in root.iter('node') if n.get('text') or n.get('content-desc')]
    raise AssertionError(f'Native control not found: {label}; visible: {visible}')

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
    image_node=next((n for n in card.iter('node') if n.get('class') == 'android.widget.ImageView'), None)
    assert image_node is not None, 'Native picture view is missing'
    # Use the actual image bounds: the card includes a density-scaled border.
    x1,y1,x2,y2 = bounds(image_node)
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
    rect=bounds(scene)
    density=int(re.findall(r'\d+', adb('shell', 'wm', 'density'))[-1]) / 160
    svg=next((n for n in scene.iter('node') if n.get('class', '').endswith('SvgView')), None)
    assert svg is not None, 'Animation drawing is missing'
    drawing=bounds(svg)
    width,height=drawing[2]-drawing[0],drawing[3]-drawing[1]
    assert any(abs(width-w*density) <= 3 and abs(height-h*density) <= 3
               for w,h in [(110,82),(138,104)]), 'Animation viewport is clipped'
    assert rect[0] <= drawing[0] and rect[1] <= drawing[1] and rect[2] >= drawing[2] and rect[3] >= drawing[3], 'Animation extends outside its card'
    assert rect[3] <= bounds(button)[1], 'Animation overlaps the workout action button'
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

def pull_jpeg(remote, artifact):
    # adb's sync protocol accepts spaces literally and reports missing files.
    path = OUT / artifact
    adb('pull', remote, path)
    with Image.open(path) as img:
        assert img.format == 'JPEG' and min(img.size) > 100, (artifact, img.format, img.size)
        img.verify()
    return path.read_bytes()


def pick_tracker_fixture():
    # Android 15 system Photo Picker and the cropper bundled with expo-image-picker.
    thumb = device(resourceIdMatches=r".*:id/(icon_thumbnail|photopicker_item_thumbnail|thumbnail)")
    if not thumb.wait(timeout=10):
        thumb = device(descriptionMatches=r"(?i).*photo taken.*")
    assert thumb.wait(timeout=10), "Photo Picker did not show the indexed test photo"
    thumb[0].click()
    crop = device(resourceIdMatches=r".*:id/crop_image_menu_crop")
    assert crop.wait(timeout=15), "The selected picture did not reach the cropper"
    crop.click()


def take_tracker_fixture():
    # Exercise the Android camera intent on an emulator with a virtual back camera.
    adb('shell', 'pm', 'grant', PACKAGE, 'android.permission.CAMERA')
    tap('Take photo')
    shutter = device(descriptionMatches=r'(?i)(shutter|take photo|take picture|capture photo)')
    shutter_id = device(resourceIdMatches=r'.*:id/(shutter_button|photo_capture|shutter)')
    until = time.monotonic() + 30
    while time.monotonic() < until:
        if shutter.exists or shutter_id.exists:
            (shutter if shutter.exists else shutter_id).click()
            break
        for label in ('No thanks', 'OK, GOT IT', 'While using the app', 'Continue', 'Next'):
            button = device(textMatches='(?i)' + re.escape(label))
            if button.exists:
                button.click()
                break
        time.sleep(.5)
    else:
        raise AssertionError('The system camera shutter never appeared')
    approve = device(descriptionMatches=r'(?i)(review done|done|ok|save|confirm|save photo)')
    if not approve.wait(timeout=9):
        approve = device(resourceIdMatches=r'.*:id/(done_button|review_done|btn_done|photo_done|intent_review_done)')
    assert approve.wait(timeout=6), 'Camera did not offer to use the captured photo'
    approve.click()
    crop = device(resourceIdMatches=r'.*:id/crop_image_menu_crop')
    assert crop.wait(timeout=15), 'Camera photo did not reach the cropper'
    crop.click()


def check_history_photo():
    # Seed two distinct finished sessions on a disposable phone. Select the older
    # one so always using the most recent session cannot pass.
    label = 'tracker-fixture'
    read_storage(label)
    date = '2026-11-24T09:00:00Z'
    record = dict(exerciseId='squat', exerciseName='Squat', setNumber=1,
                  predictedSetDuration=50, actualSetDuration=29, predictedBreakDuration=None,
                  actualBreakDuration=0, completedAt=date)
    selected = dict(id='fixture-tue', day='tuesday', date=date, totalDuration=32,
                    exercisesCompleted=1, setRecords=[record])
    sessions = [dict(selected, id='fixture-later', date='2026-11-24T16:00:00Z'), selected]
    with sqlite3.connect(OUT / label / 'RKStorage') as db:
        db.execute('INSERT OR REPLACE INTO catalystLocalStorage VALUES (?,?)',
                   ('session_history', json.dumps(sessions)))
        db.commit()
        db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    target = f'/data/data/{PACKAGE}/databases/RKStorage'
    adb('push', OUT / label / 'RKStorage', '/data/local/tmp/tracker-fixture.db')
    adb('shell', f'cat /data/local/tmp/tracker-fixture.db > {target} && rm -f {target}-wal {target}-shm')

    fixture = OUT / 'sample-tracker.jpg'
    Image.new('RGB', (600, 820), '#ddbb82').save(fixture)
    external = '/sdcard/Pictures/handwritten-test-page.jpg'
    adb('shell', 'mkdir', '-p', '/sdcard/Pictures')
    adb('push', fixture, external)
    adb('shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', 'file://' + external)
    launch()
    tap('History')
    row = device(resourceIdMatches=r'.*history-session-fixture-tue')
    assert row.wait(timeout=10)
    row.click()
    tap('Log tracker page', scroll=True)
    tap('Cancel')
    tap('Log tracker page')
    tap('Choose from library')
    pick_tracker_fixture()
    assert device(text='Tracker photo attached').wait(timeout=20), 'Capture did not finish offline'
    tap('OK')
    tap('View tracker photo', scroll=True)
    capture('history-logged-photo')
    tap('Close photo')
    data = read_storage('after-tracker-photo')
    assert json.loads(data['session_history']) == sessions, 'Attaching a page modified workout timings'
    entries = json.loads(data['tracker_entries'])
    assert len(entries) == 1
    page = entries[0]
    assert page['sessionId'] == selected['id'] and page['workoutDate'] == '2026-11-24'
    assert page['weekKey'] == '2026-W48' and page['photo']['needsReading'] and page['photo']['inAlbum']
    photo_id = page['photo']['id']
    private = pull_jpeg(f'/data/data/{PACKAGE}/files/tracker-pages/{photo_id}.jpg', 'app-tracker-page.jpg')
    name = f'2026-11-24_W48_Tuesday_{photo_id}.jpg'
    first_path = '/sdcard/Pictures/Workout Tracker 2026-11/' + name
    public = pull_jpeg(first_path, 'gallery-tracker-page.jpg')
    assert private == public, 'Gallery photo differs from the stored app photo'
    indexed = adb('shell', 'content', 'query', '--uri', 'content://media/external/images/media',
                  '--projection', '_display_name:relative_path:is_pending')
    assert any(name in line and 'Workout Tracker 2026-11/' in line and 'is_pending=0' in line for line in indexed.splitlines())
    launch()
    tap('History')
    assert row.wait(timeout=10)
    row.click()
    tap('View tracker photo', scroll=True)
    tap('Close photo')
    print('History gallery capture, cancellation, session identity, cold reopen and published monthly album JPEG passed.', flush=True)
    adb('shell', 'am', 'force-stop', PACKAGE)
    launch()
    tap('History')
    later = device(resourceIdMatches=r'.*history-session-fixture-later')
    assert later.wait(timeout=10)
    later.click()
    tap('Log tracker page', scroll=True)
    take_tracker_fixture()
    assert device(text='Tracker photo attached').wait(timeout=20), 'Camera capture did not finish offline'
    tap('OK')
    both = read_storage('after-camera-photo')
    pages = json.loads(both['tracker_entries'])
    assert sorted(e['sessionId'] for e in pages) == ['fixture-later', 'fixture-tue']
    camera = next(e['photo'] for e in pages if e['sessionId'] == 'fixture-later')
    assert camera['inAlbum'] and camera['id'] != photo_id
    camera_path = f"/sdcard/Pictures/Workout Tracker 2026-11/2026-11-24_W48_Tuesday_{camera['id']}.jpg"
    camera_bytes = pull_jpeg(camera_path, 'captured-camera-page.jpg')
    assert camera_bytes != public
    assert pull_jpeg(first_path, 'first-page-after-camera.jpg') == public
    assert json.loads(both['session_history']) == sessions
    print('Android camera capture produced a second dated gallery JPEG and retained the first photo and both workouts.', flush=True)



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
        assert_scene_above_buttons('RESUME WORKOUT')
        restored=read_storage('after-relaunch')
        checkpoint=json.loads(restored['active_workout'])['state']
        for field in ['sessionId', 'setRecords', 'currentSetNumber', 'pausedAt', 'phaseStartedAt']:
            assert prior[field] == checkpoint[field], f'Upgrade changed {field}'
        print('In-place upgrade and cold-start recovery preserved the earlier set and paused second set.', flush=True)
        launch()
        tap('RESUME WORKOUT')
        tap('DONE')
        assert_scene_above_buttons('START NEXT SET')
        capture('upgraded-rest-workout')
        rest=json.loads(read_storage('after-second-set')['active_workout'])['state']
        assert len(rest['setRecords']) == 2 and rest['setRecords'][0] == prior['setRecords'][0]
        print('Completing the next set after upgrade retained both set records.', flush=True)
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
    check_history_photo()
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
