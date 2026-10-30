# OnDevice Kit

OnDev-Kit 是Android 端侧AI工具箱。一个基于 PocketPal AI 二次开发的私有AI工具箱，集成了端云大模型、语音、图片交互与工具调用等核心能力。


---

OnDev-Kit is an AI toolkit based on the secondary development of PocketPal AI, integrating core capabilities such as end-cloud large models, voice, image interaction, and tool invocation.


## 1. Capabilities

- Chat — run GGUF LLMs locally with streaming output, multi-turn context and tool calling; or connect to a cloud OpenAI-compatible API. Local is fully offline; cloud offers larger, stronger models. Switch per scenario.

- Vision — after taking or picking a photo, recognize content, describe the scene and answer questions about it; local multimodal inference or a cloud vision API.

- Image generation — generate images from a prompt with adjustable steps, size, sampler and seed, live sampling progress and cancellation; on-device inference or a cloud A1111-compatible service.

- Text-to-speech — convert text to speech with multiple voices and optional auto voice-over for chat; local neural engines or cloud TTS.

- Voice cloning — clone a target voice from a few samples and synthesize speech; on-device inference or a cloud cloning service.

- Voice conversion — convert a source voice into a target timbre for character dubbing; local or cloud.

- Image upscaling / enhancement — upscale, denoise, sharpen, enhance color and soften portraits; local ONNX inference or a cloud enhancement service.
Every capability follows the same "local / cloud" dual-mode model: local guarantees offline operation and privacy; cloud adds compute or quality.


## 2. Architecture (four layers)


- Application — React Native (Fabric) + MobX state + WatermelonDB persistence; AgentRunner drives each turn's streaming tokens, tool calls and result re-injection.

- Bridge — llama.rn connects to llama.cpp over JSI; onnxruntime-react-native handles vision / speech / upscaling / cloning; the in-house SdGenModule drives stable-diffusion.cpp as a subprocess.

- Inference — llama.cpp (GGUF LLM / vision), ONNX Runtime (speech / upscaling / cloning / conversion), stable-diffusion.cpp (text-to-image); the cloud side uses standard HTTP APIs.

- Hardware — CPU fallback, GPU (Android OpenCL / Adreno), NPU; graceful degradation when a backend is unavailable.


## 3. Key implementation details


- Device-tier classification — a rule engine classifies devices as low / mid / high / flagship from CPU / GPU / memory, driving model recommendations, GPU layer count and image-gen quantization.

- Download pipeline — a unified resumable manager; mainland-China mirrors first with source fallback; weights use exact byte verification and fall back to resources bundled in the APK when offline.

- Image-gen quantization — automatically selects a "memory-saving / high-quality" tier by device class; low-end prioritizes memory, high-end prioritizes quality.

- Vision encoder pinned to CPU — the multimodal projector is forced to CPU to avoid a GPU forward-pass hang on some devices.

- Streaming and watchdogs — tiered first-token / 
silence watchdogs; media tasks get a wider but bounded timeout to avoid indefinite waits.

- Dual-mode routing — local and cloud share one capability interface, switched by settings or availability, transparent to the UI and callers.


## 4. Tech stack


- Framework — React Native 0.82.1 · React 19.1.1 (New Architecture / Fabric)

- Language — TypeScript 5.0.4

- State / persistence — MobX 6 · WatermelonDB · AsyncStorage · Keychain

- Inference — llama.rn (llama.cpp) · onnxruntime-react-native · react-native-speech · stable-diffusion.cpp

- Tooling — Yarn 1 · ESLint · Prettier · Jest · Husky + Commitlint


## 5. Native modules (Android / Kotlin)
In android/app/src/main/java/com/pocketpalai/:

- SdGenModule — text-to-image subprocess with progress events and cancellation.

- AudioRecorderModule — audio capture.

- ContentUriModule — safe Content URI reading.

- Download* — resumable download manager.

- HardwareInfoModule — CPU / GPU / NPU / memory probing.

- KeepAwakeModule — keeps the screen on during inference.


## 6. Build


- Install dependencies: yarn install
- Start Metro: yarn start
- Run on device: yarn android
- Release APK: cd android && ./gradlew assembleProdRelease --no-daemon
- Output: android/app/build/outputs/apk/prod/release/app-prod-release.apk

Quality gates: yarn lint · yarn typecheck · yarn test.

Rebuild after changing package.json, native modules or android/ config; release builds do not connect to Metro.


## 7. License


A derivative of PocketPal AI (MIT), inheriting the MIT license. Thanks: llama.cpp, llama.rn, ONNX Runtime, react-native-speech, stable-diffusion.cpp, Iconoir.


---


## 一、能力


- **对话** — 本地运行 GGUF 大模型，流式输出、多轮上下文、工具调用；也可接云端 OpenAI 兼容 API。本地完全离线，云端模型更大更强，按场景切换。

- **图像识别** — 拍照或选图后识别内容、描述画面、就图问答；本地多模态推理或云端视觉 API 两种模式。

- **文生图** — 输入提示词生成图片，可调步数、尺寸、采样器、种子，实时采样进度、可随时取消；本机端侧推理或云端 A1111 兼容服务。

- **语音合成** — 文字转语音，多音色可选，可为对话自动配音；本地神经引擎或云端 TTS。

- **语音克隆** — 用少量样本克隆目标音色并合成语音；本地端侧推理或云端克隆服务。

- **音色转换** — 把一段语音转换成目标音色，实现角色配音；本地或云端。

- **图像超分 / 增强** — 超分放大、去噪、锐化、色彩增强、人像柔化；本地 ONNX 推理或云端增强服务。

每一项都遵循同一套「本地 / 云端」双模式：本地保证离线与隐私，云端在算力或效果上补强。

---

## 二、技术架构（四层）


- **应用层** — React Native（Fabric）+ MobX 状态管理 + WatermelonDB 持久化；`AgentRunner` 驱动每轮对话的流式 token、工具调用与结果回灌。

- **桥接层** — `llama.rn` 经 JSI 直连 llama.cpp；`onnxruntime-react-native` 承载视觉 / 语音 / 超分 / 克隆；自研 `SdGenModule` 以子进程方式驱动 stable-diffusion.cpp。

- **推理层** — llama.cpp（GGUF 大 / 视觉）、ONNX Runtime（语音 / 超分 / 克隆 / 转换）、stable-diffusion.cpp（文生图）；云端侧统一走标准 HTTP API。

- **硬件层** — CPU 兜底、GPU（Android OpenCL / Adreno）、NPU；后端缺失时按可用性降级。

---

## 三、关键实现（工程细节）


- **设备档位判定** — 规则引擎按 CPU / GPU / 内存分类为 low / mid / high / flagship，驱动模型推荐、GPU 层数与文生图量化档位。

- **模型下载管线** — 统一走断点续传管理器；国内优先镜像，失败回退源站；权重带精确字节校验，网络不可用时回退 APK 内置资源。

- **文生图量化选型** — 按档位自动选择「省内存 / 高质量」两档量化，低端机优先省内存，高端机优先画质。

- **视觉编码器固定 CPU** — 多模态投影层强制 CPU，规避部
分机型 GPU 前向不返回导致的卡死。

- **流式与看门狗** — 首 token / 静默超时分级看门狗；带图任务单独放宽并设上限，避免无限等待。

- **双模式路由** — 本地与云端共用一套能力接口，按设置或可用性切换，UI 与调用方无感。

---


## 四、技术栈


- **框架** — React Native `0.82.1` · React `19.1.1`（New Architecture / Fabric）

- **语言** — TypeScript `5.0.4`

- **状态 / 持久化** — MobX 6 · WatermelonDB · AsyncStorage · Keychain

- **推理** — `llama.rn`（llama.cpp）· `onnxruntime-react-native` · `react-native-speech` · stable-diffusion.cpp

- **工具链** — Yarn 1 · ESLint · Prettier · Jest · Husky + Commitlint

---


## 五、原生模块（Android / Kotlin）


`android/app/src/main/java/com/pocketpalai/`：


- `SdGenModule` — 文生图子进程，进度事件回传，可取消。

- `AudioRecorderModule` — 录音采集。

- `ContentUriModule` — 安全读取 Content URI。

- `Download*` — 断点续传下载管理器。

- `HardwareInfoModule` — CPU / GPU / NPU / 内存探测。

- `KeepAwakeModule` — 推理期间保持常亮。

---


## 六、构建


- 安装依赖：`yarn install`
- 启动 Metro：`yarn start`
- 运行到设备：`yarn android`
- 发布包：`cd android && ./gradlew assembleProdRelease --no-daemon`
- 产物：`android/app/build/outputs/apk/prod/release/app-prod-release.apk`

质量门禁：`yarn lint` · `yarn typecheck` · `yarn test`。

改过 `package.json`、原生模块或 `android/` 配置后必须重新构建；Release 包不连 Metro。

---

## 七、许可

在 PocketPal AI（MIT）基础上二次开发，继承 MIT 许可。致谢：llama.cpp、llama.rn、ONNX Runtime、react-native-speech、stable-diffusion.cpp、Iconoir。
