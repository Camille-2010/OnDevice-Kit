package com.pocketpal

import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import android.provider.Settings
import android.system.Os
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule
import com.pocketpal.specs.NativeContentUriSpec
import java.io.File
import java.io.FileNotFoundException

/**
 * content:// → 文件描述符桥接。
 *
 * 让「直接引用外部模型文件」成为可能：用户在文件管理器选中的 .gguf 拿到的是
 * `content://` 虚拟 URI，llama.cpp 不认；但它由某个 provider 支撑，内核层面
 * 本来就是一个可读、可 mmap 的文件描述符。这里用 ContentResolver 打开只读
 * fd，把 `/proc/self/fd/<fd>` 交给 llama.cpp —— 全程零拷贝，不占 App 存储。
 *
 * fd 的生命周期由这里的 PFD 缓存表兜住：只有持久的 ParcelFileDescriptor
 * 存在，fd 才不会被关闭，`/proc/self/fd/N` 才有效。
 */
@ReactModule(name = NativeContentUriSpec.NAME)
class ContentUriModule(reactContext: ReactApplicationContext) :
    NativeContentUriSpec(reactContext) {

  /** uri -> 已打开的只读 PFD。必须持有，否则 fd 关闭后路径失效。 */
  private val handles = HashMap<String, ParcelFileDescriptor>()

  private fun resolver() = reactApplicationContext.contentResolver

  override fun getName(): String = NativeContentUriSpec.NAME

  override fun openFd(uri: String, promise: Promise) {
    synchronized(handles) {
      handles[uri]?.let {
        promise.resolve(it.fd)
        return
      }
    }
    try {
      val pfd =
          resolver()
              .openFileDescriptor(Uri.parse(uri), "r")
              ?: throw FileNotFoundException("openFileDescriptor returned null: $uri")
      // 失败时不要留下半开的句柄
      val dup =
          try {
            pfd
          } catch (e: Throwable) {
            try {
              pfd.close()
            } catch (_: Throwable) {
            }
            throw e
          }
      synchronized(handles) { handles[uri] = dup }
      promise.resolve(dup.fd)
    } catch (e: Throwable) {
      promise.reject("E_OPEN_URI", "无法打开 $uri: ${e.message}", e)
    }
  }

  override fun queryName(uri: String, promise: Promise) {
    try {
      val cursor =
          resolver().query(Uri.parse(uri), arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
      cursor?.use {
        if (it.moveToFirst()) {
          val idx = it.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          if (idx >= 0) {
            val name = it.getString(idx)
            promise.resolve(name ?: "")
            return
          }
        }
      }
      promise.resolve("")
    } catch (e: Throwable) {
      promise.reject("E_QUERY_NAME", e.message, e)
    }
  }

  override fun querySize(uri: String, promise: Promise) {
    try {
      val cursor =
          resolver().query(Uri.parse(uri), arrayOf(OpenableColumns.SIZE), null, null, null)
      cursor?.use {
        if (it.moveToFirst()) {
          val idx = it.getColumnIndex(OpenableColumns.SIZE)
          if (idx >= 0 && !it.isNull(idx)) {
            promise.resolve(it.getLong(idx))
            return
          }
        }
      }
      promise.resolve(0)
    } catch (e: Throwable) {
      promise.reject("E_QUERY_SIZE", e.message, e)
    }
  }

  /**
   * 直接引用外部模型的零拷贝正解：All Files Access 授权后，把 content:// fd
   * readlink 成底层真实路径（如 /storage/3937-3132/model.gguf，含 USB OTG 卷），
   * llama.cpp 直接 open + mmap —— 不经过 /proc/self/fd 的二次 open，
   * 也就不会触发 Android 13+ scoped storage 的 EACCES。
   *
   * 路径跨重启稳定，比 fd 路径更可靠。没有授权或路径不可读时返回空串，
   * 调用方回落到 fd 方案 / 复制方案。
   */
  override fun resolveRealPath(uri: String, promise: Promise) {
    try {
      val pfd =
          resolver()
              .openFileDescriptor(Uri.parse(uri), "r")
              ?: throw FileNotFoundException("openFileDescriptor returned null: $uri")
      val path =
          try {
            Os.readlink("/proc/self/fd/${pfd.fd}")
          } finally {
            try {
              pfd.close()
            } catch (_: Throwable) {}
          }
      // /proc/ 开头的 readlink 结果（管道/memfd 等）不是普通文件，交出去也没用
      if (path.isNotEmpty() && !path.startsWith("/proc/") && File(path).canRead()) {
        promise.resolve(path)
      } else {
        promise.resolve("")
      }
    } catch (e: Throwable) {
      promise.reject("E_RESOLVE_PATH", "解析真实路径失败 $uri: ${e.message}", e)
    }
  }

  /** 是否已拥有「所有文件访问」权限（Android 11+；以下版本恒 true）。 */
  override fun isAllFilesAccessGranted(promise: Promise) {
    promise.resolve(
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
          Environment.isExternalStorageManager()
        } else {
          true
        })
  }

  /**
   * 跳转系统「所有文件访问」授权页。用户勾选回来后，再调
   * isAllFilesAccessGranted / resolveRealPath 生效。这里无法得知勾选结果，
   * 由 JS 侧在 onResume 后重新探测。
   */
  override fun requestAllFilesAccess(promise: Promise) {
    try {
      val ctx = reactApplicationContext
      val intent =
          Intent(
                  Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                  Uri.parse("package:${ctx.packageName}"))
              .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      ctx.startActivity(intent)
      promise.resolve(true)
    } catch (e: Throwable) {
      try {
        // 部分 ROM 不认带 package uri 的精确跳转，退到全局授权页
        val fallback =
            Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        reactApplicationContext.startActivity(fallback)
        promise.resolve(true)
      } catch (e2: Throwable) {
        promise.reject("E_REQUEST_AFA", e2.message, e2)
      }
    }
  }

  override fun releaseFd(uri: String, promise: Promise) {
    val pfd = synchronized(handles) { handles.remove(uri) }
    promise.resolve(closeQuietly(pfd))
  }

  override fun releaseAll(promise: Promise) {
    val all = synchronized(handles) { handles.values.toList().also { handles.clear() } }
    var anyClosed = false
    all.forEach { if (closeQuietly(it)) anyClosed = true }
    promise.resolve(anyClosed)
  }

  private fun closeQuietly(pfd: ParcelFileDescriptor?): Boolean {
    if (pfd == null) return false
    return try {
      pfd.close()
      true
    } catch (_: Throwable) {
      false
    }
  }
}