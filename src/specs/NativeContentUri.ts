import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

/**
 * content:// URI 桥接。
 *
 * 背景：llama.cpp / llama.rn 只认「文件路径」（内部走 fopen + mmap），
 * 而 Android 的文件选择器给的是 `content://` 虚拟 URI，直接传会失败。
 *
 * 做法：用 ContentResolver 打开一个只读 FileDescriptor，再把
 * `/proc/self/fd/<fd>` 这个真实路径交给 llama.cpp —— 它在内核看来就是
 * 一个可 open、可 mmap 的普通文件描述符，无需任何拷贝。
 *
 * 注意：fd 只在 ParcelFileDescriptor 存活期间有效，所以模块内部必须持有
 * PFD 引用（见 openFd 的缓存表），不能取完 fd 就 close。
 */
export interface Spec extends TurboModule {
  /** 打开 content:// 返回只读 fd（int）。同一 uri 重复调用返回同一个 fd。 */
  openFd(uri: string): Promise<number>;
  /** 查询显示名（文件名），失败返回空串。 */
  queryName(uri: string): Promise<string>;
  /** 查询文件大小（字节），失败返回 0。 */
  querySize(uri: string): Promise<number>;
  /** 释放某个 uri 持有的 fd。 */
  releaseFd(uri: string): Promise<boolean>;
  /** 释放全部 fd（App 进入后台时调用，避免句柄泄漏）。 */
  releaseAll(): Promise<boolean>;
  /**
   * 把 content:// 解析成底层真实文件路径（如 /storage/3937-3132/x.gguf，
   * 含 USB OTG 卷）。需要「所有文件访问」权限；失败/不可读返回空串。
   */
  resolveRealPath(uri: string): Promise<string>;
  /** 是否已拥有「所有文件访问」权限。 */
  isAllFilesAccessGranted(): Promise<boolean>;
  /** 跳转系统「所有文件访问」授权页，无法得知勾选结果。 */
  requestAllFilesAccess(): Promise<boolean>;
}

/**
 * 用 get 而不是 getEnforcing。
 *
 * getEnforcing 在「模块不存在」时会直接抛异常，而这里是模块顶层代码 ——
 * 只要有人 import 这个文件就立刻炸，外面包 try/catch 也拦不住。
 * modelUri.ts 想做的「原生不可用时优雅降级」就永远走不到。
 *
 * get 返回 null，交给调用方判断，这样：
 *   · 新 APK（含原生模块） → 正常拿到模块
 *   · 旧 APK / jest 环境   → 拿到 null，走 modelUri 里清晰的报错提示
 */
export default TurboModuleRegistry.get<Spec>('ContentUriModule');
