package com.pocketpal

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.facebook.react.uimanager.DisplayMetricsHolder
import androidx.core.view.WindowCompat   // for edge-to-edge pre API 35
import android.os.Build
import android.view.WindowManager
import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "PocketPal"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onCreate(savedInstanceState: Bundle?) {
      // Prevent react-native-screens from restoring fragments after process death
      // This fixes the "Screen fragments should never be restored" crash
      // See: https://github.com/software-mansion/react-native-screens/issues/17
      // and https://github.com/software-mansion/react-native-screens?tab=readme-ov-file#android
      super.onCreate(null)

      fixExternalDisplayDensity()

      WindowCompat.enableEdgeToEdge(window)  // enable E2E pre-Android 15
      // 底部系统导航栏完全透明：让内容（壁纸/卡片）透到底部手势条下面、
      // 像液态玻璃一样显示，而不是被系统那层对比度蒙版压暗/遮住。
      // 需要 API 29+（Q）。三键导航时按钮对比度会略降，手势导航无影响。
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        window.isNavigationBarContrastEnforced = false
      }
      // 挖孔/刘海屏（华为居中药丸常见）：内容延伸进挖孔区，横屏时两侧
      // 挖孔区域也可用；状态栏内容由 SafeArea insets 自行避让。
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        window.attributes = window.attributes.apply {
          layoutInDisplayCutoutMode =
            WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
      }
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
      super.onConfigurationChanged(newConfig)
      fixExternalDisplayDensity()
  }

  /**
   * Forward warm-launch deep-link intents to React Native. Under
   * launchMode="singleTask" the OS reuses this activity instance, so without
   * setIntent(intent) RN's Linking 'url' event never fires for the hub/run
   * deep link.
   */
  override fun onNewIntent(intent: Intent) {
      super.onNewIntent(intent)
      setIntent(intent)
  }

  /**
   * Fix display density for external displays (Samsung DeX, Pixel Desktop Mode).
   *
   * RN's DisplayMetricsHolder.initDisplayMetrics() sets screenDisplayMetrics via
   * wm.defaultDisplay.getRealMetrics(), which always reads from the phone display
   * (e.g. 420dpi). PixelUtil uses screenDisplayMetrics for all dp-to-px conversions,
   * causing everything to render ~4x too large on a lower-density external monitor.
   *
   * windowDisplayMetrics (from Application context) has the correct density, so we
   * copy it over. This runs in onCreate and onConfigurationChanged because RN
   * re-initializes metrics on orientation/resize changes.
   */
  private fun fixExternalDisplayDensity() {
      try {
          val screenMetrics = DisplayMetricsHolder.getScreenDisplayMetrics()
          val windowMetrics = DisplayMetricsHolder.getWindowDisplayMetrics()
          if (screenMetrics.densityDpi != windowMetrics.densityDpi) {
              screenMetrics.densityDpi = windowMetrics.densityDpi
              screenMetrics.density = windowMetrics.density
              screenMetrics.scaledDensity = windowMetrics.scaledDensity
          }
      } catch (_: Exception) {
          // DisplayMetricsHolder not yet initialized — normal on phone display
      }
  }
}
