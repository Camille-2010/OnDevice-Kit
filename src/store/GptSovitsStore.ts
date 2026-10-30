import {makeAutoObservable, runInAction} from 'mobx';
import {makePersistable} from 'mobx-persist-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

import {
  bytesToBase64,
  bytesToUtf8,
  playPcmBase64,
  stopPcmPlayback,
} from '../services/tts/cloudPlayer';
import {parseWav} from '../services/gptsovits/wav';
import {
  assessDevicePerf,
  tierFromRtf,
  PerfAssessment,
  RtfMeasurement,
} from '../services/gptsovits/devicePerf';

/**
 * GPT-SoVITS 引擎。
 *
 * 【两种形态】
 *  · 远程引擎（现在就真的能用）：GPT-SoVITS 跑在电脑 / 服务器上，
 *    手机通过官方 api_v2（默认 9880）做检测 / 切权重 / 合成，
 *    通过内置 WebView 打开 9872 的 Gradio 推理网页。
 *  · 本机安装（界面骨架已就位）：把 Python + Torch 运行时装进手机
 *    这条链路需要原生层支持，对应「安装流程 / 时间轴」那段 UI，
 *    当前标注「待接入」，按钮不造假、一律禁用。
 *
 * 【api_v2 用到的接口】（全部真实请求）
 *  GET  /                  → 存活检测（任意 2xx 即在线）
 *  POST /set_gpt_weights   {gpt_path}
 *  POST /set_sovits_weights{sovits_path}
 *  POST /tts               → 音色合成，返回 WAV（32kHz/16bit 常见）
 */

export type GsvStatus = 'idle' | 'checking' | 'online' | 'offline';

/** 推理跑在哪：本地神经网络引擎，还是云端 GPT-SoVITS 服务端 */
export type GsvMode = 'local' | 'cloud';

/** 一个「角色包」= 参考音频 + 参考文本，服务端按它出对应音色 */
export interface GsvRole {
  id: string;
  name: string;
  /** 服务端文件系统里可见的音频路径，如 D:/GPT-SoVITS/refs/demo.wav */
  refAudioPath: string;
  promptText: string;
  promptLanguage: string;
}

/** api_v2 支持的主要语言标记 */
export const GSV_LANGS = ['zh', 'en', 'ja', 'ko', 'yue', 'auto'] as const;

export class GptSovitsStore {
  // ── 配置（持久化） ──
  /** api_v2 地址，默认端口 9880 */
  apiBaseUrl = '';
  /** Gradio 推理网页地址，默认端口 9872；留空则按 api 地址自动推导 */
  webuiBaseUrl = '';
  /** 当前角色：参考音频路径（服务端可见） */
  refAudioPath = '';
  /** 参考音频对应的文本 */
  promptText = '';
  /** 参考文本语言 */
  promptLanguage = 'zh';
  /** 合成文本语言 */
  textLang = 'zh';
  /** 语速 */
  speed = 1;
  /** GPT 权重路径（服务端可见） */
  gptWeightPath = '';
  /** SoVITS 权重路径（服务端可见） */
  sovitsWeightPath = '';
  /** 本机保存的角色包 */
  roles: GsvRole[] = [];
  activeRoleId: string | null = null;
  /** 推理跑在哪（Mini ONNX 页的本地/云端切换） */
  mode: GsvMode = 'cloud';

  // ── 运行态 ──
  apiStatus: GsvStatus = 'idle';
  webuiStatus: GsvStatus = 'checking';
  /** 最近一次检测的 API 延迟 ms */
  apiLatency: number | null = null;
  error: string | null = null;
  isSynthesizing = false;
  /** 终端日志（真实操作记录，环形保留 120 条） */
  logs: string[] = [];
  /** 设备性能静态预判（真实信号采集） */
  perf: PerfAssessment | null = null;
  /** RTF 实测：本地/云端各保留最后一次 */
  localRtf: RtfMeasurement | null = null;
  cloudRtf: RtfMeasurement | null = null;

  constructor() {
    makeAutoObservable(this);
    makePersistable(this, {
      name: 'GptSovitsStore',
      properties: [
        'apiBaseUrl',
        'webuiBaseUrl',
        'refAudioPath',
        'promptText',
        'promptLanguage',
        'textLang',
        'speed',
        'gptWeightPath',
        'sovitsWeightPath',
        'roles',
        'activeRoleId',
        'mode',
      ],
      storage: AsyncStorage,
    });
  }

  // ── setters ──
  setApiBaseUrl(v: string) {
    this.apiBaseUrl = v.trim();
  }
  setWebuiBaseUrl(v: string) {
    this.webuiBaseUrl = v.trim();
  }
  setRefAudioPath(v: string) {
    this.refAudioPath = v.trim();
  }
  setPromptText(v: string) {
    this.promptText = v;
  }
  setPromptLanguage(v: string) {
    this.promptLanguage = v;
  }
  setTextLang(v: string) {
    this.textLang = v;
  }
  setSpeed(v: number) {
    this.speed = Math.max(0.5, Math.min(3, Number(v.toFixed(2))));
  }
  setGptWeightPath(v: string) {
    this.gptWeightPath = v.trim();
  }
  setSovitsWeightPath(v: string) {
    this.sovitsWeightPath = v.trim();
  }
  setMode(m: GsvMode) {
    this.mode = m;
    runInAction(() => {
      this.error = null;
    });
    this.log(`切换到${m === 'local' ? '本地引擎' : '云端 GPT-SoVITS'}`);
  }

  // ── 设备性能 ──

  /** 采集真实性能信号做静态预判 */
  async refreshPerf(): Promise<void> {
    try {
      const perf = await assessDevicePerf();
      runInAction(() => {
        this.perf = perf;
      });
      this.log(`性能预判：${perf.verdict}`);
    } catch (e: any) {
      this.log(`性能预判失败：${e?.message ?? e}`);
    }
  }

  /**
   * 本地模式能不能流畅用的**最终结论**。
   *
   * 优先级：实测 RTF > 静态预判 —— 实测是这台机器上真跑出来的，最可信。
   */
  get localVerdict(): {tier: string; text: string; basedOn: string} {
    if (this.localRtf) {
      const tier = tierFromRtf(this.localRtf.rtf);
      return {
        tier,
        text:
          tier === 'fast'
            ? `实测 RTF ${this.localRtf.rtf.toFixed(2)}（快于实时）→ 本地跑得动`
            : tier === 'usable'
              ? `实测 RTF ${this.localRtf.rtf.toFixed(
                  2,
                )}（接近实时）→ 能跑，但合成时要等一下`
              : `实测 RTF ${this.localRtf.rtf.toFixed(
                  2,
                )}（慢于实时）→ 建议改用云端`,
        basedOn: '实测',
      };
    }
    if (this.perf) {
      return {
        tier: this.perf.tier,
        text: this.perf.verdict,
        basedOn: '设备预判（还没实测）',
      };
    }
    return {
      tier: 'unknown',
      text: '先点「检测本机性能」，再跑一次合成给出结论',
      basedOn: '未评估',
    };
  }

  /** 记录一次 RTF 实测（本地/云端分开存） */
  recordRtf(m: RtfMeasurement) {
    runInAction(() => {
      if (m.source === 'local-onnx') {
        this.localRtf = m;
      } else {
        this.cloudRtf = m;
      }
    });
    this.log(
      `${m.source === 'local-onnx' ? '本地' : '云端'}实测 RTF ${m.rtf.toFixed(
        2,
      )}（耗时 ${(m.elapsedMs / 1000).toFixed(1)}s / 音频 ${(
        m.audioMs / 1000
      ).toFixed(1)}s）`,
    );
  }

  /** 去掉尾斜杠后的 api 地址 */
  get apiBase(): string {
    return this.apiBaseUrl.trim().replace(/\/+$/, '');
  }

  /** 从地址里抠出 host（不带端口），解析失败返回 null */
  private hostOf(base: string): string | null {
    const m = base.match(/^(?:https?:\/\/)?([^/:?#]+)/i);
    return m ? m[1] : null;
  }

  private schemeOf(base: string): string {
    return /^https:\/\//i.test(base) ? 'https' : 'http';
  }

  /**
   * 推理网页地址：用户填了就用填的；否则按 api 地址推导
   * （同 host，端口换成 9872 —— inference_webui 的默认端口）。
   */
  get webuiUrl(): string {
    const custom = this.webuiBaseUrl.trim().replace(/\/+$/, '');
    if (custom) {
      return custom;
    }
    const api = this.apiBase;
    if (!api) {
      return '';
    }
    const host = this.hostOf(api);
    if (!host) {
      return '';
    }
    return `${this.schemeOf(api)}://${host}:9872`;
  }

  /** 状态卡文案用：引擎是否已连接 */
  get connected(): boolean {
    return this.apiStatus === 'online';
  }

  private log(line: string) {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const entry = `[${hh}:${mm}:${ss}] ${line}`;
    runInAction(() => {
      this.logs = [...this.logs.slice(-119), entry];
    });
  }

  /** 把 axios 错误翻成人话（错误体是 ArrayBuffer 时手写 UTF-8 解码） */
  private describeError(e: any, fallback: string): string {
    let detail: string | undefined;
    const raw = e?.response?.data;
    if (raw instanceof ArrayBuffer) {
      try {
        const parsed = JSON.parse(bytesToUtf8(new Uint8Array(raw)));
        detail = parsed?.message ?? parsed?.detail;
      } catch {
        // 不是 JSON 就算了
      }
    } else if (raw && typeof raw === 'object') {
      detail = raw?.message ?? raw?.detail;
    } else if (typeof raw === 'string' && raw) {
      detail = raw;
    }

    if (e?.response?.status != null) {
      return `服务端返回 ${e.response.status}${detail ? `：${detail}` : ''}`;
    }
    if (e?.code === 'ECONNABORTED') {
      return '请求超时，服务端可能正忙';
    }
    if (e?.message?.includes('Network')) {
      return '连不上服务端，检查地址、端口和同一网络';
    }
    return detail ?? e?.message ?? fallback;
  }

  /**
   * 连接检测：api 根路径任意 2xx = 在线；WebUI 同理。
   * 全部真实请求，延迟也会记下来。
   */
  async checkConnection(): Promise<void> {
    if (!this.apiBase) {
      runInAction(() => {
        this.error = '请先填写 api_v2 服务地址（默认端口 9880）';
      });
      return;
    }
    runInAction(() => {
      this.apiStatus = 'checking';
      this.webuiStatus = 'checking';
      this.error = null;
    });
    this.log(`检测连接 ${this.apiBase}`);

    const t0 = Date.now();
    try {
      await axios.get(`${this.apiBase}/`, {timeout: 5000});
      const latency = Date.now() - t0;
      runInAction(() => {
        this.apiStatus = 'online';
        this.apiLatency = latency;
      });
      this.log(`api_v2 在线 · ${latency}ms`);
    } catch (e: any) {
      runInAction(() => {
        this.apiStatus = 'offline';
        this.apiLatency = null;
        this.error = this.describeError(e, '连接失败');
      });
      this.log(`api_v2 连接失败：${this.error}`);
    }

    const webui = this.webuiUrl;
    if (webui) {
      try {
        await axios.get(`${webui}/`, {timeout: 5000});
        runInAction(() => {
          this.webuiStatus = 'online';
        });
        this.log(`推理网页在线 ${webui}`);
      } catch {
        runInAction(() => {
          this.webuiStatus = 'offline';
        });
        this.log('推理网页不可达（服务端可能没开 inference_webui）');
      }
    } else {
      runInAction(() => {
        this.webuiStatus = 'offline';
      });
    }
  }

  /** 切 GPT 权重（真实请求） */
  async applyGptWeights(): Promise<boolean> {
    if (!this.apiBase || !this.gptWeightPath.trim()) {
      runInAction(() => {
        this.error = '填写服务地址和 GPT 权重路径后再应用';
      });
      return false;
    }
    this.log(`切换 GPT 权重：${this.gptWeightPath}`);
    try {
      const res = await axios.post(
        `${this.apiBase}/set_gpt_weights`,
        {gpt_path: this.gptWeightPath.trim()},
        {timeout: 30000},
      );
      this.log(`GPT 权重：${res?.data?.message ?? '已应用'}`);
      return true;
    } catch (e: any) {
      const msg = this.describeError(e, '切换 GPT 权重失败');
      runInAction(() => {
        this.error = msg;
      });
      this.log(`切换 GPT 权重失败：${msg}`);
      return false;
    }
  }

  /** 切 SoVITS 权重（真实请求） */
  async applySovitsWeights(): Promise<boolean> {
    if (!this.apiBase || !this.sovitsWeightPath.trim()) {
      runInAction(() => {
        this.error = '填写服务地址和 SoVITS 权重路径后再应用';
      });
      return false;
    }
    this.log(`切换 SoVITS 权重：${this.sovitsWeightPath}`);
    try {
      const res = await axios.post(
        `${this.apiBase}/set_sovits_weights`,
        {sovits_path: this.sovitsWeightPath.trim()},
        {timeout: 30000},
      );
      this.log(`SoVITS 权重：${res?.data?.message ?? '已应用'}`);
      return true;
    } catch (e: any) {
      const msg = this.describeError(e, '切换 SoVITS 权重失败');
      runInAction(() => {
        this.error = msg;
      });
      this.log(`切换 SoVITS 权重失败：${msg}`);
      return false;
    }
  }

  /**
   * 合成并播放（api_v2 /tts）。
   * 返回的 WAV 剥掉容器后交给原生 AudioTrack 播。
   */
  async synthesize(text: string): Promise<boolean> {
    const input = text.trim();
    if (!this.apiBase) {
      runInAction(() => {
        this.error = '请先填写服务地址并检测连接';
      });
      return false;
    }
    if (!input) {
      runInAction(() => {
        this.error = '请输入要合成的文本';
      });
      return false;
    }
    if (!this.refAudioPath.trim()) {
      runInAction(() => {
        this.error =
          '缺少参考音频：填一个服务端可见的音频路径，或先选一个角色包';
      });
      return false;
    }

    try {
      await stopPcmPlayback();
    } catch {
      // 没在播时原生可能报错，忽略
    }
    runInAction(() => {
      this.error = null;
      this.isSynthesizing = true;
    });
    this.log(`合成「${input.slice(0, 16)}${input.length > 16 ? '…' : ''}」`);
    const ttsStartedAt = Date.now();

    try {
      const res = await axios.post(
        `${this.apiBase}/tts`,
        {
          text: input,
          text_lang: this.textLang,
          ref_audio_path: this.refAudioPath.trim(),
          prompt_text: this.promptText.trim(),
          prompt_language: this.promptLanguage,
          speed_factor: this.speed,
          aux_ref_audio_paths: [],
          media_type: 'wav',
          streaming: false,
        },
        {responseType: 'arraybuffer', timeout: 180000},
      );

      const data = res.data;
      const bytes =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : data
            ? new Uint8Array(data)
            : null;
      if (!bytes || bytes.length === 0) {
        throw new Error('服务端没有返回音频数据');
      }

      const wav = parseWav(bytes);
      if (wav.bitsPerSample !== 16) {
        throw new Error(
          `暂只支持 16bit WAV（服务端返回 ${wav.bitsPerSample}bit）`,
        );
      }
      const pcm = bytes.subarray(
        wav.dataOffset,
        wav.dataOffset + wav.dataLength,
      );
      this.log(
        `返回 ${(bytes.length / 1024).toFixed(0)}KB · ${wav.sampleRate}Hz · ${wav.channels}ch`,
      );

      // RTF 实测：请求发出到拿到音频的耗时 ÷ 音频时长。
      // 这是「这台机器/这条链路跑不跑得动实时」最硬的指标。
      const audioMs = (pcm.length / (wav.sampleRate * wav.channels * 2)) * 1000;
      this.recordRtf({
        elapsedMs: Date.now() - ttsStartedAt,
        audioMs,
        rtf: audioMs > 0 ? (Date.now() - ttsStartedAt) / audioMs : 0,
        source: 'cloud',
        at: Date.now(),
      });

      await playPcmBase64(bytesToBase64(pcm), wav.sampleRate, wav.channels);
      this.log('播放开始');
      return true;
    } catch (e: any) {
      const msg =
        e instanceof Error && e.message && !(e as any)?.response
          ? e.message
          : this.describeError(e, '合成失败');
      runInAction(() => {
        this.error = msg;
      });
      this.log(`合成失败：${msg}`);
      return false;
    } finally {
      runInAction(() => {
        this.isSynthesizing = false;
      });
    }
  }

  async stopPlayback() {
    try {
      await stopPcmPlayback();
    } catch {
      // 忽略
    }
    this.log('已停止播放');
  }

  /** 清空终端日志（真实清空，界面立刻反映） */
  clearLogs() {
    runInAction(() => {
      this.logs = [];
    });
  }

  // ── 角色包 ──
  /** 把当前参考音频配置存成一个角色包 */
  saveCurrentAsRole(name: string): GsvRole | null {
    const trimmed = name.trim();
    if (!trimmed) {
      runInAction(() => {
        this.error = '先给角色包起个名字';
      });
      return null;
    }
    if (!this.refAudioPath.trim()) {
      runInAction(() => {
        this.error = '参考音频路径为空，存不了角色包';
      });
      return null;
    }
    const role: GsvRole = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: trimmed,
      refAudioPath: this.refAudioPath.trim(),
      promptText: this.promptText.trim(),
      promptLanguage: this.promptLanguage,
    };
    runInAction(() => {
      this.roles = [...this.roles.filter(r => r.name !== trimmed), role];
      this.activeRoleId = role.id;
    });
    this.log(`已保存角色包「${trimmed}」`);
    return role;
  }

  /** 选用一个角色包（把它的配置复制到当前） */
  selectRole(id: string) {
    const role = this.roles.find(r => r.id === id);
    if (!role) {
      return;
    }
    runInAction(() => {
      this.activeRoleId = role.id;
      this.refAudioPath = role.refAudioPath;
      this.promptText = role.promptText;
      this.promptLanguage = role.promptLanguage;
    });
    this.log(`选用角色包「${role.name}」`);
  }

  deleteRole(id: string) {
    const role = this.roles.find(r => r.id === id);
    runInAction(() => {
      this.roles = this.roles.filter(r => r.id !== id);
      if (this.activeRoleId === id) {
        this.activeRoleId = null;
      }
    });
    if (role) {
      this.log(`已删除角色包「${role.name}」`);
    }
  }

  /** 获取当前选中的角色（商城页高亮用） */
  get activeRole(): GsvRole | null {
    return this.roles.find(r => r.id === this.activeRoleId) ?? null;
  }
}

export const gptSovitsStore = new GptSovitsStore();
