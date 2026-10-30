/**
 * 运行环境守卫（安全加固）。
 *
 * 目标不是「绝对防住」——客户端没有绝对防线——而是抬高攻击成本、
 * 缩小暴露面：
 *   · Frida / 注入框架检测：这类动态插桩工具是「抓密钥、改逻辑」的
 *     主力。检测到就**不从钥匙串释放云端 API Key**（云功能静默降级，
 *     本地推理不受影响——本应用的主体本来就是离线的）。
 *   · root 检测只做记录不拦截：发烧友 root 是合法场景，误伤不可接受。
 *
 * 全部探测是异步、低开销、一次性缓存；失败兜底为「未发现风险」，
 * 永不因为检测本身把 App 搞挂。
 */
import RNFS from '@dr.pogodin/react-native-fs';

export interface ThreatReport {
  /** Frida server / 注入框架特征命中 */
  instrumentation: boolean;
  /** 设备已 root（仅记录） */
  rooted: boolean;
  /** 命中的特征明细（仅 __DEV__ 打日志用，release 不外泄） */
  hits: string[];
}

let cached: Promise<ThreatReport> | null = null;

/** 常见 root 管理器的二进制/目录特征 */
const ROOT_PATHS = [
  '/system/bin/su',
  '/system/xbin/su',
  '/sbin/su',
  '/system/app/Superuser.apk',
  '/system/bin/magisk',
  '/data/adb/magisk',
];

/** Xposed / 注入框架的特征文件（按包名路径） */
const HOOKER_PATHS = [
  '/data/app_deprecated/ivy',
  '/data/user/0/de.robv.android.xposed.installer',
  '/data/data/org.lsposed.manager',
  '/data/adb/lspd',
  '/data/adb/modules/zygisk_il2cppdumper',
];

/** 探测本地 Frida server 默认端口（27042 / 27043） */
const probeFridaPort = async (port: number): Promise<boolean> => {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 250);
    // Frida server 是裸 TCP；fetch 发 HTTP 也会收到 RST/响应，
    // 只要有任何「连接成功」的迹象即视为命中。
    await fetch(`http://127.0.0.1:${port}/`, {signal: ctrl.signal});
    clearTimeout(timer);
    return true;
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    // 网络错误说明端口没监听；「响应解析错误」说明有东西在监听
    return !/aborted|abort|network|failed to fetch|timeout/i.test(msg);
  }
};

const anyPathExists = async (paths: string[]): Promise<string[]> => {
  const hits: string[] = [];
  await Promise.all(
    paths.map(async p => {
      try {
        if (await RNFS.exists(p)) {
          hits.push(p);
        }
      } catch {
        /* 无权限读此路径：视为不存在 */
      }
    }),
  );
  return hits;
};

export const runSecurityCheck = (): Promise<ThreatReport> => {
  if (!cached) {
    cached = (async (): Promise<ThreatReport> => {
      const hits: string[] = [];
      try {
        const [fridaA, fridaB, rootHits, hookerHits] = await Promise.all([
          probeFridaPort(27042),
          probeFridaPort(27043),
          anyPathExists(ROOT_PATHS),
          anyPathExists(HOOKER_PATHS),
        ]);
        if (fridaA) {
          hits.push('frida:27042');
        }
        if (fridaB) {
          hits.push('frida:27043');
        }
        hits.push(...hookerHits);
        const report: ThreatReport = {
          instrumentation: hookerHits.length > 0 || fridaA || fridaB,
          rooted: rootHits.length > 0,
          hits,
        };
        if (__DEV__ && hits.length > 0) {
          console.warn('[security] 环境特征命中:', hits.join(', '));
        }
        return report;
      } catch {
        // 检测自身异常：放行（宁可漏报不可误杀）
        return {instrumentation: false, rooted: false, hits: []};
      }
    })();
  }
  return cached;
};

/**
 * 云端密钥的「放行闸」：检测到注入框架时拒绝从钥匙串加载 API Key。
 * 本地推理、本地模型不受任何影响。
 */
export const allowSecretAccess = async (): Promise<boolean> => {
  const report = await runSecurityCheck();
  return !report.instrumentation;
};
