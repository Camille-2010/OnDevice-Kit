import {makeAutoObservable, runInAction} from 'mobx';
import {makePersistable} from 'mobx-persist-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import * as Keychain from 'react-native-keychain';

import {allowSecretAccess} from '../services/security/securityGuard';
import {
  bytesToBase64,
  bytesToUtf8,
  playPcmBase64,
  stopPcmPlayback,
} from '../services/tts/cloudPlayer';

const KEYCHAIN_SERVICE = 'com.pocketpalai.cloud-tts';

/**
 * 云端 TTS（OpenAI 兼容接口）。
 *
 * 为什么要有这个：
 *   本地 TTS 虽然开箱可用（系统引擎），但音色和自然度有限，神经网络引擎
 *   又要下载几百 MB 的模型。云端模式直接调服务端的 `/v1/audio/speech`，
 *   音色更好、不用下模型，代价是要联网、要 API Key。
 *
 * 【请求 / 播放链路】
 *   POST {baseUrl}/v1/audio/speech
 *   body: {model, input, voice, response_format: 'pcm', speed}
 *   → 服务端返回**裸 PCM 字节**
 *   → 转 base64 → 交给原生 AudioTrack 播放（24kHz / 单声道）
 * 选 pcm 而不是 mp3，是因为项目里没有能解 mp3 的播放器，
 * 原生只吃 base64 PCM（见 services/tts/cloudPlayer.ts）。
 *
 * 安全：apiKey 只存系统钥匙串（Android Keystore / iOS Keychain），
 * 不进 AsyncStorage 明文——与 ApiStore 同一套安全模型（含 Frida/Xposed
 * 安全闸与旧明文迁移清除）。AsyncStorage 只持久化非敏感的
 * enabled/baseUrl/model/voice/speed。
 */
export class CloudTTSStore {
  /** 是否启用云端模式（「生成语音」页的本地/云端开关） */
  enabled = false;

  /** OpenAI 兼容服务的地址，可以带或不带 /v1 */
  baseUrl = 'https://api.openai.com';
  /** 仅内存镜像；真实存储在 Keychain */
  apiKey = '';
  /** 语音模型名，如 tts-1 / gpt-4o-mini-tts / 各厂商自己的名字 */
  model = 'tts-1';
  /** 音色名，如 alloy / nova / shimmer */
  voice = 'alloy';
  /** 语速 0.25~4.0 */
  speed = 1;

  /**
   * 安全闸命中（Frida / Xposed 等注入框架）时为 true：
   * 密钥故意不从钥匙串释放，云端 TTS 停用。
   * 只在内存里，不持久化。
   */
  secretBlocked = false;

  // ── 运行态 ──
  isSpeaking = false;
  error: string | null = null;

  constructor() {
    makeAutoObservable(this);
    makePersistable(this, {
      name: 'CloudTTSStore',
      // apiKey 不持久化：只进系统钥匙串
      properties: ['enabled', 'baseUrl', 'model', 'voice', 'speed'],
      storage: AsyncStorage,
    });
    // ⚠️ 旧明文的读取必须**在这里就发起**：hydration 完成后会把
    // 「不含 apiKey」的状态写回 AsyncStorage，把旧明文覆盖掉。
    // 与 ApiStore 同一个坑，同样的解法——构造期先抓旧值快照。
    const legacyRawPromise: Promise<string | null> = AsyncStorage?.getItem
      ? AsyncStorage.getItem('CloudTTSStore')
      : Promise.resolve(null);
    // 不 await：启动后台搬钥匙，不阻塞首屏
    this.migrateAndLoadKey(legacyRawPromise);
  }

  private async migrateAndLoadKey(legacyRawPromise: Promise<string | null>) {
    // 1) 先取旧明文（旧版本把 apiKey 存在 AsyncStorage 里）
    let legacyKey = '';
    try {
      const raw = await legacyRawPromise;
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (typeof parsed?.apiKey === 'string' && parsed.apiKey.length > 0) {
            legacyKey = parsed.apiKey;
          }
        } catch {
          // 非 JSON（旧版本格式变化）——忽略，走 Keychain 读取
        }
      }
    } catch {
      /* 读不到旧值就算了，Keychain 里可能已有 */
    }

    // 2) 安全闸：命中注入框架（Frida/Xposed 等）时不释放密钥，
    //    云端 TTS 静默降级；本地 TTS 不受影响。
    let allowed = true;
    try {
      allowed = await allowSecretAccess();
    } catch {
      // 守卫自身异常：放行（宁可漏报不可误杀）
      allowed = true;
    }

    // 3) 无论放不放行，都要把 AsyncStorage 里的明文 key 抹掉——
    //    不能因为「不释放密钥」就把明文留在盘上。
    await this.purgeLegacyKey();
    if (!allowed) {
      runInAction(() => {
        this.secretBlocked = true;
      });
      return;
    }

    // 4) Keychain 已有值优先；否则把 legacy 搬进 Keychain
    try {
      const stored = await Keychain.getGenericPassword({
        service: KEYCHAIN_SERVICE,
      });
      if (stored && typeof stored === 'object' && stored.password) {
        runInAction(() => {
          this.apiKey = stored.password;
        });
      } else if (legacyKey) {
        await Keychain.setGenericPassword('cloud-tts', legacyKey, {
          service: KEYCHAIN_SERVICE,
        });
        runInAction(() => {
          this.apiKey = legacyKey;
        });
      }
    } catch (error) {
      console.error('[CloudTTSStore] 读取云端 TTS Key 失败:', error);
    }
  }

  /** 把旧版遗留在 AsyncStorage 里的明文 apiKey 删掉。 */
  private async purgeLegacyKey() {
    try {
      const again = await AsyncStorage.getItem('CloudTTSStore');
      if (!again) {
        return;
      }
      const parsed = JSON.parse(again);
      if (parsed && 'apiKey' in parsed) {
        delete parsed.apiKey;
        await AsyncStorage.setItem('CloudTTSStore', JSON.stringify(parsed));
      }
    } catch {
      /* 忽略：清不掉也不影响功能（Keychain 才是权威存储） */
    }
  }

  setEnabled(v: boolean) {
    this.enabled = v;
    if (!v) {
      this.stop();
    }
  }
  setBaseUrl(v: string) {
    this.baseUrl = v.trim();
  }
  setApiKey(v: string) {
    const key = v.trim();
    runInAction(() => {
      this.apiKey = key;
    });
    // fire-and-forget：UI 不等钥匙串；失败保留内存值（本次会话仍可用）。
    // 清空则连钥匙串条目一起删掉。
    const persist = key
      ? Keychain.setGenericPassword('cloud-tts', key, {
          service: KEYCHAIN_SERVICE,
        })
      : Keychain.resetGenericPassword({service: KEYCHAIN_SERVICE});
    persist.catch(err =>
      console.error('[CloudTTSStore] 保存 TTS Key 到钥匙串失败:', err),
    );
  }
  setModel(v: string) {
    this.model = v.trim();
  }
  setVoice(v: string) {
    this.voice = v.trim();
  }
  setSpeed(v: number) {
    this.speed = Math.max(0.25, Math.min(4, Number(v.toFixed(2))));
  }

  /** 配置齐了没（地址 + Key + 模型名） */
  get ready(): boolean {
    return (
      this.baseUrl.trim().length > 0 &&
      this.apiKey.trim().length > 0 &&
      this.model.trim().length > 0
    );
  }

  /**
   * 拼出 /v1/audio/speech 的完整地址。
   * 用户填的地址可能已经带 `/v1`，也可能带尾斜杠，这里统一收口，避免出现
   * `.../v1/v1/audio/speech` 这种重复。
   */
  get speechUrl(): string {
    const base = this.baseUrl.trim().replace(/\/+$/, '');
    if (!base) {
      return '';
    }
    return /\/v1$/i.test(base)
      ? `${base}/audio/speech`
      : `${base}/v1/audio/speech`;
  }

  async stop() {
    try {
      await stopPcmPlayback();
    } catch {
      // 没在播时原生可能报错，忽略
    }
    runInAction(() => {
      this.isSpeaking = false;
    });
  }

  /** 把文字发给云端合成并播放。错误写进 this.error。 */
  async speak(text: string): Promise<boolean> {
    const input = text.trim();
    if (!input) {
      runInAction(() => {
        this.error = '请输入要朗读的文字';
      });
      return false;
    }
    if (!this.ready) {
      runInAction(() => {
        this.error = '请先填写云端服务地址、API Key 和模型名';
      });
      return false;
    }

    const url = this.speechUrl;
    if (!url) {
      runInAction(() => {
        this.error = '云端服务地址不合法';
      });
      return false;
    }

    await this.stop();
    runInAction(() => {
      this.error = null;
      this.isSpeaking = true;
    });

    try {
      const res = await axios.post(
        url,
        {
          model: this.model,
          input,
          voice: this.voice,
          // 必须 pcm：原生播放器只吃裸 PCM
          response_format: 'pcm',
          speed: this.speed,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          responseType: 'arraybuffer',
          timeout: 120000,
        },
      );

      const data = res.data;
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : null;
      if (!bytes || bytes.length === 0) {
        throw new Error('服务端没有返回音频数据');
      }

      await playPcmBase64(bytesToBase64(bytes), 24000, 1);
      return true;
    } catch (e: any) {
      // 服务端返回 JSON 错误体时，axios 给的是 ArrayBuffer，
      // 转成文本才能把真正的原因（401 / model not found 之类）读出来。
      // 注意：不能用 TextDecoder —— Hermes 没有这个全局。
      let detail: string | undefined;
      const raw = e?.response?.data;
      if (raw instanceof ArrayBuffer) {
        try {
          detail = JSON.parse(bytesToUtf8(new Uint8Array(raw)))?.error?.message;
        } catch {
          // 不是 JSON 就算了
        }
      } else if (raw && typeof raw === 'object') {
        detail = raw?.error?.message;
      }

      const msg =
        e?.response?.status != null
          ? `服务端返回 ${e.response.status}${detail ? `：${detail}` : ''}`
          : e?.code === 'ECONNABORTED'
            ? '请求超时，云端合成较慢时可稍后再试'
            : e?.message?.includes('Network')
              ? '连不上云端服务，检查网络与地址是否正确'
              : (detail ?? e?.message ?? '云端合成失败');

      runInAction(() => {
        this.error = msg;
        this.isSpeaking = false;
      });
      return false;
    } finally {
      runInAction(() => {
        this.isSpeaking = false;
      });
    }
  }
}

export const cloudTTSStore = new CloudTTSStore();
