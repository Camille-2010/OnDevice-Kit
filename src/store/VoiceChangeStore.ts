import {makeAutoObservable, runInAction} from 'mobx';
import {makePersistable} from 'mobx-persist-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {startRecording, stopRecording} from '../services/audio/audioRecorder';
import {pickAudioFile} from '../services/audio/filePicker';
import {playWavFile} from '../services/audio/wavPlayback';
import {rvcConvert} from '../services/rvc/rvc';
import {stopPcmPlayback} from '../services/tts/cloudPlayer';

/**
 * 音色转换（RVC 变声）状态。
 *
 * 流程：录一段 / 选一个音频 → 连 RVC 变声服务端 → 换成目标音色 → 播放结果。
 * 服务端接口契约见 services/rvc/rvc.ts；配套脚本 `F:\OnDevice Kit\rvc_server.py`。
 */
export class VoiceChangeStore {
  // ── RVC 服务端配置（持久化） ──
  rvcBaseUrl = '';
  modelName = '';
  f0UpKey = 0;
  indexRate = 0.75;
  rmsMixRate = 0.25;
  indexPath = '';

  // ── 源音频（运行态，不持久化） ──
  sourcePath: string | null = null;
  sourceName: string | null = null;

  // ── 运行态 ──
  isRecording = false;
  isConverting = false;
  isPlaying = false;
  error: string | null = null;
  hint: string | null = null;
  resultPath: string | null = null;

  constructor() {
    makeAutoObservable(this);
    makePersistable(this, {
      name: 'VoiceChangeStore',
      properties: [
        'rvcBaseUrl',
        'modelName',
        'f0UpKey',
        'indexRate',
        'rmsMixRate',
        'indexPath',
      ],
      storage: AsyncStorage,
    });
  }

  // ── setters ──
  setRvcBaseUrl(v: string) {
    this.rvcBaseUrl = v.trim();
  }
  setModelName(v: string) {
    this.modelName = v.trim();
  }
  setF0UpKey(v: number) {
    this.f0UpKey = Number.isFinite(v) ? Math.round(v) : 0;
  }
  setIndexRate(v: number) {
    this.indexRate = Math.max(0, Math.min(1, Number(v) || 0));
  }
  setRmsMixRate(v: number) {
    this.rmsMixRate = Math.max(0, Math.min(1, Number(v) || 0));
  }
  setIndexPath(v: string) {
    this.indexPath = v.trim();
  }

  get hasSource(): boolean {
    return this.sourcePath != null && this.sourcePath.length > 0;
  }

  // ── 录音 ──
  async beginRecording(): Promise<void> {
    if (this.isRecording) {
      return;
    }
    runInAction(() => {
      this.error = null;
      this.hint = null;
    });
    try {
      const path = await startRecording(16000);
      runInAction(() => {
        this.isRecording = true;
        this.sourcePath = path;
        this.sourceName = '正在录音…';
      });
    } catch (e: any) {
      runInAction(() => {
        this.error = e?.message ?? '录音启动失败';
      });
    }
  }

  async endRecording(): Promise<void> {
    if (!this.isRecording) {
      return;
    }
    const path = await stopRecording();
    runInAction(() => {
      this.isRecording = false;
      if (path) {
        this.sourcePath = path;
        this.sourceName = '手机录音';
      }
      this.hint = path ? '录音已就绪，可预览或直接变声' : '录音未完成';
    });
  }

  // ── 选文件 ──
  async chooseSourceFile(): Promise<void> {
    runInAction(() => {
      this.error = null;
      this.hint = null;
    });
    const f = await pickAudioFile();
    if (f) {
      runInAction(() => {
        this.sourcePath = f.path;
        this.sourceName = f.name;
        this.hint = '已导入音频，可预览或直接变声';
      });
    }
  }

  clearSource() {
    runInAction(() => {
      this.sourcePath = null;
      this.sourceName = null;
      this.resultPath = null;
      this.hint = null;
    });
  }

  // ── 预览源音频 ──
  async previewSource(): Promise<void> {
    if (!this.sourcePath) {
      return;
    }
    if (this.isPlaying) {
      await this.stopPlayback();
      return;
    }
    try {
      runInAction(() => {
        this.isPlaying = true;
        this.error = null;
      });
      await playWavFile(this.sourcePath);
    } catch (e: any) {
      runInAction(() => {
        this.error = e?.message ?? '预览失败（音频格式可能不支持，试试 WAV）';
      });
    } finally {
      runInAction(() => {
        this.isPlaying = false;
      });
    }
  }

  // ── RVC 变声 ──
  async convert(): Promise<void> {
    if (this.isConverting) {
      return;
    }
    if (!this.sourcePath) {
      runInAction(() => {
        this.error = '先录一段或选一个源音频';
      });
      return;
    }
    runInAction(() => {
      this.error = null;
      this.hint = null;
      this.isConverting = true;
    });
    try {
      const outPath = await rvcConvert(this.rvcBaseUrl, this.sourcePath, {
        modelName: this.modelName,
        f0UpKey: this.f0UpKey,
        indexRate: this.indexRate,
        rmsMixRate: this.rmsMixRate,
        indexPath: this.indexPath,
      });
      runInAction(() => {
        this.resultPath = outPath;
        this.hint = '变声完成，点「播放结果」试听';
      });
    } catch (e: any) {
      runInAction(() => {
        this.error = e?.message ?? '变声失败';
      });
    } finally {
      runInAction(() => {
        this.isConverting = false;
      });
    }
  }

  // ── 播放变声结果 ──
  async playResult(): Promise<void> {
    if (!this.resultPath) {
      return;
    }
    if (this.isPlaying) {
      await this.stopPlayback();
      return;
    }
    try {
      runInAction(() => {
        this.isPlaying = true;
        this.error = null;
      });
      await playWavFile(this.resultPath);
    } catch (e: any) {
      runInAction(() => {
        this.error = e?.message ?? '播放失败';
      });
    } finally {
      runInAction(() => {
        this.isPlaying = false;
      });
    }
  }

  async stopPlayback(): Promise<void> {
    try {
      await stopPcmPlayback();
    } catch {
      // 忽略
    }
    runInAction(() => {
      this.isPlaying = false;
    });
  }
}

export const voiceChangeStore = new VoiceChangeStore();
