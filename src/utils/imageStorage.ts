import * as RNFS from '@dr.pogodin/react-native-fs';

/**
 * 把相册 / 相机选中的图片转存为原生层可读的本地文件。
 *
 * 为什么必须转存：
 * - Android 上 `react-native-image-picker` 返回的通常是 `content://` URI，
 *   而 `llama.rn` / `mtmd` 只认真实文件路径，拿到 `content://` 会直接打不开
 *   文件 —— 用户看到的就是「图片导入失败 / 点了识别一直转圈」。
 * - 即使返回 `file://`，也可能指向系统缓存目录（App 重启、存储紧张或用户
 *   「清除缓存」后会被删掉），历史会话里的图片就变成死路径。
 *
 * 因此统一落到 App 私有文档目录 `DocumentDirectoryPath/vision`：系统不会
 * 自动清理，历史会话重开时图片仍然可读。
 */
const VISION_DIR = `${RNFS.DocumentDirectoryPath}/vision`;

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|bmp|heic|heif)(?:\?|#|$)/i;

function pickExtension(uri: string): string {
  const matched = uri.match(IMAGE_EXT_RE);
  const ext = (matched?.[1] || 'jpg').toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext;
}

// 同一毫秒内连续选择多张图时，避免文件名撞车。
let copySequence = 0;

/**
 * 转存单张图片，返回 `file://` 开头的本地路径。
 * 失败时抛错（调用方负责提示用户），绝不把读不了的 URI 原样透传。
 */
export async function persistPickedImage(uri: string): Promise<string> {
  const dest = `${VISION_DIR}/vision_${Date.now()}_${copySequence++}.${pickExtension(
    uri,
  )}`;
  try {
    if (!(await RNFS.exists(VISION_DIR))) {
      await RNFS.mkdir(VISION_DIR);
    }
    // RNFS.copyFile 同时支持 content:// 与 file:// 源路径。
    await RNFS.copyFile(uri, dest);
  } catch (e) {
    throw new Error(
      `图片转存失败，无法读取所选图片：${e instanceof Error ? e.message : e}`,
    );
  }
  return `file://${dest}`;
}

/**
 * 批量转存（顺序执行，避免并发写同一目录时出现半成品文件）。
 * 任意一张失败都会抛错，由调用方决定是整体放弃还是降级。
 */
export async function persistPickedImages(uris: string[]): Promise<string[]> {
  const persisted: string[] = [];
  for (const uri of uris) {
    persisted.push(await persistPickedImage(uri));
  }
  return persisted;
}
