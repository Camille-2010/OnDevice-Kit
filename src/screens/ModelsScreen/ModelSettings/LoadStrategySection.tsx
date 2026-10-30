import React from 'react';
import {View, StyleSheet} from 'react-native';
import {Text, Chip} from 'react-native-paper';
import {GlassButton as Button} from '../../../components/GlassButton';
import Slider from '@react-native-community/slider';
import {observer} from 'mobx-react-lite';

import {modelStore} from '../../../store';
import {useTheme} from '../../../hooks';
import {describeOffload} from '../../../utils/modelKind';
import {createStyles} from './styles';

type MmapMode = 'true' | 'false' | 'smart';

const MMAP_OPTIONS: {value: MmapMode; label: string}[] = [
  {value: 'false', label: '关闭'},
  {value: 'smart', label: '智能'},
  {value: 'true', label: '开启'},
];

/**
 * 加载方式面板：内存映射（mmap）+ GPU 层数（部分层卸载）。
 *
 * 这两个参数由 llama.cpp 在 `initLlama` 建立 context 时读取一次，改完
 * 只是改了内存里的 `contextInitParams`，不重载就还是旧配置 —— 所以这里
 * 配一个显式的「重新加载」按钮，让设置真正落到 native 侧。
 *
 * GPU 层数语义：前 N 层放 GPU，其余层留在 CPU（N < 总层数即「部分卸载」）。
 */
export const LoadStrategySection: React.FC<{modelId?: string}> = observer(
  ({modelId}) => {
    const theme = useTheme();
    const base = createStyles(theme);
    const [reloading, setReloading] = React.useState(false);

    const model = modelId
      ? modelStore.models.find(m => m.id === modelId)
      : undefined;
    const params = modelStore.contextInitParams;
    const storedGpu = params.n_gpu_layers ?? 0;
    const nLayers = model?.ggufMetadata?.n_layers ?? 0;
    // 读不到总层数时退回到 99（llama.cpp 的惯例：99 ≈ 全部层）
    const maxLayers = nLayers > 0 ? nLayers : 99;
    const mmap = (params.use_mmap ?? 'smart') as MmapMode;
    const isActive = !!modelId && modelStore.activeModelId === modelId;

    // 滑杆用本地值驱动，松手才写 store：避免每帧触发 observable 更新
    const [sliderValue, setSliderValue] = React.useState(storedGpu);
    React.useEffect(() => {
      setSliderValue(Math.min(storedGpu, maxLayers));
    }, [storedGpu, maxLayers]);

    const onReload = async () => {
      setReloading(true);
      try {
        await modelStore.reloadActiveModelWithNewParams();
      } catch (e) {
        console.warn('[LoadStrategy] reload failed', e);
      } finally {
        setReloading(false);
      }
    };

    return (
      <View style={base.settingsSection} testID="load-strategy-section">
        <Text style={base.modelNameLabel}>加载方式</Text>

        {/*
          内存不够时最有效的三步，按「见效最快」排序。
          这是用户实际踩过的坑：同一个模型别的 App 能跑、我们报内存不足，
          根因就是 mmap 关着（权重全额进堆内存）。所以第一句话就说这个。
        */}
        <View style={local.tipBox}>
          <Text variant="labelSmall" style={local.tipTitle}>
            内存不足加载失败？按顺序试这三步
          </Text>
          <Text variant="labelSmall" style={local.tipText}>
            ①「内存映射」选
            {/* ⚠️ 这里必须是嵌套的 <Text>，不能写 HTML 的 <strong>。
                React Native 只认识自己的宿主组件（View / Text / Image…），
                <strong> 在原生侧没有对应的 view config，一渲染就抛
                「Unrecognized component」，整个「模型设置」弹窗直接白掉/红屏。
                加粗用 fontWeight 表达。 */}
            <Text style={local.tipEmphasis}>开启</Text>
            —— 这一步最关键。关闭时模型权重会被整个读进运行内存（一个 2.3GB
            的模型就实打实吃掉 2.3GB），开启后由系统按需调页、内存紧张时可回收。
            {'\n'}②把「上下文大小」调小（2048 → 1024），KV 缓存会成比例下降。
            {'\n'}③显存不够时把「GPU 层数」往左拖，剩下的层留在 CPU 上算。
          </Text>
        </View>

        <Text variant="labelSmall" style={local.label}>
          内存映射（mmap）
        </Text>
        <View style={local.chipRow}>
          {MMAP_OPTIONS.map(opt => (
            <Chip
              key={opt.value}
              compact
              selected={mmap === opt.value}
              onPress={() => modelStore.setUseMmap(opt.value)}
              style={local.chip}>
              {opt.label}
            </Chip>
          ))}
        </View>
        <Text variant="labelSmall" style={local.hint}>
          把模型文件直接映射进内存：加载更快、常驻内存更省。默认已开启；
          若某些机型加载异常，可改用「智能」让 llama.cpp 自行决定。
        </Text>

        <Text variant="labelSmall" style={local.hintStrong}>
          GPU 层数：
          {describeOffload(storedGpu, nLayers > 0 ? nLayers : undefined)}
        </Text>
        <Slider
          style={local.slider}
          value={Math.min(sliderValue, maxLayers)}
          minimumValue={0}
          maximumValue={maxLayers}
          step={1}
          onValueChange={setSliderValue}
          onSlidingComplete={v => modelStore.setNGPULayers(Math.round(v))}
          minimumTrackTintColor={theme.colors.primary}
          thumbTintColor={theme.colors.primary}
        />
        <Text variant="labelSmall" style={local.hint}>
          滑块调小即可把后面的层留在
          CPU（部分层卸载），显存不够时用这个办法把模型 跑起来。
        </Text>

        <Button
          mode="contained"
          onPress={onReload}
          loading={reloading}
          disabled={!isActive}
          style={local.reloadBtn}>
          {isActive ? '重新加载模型使设置生效' : '该模型未激活，加载后生效'}
        </Button>
      </View>
    );
  },
);

const local = StyleSheet.create({
  tipBox: {
    marginBottom: 14,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(59,130,246,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.22)',
  },
  tipTitle: {
    marginBottom: 6,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  tipText: {
    opacity: 0.9,
    lineHeight: 18,
  },
  // 替换原来的 HTML <strong>：嵌套 <Text> 只改字重，其它属性继承外层
  tipEmphasis: {
    fontWeight: '700',
  },
  label: {
    marginTop: 4,
    marginBottom: 6,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  chip: {
    minHeight: 32,
  },
  hint: {
    marginTop: 6,
    opacity: 0.72,
  },
  hintStrong: {
    marginTop: 14,
    marginBottom: 2,
  },
  slider: {
    marginHorizontal: -6,
  },
  reloadBtn: {
    marginTop: 14,
    borderRadius: 12,
  },
});
