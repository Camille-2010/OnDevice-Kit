# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified in
# /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by can be changed with the
# proguardFiles directive in build.gradle.
#
# For more details, see:
#   http://developer.android.com/guide/developing/tools/proguard.html

# ─────────────────────────────────────────────────────────────
# 安全加固（防反编译）：R8 对 release 做「混淆 + 裁剪 + 优化」。
# keep 规则只保留「运行时靠反射 / JNI 按名字找类」的部分，其余
# 类名/方法名全部混淆。新增原生模块或反射用法时在这里补。
# ─────────────────────────────────────────────────────────────

# React Native 运行时按名字反射访问的部分
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.soloader.** { *; }
-keep class com.facebook.systrace.** { *; }
-dontwarn com.facebook.**

# 自研 TurboModule / 原生模块：Package 列表与 @ReactMethod 靠名字桥接
-keep class com.pocketpalai.** { *; }

# llama.rn（JSI + JNI 按符号注册，名字不能动）
-keep class ai.rnllama.** { *; }
-keep class com.rnllama.** { *; }

# WatermelonDB（JSI）
-keep class com.nozbe.watermelondb.** { *; }

# Firebase（官方 AAR 带 consumer rules，这里兜底防裁剪服务声明）
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**

# 常见 RN 库的 JNI / 反射点
-keep class com.swmansion.reanimated.** { *; }
-keep class com.swmansion.gesturehandler.** { *; }
-keep class com.oblador.performance.** { *; }
-keep class com.reactnativecommunity.** { *; }
-keep class net.openid.appauth.** { *; }
-keep class com.rnfs.** { *; }
-dontwarn com.rnfs.**
-keep class com.blurview.** { *; }
-dontwarn com.blurview.**
-keep class org.conscrypt.** { *; }
-dontwarn org.conscrypt.**
-keep class org.bouncycastle.** { *; }
-dontwarn org.bouncycastle.**

# Google Play Billing（AIDL 反射）
-keep class com.android.vending.billing.** { *; }

# keep 注解与源码名（崩溃栈可读；混淆映射在 release 构建产物 mapping.txt）
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
# 保留注解：原生 ViewManager 的 @ReactProp 等靠反射读注解，剥掉会导致
# 玻璃/原生组件的属性不生效（release 上玻璃“变平/消失”）
-keepattributes *Annotation*
-keepattributes RuntimeVisibleAnnotations,RuntimeVisibleParameterAnnotations,AnnotationDefault

# 液态玻璃（@sbaiahmed1/react-native-blur）：R8 会剥掉 ViewManager 的
# 反射 setter 与着色器资源引用，release 上玻璃静默失效（debug 正常，实测实锤）
-keep class com.sbaiahmed1.reactnativeblur.** { *; }
-dontwarn com.sbaiahmed1.reactnativeblur.**

# 自定义原生模块/包（SdGen 端上出图等）在 com.pocketpal 包下，RN 按类名反射
# 注册 —— 必须整包 keep，否则 release 上模块变 undefined。
-keep class com.pocketpal.** { *; }
-dontwarn com.pocketpal.**
