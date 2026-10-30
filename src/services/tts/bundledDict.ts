import * as RNFS from '@dr.pogodin/react-native-fs';

import {EN_US_DICT_B64_CHUNKS} from '../../assets/tts/en-us.b64';

/**
 * 随包的 IPA 音素字典（en-us.bin）。
 *
 * 原本是联网从 HuggingFace 数据集下的，但 HF 的大文件会 302 到
 * `cas-bridge.xethub.hf.co` —— 那个域名在中国大陆连不上（TLS 直接被重置），
 * 于是 Kokoro / Kitten 装到「下载字典」这一步就失败。
 *
 * 字典只有 3.5MB 且是**静态文件**（永不变化），没必要每次都联网：
 * 直接随包发布，安装引擎时本地写盘，大陆网络零依赖。
 */
const BUNDLED_DICT_BYTES = 3_556_124;

/**
 * 把随包字典写到目标路径。
 * 已存在且大小一致就直接复用，避免每次安装重复写 3.5MB。
 */
export const writeBundledDict = async (destPath: string): Promise<void> => {
  // 单测里的 RNFS mock 只有部分方法，stat 可能不存在 —— 探测失败就当没有缓存
  let existingSize = 0;
  try {
    if (typeof RNFS.stat === 'function') {
      const stat = await RNFS.stat(destPath);
      existingSize = Number(stat?.size ?? 0);
    }
  } catch {
    existingSize = 0;
  }
  if (existingSize === BUNDLED_DICT_BYTES) {
    return;
  }
  await RNFS.writeFile(destPath, EN_US_DICT_B64_CHUNKS.join(''), 'base64');
};
