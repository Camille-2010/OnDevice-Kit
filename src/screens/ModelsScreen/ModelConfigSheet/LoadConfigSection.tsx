import React from 'react';
import {View, StyleSheet, TouchableOpacity} from 'react-native';
import {Text} from 'react-native-paper';
import {GlassButton as Button} from '../../../components/GlassButton';
import {ThickTrackSlider} from '../../../components/ThickTrackSlider';
import {observer} from 'mobx-react-lite';

import {modelStore} from '../../../store';
import {useTheme} from '../../../hooks';
import {describeOffload} from '../../../utils/modelKind';
import {Model} from '../../../utils/types';
import {
  cardBg,
  buttonRing,
  glassButton,
  dialogGlassTint,
} from '../../../theme/cards';
import {SurfaceCard} from '../../../components/GlassSurface';
import {defaultGpuLayersForTier} from '../../../utils/contextInitParamsVersions';

/**
 * 每一项设置都做成一张卡片。
 *
 * 弹窗的整块面板是液态玻璃，内层卡片用 SurfaceCard：液态玻璃风格下渲染成
 * 真玻璃（玻璃叠玻璃，边缘高光 RimWidth 加大以区分层级），其他风格仍是
 * 原来的浅灰实底卡 —— 两种风格零分支。
 */
const rowCard = (theme: ReturnType<typeof useTheme>) => ({
  backgroundColor: cardBg(theme),
  // 14 -> 16：内层卡片也跟着更圆一点，和窗口圆角呼应
  borderRadius: 16,
  // 卡片更紧凑：纵向 12 -> 9，横向 14 -> 12
  paddingHorizontal: 12,
  paddingVertical: 9,
});

/**
 * 「加载配置」区块。
 *
 * 这一组参数由 llama.cpp 在 `initLlama` 建立 context 时**读取一次**，
 * 改完只是改了内存里的 contextInitParams —— 不重载模型还是旧配置。
 * 所以底部配一个显式的「重新加载使设置生效」。
 *
 * 每个参数都是滑块 + 右侧数值：内存紧张时用户能一眼看到「上下文 2048」
 * 这类数字，也知道往哪拖。
 */

type MmapMode = 'true' | 'false' | 'smart';

const MMAP_OPTIONS: {value: MmapMode; label: string}[] = [
  {value: 'true', label: 'MMAP'},
  {value: 'smart', label: '智能'},
  {value: 'false', label: '关闭'},
];

/** 一个「标签 + 数值 + 滑块 + 说明」的参数行 */
const ParamSlider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  help?: string;
  onChange: (v: number) => void;
  onCommit: (v: number) => void;
}> = ({label, value, min, max, step = 1, help, onChange, onCommit}) => {
  const theme = useTheme();
  const [local, setLocal] = React.useState(value);

  React.useEffect(() => {
    setLocal(value);
  }, [value]);

  return (
    <SurfaceCard
      glassType="regular"
      tint={dialogGlassTint(theme)}
      tintOpacity={0.5}
      rimWidth={1.6}
      style={[localStyles.row, rowCard(theme)]}>
      <View style={localStyles.labelRow}>
        <Text
          style={{
            color: theme.colors.onSurface,
            fontSize: 12,
            fontWeight: '700',
          }}>
          {label}
        </Text>
        <Text
          style={{
            color: theme.colors.primary,
            fontSize: 12,
            fontWeight: '700',
          }}>
          {String(Math.round(local))}
        </Text>
      </View>
      <ThickTrackSlider
        style={localStyles.slider}
        value={Math.min(Math.max(local, min), max)}
        min={min}
        max={max}
        step={step}
        // 拖动时同步本地值：滑杆拇指跟手、上方数字实时跟随；
        // 松手（onSlidingComplete）才真正写回 store。
        onValueChange={v => {
          setLocal(v);
          onChange(v);
        }}
        onSlidingComplete={onCommit}
      />
      {help ? <Text style={localStyles.help}>{help}</Text> : null}
    </SurfaceCard>
  );
};

/**
 * 「加载配置」底部的固定操作条。
 *
 * 从 LoadConfigSection 里抽出来的原因：这两个按钮原来**在滚动内容里**，
 * 往下滑就跟着滚走了。现在由 ModelConfigSheet 放在卡片底部固定区域，
 * 只有中间的配置项滚动 —— 和参考设计一致。
 */
export const LoadConfigActions: React.FC<{model: Model}> = observer(
  ({model}) => {
    // 按钮外圈高光需要主题色（buttonRing）
    const theme = useTheme();
    const [reloading, setReloading] = React.useState(false);
    const isActive = modelStore.activeModelId === model.id;

    const onReload = async () => {
      setReloading(true);
      try {
        await modelStore.reloadActiveModelWithNewParams();
      } catch (e) {
        console.warn('[LoadConfig] reload failed', e);
      } finally {
        setReloading(false);
      }
    };

    const resetDefaults = () => {
      modelStore.setNContext(2048);
      modelStore.setNThreads(4);
      modelStore.setNBatch(512);
      modelStore.setNUBatch(512);
      modelStore.setNGPULayers(99);
      modelStore.setUseMmap('true');
    };

    return (
      <>
        <Button
          mode="outlined"
          onPress={resetDefaults}
          labelStyle={{fontSize: 11}}
          style={[
            localStyles.secondaryBtn,
            glassButton(theme),
            {borderWidth: 1, borderColor: buttonRing(theme)},
          ]}>
          重置为默认
        </Button>
        <Button
          mode="contained"
          onPress={onReload}
          loading={reloading}
          disabled={!isActive}
          labelStyle={{fontSize: 11}}
          textColor={theme.colors.primary}
          style={[
            localStyles.primaryBtn,
            glassButton(theme, 'filled'),
            {borderWidth: 1, borderColor: buttonRing(theme)},
          ]}>
          {isActive ? '重新加载模型使设置生效' : '该模型未激活，加载后生效'}
        </Button>
      </>
    );
  },
);

export const LoadConfigSection: React.FC<{model: Model}> = observer(
  ({model}) => {
    const theme = useTheme();
    const [mmapMenu, setMmapMenu] = React.useState(false);

    const params = modelStore.contextInitParams;
    const nLayers = model.ggufMetadata?.n_layers ?? 0;

    const nGpu = params.n_gpu_layers ?? 0;
    const mmap = (params.use_mmap ?? 'smart') as MmapMode;
    const mmapLabel = MMAP_OPTIONS.find(o => o.value === mmap)?.label ?? 'MMAP';

    // 线程数上限按 CPU 核数给，超过没有意义
    const maxThreads = Math.max(modelStore.max_threads ?? 4, 4);

    // 本机档位推荐的 GPU 层数（任何档位都不给满）
    const tier = modelStore.deviceTier;
    const tierGpu = defaultGpuLayersForTier(tier);
    const tierLabel =
      tier === 'flagship'
        ? '旗舰'
        : tier === 'high'
          ? '高'
          : tier === 'mid'
            ? '中'
            : tier === 'low'
              ? '低'
              : '未知';

    return (
      <View>
        <SurfaceCard
          tint="#3B82F6"
          tintOpacity={0.14}
          style={localStyles.tipBox}>
          <Text variant="labelSmall" style={localStyles.tipText}>
            模型加载时读取这些参数，一般用默认即可。内存不足时可调小上下文大小。
          </Text>
        </SurfaceCard>

        <ParamSlider
          label="上下文大小"
          value={params.n_ctx}
          min={512}
          max={32768}
          step={512}
          help={
            params.n_ctx > 4096
              ? '上下文越大越吃内存。手机端建议 2048～4096。'
              : undefined
          }
          onChange={() => undefined}
          onCommit={v => modelStore.setNContext(Math.round(v))}
        />

        <ParamSlider
          label="GPU 层数"
          value={nGpu}
          min={0}
          max={nLayers > 0 ? nLayers : 99}
          help={describeOffload(nGpu, nLayers > 0 ? nLayers : undefined)}
          onChange={() => undefined}
          onCommit={v => modelStore.setNGPULayers(Math.round(v))}
        />

        {/* 一键回到本机档位推荐值 */}
        <SurfaceCard
          glassType="regular"
          tint={dialogGlassTint(theme)}
          tintOpacity={0.5}
          rimWidth={1.6}
          style={[localStyles.gpuRow, rowCard(theme)]}>
          <View style={{flex: 1}}>
            <Text
              style={[localStyles.gpuTitle, {color: theme.colors.onSurface}]}>
              本机推荐：{tierGpu} 层
            </Text>
            <Text
              style={[
                localStyles.gpuHelp,
                {color: theme.colors.onSurfaceVariant},
              ]}>
              {tierLabel ? `设备档位 ${tierLabel}。` : ''}
              拉满容易显存不足闪退，建议留余量。
              {nGpu !== tierGpu ? '（当前值与推荐不同）' : ''}
            </Text>
          </View>
          <Button
            mode="outlined"
            compact
            disabled={nGpu === tierGpu}
            style={[
              glassButton(theme),
              {borderWidth: 1, borderColor: buttonRing(theme)},
            ]}
            onPress={() => modelStore.setNGPULayers(tierGpu)}>
            套用
          </Button>
        </SurfaceCard>

        <ParamSlider
          label="线程数"
          value={params.n_threads}
          min={1}
          max={maxThreads}
          help="一般设为 CPU 小核数量即可。"
          onChange={() => undefined}
          onCommit={v => modelStore.setNThreads(Math.round(v))}
        />

        <ParamSlider
          label="批处理大小"
          value={params.n_batch}
          min={32}
          max={2048}
          step={32}
          help="每次提交给模型的最大 token 数。越大预填充越快，也越占内存。"
          onChange={() => undefined}
          onCommit={v => modelStore.setNBatch(Math.round(v))}
        />

        <ParamSlider
          label="物理批处理大小"
          value={params.n_ubatch}
          min={32}
          max={2048}
          step={32}
          help="实际并行计算的批大小，显存紧张时可以适当调小。"
          onChange={() => undefined}
          onCommit={v => modelStore.setNUBatch(Math.round(v))}
        />

        {/* 加载模式 */}
        <SurfaceCard
          glassType="regular"
          tint={dialogGlassTint(theme)}
          tintOpacity={0.5}
          rimWidth={1.6}
          style={[localStyles.row, rowCard(theme)]}>
          <View style={localStyles.labelRow}>
            <Text
              style={{
                color: theme.colors.onSurface,
                fontSize: 12,
                fontWeight: '700',
              }}>
              加载模式
            </Text>
            <Text
              style={{
                color: theme.colors.primary,
                fontSize: 12,
                fontWeight: '700',
              }}>
              {mmapLabel}
            </Text>
          </View>

          {/*
            ⚠️ 这里原来是 react-native-paper 的 <Menu>，点开没反应。
            原因：Paper 的 Menu 用 Portal 渲染到 **PaperProvider 的根节点**，
            而本弹窗是 RN 原生 <Modal> —— Modal 是独立的一层原生视图，
            永远盖在 Portal 之上。于是菜单其实「打开了」，只是被压在弹窗
            底下看不见。
            改成内联展开的下拉列表：不开 Portal、就地渲染，Modal 里一定可见。
          */}
          <SurfaceCard
            glassType="regular"
            tint={dialogGlassTint(theme)}
            tintOpacity={0.5}
            rimWidth={1.6}
            style={[
              localStyles.dropdown,
              {
                borderColor: theme.colors.outlineVariant,
                // 玻璃模式下 SurfaceCard 会剥掉这层实底；其他风格保持原样
                backgroundColor: theme.colors.background,
              },
            ]}>
            <TouchableOpacity
              testID="mmap-dropdown"
              accessibilityRole="button"
              accessibilityLabel="选择加载模式"
              style={localStyles.dropdownInner}
              onPress={() => setMmapMenu(v => !v)}>
              <Text style={{color: theme.colors.onSurface, fontSize: 13}}>
                {mmapLabel}
              </Text>
              <Text
                style={{color: theme.colors.onSurfaceVariant, fontSize: 12}}>
                {mmapMenu ? '▴' : '▾'}
              </Text>
            </TouchableOpacity>
          </SurfaceCard>

          {mmapMenu ? (
            <SurfaceCard
              glassType="regular"
              tint={dialogGlassTint(theme)}
              tintOpacity={0.5}
              rimWidth={1.6}
              style={[
                localStyles.menuList,
                {
                  borderColor: theme.colors.outlineVariant,
                  // 玻璃模式下 SurfaceCard 会剥掉这层实底；其他风格保持原样
                  backgroundColor: theme.colors.background,
                },
              ]}>
              {MMAP_OPTIONS.map(opt => {
                const selected = opt.value === mmap;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    testID={`mmap-option-${opt.value}`}
                    style={[
                      localStyles.menuItem,
                      selected && {
                        backgroundColor: 'rgba(59,130,246,0.14)',
                      },
                    ]}
                    onPress={() => {
                      modelStore.setUseMmap(opt.value);
                      setMmapMenu(false);
                    }}>
                    <Text
                      style={{
                        fontSize: 12,
                        color: selected
                          ? theme.colors.primary
                          : theme.colors.onSurface,
                        fontWeight: selected ? '700' : '400',
                      }}>
                      {opt.label}
                    </Text>
                    {selected ? (
                      <Text style={{color: theme.colors.primary, fontSize: 12}}>
                        ✓
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </SurfaceCard>
          ) : null}

          <Text variant="labelSmall" style={localStyles.help}>
            MMAP 把模型文件直接映射进内存，由系统按需调页、内存紧张时可回收 ——
            大模型能在手机上跑起来的关键。默认已开启。
          </Text>
        </SurfaceCard>
      </View>
    );
  },
);

const localStyles = StyleSheet.create({
  row: {
    // 卡片化之后内边距由 rowCard 提供，这里只留卡片之间的间距
    marginBottom: 8,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  slider: {
    marginHorizontal: -6,
  },
  help: {
    marginTop: 4,
    opacity: 0.72,
    fontSize: 12,
    lineHeight: 16,
  },
  gpuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  gpuTitle: {
    fontSize: 12,
    fontWeight: '700',
  },
  gpuHelp: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  tipBox: {
    // 18 -> 10：蓝色提示框不再占那么大一块
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: 'rgba(59,130,246,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.22)',
  },
  tipText: {
    opacity: 0.9,
    fontSize: 12,
    lineHeight: 17,
  },
  dropdown: {
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  // SurfaceCard 的 onPress 会在卡片和内容之间插一层 flex:1 的 Touchable，
  // 会把下拉框的横向布局吃掉 —— 所以这里自己放 Touchable，行布局交给它
  dropdownInner: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  // 内联下拉列表（替代 Paper 的 Menu —— 那个在 RN Modal 里会被盖住）
  menuList: {
    marginTop: 6,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  // 底部操作条是横向排布的一行：左边「重置」窄一点，右边「重新加载」宽一点，
  // 避免长文案在按钮里换成两行、把底栏撑高。
  primaryBtn: {
    flex: 1.6,
    borderRadius: 12,
  },
  secondaryBtn: {
    flex: 1,
    borderRadius: 12,
  },
});
