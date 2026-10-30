import React, {useEffect, useMemo} from 'react';
import {
  Modal,
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import {Text, Icon} from 'react-native-paper';

import {useTheme} from '../../hooks';
import {modelStore} from '../../store';
import {dialogGlassTint} from '../../theme/cards';
import {Model, Theme} from '../../utils/types';
import {SurfaceCard} from '../GlassSurface';

/**
 * 「模型信息」悬浮窗。
 *
 * 展示从 GGUF 头读出来的原始元数据 —— 上下文长度、层数、注意力头数、
 * 频率基数、tokenizer 的起止 id 这些。分组是为了让一长串键值对有结构，
 * 不是把所有字段平铺一屏。
 *
 * 之前这些信息藏在卡片的「展开详情」里（要点两下、还要滚动半屏），
 * 现在点卡片右上角的 ℹ️ 直接弹这个窗。
 */

type Row = [string, string | number | undefined];

const GGUF_VERSION_LABEL: Record<number, string> = {
  1: 'V1',
  2: 'V2',
  3: 'V3',
};

/** 把可能是字符串的数字转成可显示的值；缺失统一显示 '—' */
const v = (x: unknown): string | number => {
  if (x === undefined || x === null || x === '') {
    return '—';
  }
  return typeof x === 'number' ? x : String(x);
};

/** 一行「标签 + 值」。标签固定字符串，值可能缺失。 */
const row = (label: string, value: unknown): Row => [label, v(value)];

/** 小数浮点保留到 6 位，去掉多余的 0（0.000001 要显示全，1.5 不要变成 1.500000） */
const num = (x: unknown, digits = 6): string => {
  if (typeof x !== 'number' || !Number.isFinite(x)) {
    return '—';
  }
  const s = x.toFixed(digits);
  return s.replace(/0+$/, '').replace(/\.$/, '');
};

export const ModelInfoOverlay: React.FC<{
  visible: boolean;
  model?: Model;
  onClose: () => void;
}> = ({visible, model, onClose}) => {
  const theme = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  // 没读到 GGUF 头时现读一次（点开 info 才读，不在列表里白读文件）
  useEffect(() => {
    if (!visible || !model?.isDownloaded || model.ggufMetadata) {
      return;
    }
    // 防御：某些环境（测试 mock / 早期版本）没有这个方法，不能让它把
    // 整个卡片渲染带崩 —— 大不了退化成「没有元数据可显示」。
    const fetchMeta = (modelStore as any).fetchAndPersistGGUFMetadata;
    if (typeof fetchMeta === 'function') {
      Promise.resolve(fetchMeta.call(modelStore, model)).catch(() => {});
    }
  }, [visible, model]);

  const groups = useMemo((): {title: string; rows: Row[]}[] => {
    if (!model) {
      return [];
    }
    const m = model.ggufMetadata;
    if (!m) {
      return [];
    }
    return [
      {
        title: '基本信息',
        rows: [
          row(
            'GGUF 版本',
            m.gguf_version
              ? (GGUF_VERSION_LABEL[m.gguf_version] ?? `V${m.gguf_version}`)
              : undefined,
          ),
          row('张量数量', m.tensor_count),
          row('元数据键值对数量', m.kv_count),
          row('尺寸标签', m.size_label),
        ],
      },
      {
        title: '架构信息',
        rows: [row('架构', m.architecture), row('文件类型', m.file_type)],
      },
      {
        title: '上下文长度',
        rows: [
          row('上下文长度', m.context_length),
          row('嵌入维度', m.n_embd),
          row('层数', m.n_layers),
          row('前馈网络大小', m.n_ff),
        ],
      },
      {
        title: '注意力头数',
        rows: [
          row('注意力头数', m.n_head),
          row('KV 头数', m.n_head_kv),
          row('层 RMS 归一化 Epsilon', num(m.rms_norm_eps)),
          row('频率基数', m.rope_freq_base),
        ],
      },
      {
        title: '分词器',
        rows: [
          row('词表大小', m.n_vocab),
          row('起始标记 ID', m.bos_token_id),
          row('结束标记 ID', m.eos_token_id),
        ],
      },
    ].filter(g => g.rows.some(([, val]) => val !== '—'));
  }, [model]);

  const loading = !!(model?.isDownloaded && !model.ggufMetadata);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} />

      <View style={styles.center} pointerEvents="box-none">
        {/* RN Modal 独立窗口采不到壁纸：与其他弹窗统一走磨砂玻璃 */}
        <SurfaceCard
          style={styles.card}
          glassType="regular"
          tint={dialogGlassTint(theme)}
          tintOpacity={0.34}
          blur
          blurAmount={50}
          blurRounds={6}
          forceFrosted>
          {/* 标题 */}
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text
                variant="titleMedium"
                numberOfLines={1}
                style={{color: theme.colors.onSurface}}>
                {model?.name || model?.filename || ''}
              </Text>
              <Text
                variant="bodySmall"
                style={{color: theme.colors.onSurfaceVariant}}>
                模型信息
              </Text>
            </View>
            <TouchableOpacity
              testID="model-info-close"
              onPress={onClose}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="关闭">
              <Icon
                source="close"
                size={20}
                color={theme.colors.onSurfaceVariant}
              />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}>
            {loading ? (
              <View style={styles.loading}>
                <ActivityIndicator />
                <Text
                  variant="bodySmall"
                  style={[
                    styles.loadingText,
                    {color: theme.colors.onSurfaceVariant},
                  ]}>
                  正在读取模型文件…
                </Text>
              </View>
            ) : groups.length === 0 ? (
              <Text
                variant="bodyMedium"
                style={[
                  styles.emptyText,
                  {color: theme.colors.onSurfaceVariant},
                ]}>
                没有可读的元数据。模型文件可能还没下载完成，或者不是 GGUF 格式。
              </Text>
            ) : (
              groups.map(g => (
                <View key={g.title} style={styles.group}>
                  <Text variant="titleSmall" style={styles.groupTitle}>
                    {g.title}
                  </Text>
                  <View
                    style={[
                      styles.groupBox,
                      {borderColor: theme.colors.outlineVariant},
                    ]}>
                    {g.rows.map(([label, value], idx) => (
                      <View
                        key={label}
                        style={[
                          styles.row,
                          idx > 0 && {
                            borderTopWidth: StyleSheet.hairlineWidth,
                            borderTopColor: theme.colors.outlineVariant,
                          },
                        ]}>
                        <Text
                          variant="bodyMedium"
                          numberOfLines={1}
                          style={[
                            styles.rowLabel,
                            {color: theme.colors.onSurfaceVariant},
                          ]}>
                          {label}
                        </Text>
                        <Text
                          variant="bodyMedium"
                          numberOfLines={1}
                          style={[
                            styles.rowValue,
                            {color: theme.colors.onSurface},
                          ]}>
                          {value}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </SurfaceCard>
      </View>
    </Modal>
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.45)',
    },
    center: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: 20,
    },
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: 22,
      maxHeight: '78%',
      overflow: 'hidden',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingTop: 18,
      paddingBottom: 14,
    },
    headerText: {
      flex: 1,
      gap: 2,
    },
    closeBtn: {
      padding: 4,
      marginLeft: 10,
      borderRadius: 999,
    },
    scroll: {
      flexGrow: 0,
    },
    scrollContent: {
      paddingHorizontal: 20,
      paddingBottom: 22,
    },
    group: {
      marginBottom: 16,
    },
    groupTitle: {
      fontWeight: '700',
      marginBottom: 8,
      color: theme.colors.onSurface,
    },
    groupBox: {
      borderWidth: 1,
      borderRadius: 14,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    rowLabel: {
      flex: 1,
      fontSize: 13,
    },
    rowValue: {
      fontSize: 14,
      fontWeight: '600',
      maxWidth: '52%',
      textAlign: 'right',
    },
    loading: {
      alignItems: 'center',
      paddingVertical: 32,
      gap: 12,
    },
    loadingText: {
      fontSize: 12,
    },
    emptyText: {
      paddingVertical: 28,
      textAlign: 'center',
      lineHeight: 20,
    },
  });
