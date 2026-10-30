import {Platform} from 'react-native';
import {pick, types} from '@react-native-documents/picker';

import type {Spec as ContentUriSpec} from '../specs/NativeContentUri';

/**
 * 原生模块做容错加载：生产环境正常注册；旧 APK / jest 等没有原生的环境里
 * 退化成 null（相关调用会给出明确错误，而不是让整个模块 import 就炸掉）。
 *
 * 注意 NativeContentUri 那边用的是 TurboModuleRegistry.get（不是 getEnforcing），
 * 所以拿不到时返回的是 null 而不是抛异常 —— 这里必须显式判 null。
 */
let native: ContentUriSpec | null | undefined;
const getNative = (): ContentUriSpec => {
  if (native === undefined) {
    try {
      const mod = require('../specs/NativeContentUri').default;
      native = (mod as ContentUriSpec) ?? null;
    } catch (e) {
      console.warn('[modelUri] 原生 ContentUriModule 不可用', e);
      native = null;
    }
  }
  if (!native) {
    throw new Error(
      '「直接引用外部文件」需要 ContentUriModule 原生模块，请用重新打包后的 App',
    );
  }
  return native;
};

/**
 * 「直接引用」外部模型文件的完整链路（零拷贝）。
 *
 * 原理：
 *   1. SAF 文件选择器返回 `content://` URI —— 它不是真实路径，而是一个
 *      「由某个 provider 支撑的虚拟文件」的地址，直接喂给 llama.cpp 会失败。
 *   2. `requestLongTermAccess` 申请持久化读权限：把这个授权写进系统，
 *      App 进程被杀、下次冷启动后依然有效（否则重启就 404）。
 *   3. 用原生模块把 URI 打开成只读 FileDescriptor，再把
 *      `/proc/self/fd/<fd>` 这个「内核视角的真实路径」交给 llama.cpp。
 *      它在内核看来就是普通文件，fopen / mmap 都照常工作，**一个字节都不用复制**。
 *
 * 代价：fd 只在 App 进程存活期间有效，所以每次加载模型前都要重新开一次 fd
 * （见 resolveLoadPath）。这正是「省空间」要付的代价。
 */

export type PickedModelFile = {
  uri: string;
  name: string;
  size: number;
};

/** 弹出系统文件选择器选一个 .gguf（Android 走 SAF，返回 content:// URI） */
export const pickGgufFile = async (): Promise<PickedModelFile | null> => {
  let picked: any = null;
  try {
    // mode:'open' + requestLongTermAccess:true → picker 在选中的同时就向系统
    // 申请持久读取权限（takePersistableUriPermission），App 重启后依然有效。
    //
    // 注意：新版 @react-native-documents/picker 的 pick() 统一返回数组
    // （即使只选一个文件），旧版返回单个对象。这里两种都兼容。
    picked = await pick({
      type: [types.allFiles],
      mode: 'open',
      requestLongTermAccess: true,
    });
  } catch (e) {
    // 用户取消时 picker 会抛异常，不是错误
    if (Platform.OS === 'android') {
      return null;
    }
    throw e;
  }
  const file = Array.isArray(picked) ? picked[0] : picked;
  if (!file?.uri) {
    return null;
  }
  let name = file.name ?? file.uri.split('/').pop() ?? 'model.gguf';
  let size = file.size ?? 0;
  if (Platform.OS === 'android') {
    // picker 给的 name/size 在部分 provider 下为空或不可信，走一次原生查询
    const [qName, qSize] = await Promise.all([
      getNative()
        .queryName(file.uri)
        .catch(() => ''),
      getNative()
        .querySize(file.uri)
        .catch(() => 0),
    ]);
    if (qName) {
      name = qName;
    }
    if (qSize > 0) {
      size = qSize;
    }
  }
  return {uri: file.uri, name, size};
};

/**
 * 申请持久化读权限。不申请的话，App 重启后系统可能不再授权这个 URI，
 * 表现为「昨天还能用，今天模型加载失败」。
 */
export const persistPermission = async (uri: string): Promise<boolean> => {
  // 持久权限在 pickGgufFile 里已通过 `requestLongTermAccess: true` 申请过，
  // 这里只做一次「现在还能不能打开」的实测，用来在导入前发现源文件已被删除。
  if (Platform.OS !== 'android') {
    return false;
  }
  try {
    await resolveLoadPath(uri);
    return true;
  } catch (e) {
    console.warn('[modelUri] URI 已不可访问（可能被移动/删除）', e);
    return false;
  }
};

/**
 * 把 content:// 解析成 llama.cpp 能用的路径（`/proc/self/fd/<fd>`）。
 * 同一 URI 重复调用会拿到同一个 fd，不会泄漏句柄。
 */
export const resolveLoadPath = async (uri: string): Promise<string> => {
  const fd = await getNative().openFd(uri);
  return `/proc/self/fd/${fd}`;
};

/** 判断一个路径是否是「fd 虚拟路径」（重启后必然失效，需要重开） */
export const isProcFdPath = (path?: string): boolean =>
  !!path && path.startsWith('/proc/self/fd/');

/**
 * 把 content:// 升级成底层真实文件路径（零拷贝的正解）。
 *
 * 前提是已授予「所有文件访问」权限（MANAGE_EXTERNAL_STORAGE）：此时
 * llama.cpp 可以直接 open + mmap /storage/<卷>/xxx.gguf（含 USB OTG 的
 * 可移动存储卷），不再经过 /proc/self/fd 的二次 open —— 那条路在
 * Android 13+ scoped storage 下会 EACCES。
 *
 * 真实路径跨重启稳定，拿到后 App 内完全不用再管 fd 生命周期。
 * 未授权 / 原生模块缺失 / 解析失败 → 返回 null，调用方回落 fd 方案。
 */
export const resolveRealPathIfAccessible = async (
  uri: string,
): Promise<string | null> => {
  if (Platform.OS !== 'android' || !uri) {
    return null;
  }
  try {
    const mod = getNative();
    if (!(await mod.isAllFilesAccessGranted())) {
      return null;
    }
    const real = await mod.resolveRealPath(uri);
    return real || null;
  } catch (e) {
    console.warn('[modelUri] resolveRealPath 失败', e);
    return null;
  }
};

/** 是否已授予「所有文件访问」权限（非 Android / 原生缺失按 false 处理）。 */
export const isAllFilesAccessGranted = async (): Promise<boolean> => {
  if (Platform.OS !== 'android') {
    return false;
  }
  try {
    return await getNative().isAllFilesAccessGranted();
  } catch {
    return false;
  }
};

/** 跳转系统「所有文件访问」授权页（结果未知，回来后需重新探测）。 */
export const requestAllFilesAccess = async (): Promise<boolean> => {
  try {
    return await getNative().requestAllFilesAccess();
  } catch (e) {
    console.warn('[modelUri] 跳转授权页失败', e);
    return false;
  }
};

/** 估算一个 content:// 模型的可读性，导入前先探一次 */
export const probeUri = async (uri: string): Promise<boolean> => {
  try {
    await persistPermission(uri);
    const path = await resolveLoadPath(uri);
    return path.startsWith('/proc/self/fd/');
  } catch (e) {
    console.warn('[modelUri] probe failed', e);
    return false;
  }
};
