/**
 * Jest 桩：onnxruntime-react-native 的入口在 import 阶段就去装载原生
 * binding（binding.js 里 `undefined.install()`），测试环境没有原生库，
 * 任何走到 `superRes → ImageEnhanceScreen → screens/index → App` 的
 * 测试都会在 import 时崩（"Test suite failed to run"）。
 * 这里只保证「可导入」；真推理只在真机/模拟器上跑，没有单测覆盖它。
 */
class Tensor {
  constructor(type, data, dims) {
    this.type = type;
    this.data = data;
    this.dims = dims;
  }
}

const InferenceSession = {
  create: async () => {
    throw new Error('onnxruntime-react-native is mocked in tests');
  },
};

module.exports = {InferenceSession, Tensor};
