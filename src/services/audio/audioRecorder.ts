import {PermissionsAndroid, Platform} from 'react-native';
import RNFS from '@dr.pogodin/react-native-fs';

import NativeAudioRecorder from '../../specs/NativeAudioRecorder';

/**
 * 录音封装：权限请求 + 原生 AudioRecorder（16bit mono PCM → WAV）。
 * 输出 WAV 是 RVC / 变声服务端最通用的输入，也可本地直接回放。
 */

export const requestMicPermission = async (): Promise<boolean> => {
  if (Platform.OS !== 'android') {
    return true;
  }
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
};

/** 开始录音，返回输出文件路径（WAV）。录音期间拿到路径即可，stop 后回填头。 */
export const startRecording = async (sampleRate = 16000): Promise<string> => {
  const ok = await requestMicPermission();
  if (!ok) {
    throw new Error('未获得麦克风权限，无法录音');
  }
  const dir = `${RNFS.CachesDirectoryPath}/recordings`;
  await RNFS.mkdir(dir);
  const path = `${dir}/rec_${Date.now()}.wav`;
  const started = await NativeAudioRecorder.startRecording(path, sampleRate);
  if (!started) {
    throw new Error('录音启动失败');
  }
  return path;
};

/** 停止录音，返回最终 WAV 文件绝对路径（空串表示没在录） */
export const stopRecording = (): Promise<string> =>
  NativeAudioRecorder.stopRecording();

export const isRecording = (): Promise<boolean> =>
  NativeAudioRecorder.isRecording();
