package com.pocketpal

import com.facebook.react.TurboReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.pocketpal.specs.NativeContentUriSpec

/** 注册 ContentUriModule（content:// → 文件描述符桥接）。 */
class ContentUriPackage : TurboReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
    return if (name == NativeContentUriSpec.NAME) {
      ContentUriModule(reactContext)
    } else {
      null
    }
  }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
    return ReactModuleInfoProvider {
      mapOf(
        NativeContentUriSpec.NAME to ReactModuleInfo(
          NativeContentUriSpec.NAME,
          NativeContentUriSpec.NAME,
          false, // canOverrideExistingModule
          false, // needsEagerInit
          false, // hasConstants
          false, // isCxxModule
          true,  // isTurboModule
        ),
      )
    }
  }
}