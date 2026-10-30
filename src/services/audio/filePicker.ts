import RNFS from '@dr.pogodin/react-native-fs';
import {
  pick,
  types,
  isErrorWithCode,
  errorCodes,
} from '@react-native-documents/picker';

export interface PickedAudio {
  name: string;
  /** 拷贝到 app 私有目录后的本地路径（稳定，不依赖 content:// 生命周期） */
  path: string;
  size: number;
  mimeType: string;
}

/**
 * 系统音频文件选择（复用 @react-native-documents/picker）。
 * 选中后拷贝到 caches/audio_pick，返回稳定本地路径，供变声/播放使用。
 * 用户取消或出错时返回 null。
 */
export const pickAudioFile = async (): Promise<PickedAudio | null> => {
  try {
    const res = await pick({type: [types.audio]});
    if (!res || res.length === 0) {
      return null;
    }
    const f = res[0];
    const dir = `${RNFS.CachesDirectoryPath}/audio_pick`;
    await RNFS.mkdir(dir);
    const safeName = (f.name || 'audio').replace(/[^A-Za-z0-9._-]/g, '_');
    const dest = `${dir}/${Date.now()}_${safeName}`;
    await RNFS.copyFile(f.uri, dest);
    const stat = await RNFS.stat(dest);
    return {
      name: f.name || 'audio',
      path: dest,
      size: stat.size,
      mimeType: f.type || 'audio/*',
    };
  } catch (err) {
    if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) {
      return null;
    }
    return null;
  }
};
