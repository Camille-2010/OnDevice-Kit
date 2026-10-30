# 踩坑记录（Pitfalls）

本文件汇总开发中遇到的技术坑与解决方案，供后续维护参考。所有机型/路径均做泛化处理。

---

## 1. 液态玻璃弹窗：必须用页面内覆盖层

- **现象**：弹窗一打开就红屏 `useBottomSheetInternal cannot be used out of the BottomSheet!`。
- **根因**：用了 gorhom `Sheet` / `BottomSheetModal`（底层是独立 RN Modal 窗口），其子组件（如 `Sheet.ScrollView` → `BottomSheetKeyboardAwareScrollView`）在 BottomSheet context 之外渲染时抛错；同时独立窗口采不到页面壁纸，玻璃会发白。
- **解法**：所有玻璃弹窗改用 `AnimatedSheet inPage`（页面内覆盖层）+ `SheetGlass`；滚动容器用 RN 原生 `ScrollView`，不要用 `Sheet.ScrollView`。

## 2. 原生 AGSL 玻璃在覆盖层里采样不到背景 → 面板全透明

- **现象**：部分 API 34 机型上，弹窗面板全透明，文字和页面内容叠在一起。
- **根因**：原生 AGSL 玻璃（`LiquidGlassView`）在 inPage 覆盖层里采样不到背后内容。
- **解法**：`GlassSurface` 增加 `forceFrosted`，`SheetGlass` 默认强制走**磨砂路径**（不依赖原生抓屏，任何 ROM 都稳定），并配合较高的 `tintOpacity` 兜底，即使模糊失效也不透明。

## 3. 磨砂「真模糊」：叠在色调层下方

- **要点**：磨砂路径下，在色调层**下面**再叠一层 `BlurView`（`@sbaiahmed1/react-native-blur`，底层是原生 box blur + 降采样，不是 RenderScript，API 29 也够快）。顺序不能反，否则模糊被色调一起压掉。
- **性能**：仅弹窗/大面板开启真模糊；普通卡片保持「半透明 tint + 高光描边」的轻磨砂，避免一屏几十张同时 blur 掉帧。

## 4. BlurView 取不到时要 try/catch

- **现象**：原生模块没打进 APK 时 `BlurView` 为 `undefined`，直接渲染红屏 `Element type is invalid`。
- **解法**：`require` 包在 try/catch 里，取不到就退化为「不模糊」，不崩。

## 5. HuggingFace 大文件下载在国内连不上（Xet）

- **现象**：`/resolve/` 链接 302 跳转到 `cas-bridge.xethub.hf.co`，国内直连超时；hf-mirror 只是转发同一个 302，救不了。
- **解法**：下载前先做可达性探测（Range `0-0`），优先国内可达源（如 ModelScope），失败回退 HF；模型搜索/文件列表 API 加「官方超时 → 镜像重试」的 fallback（镜像请求不带 token）。

## 6. 3D 图标模糊

- **根因**：源图只有 256×256；高 DPI 机型上按设计尺寸放大后超过源图像素 → 重采样糊。
- **解法**：渲染尺寸取整，并钳制在 `256 / PixelRatio.get()` 以内（宁小 1~2dp 也不放大）。

## 7. 3D 图标发灰 / 像有一层背景

- **根因**：部分 PNG 的最大 alpha < 255（线条从不透明渐变到半透明），叠在浅色玻璃卡上像一层淡背景。
- **解法**：按 `255 / maxAlpha`（设上限）整体提亮至实心；透明线稿类图标不要动。

## 8. 图标被圆角裁切

- **根因**：图标贴边（`right:0`）+ 父级 `overflow:hidden` + 圆角 → 角被切掉一块。
- **解法**：留出内边距（如 `right:8`），或适当缩小图标并提高不透明度。

## 9. 弹窗太亮 / 文字被冲淡

- **根因**：弹窗底版不透明度太低，亮色壁纸透进来把文字冲淡（液态玻璃模式特有）。
- **解法**：底版用弹窗专用沉灰 tint + 模糊；不透明度取 **0.7 左右 + blur** 的平衡点（拉到 0.86 会太实、失去玻璃感）。

## 10. Metro 调试（Windows + Git Bash）

- 后台任务面板显示 `failed` 的 Metro 进程可能仍存活，以 `netstat` 查 8081 监听 PID 为准。
- Git Bash 会把 `/F` 当路径，强杀进程用 `MSYS_NO_PATHCONV=1 taskkill /F /PID <pid>`。
- `--reset-cache` 首次 bundle 很慢；代码改动已在盘时靠文件 watcher 即可，不必反复 reset。
- 新架构下设备端 dev bundle 落在应用私有目录的 `BridgelessReactNativeDevBundle.js`，可 grep 特征串验证版本。

## 11. 端侧文生图（stable-diffusion.cpp）

- 二进制是 **OpenCL 构建**，不要传 `-vulkan`（未知参数直接报错）。
- GPU 兼容性出问题时用 CPU 逃生门：`--backend diffusion=CPU,te=CPU,vae=CPU`。
- 模型用单文件 GGUF；显存/内存不足时优先更小的量化档位。

## 12. 视觉多模态在部分机型卡死

- **现象**：`initMultimodal` 成功、图片也能 tokenize，但前向推理不返回、界面一直转圈。
- **解法**：把视觉投影层（projector）固定到 CPU 推理，规避 GPU 前向不返回；文本生成仍按设置走 GPU。

---

> 说明：以上均为通用工程经验，不含任何设备标识、账号或私有路径。
