import {makeAutoObservable, runInAction} from 'mobx';
import {makePersistable} from 'mobx-persist-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import {allowSecretAccess} from '../services/security/securityGuard';

/**
 * 云端模型服务（API 模式）：
 * 与本地 llama.cpp 离线推理并存，二选一驱动聊天。
 * 兼容 OpenAI 格式接口（DeepSeek / OpenAI / 通义等）。
 *
 * 安全：apiKey 只存系统钥匙串（Android Keystore / iOS Keychain，
 * 硬件级加密、不随 adb backup / 云备份导出），不进 AsyncStorage
 * 明文。AsyncStorage 只持久化非敏感的 enabled/baseUrl/model。
 * 旧的 AsyncStorage 明文 key 会在启动时自动迁移并清除。
 */
const KEYCHAIN_SERVICE = 'com.pocketpalai.cloud-api';

class ApiStore {
  enabled = false;
  baseUrl = 'https://api.deepseek.com';
  /** 仅内存镜像；真实存储在 Keychain */
  apiKey = '';
  model = 'deepseek-chat';
  /**
   * 安全闸命中（检测到 Frida / Xposed 等注入框架）时为 true：
   * 密钥故意不从钥匙串释放，云功能停用。给 UI 一个明确提示用——
   * 否则用户只会觉得「云端突然不能用了」却没有任何原因可看。
   * 只在内存里，不持久化。
   */
  secretBlocked = false;

  constructor() {
    makeAutoObservable(this);
    makePersistable(this, {
      name: 'ApiStore',
      properties: ['enabled', 'baseUrl', 'model'],
      storage: AsyncStorage,
    });
    // ⚠️ 旧明文的读取必须**在这里就发起**，不能等到 migrateAndLoadKey
    // 里面再读：mobx-persist-store 的 hydration 完成后会把「不含 apiKey」
    // 的状态写回 AsyncStorage，把旧明文覆盖掉。而 hydrate 与我们的迁移是
    // 并发的——若先等安全闸（端口探测最多约 250ms）再读，用户升级前保存的
    // 明文 Key 已经被擦掉，表现为「升级后云端对话莫名不能用了」。
    // AsyncStorage?.：不少单测对 AsyncStorage 做部分 mock（没有 getItem），
    // 构造期调用会把整套件炸掉；真机上一定是完整实现。
    const legacyRawPromise: Promise<string | null> = AsyncStorage?.getItem
      ? AsyncStorage.getItem('ApiStore')
      : Promise.resolve(null);
    // 不 await：启动后台搬钥匙，不阻塞首屏
    this.migrateAndLoadKey(legacyRawPromise);
  }

  private async migrateAndLoadKey(legacyRawPromise: Promise<string | null>) {
    // 1) 先取旧明文（读取在构造函数里就发起，赶在 hydration 写回之前）
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
    //    云功能静默降级；本地推理不受影响。
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
        await Keychain.setGenericPassword('cloud-api', legacyKey, {
          service: KEYCHAIN_SERVICE,
        });
        runInAction(() => {
          this.apiKey = legacyKey;
        });
      }
    } catch (error) {
      console.error('[ApiStore] 读取云端 API Key 失败:', error);
    }
  }

  /** 把旧版遗留在 AsyncStorage 里的明文 apiKey 删掉（双保险）。 */
  private async purgeLegacyKey() {
    try {
      const again = await AsyncStorage.getItem('ApiStore');
      if (!again) {
        return;
      }
      const parsed = JSON.parse(again);
      if (parsed && 'apiKey' in parsed) {
        delete parsed.apiKey;
        await AsyncStorage.setItem('ApiStore', JSON.stringify(parsed));
      }
    } catch {
      /* 忽略：清不掉也不影响功能（Keychain 才是权威存储） */
    }
  }

  setEnabled(v: boolean) {
    this.enabled = v;
  }

  setBaseUrl(v: string) {
    this.baseUrl = v.trim();
  }

  setModel(v: string) {
    this.model = v.trim();
  }

  setApiKey(v: string) {
    const key = v.trim();
    runInAction(() => {
      this.apiKey = key;
    });
    // fire-and-forget：UI 不等钥匙串；失败保留内存值（本次会话仍可用）
    Keychain.setGenericPassword('cloud-api', key, {
      service: KEYCHAIN_SERVICE,
    }).catch(err =>
      console.error('[ApiStore] 保存 API Key 到钥匙串失败:', err),
    );
  }

  async clearApiKey() {
    runInAction(() => {
      this.apiKey = '';
    });
    try {
      await Keychain.resetGenericPassword({service: KEYCHAIN_SERVICE});
    } catch (error) {
      console.error('[ApiStore] 清除 API Key 失败:', error);
    }
  }

  /** 是否已配置并可启用 */
  get ready() {
    return this.enabled && this.apiKey.length > 0 && this.baseUrl.length > 0;
  }
}

export const apiStore = new ApiStore();
