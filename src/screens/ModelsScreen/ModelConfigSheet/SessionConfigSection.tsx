import React from 'react';
import {View, StyleSheet, Pressable} from 'react-native';
import {Text, Switch, Menu} from 'react-native-paper';
import {GlassButton as Button} from '../../../components/GlassButton';
import {AppIcon} from '../../../components/AppIcon';
import {ThickTrackSlider} from '../../../components/ThickTrackSlider';
import {observer} from 'mobx-react-lite';

import {modelStore, palStore, chatSessionStore} from '../../../store';
import {useTheme} from '../../../hooks';
import {Model} from '../../../utils/types';
import {
  cardBg,
  buttonRing,
  glassButton,
  dialogGlassTint,
} from '../../../theme/cards';
import {SurfaceCard} from '../../../components/GlassSurface';
// 内层卡片：液态玻璃风格下 SurfaceCard 渲染成真玻璃（玻璃叠玻璃），
// 其他风格仍是原来的浅灰实底卡
const rowCard = (theme: ReturnType<typeof useTheme>) => ({
  backgroundColor: cardBg(theme),
  // 14 -> 16：内层卡片也跟着更圆一点，和窗口圆角呼应
  borderRadius: 16,
  // 卡片更紧凑：纵向 12 -> 9，横向 14 -> 12
  paddingHorizontal: 12,
  paddingVertical: 9,
});

/**
 * 「默认会话配置」区块。
 *
 * 用该模型**新建**会话时会读这里的一组采样参数。已经存在的会话保留各自
 * 的参数，不追溯改写 —— 这样改默认值不会把正在聊的内容搅乱。
 */

const SLIDERS: {
  key:
    | 'temperature'
    | 'top_k'
    | 'top_p'
    | 'min_p'
    | 'typical_p'
    | 'penalty_repeat'
    | 'penalty_freq'
    | 'penalty_present'
    | 'penalty_last_n'
    | 'n_predict'
    | 'seed';
  label: string;
  min: number;
  max: number;
  step: number;
  help: string;
  /** 显示用：value 为 undefined 时展示这个 */
  emptyText?: string;
}[] = [
  {
    key: 'seed',
    label: '随机种子',
    min: 0,
    max: 100,
    step: 1,
    help: '固定后每次生成结果一致，便于复现。',
  },
  {
    key: 'n_predict',
    label: '最大 Token 数',
    min: -1,
    max: 4096,
    step: 1,
    help: '-1 表示不限，由模型自己决定何时结束。',
  },
  {
    key: 'temperature',
    label: '温度',
    min: 0,
    max: 2,
    step: 0.05,
    help: '越高越发散，0.8 左右比较自然。',
  },
  {
    key: 'top_k',
    label: 'Top K',
    min: 1,
    max: 100,
    step: 1,
    help: '每步只考虑概率最高的 K 个词。',
  },
  {
    key: 'top_p',
    label: 'Top P',
    min: 0,
    max: 1,
    step: 0.01,
    help: '核采样：累计概率达到该值就截断。',
  },
  {
    key: 'min_p',
    label: 'Min P',
    min: 0,
    max: 1,
    step: 0.01,
    help: '概率下限：低于最高概率的这个比例就丢弃。',
  },
  {
    key: 'typical_p',
    label: 'Typical P',
    min: 0,
    max: 1,
    step: 0.01,
    help: '只保留接近「典型」概率的词，越小越保守。',
  },
  {
    key: 'penalty_repeat',
    label: '重复惩罚',
    min: 1,
    max: 2,
    step: 0.01,
    help: '大于 1 会压低已出现过的词，越大越不容易复读。',
  },
  {
    key: 'penalty_freq',
    label: '频率惩罚',
    min: 0,
    max: 2,
    step: 0.01,
    help: '按出现次数惩罚，压住车轱辘话。',
  },
  {
    key: 'penalty_present',
    label: '存在惩罚',
    min: 0,
    max: 2,
    step: 0.01,
    help: '按「出现过/没出现过」惩罚，鼓励谈新内容。',
  },
  {
    key: 'penalty_last_n',
    label: '惩罚最近 N 个',
    min: 0,
    max: 128,
    step: 8,
    help: '惩罚只作用于最近 N 个词，0 表示全部。',
  },
];

const ReasoningRow: React.FC<{
  value: boolean;
  onChange: (v: boolean) => void;
}> = ({value, onChange}) => {
  const theme = useTheme();
  return (
    // ⚠️ 这里必须显式给 row 布局。
    // s.row 只有 marginBottom（卡片间距），默认是 column 方向 ——
    // 标题和 Switch 会竖着排，Switch 掉到第二行，卡片高度直接翻倍。
    <SurfaceCard
      glassType="regular"
      tint={dialogGlassTint(theme)}
      tintOpacity={0.5}
      rimWidth={1.6}
      style={[
        s.row,
        s.labelRow, // flexDirection:'row' + space-between + center
        rowCard(theme),
      ]}>
      <Text
        style={{
          color: theme.colors.onSurface,
          fontSize: 12,
          fontWeight: '700',
        }}>
        推理模式
      </Text>
      <Switch value={value} onValueChange={onChange} />
    </SurfaceCard>
  );
};

const NumberRow: React.FC<{
  model: Model;
  onCommit: (patch: any) => void;
}> = ({model, onCommit}) => {
  const theme = useTheme();
  const params = model.defaultCompletionSettings ?? ({} as any);
  const [local, setLocal] = React.useState<Record<string, number>>({});

  return (
    <>
      {SLIDERS.map(cfg => {
        const raw = params[cfg.key];
        // 读不到值时的兜底（与 SessionConfigActions 的重置值一致）
        const fallback =
          cfg.key === 'n_predict'
            ? -1
            : cfg.key === 'seed'
              ? 0
              : cfg.key === 'temperature'
                ? 0.8
                : cfg.key === 'top_k'
                  ? 40
                  : cfg.key === 'min_p'
                    ? 0.05
                    : cfg.key === 'typical_p'
                      ? 1
                      : cfg.key === 'penalty_repeat'
                        ? 1
                        : cfg.key === 'penalty_last_n'
                          ? 64
                          : 0.95;
        const current =
          typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
        const value = local[cfg.key] ?? current;
        // 显示值必须用「滑动中的本地值 value」而不是已提交的 current，
        // 否则拖动时上面的数字不动、松手才跳变（用户反馈「数据不跟着拉杆走」）。
        const display =
          cfg.key === 'n_predict' && value < 0
            ? '无限'
            : String(Math.round(value * 1000) / 1000);

        return (
          <SurfaceCard
            glassType="regular"
            tint={dialogGlassTint(theme)}
            tintOpacity={0.5}
            rimWidth={1.6}
            style={[s.row, rowCard(theme)]}
            key={cfg.key}>
            <View style={s.labelRow}>
              <Text
                style={{
                  color: theme.colors.onSurface,
                  fontSize: 12,
                  fontWeight: '700',
                }}>
                {cfg.label}
              </Text>
              <Text
                style={{
                  color: theme.colors.primary,
                  fontSize: 12,
                  fontWeight: '700',
                }}>
                {display}
              </Text>
            </View>
            <ThickTrackSlider
              style={s.slider}
              value={value}
              min={cfg.min}
              max={cfg.max}
              step={cfg.step}
              onValueChange={v => setLocal(p => ({...p, [cfg.key]: v}))}
              onSlidingComplete={v =>
                onCommit({[cfg.key]: Math.round(v * 1000) / 1000})
              }
            />
            <Text style={s.help}>{cfg.help}</Text>
          </SurfaceCard>
        );
      })}
    </>
  );
};

export const SessionConfigSection: React.FC<{model: Model}> = observer(
  ({model}) => {
    const theme = useTheme();
    const reasoningEnabled =
      !!model.defaultCompletionSettings?.reasoning?.enabled;

    // 当前 Pal 的系统提示词（参考 App 的「系统提示词」一行）。
    // 会话设置的归属是「当前会话」，所以取当前会话绑定的 Pal。
    const activePal = palStore.pals.find(
      p =>
        p.id ===
        chatSessionStore.sessions.find(
          s => s.id === chatSessionStore.activeSessionId,
        )?.activePalId,
    );
    const [palMenuOpen, setPalMenuOpen] = React.useState(false);

    return (
      <View>
        <SurfaceCard tint="#3B82F6" tintOpacity={0.14} style={s.tipBox}>
          <Text style={s.tipText}>
            创建新会话时读取此处的默认配置，聊天页可单独修改。
          </Text>
        </SurfaceCard>

        {/*
          系统提示词：助手下拉。
          2026-10-19 用户要求「做好下拉剪头，可以选择每一个助手，
          下拉框里只显示是什么什么助手」。
          之前是只读摘要文本，现在改成可点的 Menu。
        */}
        <SurfaceCard
          glassType="regular"
          tint={dialogGlassTint(theme)}
          tintOpacity={0.5}
          rimWidth={1.6}
          style={[s.row, rowCard(theme)]}>
          <Menu
            visible={palMenuOpen}
            onDismiss={() => setPalMenuOpen(false)}
            anchor={
              <Pressable
                testID="session-pal-picker"
                onPress={() => setPalMenuOpen(true)}
                style={s.palPickerRow}>
                <Text
                  style={{
                    color: theme.colors.onSurface,
                    fontSize: 12,
                    fontWeight: '700',
                  }}>
                  系统提示词
                </Text>
                <View style={s.palPickerRight}>
                  <Text
                    style={{
                      color: theme.colors.onSurfaceVariant,
                      fontSize: 12,
                    }}
                    numberOfLines={1}>
                    {activePal ? `${activePal.name}` : '无'}
                  </Text>
                  {/* 下拉箭头：展开时旋转 90° */}
                  <View
                    style={{
                      transform: [{rotate: palMenuOpen ? '90deg' : '0deg'}],
                    }}>
                    <AppIcon
                      name="chevronRight"
                      size={14}
                      color={theme.colors.onSurfaceVariant}
                    />
                  </View>
                </View>
              </Pressable>
            }>
            {/* 下拉里只列助手名 */}
            {palStore.pals.map(p => (
              <Menu.Item
                key={p.id}
                title={p.name}
                testID={`session-pal-option-${p.id}`}
                onPress={() => {
                  setPalMenuOpen(false);
                  void chatSessionStore.updateSessionActivePal(p.id);
                }}
                trailingIcon={p.id === activePal?.id ? 'check' : undefined}
              />
            ))}
          </Menu>
        </SurfaceCard>

        <ReasoningRow
          value={reasoningEnabled}
          onChange={v =>
            modelStore.updateModelDefaultCompletionSettings(model.id, {
              reasoning: {
                ...(model.defaultCompletionSettings?.reasoning ?? {}),
                enabled: v,
              },
            })
          }
        />

        <NumberRow
          model={model}
          onCommit={patch =>
            modelStore.updateModelDefaultCompletionSettings(model.id, patch)
          }
        />
      </View>
    );
  },
);

/**
 * 「会话配置」底部的固定操作条（和「加载配置」一样，不随内容滚动）。
 */
export const SessionConfigActions: React.FC<{model: Model}> = ({model}) => {
  const theme = useTheme();
  return (
    <Button
      mode="outlined"
      style={[
        s.resetBtn,
        glassButton(theme),
        {borderWidth: 1, borderColor: buttonRing(theme)},
      ]}
      onPress={() => {
        modelStore.updateModelDefaultCompletionSettings(model.id, {
          temperature: 0.8,
          top_k: 40,
          top_p: 0.95,
          min_p: 0.05,
          typical_p: 1,
          penalty_repeat: 1,
          penalty_freq: 0,
          penalty_present: 0,
          penalty_last_n: 64,
          n_predict: -1,
          seed: 0,
        });
      }}>
      重置为默认
    </Button>
  );
};

const s = StyleSheet.create({
  tipBox: {
    marginBottom: 18,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(59,130,246,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.22)',
  },
  tipText: {
    opacity: 0.9,
    fontSize: 12,
    lineHeight: 16,
  },
  palPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 2,
  },
  palPickerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
  },
  row: {
    // 卡片化：内边距由 rowCard 提供，这里只留卡片间距
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
    lineHeight: 17,
  },
  resetBtn: {
    flex: 1,
    borderRadius: 12,
  },
});
