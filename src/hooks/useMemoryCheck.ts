import React, {useEffect, useState} from 'react';
import DeviceInfo from 'react-native-device-info';
import {L10nContext, formatBytes} from '../utils';
import {t} from '../locales';
import {Model, ContextInitParams} from '../utils/types';
import {isHighEndDevice} from '../utils/deviceCapabilities';
import {getModelMemoryRequirement} from '../utils/memoryEstimator';
// Note: This creates a circular dependency with ModelStore (which imports hasEnoughMemory).
// This is intentional and runtime-safe because:
// 1. modelStore is instantiated after class definition
// 2. hasEnoughMemory is only called at runtime, not during module initialization
import {modelStore} from '../store';
import {MemoryFitStatus} from '../utils/memoryDisplay';

/**
 * Check if there's enough memory to load a model.
 *
 * Uses calibrated ceiling from ModelStore (max of largestSuccessfulLoad, availableMemoryCeiling).
 *
 * @param model - The model to check
 * @param projectionModel - Optional mmproj model for multimodal
 * @param draftModel - Optional speculative draft model loaded alongside the target
 * @returns true if device has enough memory
 */
export const hasEnoughMemory = async (
  model: Model,
  projectionModel?: Model,
  draftModel?: Model,
): Promise<boolean> => {
  // Try to fetch GGUF metadata if not available but model is downloaded
  // After fetching, get the updated model from store (if it exists there)
  let modelForCalc = model;
  if (!model.ggufMetadata && model.isDownloaded) {
    try {
      await modelStore.fetchAndPersistGGUFMetadata(model);
      // Get updated model from store (metadata is persisted there)
      const updatedModel = modelStore.models.find(m => m.id === model.id);
      if (updatedModel) {
        modelForCalc = updatedModel;
      }
    } catch {
      // Continue with fallback estimation
    }
  }

  // Get calibration data from ModelStore
  const {largestSuccessfulLoad, availableMemoryCeiling} = modelStore;

  // 系统信号：设备当前实际空闲的内存。
  //
  // ⚠️ 以前 ceiling 只取 max(largestSuccessfulLoad, availableMemoryCeiling)，
  // 这两个都是**历史校准值**（这台机器成功加载过的最大模型）——
  // 它证明「至少能加载这么大」，但**不是上限**。
  //
  // 副作用：只加载过小模型的设备，校准值会一直卡在那个小值上，
  // 之后导入更大的模型就被拦（「内存不够」），哪怕手机还有好几个 G 空闲。
  // 2026-10-19 用户实测：手机显示 5GB+ 可用，App 只认 3GB。
  //
  // ⚠️ 不能用 DeviceInfo.getUsedMemory() 推 free —— 那个在 Android 上返回的是
  // **JVM 堆**（Runtime.totalMemory - Runtime.freeMemory），不是系统占用，
  // 拿它算出来的「空闲」会严重虚高，直接导致 OOM。所以这里用总量的保守比例。
  const totalMemory = await DeviceInfo.getTotalMemory();
  // 单 App 可用上限的经验比例：总量的 75%（其余给系统 + 其他 App）。
  // 只加载文本模型时 llama.cpp 还会额外吃上下文/KV cache，但 checkMemoryAndConfirm
  // 会给用户「继续/取消」的选择，不硬拦。
  const systemCeiling = totalMemory * 0.75;

  // 校准值与系统信号谁大用谁：历史证据更可信，但系统上限明显更大时信系统
  const ceiling = Math.max(
    largestSuccessfulLoad ?? 0,
    availableMemoryCeiling ?? 0,
    systemCeiling,
  );

  const memoryRequirement = getModelMemoryRequirement(
    modelForCalc,
    projectionModel,
    modelStore.contextInitParams,
    draftModel,
  );

  return memoryRequirement <= ceiling;
};

/**
 * Get memory fit status with details
 */
async function getMemoryFitDetails(
  model: Model,
  projectionModel: Model | undefined,
  contextInitParams: ContextInitParams,
  draftModel?: Model,
): Promise<{
  status: MemoryFitStatus;
  requiredBytes: number;
  availableBytes: number;
}> {
  // Get memory requirement
  const requiredBytes = getModelMemoryRequirement(
    model,
    projectionModel,
    contextInitParams,
    draftModel,
  );

  // Get device total memory
  const totalMemory = await DeviceInfo.getTotalMemory();

  // 与 hasEnoughMemory 同一套口径：历史校准值是「下界证据」不是上限。
  // 否则 UI 上显示的数字会和实际判定不一致。
  // 不能用 getUsedMemory() 推 free —— 那是 JVM 堆，不是系统占用。
  const availableBytes = Math.max(
    modelStore.largestSuccessfulLoad ?? 0,
    modelStore.availableMemoryCeiling ?? 0,
    totalMemory * 0.75,
  );

  // Determine status
  let status: MemoryFitStatus;
  if (requiredBytes <= availableBytes) {
    status = 'fits';
  } else if (requiredBytes <= totalMemory) {
    status = 'tight';
  } else {
    status = 'wont_fit';
  }

  return {status, requiredBytes, availableBytes};
}

/**
 * Hook for checking memory availability for a model.
 *
 * @param model - The model to check (or a partial model with at least size)
 * @param projectionModel - Optional mmproj model for multimodal
 * @param draftModel - Optional speculative draft model loaded alongside the target
 */
export const useMemoryCheck = (
  model: Model | {size: number; supportsMultimodal?: boolean},
  projectionModel?: Model,
  draftModel?: Model,
) => {
  const l10n = React.useContext(L10nContext);
  const [memoryWarning, setMemoryWarning] = useState('');
  const [shortMemoryWarning, setShortMemoryWarning] = useState('');
  const [multimodalWarning, setMultimodalWarning] = useState('');
  const [fitStatus, setFitStatus] = useState<MemoryFitStatus>('fits');

  // Read MobX observables during render so changes trigger re-render in observer components
  // This also creates a stable dependency for useEffect
  const calibrationCeiling = Math.max(
    modelStore.largestSuccessfulLoad ?? 0,
    modelStore.availableMemoryCeiling ?? 0,
  );

  // Read context settings that affect memory estimation
  // This ensures the hook re-runs when user changes context size, cache types, etc.
  const contextInitParams = modelStore.contextInitParams;

  useEffect(() => {
    const checkMemory = async () => {
      // Reset warnings first
      setMemoryWarning('');
      setShortMemoryWarning('');
      setMultimodalWarning('');
      setFitStatus('fits');

      try {
        const {status, requiredBytes, availableBytes} =
          await getMemoryFitDetails(
            model as Model,
            projectionModel,
            contextInitParams,
            draftModel,
          );

        setFitStatus(status);

        if (status === 'tight') {
          // Concise badge text
          setShortMemoryWarning(l10n.memory.memoryTight);
          // Detailed message with numbers
          const neededText = formatBytes(requiredBytes, 1);
          const availableText = formatBytes(availableBytes, 1);
          setMemoryWarning(
            t(l10n.memory.memoryDetailMessage, {
              needed: neededText,
              available: availableText,
            }),
          );
        } else if (status === 'wont_fit') {
          // Concise badge text
          setShortMemoryWarning(l10n.memory.lowMemory);
          // Detailed message with numbers
          const neededText = formatBytes(requiredBytes, 1);
          const availableText = formatBytes(availableBytes, 1);
          setMemoryWarning(
            t(l10n.memory.memoryDetailMessage, {
              needed: neededText,
              available: availableText,
            }),
          );
        }

        // Additional check for multimodal capability
        const isMultimodal =
          'supportsMultimodal' in model && model.supportsMultimodal;
        if (isMultimodal) {
          const isCapable = await isHighEndDevice();
          if (!isCapable) {
            setMultimodalWarning(l10n.memory.multimodalWarning);
          }
        }
      } catch (error) {
        // Clear all warnings when there's an error
        setMemoryWarning('');
        setShortMemoryWarning('');
        setMultimodalWarning('');
        setFitStatus('fits');
        console.error('Memory check failed:', error);
      }
    };

    checkMemory();
  }, [
    model,
    projectionModel,
    draftModel,
    l10n,
    calibrationCeiling,
    contextInitParams,
  ]);

  return {memoryWarning, shortMemoryWarning, multimodalWarning, fitStatus};
};
