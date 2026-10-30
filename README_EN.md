# OnDevice Kit

An on-device AI toolkit for Android. Seven capabilities run locally by default and all also support a cloud mode — offline on-device, cloud-enhanced on demand, switchable at any time.

---

## 1. Capabilities

- **Chat** — run GGUF LLMs locally with streaming output, multi-turn context and tool calling; or connect to a cloud OpenAI-compatible API. Local is fully offline; cloud offers larger, stronger models. Switch per scenario.
- **Vision** — after taking or picking a photo, recognize content, describe the scene and answer questions about it; local multimodal inference or a cloud vision API.
- **Image generation** — generate images from a prompt with adjustable steps, size, sampler and seed, live sampling progress and cancellation; on-device inference or a cloud A1111-compatible service.
- **Text-to-speech** — convert text to speech with multiple voices and optional auto voice-over for chat; local neural engines or cloud TTS.
- **Voice cloning** — clone a target voice from a few samples and synthesize speech; on-device inference or a cloud cloning service.
- **Voice conversion** — convert a source voice into a target timbre for character dubbing; local or cloud.
- **Image upscaling / enhancement** — upscale, denoise, sharpen, enhance color and soften portraits; local ONNX inference or a cloud enhancement service.

Every capability follows the same "local / cloud" dual-mode model: local guarantees offline operation and privacy; cloud adds compute or quality.

---

## 2. Architecture (four layers)

- **Application** — React Native (Fabric) + MobX state + WatermelonDB persistence; `AgentRunner` drives each turn's streaming tokens, tool calls and result re-injection.
- **Bridge** — `llama.rn` connects to llama.cpp over JSI; `onnxruntime-react-native` handles vision / speech / upscaling / cloning; the in-house `SdGenModule` drives stable-diffusion.cpp as a subprocess.
- **Inference** — llama.cpp (GGUF LLM / vision), ONNX Runtime (speech / upscaling / cloning / conversion), stable-diffusion.cpp (text-to-image); the cloud side uses standard HTTP APIs.
- **Hardware** — CPU fallback, GPU (Android OpenCL / Adreno), NPU; graceful degradation when a backend is unavailable.

---

## 3. Key implementation details

- **Device-tier classification** — a rule engine classifies devices as low / mid / high / flagship from CPU / GPU / memory, driving model recommendations, GPU layer count and image-gen quantization.
- **Download pipeline** — a unified resumable manager; mainland-China mirrors first with source fallback; weights use exact byte verification and fall back to resources bundled in the APK when offline.
- **Image-gen quantization** — automatically selects a "memory-saving / high-quality" tier by device class; low-end prioritizes memory, high-end prioritizes quality.
- **Vision encoder pinned to CPU** — the multimodal projector is forced to CPU to avoid a GPU forward-pass hang on some devices.
- **Streaming and watchdogs** — tiered first-token / silence watchdogs; media tasks get a wider but bounded timeout to avoid indefinite waits.
- **Dual-mode routing** — local and cloud share one capability interface, switched by settings or availability, transparent to the UI and callers.

---

## 4. Tech stack

- **Framework** — React Native `0.82.1` · React `19.1.1` (New Architecture / Fabric)
- **Language** — TypeScript `5.0.4`
- **State / persistence** — MobX 6 · WatermelonDB · AsyncStorage · Keychain
- **Inference** — `llama.rn` (llama.cpp) · `onnxruntime-react-native` · `react-native-speech` · stable-diffusion.cpp
- **Tooling** — Yarn 1 · ESLint · Prettier · Jest · Husky + Commitlint

---

## 5. Native modules (Android / Kotlin)

In `android/app/src/main/java/com/pocketpalai/`:

- `SdGenModule` — text-to-image subprocess with progress events and cancellation.
- `AudioRecorderModule` — audio capture.
- `ContentUriModule` — safe Content URI reading.
- `Download*` — resumable download manager.
- `HardwareInfoModule` — CPU / GPU / NPU / memory probing.
- `KeepAwakeModule` — keeps the screen on during inference.

---

## 6. Build

- Install dependencies: `yarn install`
- Start Metro: `yarn start`
- Run on device: `yarn android`
- Release APK: `cd android && ./gradlew assembleProdRelease --no-daemon`
- Output: `android/app/build/outputs/apk/prod/release/app-prod-release.apk`

Quality gates: `yarn lint` · `yarn typecheck` · `yarn test`.

Rebuild after changing `package.json`, native modules or `android/` config; release builds do not connect to Metro.

---

## 7. License

A derivative of PocketPal AI (MIT), inheriting the MIT license. Thanks: llama.cpp, llama.rn, ONNX Runtime, react-native-speech, stable-diffusion.cpp, Iconoir.
