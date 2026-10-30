import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

/**
 * 原生录音（AudioRecord → 16bit mono PCM → WAV 文件）。
 * 输出 WAV 是 RVC / 变声服务端最通用的输入格式，省去转码。
 */
export interface Spec extends TurboModule {
  /** 开始录音，写入 outputPath（WAV）。返回是否成功启动。 */
  startRecording(outputPath: string, sampleRate: number): Promise<boolean>;
  /** 停止并封存 WAV，返回最终文件绝对路径。 */
  stopRecording(): Promise<string>;
  isRecording(): Promise<boolean>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('AudioRecorderModule');
