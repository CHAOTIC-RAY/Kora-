"""
Static audit of the built Android APK.

What this proves without a device: manifest correctness, permissions (and which
are actually used), the Capacitor activity setup, native libs, and whether the
web bundle inside the APK matches current source.

What it cannot prove is runtime behaviour. The UI/gesture checks run in a real
browser at phone viewport instead (see scripts/verify-*.mts).

Usage:  python scripts/apk-audit.py [path-to.apk]
"""
import logging
import re
import sys
import zipfile

# androguard is extremely chatty at DEBUG; silence it before importing.
logging.disable(logging.CRITICAL)
for _name in (
    "androguard",
    "androguard.core.apk",
    "androguard.core.axml",
    "androguard.core.arsc",
    "androguard.core.dex",
    "asn1crypto",
):
    logging.getLogger(_name).setLevel(logging.CRITICAL)
try:
    from loguru import logger as _loguru
    _loguru.disable("androguard")
except Exception:
    pass

from androguard.core.apk import APK

APK_PATH = sys.argv[1] if len(sys.argv) > 1 else r"D:\Wafig\Hermes\cache\scratch\new.apk"

a = APK(APK_PATH)
z = zipfile.ZipFile(APK_PATH)
files = a.get_files()

# ---------------------------------------------------------------- identity
print("=== identity ===")
print("  package :", a.get_package())
print("  version :", a.get_androidversion_name(), "(code %s)" % a.get_androidversion_code())
print("  minSdk  :", a.get_min_sdk_version(), " targetSdk:", a.get_target_sdk_version())
print("  label   :", a.get_app_name())

# ------------------------------------------------------------- permissions
print("\n=== permissions ===")
perms = sorted(a.get_permissions() or [])
print(f"  declared: {len(perms)}")

# Cross-check each against the code actually shipped in the dex, so a
# declared-but-unused permission is visible rather than assumed.
dex = "".join(
    z.read(n).decode("utf-8", "replace")
    for n in files
    if n.startswith("classes") and n.endswith(".dex")
)
USED = {
    "RECORD_AUDIO": ["MediaRecorder", "AudioRecord"],
    "ACCESS_FINE_LOCATION": ["ACCESS_FINE_LOCATION", "LocationManager"],
    "ACCESS_COARSE_LOCATION": ["ACCESS_COARSE_LOCATION"],
    "REQUEST_INSTALL_PACKAGES": ["REQUEST_INSTALL_PACKAGES"],
    "BLUETOOTH_CONNECT": ["BLUETOOTH_CONNECT"],
    "BLUETOOTH_SCAN": ["BLUETOOTH_SCAN"],
    "NEARBY_WIFI_DEVICES": ["NEARBY_WIFI_DEVICES"],
    "READ_MEDIA_AUDIO": ["READ_MEDIA_AUDIO"],
    "READ_MEDIA_IMAGES": ["READ_MEDIA_IMAGES"],
    "READ_MEDIA_VIDEO": ["READ_MEDIA_VIDEO"],
    "SCHEDULE_EXACT_ALARM": ["SCHEDULE_EXACT_ALARM"],
    "USE_EXACT_ALARM": ["USE_EXACT_ALARM"],
    "RECEIVE_BOOT_COMPLETED": ["RECEIVE_BOOT_COMPLETED"],
    "MODIFY_AUDIO_SETTINGS": ["MODIFY_AUDIO_SETTINGS"],
    "FOREGROUND_SERVICE_MEDIA_PLAYBACK": ["FOREGROUND_SERVICE_MEDIA_PLAYBACK"],
    "FOREGROUND_SERVICE_DATA_SYNC": ["FOREGROUND_SERVICE_DATA_SYNC"],
    "ACCESS_ADSERVICES_ATTRIBUTION": ["ACCESS_ADSERVICES_ATTRIBUTION"],
    "AD_ID": ["com.google.android.gms.ads.identifier"],
    "READ_GSERVICES": ["com.google.android.gms"],
}
unused = []
for p in perms:
    short = p.split(".")[-1]
    hints = USED.get(short)
    if hints is None:
        continue
    hit = any(h in dex for h in hints)
    print(f"   {'USED  ' if hit else 'UNUSED'}  {short}")
    if not hit:
        unused.append(short)
print(f"\n  -> unused / no dex reference: {unused or 'none'}")

# -------------------------------------------------------------- activities
print("\n=== activities ===")
for act in a.get_activities():
    print("   ", act)

print("\n=== launcher intent ===")
main = a.get_main_activity()
print("   main:", main)
for f in a.get_intent_filters("activity", main) or []:
    print("   filter:", f)

# ------------------------------------------------------------ native / abi
print("\n=== native code ===")
sos = sorted({n for n in files if n.endswith(".so")})
print(f"   .so: {len(sos)}")
for s in sos:
    print("     ", s)
abis = sorted({n.split("/")[1] for n in files if n.startswith("lib/")})
print("   ABIs:", abis)

# ----------------------------------------------------------- bundled web
print("\n=== bundled web assets ===")
idx = sorted(n for n in files if n.endswith("index.html") and "public" in n)
css = sorted(n for n in files if n.endswith(".css") and "public" in n)
js = sorted(n for n in files if n.endswith(".js") and "public" in n and ".br" not in n)
print("   index.html:", idx)
print("   css:", css)
if idx:
    html = z.read(idx[0]).decode("utf-8", "replace")
    refs = re.findall(r"assets/[\w.-]+\.(?:js|css)", html)
    print("   references:", refs[:6])

# Does the shipped bundle contain the current fixes?
print("\n=== fix markers in the shipped bundle ===")
blob = "".join(z.read(n).decode("utf-8", "replace") for n in css)
sentry_blob = "".join(z.read(n).decode("utf-8", "replace") for n in js if "index" in n)
for label, probe, hay in [
    ("sentry #sentry-feedback CSS", "#sentry-feedback", blob),
    ("sentry --z-index: 500", "--z-index: 500", blob),
    ("toast swipe wrapper", "createToastSwipeHandlers", sentry_blob),
    ("relevance gate", "isRelevantMirrorResult", sentry_blob),
]:
    print(f"   {'yes' if probe in hay else 'NO '}  {label}")