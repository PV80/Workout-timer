#!/usr/bin/env bash
set -euo pipefail
args=(--update apk/update/app-release.apk)
if [[ -d apk/baseline ]]; then
  mapfile -t baseline_apks < <(find apk/baseline -name '*.apk')
  [[ ${#baseline_apks[@]} -eq 1 ]]
  args+=(--baseline "${baseline_apks[0]}")
fi
if [[ -f apk/release/app-release.apk ]]; then
  args+=(--release apk/release/app-release.apk)
fi
python3 scripts/android-smoke.py "${args[@]}"
