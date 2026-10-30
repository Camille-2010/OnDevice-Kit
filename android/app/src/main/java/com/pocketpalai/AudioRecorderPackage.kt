package com.pocketpal

import com.facebook.react.TurboReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.pocketpal.specs.NativeAudioRecorderSpec

class AudioRecorderPackage : TurboReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
    return if (name == NativeAudioRecorderSpec.NAME) {
      AudioRecorderModule(reactContext)
    } else {
      null
    }
  }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
    return ReactModuleInfoProvider {
      mapOf(
        NativeAudioRecorderSpec.NAME to ReactModuleInfo(
          NativeAudioRecorderSpec.NAME,
          NativeAudioRecorderSpec.NAME,
          false, // canOverrideExistingModule
          false, // needsEagerInit
          true,  // hasConstants
          false, // isCxxModule
          true,  // isTurboModule
        ),
      )
    }
  }
}
