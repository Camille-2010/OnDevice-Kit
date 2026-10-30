# GPT-SoVITS 端侧推理（ONNX）使用说明

> 更多 > GPT-SoVITS > **端侧 ONNX（本机推理）**

在手机上离线运行完整的 GPT-SoVITS v2（BERT 韵律 → GPT 语义自回归解码 → SoVITS 声码），
不联网、不需要电脑常驻。**默认角色：阿罗娜（中配）**，角色包随 APK 自带。

## 组成

| 部分 | 体积 | 来源 |
| --- | --- | --- |
| 角色包（参考音频 + 预计算特征） | ~440 KB | APK 内置（`android/app/src/main/assets/gsv/`） |
| bert.onnx（所有角色共享） | 599 MB | 首次导入/下载 |
| gpt_encoder / gpt_step / sovits.onnx（阿罗娜专属） | ~400 MB | 首次导入/下载 |

权重是一次性的：导入或下载完成后即可删除电脑端文件，之后完全离线。

## 权重导入（二选一）

**方式 A · 局域网下载（推荐）**

1. 电脑双击 `F:\gsv-minimal\启动模型服务.bat`（在 `onnx_arona_fp16` 目录起一个
   `python -m http.server 8000`）；
2. 手机与电脑连同一 Wi-Fi，App 里填 `http://电脑IP:8000` → 「从电脑下载」。

**方式 B · USB 拷贝**

把 4 个 `.onnx` 文件拷到手机 `Download/` 目录 → App 里点「从下载目录导入」。

## 使用

模型齐了之后引擎自动加载（约 1GB，首次十几秒），在「合成」卡输入**中文**文本
→ 合成并播放。页面显示 RTF 实测（推理耗时 ÷ 音频时长）。

## 当前限制（v1）

- 仅中文文本（英文/日文走云端引擎，拉丁字母会被剔除）；
- 多音字用 pinyin-pro 词典消歧（非 G2PW 神经模型），生僻搭配可能读错；
- 三声连读等词级变调未做（"你好"仍按字调）；
- 采样温度固定 1.0（top-k 50）；速度可在 store 调（默认 1.0）。

## 工程结构

```
src/services/gsv/onnx/
  g2pChinese.ts      中文文本 → GSV v2 音素符号（pinyin-pro + opencpop 表）
  wordpiece.ts       BERT tokenizer（每汉字一个 token，与 word2ph 对齐）
  half.ts            fp16/fp32 转换（KV cache 走 Uint16 原始位）
  packBinary.ts      角色包 .bin 的小端对齐读取
  gsvPipeline.ts     推理管线（OrtAdapter 抽象，Node/手机双端可跑）
  rnAdapter.ts       onnxruntime-react-native 绑定
  gsvFiles.ts        模型文件布局 / 资产解包 / 下载 / 导入
  wavOut.ts          PCM → 播放 / WAV 编码
  data/              生成数据：符号表、opencpop 映射、BERT 词表
src/store/GsvOnnxStore.ts   MobX store（下载/加载/合成/RTF）
src/screens/GptSovitsScreen/GsvOnnxLocalScreen.tsx   界面
```

PC 侧工具（F:/gsv-minimal）：

- `export_pack.py` — 给任意角色预计算角色包（复用 minimal_inference 的 ONNX 导出）；
- `export_onnx.py` / `onnx_to_fp16.py` — 权重导出与 fp16 转换（见 POC报告.md）；
- `js-test/run_test.ts` — Node 对拍管线（g2p 与 Python 金标 83.7%，e2e 出声验证）。

## 换角色 / 加角色

1. 在 PC 上用该角色的 ckpt/pth 跑 `export_onnx.py` → `onnx_to_fp16.py`
   （角色专属的只有 gpt_encoder/gpt_step/sovits 三个文件，bert 共享）；
2. 用该角色的一条参考音频 + 参考文本跑 `export_pack.py` 生成角色包；
3. 角色包放 `assets/gsv/packs/<role>/` 重新打包，或做成后续的在线角色市场。

许可提醒：碧蓝档案权重来自 SLNeil 的免费二创配布，禁止商用。
