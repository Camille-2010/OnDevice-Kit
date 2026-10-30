import Speech from '@pocketpalai/react-native-speech';

/**
 * 系统 TTS 引擎选择。
 *
 * 【为什么需要这个】
 *   Android 的 `TextToSpeech(context, listener)` 不传引擎包名时用系统默认引擎，
 *   而默认引擎来自 `Settings.Secure.TTS_DEFAULT_SYNTH`。部分国产 ROM（实测小米
 *   12S Ultra，MIUI）**这个设置是空的、也没装 Google TTS** → 绑定失败 →
 *   `onInit(ERROR)` → 原生模块重试 3 次后报 "Failed to initialize TTS engine"，
 *   系统 TTS 整个不可用。
 *   但设备上其实装着可用的引擎（小米：com.xiaomi.mibrain.speech，唯一的
 *   TTS_SERVICE，exported 无权限）—— 显式传包名就能 bind 上。
 *
 * 【策略】
 *   1. 先试默认引擎：`getEngines()` 会触发原生初始化，成功则直接用它
 *      （顺带拿到全设备引擎列表）。
 *   2. 默认引擎不可用 → 按候选包名逐个 `setEngine()` + `getEngines()` 验证。
 *      原生 setEngine 在「从未初始化成功过」时不校验包名是否存在，所以这条
 *      路走得通；bind 失败会重试后 reject，自动换下一个。
 *
 * 选定结果在本模块内缓存，一次会话只探一次。
 */

/** 常见国产/海外 TTS 引擎包名，按命中概率排序 */
const OS_ENGINE_CANDIDATES = [
  'com.xiaomi.mibrain.speech', // 小米 MIUI（小爱语音引擎）
  'com.google.android.tts', // AOSP / 谷歌
  'com.iflytek.speechsuite', // 讯飞
  'com.baidu.tts', // 百度
];

let selectedPackage: string | null = null;
let probePromise: Promise<string | null> | null = null;

/** 默认引擎是否可用；可用则返回该引擎包名 */
const tryDefaultEngine = async (): Promise<string | null> => {
  try {
    const engines = await Speech.getEngines();
    if (engines.length === 0) {
      return null;
    }
    const def = engines.find(e => e.isDefault);
    if (def) {
      return def.name;
    }
    // 没有默认标记：按候选优先级挑，否则用列表第一个
    for (const pkg of OS_ENGINE_CANDIDATES) {
      if (engines.some(e => e.name === pkg)) {
        return pkg;
      }
    }
    return engines[0].name;
  } catch {
    // 默认引擎绑定失败（如小米未设置默认 TTS 引擎）→ 走候选包名
    return null;
  }
};

/** 逐个尝试候选引擎包名，返回第一个能绑定成功的 */
const tryCandidateEngines = async (): Promise<string | null> => {
  for (const pkg of OS_ENGINE_CANDIDATES) {
    try {
      await Speech.setEngine(pkg);
      // 验证初始化真的成功了（bind 失败会 reject）
      await Speech.getEngines();
      return pkg;
    } catch {
      // 这个包名不可用，换下一个
    }
  }
  return null;
};

/**
 * 确保原生 TTS 绑定到了一个可用引擎。返回引擎包名；设备上没有任何可用
 * TTS 引擎时返回 null。
 */
export const ensureSystemEngineReady = (): Promise<string | null> => {
  if (selectedPackage) {
    return Promise.resolve(selectedPackage);
  }
  if (!probePromise) {
    probePromise = (async () => {
      const viaDefault = await tryDefaultEngine();
      if (viaDefault) {
        return viaDefault;
      }
      return tryCandidateEngines();
    })()
      .then(pkg => {
        selectedPackage = pkg;
        return pkg;
      })
      .finally(() => {
        probePromise = null;
      });
  }
  return probePromise;
};
