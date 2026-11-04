#!/usr/bin/env bash
# Opens the Android test version on an emulator and takes pictures of what it
# shows: the activation screen, and (when the activation secret is there)
# the app itself after it's activated with a key made for the emulator.
#   scripts/android_emulator_check.sh path/to.apk out-folder
set -uo pipefail

apk=$1
out=$2
app=com.krowsingre.theboundvigil
mkdir -p "$out"

shot() { adb exec-out screencap -p > "$out/$1.png"; echo "Took $1.png"; }
screen_xml() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml "$out/$1.xml" >/dev/null 2>&1; }
# The middle of the first element whose text or class matches $2, from $1.
centre() {
  python3 - "$1" "$2" <<'PY'
import re, sys
xml = open(sys.argv[1], encoding="utf-8", errors="replace").read()
for node in re.findall(r"<node [^>]*>", xml):
    if re.search(sys.argv[2], node):
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', node)
        if b:
            x1, y1, x2, y2 = map(int, b.groups())
            print((x1 + x2) // 2, (y1 + y2) // 2)
            break
PY
}

adb install -r "$apk" || { echo "::error::The APK didn't install."; exit 1; }
adb logcat -c
adb shell monkey -p "$app" -c android.intent.category.LAUNCHER 1 >/dev/null
sleep 40
screen_xml 1-opened
# A slow emulator sometimes shows "Pixel Launcher isn't responding" (Android's
# own home screen, not TBV) over the app; choose Wait so the screen can be read.
for _ in 1 2 3; do
  grep -q "isn't responding" "$out/1-opened.xml" || break
  read -r wx wy <<< "$(centre "$out/1-opened.xml" '(text|content-desc)="Wait"')"
  if [ -n "${wx:-}" ]; then adb shell input tap "$wx" "$wy"; else adb shell input keyevent 4; fi
  sleep 5
  screen_xml 1-opened
done
shot 1-opened
code=$(grep -oE '[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}' "$out/1-opened.xml" | head -1 || true)
echo "Device code on screen: ${code:-none}"

if [ -n "$code" ] && [ -n "${ACTIVATION_KEY_PEM:-}" ]; then
  key=$(node scripts/android_activation_key.mjs "$code")
  read -r x y <<< "$(centre "$out/1-opened.xml" 'class="android.widget.EditText"')"
  if [ -n "${x:-}" ]; then
    adb shell input tap "$x" "$y"
    sleep 1
    adb shell input text "$key"
    sleep 1
    adb shell input keyevent 111 # Escape closes the keyboard
    sleep 1
    screen_xml 2-key
    read -r ax ay <<< "$(centre "$out/2-key.xml" '(text|content-desc)="Activate"')"
    if [ -n "${ax:-}" ]; then
      adb shell input tap "$ax" "$ay"
      sleep 15
      shot 3-activated
      screen_xml 3-activated
    else
      echo "::warning::The Activate button wasn't found."
    fi
  else
    echo "::warning::The key box wasn't found."
  fi
fi

adb logcat -d > "$out/logcat.txt"
echo "--- What TBV and Android said ---"
grep -E "RustStdoutStderr|AndroidRuntime|Tauri|tbv|chromium.*Console" "$out/logcat.txt" | tail -n 150
if grep -q "FATAL EXCEPTION" "$out/logcat.txt"; then
  echo "::error::The app crashed."
  exit 1
fi
[ -n "$code" ] || { echo "::error::The activation screen didn't show a device code."; exit 1; }
exit 0
