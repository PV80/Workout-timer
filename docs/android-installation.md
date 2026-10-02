# Android installation and artwork regression

Version 1.1.1 (Android version code 3) fixes hero artwork sizing. React Native
prepends the bundled JPEG's intrinsic dimensions to an Image's styles. Absolute
positioning alone left a 960×640 image clipped inside the card, often exposing
only the dark corner. Explicit 100% width and height make cover scaling use the
card's actual bounds. SVG shading now uses explicit percentage coordinates.
The workout screen reserves space for the animation and allows its middle
section to scroll when needed, keeping the action buttons clear on small phones.

## Choose an APK with the same signing certificate as the installed app

- **workout-timer-update-existing-debug**: a release-mode APK using the Expo
  template's existing debug certificate. Intended to update existing debug APKs
  in place, preserving local workout data. It has bundled production JavaScript,
  embedded artwork, and no developer-server requirement. The debug certificate
  is public and is not suitable for a Play Store production signing identity.
- **workout-timer-release**: the production certificate stored in repository
  secrets. Use for a clean installation or an existing installation signed with
  that certificate.

The package remains `com.briangitau.workouttimer` for both paths. Android does
not permit one certificate to replace the other. Do not uninstall the app to
work around that restriction without first exporting and verifying a full data
backup. Use the compatible update when the current app was installed from a
debug artifact. Future compatible updates must keep this certificate.

## Verification

`scripts/verify-apk.py` checks the actual APK's signature, package/version,
non-debuggable mode, JavaScript bundle, and byte-for-byte presence of all six
hero JPEGs. The compatible build must match the existing debug keystore.

The `native-smoke` CI job uses a disposable Android 35 emulator. When a prior
compatible main-branch artifact is available, it installs that APK, completes a
set, pauses the second set, and upgrades in place. It compares saved storage
before/after installation and verifies the checkpoint after a cold launch.
It checks fresh-screen artwork pixels against the expected cover crop while
Wi-Fi and mobile data are disabled. On main, it also tests a clean installation
of the production-signed release. Screenshots and logs are uploaded as
`android-native-evidence`. These tests never connect to a user's device.

A missing previous artifact is explicitly reported as a skipped upgrade check.
Successful compilation alone does not establish installation or visual success;
check the native-smoke result before distributing the APK.
