import axios from 'axios';
import RNFS from '@dr.pogodin/react-native-fs';

/**
 * RVC 变声服务端调用。
 *
 * 接口契约（手机端 → 服务端，标准 JSON + base64）：
 *   POST {baseUrl}/convert
 *   body: {
 *     audio: string,          // 源音频 WAV 的 base64
 *     model_name: string,     // 目标音色 .pth 文件名（服务端可见）
 *     f0_up_key: number,      // 变调（半音，默认 0）
 *     index_rate: number,     // 检索混合比例（默认 0.75）
 *     rms_mix_rate: number,   // 响度混合比例（默认 0.25）
 *     index_path: string,     // 可选 .index 路径
 *   }
 *   响应: { audio: string }   // 变声后 WAV 的 base64
 *
 * 配套服务端脚本见 `F:\OnDevice Kit\rvc_server.py`（封装 RVC WebUI 推理）。
 */

export interface RvcConvertOptions {
  modelName: string;
  f0UpKey?: number;
  indexRate?: number;
  rmsMixRate?: number;
  indexPath?: string;
}

/** 调 RVC 变声服务端，把 sourcePath 的音频换成 modelName 音色，返回结果文件路径。 */
export const rvcConvert = async (
  baseUrl: string,
  sourcePath: string,
  opts: RvcConvertOptions,
): Promise<string> => {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (!base) {
    throw new Error('请先填写 RVC 变声服务地址');
  }
  if (!opts.modelName.trim()) {
    throw new Error('请填写目标音色模型名（.pth 文件名）');
  }
  const audioBase64 = await RNFS.readFile(sourcePath, 'base64');

  const res = await axios.post(
    `${base}/convert`,
    {
      audio: audioBase64,
      model_name: opts.modelName.trim(),
      f0_up_key: opts.f0UpKey ?? 0,
      index_rate: opts.indexRate ?? 0.75,
      rms_mix_rate: opts.rmsMixRate ?? 0.25,
      index_path: opts.indexPath ?? '',
    },
    {timeout: 180000},
  );

  const outBase64: string | undefined =
    res.data?.audio ?? (typeof res.data === 'string' ? res.data : undefined);
  if (!outBase64) {
    throw new Error('服务端未返回变声音频');
  }

  const outPath = `${RNFS.CachesDirectoryPath}/rvc_out_${Date.now()}.wav`;
  await RNFS.writeFile(outPath, outBase64, 'base64');
  return outPath;
};
