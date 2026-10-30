package com.pocketpal

import android.app.Application
import android.system.Os
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.load
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader
import com.pocketpal.KeepAwakePackage
import com.pocketpal.HardwareInfoPackage
import com.pocketpal.AudioRecorderPackage
import com.pocketpal.download.DownloadPackage

class MainApplication : Application(), ReactApplication {

  override val reactNativeHost: ReactNativeHost =
      object : DefaultReactNativeHost(this) {
        override fun getPackages(): List<ReactPackage> =
            PackageList(this).packages.apply {
              // Packages that cannot be autolinked yet can be added manually here, for example:
              // add(MyReactNativePackage())
              add(KeepAwakePackage())
              add(HardwareInfoPackage())
              add(AudioRecorderPackage())
              add(ContentUriPackage())
              add(DownloadPackage())
              add(SdGenPackage())
            }

        override fun getJSMainModuleName(): String = "index"

        // Independent of BuildConfig.DEBUG: releaseE2e is `debuggable=true`
        // for `adb run-as` but must still load the baked bundle, not from
        // a locally-running Metro server.
        override fun getUseDeveloperSupport(): Boolean = BuildConfig.USE_DEV_SUPPORT

        /**
         * ⚠️ 2026-10-20：dev 模式必须返回 null，否则热重载永远不工作。
         *
         * ReactNativeHost 的**默认实现**返回 "index.android.bundle"：
         * ```java
         * protected @Nullable String getBundleAssetName() {
         *   return "index.android.bundle";
         * }
         * ```
         * 而 prodDebug APK 的 assets 里确实打进了这个 bundle
         * （assembleProdDebug 会执行 bundle 任务），于是 App 直接读
         * assets，**根本不连 Metro** —— 表现就是 Metro 一直打印
         *   "No apps connected. Sending \"reload\" ... failed"
         * 但 App 界面其实好好的（用的是 assets 里的旧 bundle）。
         *
         * RN 注释原文：If this is null, and no file path is specified
         * for the bundle, the app will only work with
         * getUseDeveloperSupport enabled and will **always try to load
         * the JS bundle from Metro**.
         *
         * 所以：
         *   USE_DEV_SUPPORT = true  → null → 强制连 Metro → 可热重载
         *   USE_DEV_SUPPORT = false → "index.android.bundle" → 读 assets
         */
        override fun getBundleAssetName(): String? =
          if (BuildConfig.USE_DEV_SUPPORT) null else "index.android.bundle"

        override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
        override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
      }

  override val reactHost: ReactHost
    get() = getDefaultReactHost(applicationContext, reactNativeHost)

  override fun onCreate() {
    super.onCreate()
    // Enable Adreno large buffer support on Qualcomm A7X/A8X GPUs.
    // The OpenCL backend in llama.rn self-gates on GPU family and the
    // cl_qcom_large_buffer extension — this is a no-op on non-Adreno devices.
    // Must be set before SoLoader.init so the native library picks it up.
    // See: https://github.com/ggml-org/llama.cpp/pull/20997
    Os.setenv("GGML_OPENCL_ADRENO_USE_LARGE_BUFFER", "1", true)
    SoLoader.init(this, OpenSourceMergedSoMapping)
    if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
      // If you opted-in for the New Architecture, we load the native entry point for this app.
      load()
    }
  }
}
