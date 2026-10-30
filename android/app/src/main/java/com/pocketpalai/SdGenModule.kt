package com.pocketpal

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/**
 * 端侧（手机本地）图像生成原生模块 —— 调用内置的 stable-diffusion.cpp 可执行文件。
 *
 * 二进制（libsdcli.so，OpenCL 构建）随 APK 打在 jniLibs/arm64-v8a 里，安装器解压到
 * nativeLibraryDir —— 这是 targetSdk 30+ 上唯一保证可 exec 的位置（App 可写目录
 * filesDir 会被 W^X 策略拦掉）。后端由 auto-fit 自动选：有 OpenCL GPU（Mali/Adreno）
 * 就走 GPU，没有自动回退 CPU。实测某骁龙8+机型（Mali-G710）：256×256/4 步 ≈ 73s；
 * 纯 CPU 256×256/4 步 ≈ 110s。512×512 会按像素数线性变慢。
 *
 * 进度：运行期把 sd-cli 的采样进度解析成事件 `SdGenProgress` 推给 JS（DeviceEventEmitter）。
 *   形如 { stage, step, total, sPerIt, etaSec, message }
 *   stage ∈ loading | encoding | sampling | decoding | done | cancelled
 * 取消：cancel() 会 kill 掉当前子进程，generate 的 Promise 以 code=CANCELLED reject。
 *
 * 模型：由 JS 传入（App 私有目录 sd-models/ 下的 GGUF，经下载或文件导入落到那里）。
 * 输出写到 <app filesDir>/sd_out.png，返回 data URI。
 */
class SdGenModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "SdGen"

  @Volatile private var currentProc: Process? = null
  private val cancelRequested = AtomicBoolean(false)
  // 防重入闸门：必须在 JS 线程同步判定，不能依赖 currentProc（它是子线程
  // 起进程后才赋值的，快速连点会在赋值前双双通过检查，起两个 sd-cli）。
  private val running = AtomicBoolean(false)

  /**
   * 定位 sd-cli 可执行文件。
   * 首选：APK jniLibs 解压出来的 libsdcli.so（nativeLibraryDir 有执行位）；
   * 兜底：老的手动放进 filesDir 的 sd-cli（Android 10+ 通常 exec 不了，仅为兼容保留）。
   * 都没有 → null。
   */
  private fun binFile(): File? =
      File(reactApplicationContext.applicationInfo.nativeLibraryDir, "libsdcli.so")
          .takeIf { it.exists() }
          ?: File(reactApplicationContext.filesDir, "sd-cli").takeIf { it.exists() }

  /** 是否就绪：sd-cli 可执行文件存在，且模型文件存在。 */
  @ReactMethod
  fun isReady(modelPath: String, promise: Promise) {
    try {
      val ok = binFile() != null && File(modelPath).exists()
      promise.resolve(ok)
    } catch (e: Exception) {
      promise.resolve(false)
    }
  }

  /** 取消当前正在跑的生成（若无则忽略）。 */
  @ReactMethod
  fun cancel() {
    cancelRequested.set(true)
    val p = currentProc ?: return
    try {
      p.destroy()
      // 兜底：1.5s 后仍未退出则强杀，避免用户卡在「取消」上
      Thread {
        try {
          Thread.sleep(1500)
          if (p.isAlive) {
            p.destroyForcibly()
          }
        } catch (_: Exception) {
        }
      }.start()
    } catch (_: Exception) {
    }
  }

  private fun emitProgress(map: com.facebook.react.bridge.WritableMap) {
    try {
      reactApplicationContext.emitDeviceEvent("SdGenProgress", map)
    } catch (_: Exception) {
    }
  }

  private fun emit(
      stage: String,
      message: String,
      step: Int = -1,
      total: Int = -1,
      sPerIt: Double = 0.0,
      etaSec: Int = -1,
  ) {
    val m = Arguments.createMap()
    m.putString("stage", stage)
    m.putString("message", message)
    if (step >= 0) m.putInt("step", step)
    if (total >= 0) m.putInt("total", total)
    if (sPerIt > 0.0) m.putDouble("sPerIt", sPerIt)
    if (etaSec >= 0) m.putInt("etaSec", etaSec)
    emitProgress(m)
  }

  /**
   * 生成一张图（阻塞，跑在后台线程）。
   * @param modelPath 模型绝对路径（App 私有目录下的 GGUF）
   * @param prompt    正向提示词
   * @param steps     采样步数（越少越快）
   * @param threads   线程数（建议 6~8；GPU 路径影响不大）
   * @param backend   后端：gpu（默认，auto-fit 自动挑 OpenCL GPU，无则回退 CPU）/ cpu（强制纯 CPU）
   * 成功 resolve 输出图片 data URI；取消 reject(CANCELLED)；失败 reject（带日志尾部）。
   */
  @ReactMethod
  fun generate(
      modelPath: String,
      prompt: String,
      steps: Int,
      threads: Int,
      width: Int,
      height: Int,
      backend: String,
      promise: Promise,
  ) {
    if (!running.compareAndSet(false, true)) {
      promise.reject("BUSY", "已有一次生成在跑")
      return
    }
    cancelRequested.set(false)
    Thread {
      try {
        val ctx = reactApplicationContext
        val bin = binFile()
        if (bin == null) {
          promise.reject(
              "NO_BIN",
              "sd-cli 未就位（APK 应内置 libsdcli.so，且 filesDir/sd-cli 也不存在）",
          )
          return@Thread
        }
        if (!File(modelPath).exists()) {
          promise.reject("NO_MODEL", "模型不存在：$modelPath")
          return@Thread
        }
        val out = File(ctx.filesDir, "sd_out.png")
        if (out.exists()) out.delete()

        emit("loading", "加载模型…")
        // sd-cli（OpenCL 构建）后端选择：
        //   默认（gpu）→ 不传 --backend，让 auto-fit 自动挑（有 OpenCL GPU 走 GPU，
        //     没有自动回退 CPU）。⚠️ 不要传 -vulkan：这是 OpenCL 构建的二进制，
        //     -vulkan 是未知参数，直接报错。
        //   cpu → 显式全 CPU，作为 GPU 兼容性问题时的逃生门。
        val cmd = mutableListOf(
            bin.absolutePath,
            "-m", modelPath,
            "-p", prompt,
            "-o", out.absolutePath,
            "-W", width.toString(),
            "-H", height.toString(),
            "--steps", steps.toString(),
            "-t", threads.toString(),
        )
        if (backend.equals("cpu", ignoreCase = true)) {
          cmd.add("--backend")
          cmd.add("diffusion=CPU,te=CPU,vae=CPU")
        }
        val pb = ProcessBuilder(cmd)
        pb.redirectErrorStream(true)
        pb.directory(ctx.filesDir)
        // 子进程的动态库解析：libomp.so 随 jniLibs 在 nativeLibraryDir，
        // libOpenCL.so 在设备 /vendor/lib64。filesDir 兜底给老式手动装法。
        pb.environment()["LD_LIBRARY_PATH"] =
            listOf(
                reactApplicationContext.applicationInfo.nativeLibraryDir,
                ctx.filesDir.absolutePath,
                "/vendor/lib64",
                "/system/lib64",
            ).joinToString(":")
        val proc = pb.start()
        currentProc = proc

        val sb = StringBuilder()
        val sampleRe = Regex("""\|\s*(\d+)/(\d+)\s*-\s*([\d.]+)s/it""")
        val etaRe = Regex("""ETA\s+(\d+):(\d+)""")
        var lastEmitAt = 0L
        var stage = "loading"

        proc.inputStream.bufferedReader().forEachLine { line ->
          if (sb.length < 8000) sb.append(line).append('\n')
          // 阶段切换
          val newStage = when {
            line.contains("loading model") -> "loading"
            line.contains("get_learned_condition") -> "encoding"
            line.contains("generating image") -> "sampling"
            line.contains("decoding") -> "decoding"
            else -> null
          }
          if (newStage != null && newStage != stage) {
            stage = newStage
            val msg = when (stage) {
              "encoding" -> "编码提示词…"
              "sampling" -> "采样中…"
              "decoding" -> "解码图像…"
              else -> "加载模型…"
            }
            emit(stage, msg)
          }
          // 采样进度
          val mm = sampleRe.find(line)
          if (mm != null) {
            val step = mm.groupValues[1].toIntOrNull() ?: -1
            val total = mm.groupValues[2].toIntOrNull() ?: -1
            val sPerIt = mm.groupValues[3].toDoubleOrNull() ?: 0.0
            var etaSec = -1
            val em = etaRe.find(line)
            if (em != null) {
              val mn = em.groupValues[1].toIntOrNull() ?: 0
              val ss = em.groupValues[2].toIntOrNull() ?: 0
              etaSec = mn * 60 + ss
            }
            val now = System.currentTimeMillis()
            if (now - lastEmitAt > 180 || (total > 0 && step >= total)) {
              lastEmitAt = now
              val msg = if (total > 0) "采样 $step/$total" else "采样中…"
              emit("sampling", msg, step, total, sPerIt, etaSec)
            }
          }
        }

        val code = proc.waitFor()

        // 成功优先于取消：用户在出图完成的同一瞬间点了取消，好图不该丢。
        if (code == 0 && out.exists() && out.length() > 0) {
          val b64 = android.util.Base64.encodeToString(out.readBytes(), android.util.Base64.NO_WRAP)
          emit("done", "完成", steps, steps)
          promise.resolve("data:image/png;base64,$b64")
        } else if (cancelRequested.get()) {
          emit("cancelled", "已取消")
          promise.reject("CANCELLED", "已取消")
        } else {
          val tail = sb.toString().takeLast(1800)
          emit("done", "失败")
          promise.reject("SD_FAIL", "sd-cli 退出码 $code\n$tail")
        }
      } catch (e: Exception) {
        if (cancelRequested.get()) {
          promise.reject("CANCELLED", "已取消")
        } else {
          promise.reject("SD_ERR", e.message ?: "未知错误", e)
        }
      } finally {
        currentProc = null
        running.set(false)
      }
    }.start()
  }

  // RN 原生事件模块在 NativeEventEmitter 下需要这两个空实现；用 DeviceEventEmitter 时也保留以兼容。
  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Int) {}
}
