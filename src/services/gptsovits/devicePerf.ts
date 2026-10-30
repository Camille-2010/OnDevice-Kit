import DeviceInfo from 'react-native-device-info';

/**
 * 设备性能评估 —— 用来判断「本地 ONNX 推理」在这台手机上能不能流畅跑。
 *
 * 【为什么要评估】
 *   GPT-SoVITS 这类模型在手机上跑本地推理，速度完全取决于 SoC / 内存 / 散热。
 *   同一份模型在骁龙 8 Gen3 上流畅，在低端机上可能比实时还慢（RTF > 1，
 *   也就是合成 3 秒音频要等 5 秒）。所以本地模式必须在界面上明确告诉用户
 *   「你这台机器行不行」，而不是让人干等。
 *
 * 【评估依据】全部是真实读取的信号，不编造：
 *   - SoC 型号（DeviceInfo.getHardware，如 mt6983 / SM8650）
 *   - 物理内存（getTotalMemory）
 *   - 可用存储（getFreeDiskStorage，模型要占地方）
 *   - 系统是否判定为低内存设备（isLowRamDevice）
 *
 * 【最重要的裁决手段】RTF 实测
 *   静态指标只是预判，真正说了算的是「实测一次」。
 *   RTF（Real Time Factor）= 推理耗时 / 音频时长：
 *     RTF < 1   快于实时 → 流畅
 *     RTF 1~1.5 接近实时 → 可用，会有等待感
 *     RTF > 1.5 比实时慢 → 不建议本地，请走云端
 *   store 里跑完一次合成就会把真实 RTF 记到 measurement 里，界面据此下结论。
 */

export type PerfTier = 'unknown' | 'fast' | 'usable' | 'struggling';

export interface DevicePerfFacts {
  model: string;
  hardware: string;
  /** SoC 归一化后的判定位（snapdragon / mediatek / unknown…） */
  socFamily: string;
  totalMemoryGb: number;
  freeDiskGb: number;
  isLowRamDevice: boolean;
}

export interface PerfAssessment {
  tier: PerfTier;
  /** 面向用户的一句话结论 */
  verdict: string;
  /** 列出判定依据，界面上要显示出来，不能只给结论 */
  reasons: string[];
  facts: DevicePerfFacts;
}

/** 真实 RTF 实测结果 */
export interface RtfMeasurement {
  /** 推理耗时 ms */
  elapsedMs: number;
  /** 合成音频时长 ms */
  audioMs: number;
  /** RTF = elapsedMs / audioMs */
  rtf: number;
  /** 哪个引擎测出来的 */
  source: 'local-onnx' | 'cloud';
  at: number;
}

/** 按 RTF 换算档位（本地推理用；云端不受本机算力限制，所以云端另判） */
export const tierFromRtf = (rtf: number): PerfTier => {
  if (!Number.isFinite(rtf) || rtf <= 0) {
    return 'unknown';
  }
  if (rtf < 1) {
    return 'fast';
  }
  if (rtf <= 1.5) {
    return 'usable';
  }
  return 'struggling';
};

const TIER_TEXT: Record<PerfTier, string> = {
  unknown: '尚未评估，先跑一次实测再下结论',
  fast: '这台手机跑本地 ONNX 会比较流畅',
  usable: '这台手机能跑本地 ONNX，但合成时需要等一下',
  struggling: '这台手机跑本地 ONNX 会很吃力，建议改用云端',
};

/**
 * SoC 归一化。Android 的 hardware 字符串形如 "mt6983" / "SM8650" / "qcom"。
 * 未知型号一律归 unknown，交给内存/实测信号兜底，不硬猜。
 */
const socFamilyOf = (hardware: string): string => {
  const h = (hardware || '').toLowerCase();
  if (!h) {
    return 'unknown';
  }
  if (h.startsWith('qcom') || h.startsWith('sm')) {
    return 'qualcomm';
  }
  if (h.startsWith('mt') || h.startsWith('dimensity')) {
    return 'mediatek';
  }
  if (h.startsWith('exynos') || h.startsWith('samsung')) {
    return 'exynos';
  }
  if (h.startsWith('kirin') || h.startsWith('hi')) {
    return 'hisilicon';
  }
  if (h.includes('tensor')) {
    return 'tensor';
  }
  return 'unknown';
};

const gb = (bytes: number): number => bytes / 1024 ** 3;

/**
 * 采集真实性能信号并给出静态预判。
 *
 * 注意：这里的结论是「预判」。真正的裁决请看 store.measureRtf() 的实测结果。
 */
export const assessDevicePerf = async (): Promise<PerfAssessment> => {
  const [model, hardware, totalMemory, freeDisk, isLowRamDevice] =
    await Promise.all([
      DeviceInfo.getModel(),
      DeviceInfo.getHardware(),
      DeviceInfo.getTotalMemory(),
      DeviceInfo.getFreeDiskStorage('important'),
      DeviceInfo.isLowRamDevice(),
    ]);

  const facts: DevicePerfFacts = {
    model,
    hardware,
    socFamily: socFamilyOf(hardware),
    totalMemoryGb: gb(totalMemory),
    freeDiskGb: gb(freeDisk),
    isLowRamDevice,
  };

  const reasons: string[] = [
    `处理器 ${hardware || '未识别'}`,
    `内存 ${facts.totalMemoryGb.toFixed(1)}GB`,
    `可用存储 ${facts.freeDiskGb.toFixed(1)}GB`,
  ];

  // 存储不够放不下模型，直接判死
  if (facts.freeDiskGb < 2) {
    return {
      tier: 'struggling',
      verdict: `可用存储只剩 ${facts.freeDiskGb.toFixed(
        1,
      )}GB，放不下本地模型，请改用云端`,
      reasons: [...reasons, '本地 ONNX 模型至少需要约 2GB 可用空间'],
      facts,
    };
  }

  // 内存是本地大模型的第一道门槛
  if (facts.totalMemoryGb < 4) {
    reasons.push('内存低于 4GB，本地推理大概率被系统杀掉');
    return {
      tier: 'struggling',
      verdict: TIER_TEXT.struggling,
      reasons,
      facts,
    };
  }

  if (isLowRamDevice) {
    reasons.push('系统把本机判定为低内存设备');
  }

  if (facts.totalMemoryGb < 6) {
    reasons.push('内存低于 6GB');
    return {
      tier: 'struggling',
      verdict: TIER_TEXT.struggling,
      reasons,
      facts,
    };
  }

  if (facts.socFamily === 'unknown') {
    // 认不出 SoC 就只按内存给个中性偏保守的预判
    reasons.push('芯片型号不在已知列表，先按内存给出保守预判');
    return {
      tier: 'usable',
      verdict: TIER_TEXT.usable,
      reasons,
      facts,
    };
  }

  // 认得出 SoC 且内存 >= 6GB，静态上是可以跑的
  reasons.push('芯片与内存达到本地推理门槛');
  return {
    tier: 'fast',
    verdict: TIER_TEXT.fast,
    reasons,
    facts,
  };
};
