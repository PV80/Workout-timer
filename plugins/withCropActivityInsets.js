const { withAndroidStyles, withAndroidManifest } = require('@expo/config-plugins');

/**
 * Fix the image-picker crop tool's handles being unreachable under the status
 * and navigation bars.
 *
 * The crop UI is a third-party activity (com.canhub.cropper.CropImageActivity,
 * vanniktech android-image-cropper 4.6.0) that expo-image-picker declares with
 * `@style/Base.Theme.AppCompat`. On Android 15 (targetSdk 35) the system FORCES
 * edge-to-edge on every window, and that old cropper doesn't inset its overlay
 * — so the drag handles land under the system bars.
 *
 * The app's own AppTheme already dodges this via
 * `android:windowOptOutEdgeToEdgeEnforcement=true` (because
 * expo.edgeToEdgeEnabled=false). This plugin gives the crop activity the same
 * opt-out through a dedicated theme, so the crop frame sits between the header
 * and the nav bar with reachable handles. No native code, no SDK bump.
 */

const THEME_NAME = 'Theme.ImagePickerCrop';
const CROP_ACTIVITY = 'com.canhub.cropper.CropImageActivity';
const TOOLS_NS = 'http://schemas.android.com/tools';

function addCropTheme(config) {
  return withAndroidStyles(config, (cfg) => {
    const resources = cfg.modResults.resources;
    resources.$ = resources.$ || {};
    if (!resources.$['xmlns:tools']) resources.$['xmlns:tools'] = TOOLS_NS;
    resources.style = resources.style || [];

    const style = {
      // Match the cropper's original parent so its toolbar/menu look unchanged.
      $: { name: THEME_NAME, parent: 'Base.Theme.AppCompat' },
      item: [
        // The actual fix: opt this window out of forced edge-to-edge so its
        // content is laid out below the system bars (handles reachable).
        { $: { name: 'android:windowOptOutEdgeToEdgeEnforcement', 'tools:targetApi': '35' }, _: 'true' },
        // Opaque bars behind which nothing is drawn — the cropper is dark.
        { $: { name: 'android:statusBarColor' }, _: '@android:color/black' },
        { $: { name: 'android:navigationBarColor' }, _: '@android:color/black' },
      ],
    };

    const idx = resources.style.findIndex((s) => s.$ && s.$.name === THEME_NAME);
    if (idx >= 0) resources.style[idx] = style;
    else resources.style.push(style);
    return cfg;
  });
}

function overrideCropActivityTheme(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$ = manifest.$ || {};
    if (!manifest.$['xmlns:tools']) manifest.$['xmlns:tools'] = TOOLS_NS;

    const application = manifest.application && manifest.application[0];
    if (!application) return cfg;
    application.activity = application.activity || [];

    let crop = application.activity.find(
      (a) => a.$ && a.$['android:name'] === CROP_ACTIVITY,
    );
    if (!crop) {
      crop = { $: { 'android:name': CROP_ACTIVITY } };
      application.activity.push(crop);
    }
    // Replace the theme the library set with our opt-out theme (manifest merger
    // requires tools:replace to override a library-declared attribute).
    crop.$['android:theme'] = `@style/${THEME_NAME}`;
    crop.$['tools:replace'] = 'android:theme';
    return cfg;
  });
}

module.exports = function withCropActivityInsets(config) {
  return overrideCropActivityTheme(addCropTheme(config));
};
