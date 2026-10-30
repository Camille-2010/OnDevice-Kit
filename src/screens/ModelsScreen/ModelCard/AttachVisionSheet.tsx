import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import {Icon, Text} from 'react-native-paper';
import {GlassButton as Button} from '../../../components/GlassButton';
import {observer} from 'mobx-react';

import {useTheme} from '../../../hooks';
import {modelStore} from '../../../store';
import {Model} from '../../../utils/types';
import {cardRadius} from '../../../theme/cards';
import {Sheet} from '../../../components/Sheet';

/**
 * 「绑定视觉模型」弹层。
 *
 * 流程：
 *   1. 打开时先去探测 —— 读主模型的 GGUF 头拿到 architecture，
 *      再逐个读库里投影模型的 clip.projector_type，两边按族匹配。
 *   2. 只把**真的能接上**的列出来。列不出来就说明没有可用的投影模型，
 *      给一句明确的话，而不是硬塞一个「绑定」按钮让人点了报错。
 *   3. 选中后写 supportsMultimodal + defaultProjectionModel，
 *      加载路径就能拿到 mmproj 了。
 *
 * 探测是真的读文件（几 MB 的头部），所以放异步 + loading，
 * 不让 UI 卡住。
 */
export const AttachVisionSheet: React.FC<{
  visible: boolean;
  model: Model;
  onClose: () => void;
}> = observer(({visible, model, onClose}) => {
  const theme = useTheme();
  const styles = createStyles(theme);

  const [probing, setProbing] = useState(false);
  const [candidates, setCandidates] = useState<
    {model: Model; downloaded: boolean}[]
  >([]);
  const [mainArch, setMainArch] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [, setDone] = useState(false);

  const runProbe = useCallback(async () => {
    setProbing(true);
    setDone(false);
    setError(undefined);
    try {
      const res = await modelStore.probeVisionCapability(model);
      // 弹层开着的时候模型可能已经被别处标成多模态了，直接关掉
      if (res.alreadyVision) {
        setDone(true);
        onClose();
        return;
      }
      setCandidates(res.candidates);
      setMainArch(res.mainProbe?.architecture);
      setError(res.error);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setCandidates([]);
    } finally {
      setProbing(false);
    }
  }, [model, onClose]);

  useEffect(() => {
    if (visible) {
      runProbe();
    }
    // 只依赖 visible：每次打开重新探一次，避免拿到过期的候选列表
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleAttach = (projectionId: string) => {
    modelStore.attachProjectionModel(model.id, projectionId);
    setDone(true);
    onClose();
  };

  return (
    <Sheet
      isVisible={visible}
      onClose={onClose}
      title="绑定视觉模型"
      snapPoints={['80%']}>
      <Sheet.ScrollView contentContainerStyle={styles.container}>
        {/* 说明 */}
        <View style={styles.tipCard}>
          <Text style={styles.tipTitle}>这个模型现在只能读文字</Text>
          <Text style={styles.tipText}>
            给它接一个视觉投影模型（mmproj），它就能同时看懂图片。
            投影模型必须是和它同一套视觉塔的，接错了加载会失败 ——
            所以下面只列出检测过、确实能用的。
          </Text>
          {mainArch ? (
            <Text style={styles.tipMeta}>主模型架构：{mainArch}</Text>
          ) : null}
        </View>

        {probing ? (
          <View style={styles.centerBox}>
            <ActivityIndicator />
            <Text style={styles.centerText}>正在读取模型信息…</Text>
          </View>
        ) : candidates.length === 0 ? (
          <View style={styles.centerBox}>
            <Icon
              source="information-outline"
              size={22}
              color={theme.colors.onSurfaceVariant}
            />
            <Text style={styles.centerText}>
              {error ? `没能完成检测：${error}` : '没有找到和它兼容的视觉模型'}
            </Text>
            <Text style={styles.centerHint}>
              先去「添加本地模型」导入一个配套的 mmproj 文件（文件名通常带
              mmproj），再回来这里就能选上了。
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.sectionLabel}>可用（{candidates.length}）</Text>
            {candidates.map(item => (
              <TouchableOpacity
                key={item.model.id}
                style={styles.candidateCard}
                onPress={() => handleAttach(item.model.id)}>
                <View style={styles.candidateMain}>
                  <Text style={styles.candidateName} numberOfLines={2}>
                    {item.model.name || item.model.filename}
                  </Text>
                  <View style={styles.candidateMetaRow}>
                    <View
                      style={[
                        styles.badge,
                        item.downloaded
                          ? {backgroundColor: theme.colors.primary}
                          : {backgroundColor: theme.colors.outline},
                      ]}>
                      <Text style={styles.badgeText}>
                        {item.downloaded ? '已下载' : '未下载'}
                      </Text>
                    </View>
                    <Text style={styles.candidateSize}>
                      {formatSize(item.model.size)}
                    </Text>
                  </View>
                </View>
                <Icon
                  source="link-variant"
                  size={20}
                  color={theme.colors.primary}
                />
              </TouchableOpacity>
            ))}
          </>
        )}

        <View style={styles.footerRow}>
          <Button
            mode="text"
            onPress={runProbe}
            disabled={probing}
            style={styles.footerBtn}>
            重新检测
          </Button>
          <Button mode="text" onPress={onClose} style={styles.footerBtn}>
            取消
          </Button>
        </View>
      </Sheet.ScrollView>
    </Sheet>
  );
});

const formatSize = (bytes: number): string => {
  if (!bytes || bytes <= 0) {
    return '';
  }
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb >= 1) {
    return `${gb.toFixed(2)} GB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
};

const createStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    container: {
      paddingHorizontal: 16,
      paddingBottom: 24,
      gap: 12,
    },
    tipCard: {
      borderRadius: cardRadius(),
      backgroundColor: theme.colors.surfaceVariant,
      padding: 14,
      gap: 6,
    },
    tipTitle: {
      fontWeight: '700',
      color: theme.colors.onSurface,
    },
    tipText: {
      color: theme.colors.onSurfaceVariant,
      lineHeight: 20,
    },
    tipMeta: {
      color: theme.colors.onSurfaceVariant,
      opacity: 0.7,
      fontSize: 12,
    },
    centerBox: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 28,
      gap: 8,
    },
    centerText: {
      color: theme.colors.onSurface,
      textAlign: 'center',
    },
    centerHint: {
      color: theme.colors.onSurfaceVariant,
      textAlign: 'center',
      lineHeight: 19,
      paddingHorizontal: 12,
      fontSize: 12,
    },
    sectionLabel: {
      color: theme.colors.onSurfaceVariant,
      fontSize: 12,
      marginTop: 4,
    },
    candidateCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 14,
      borderRadius: cardRadius(),
      backgroundColor: theme.colors.surfaceVariant,
    },
    candidateMain: {
      flex: 1,
      gap: 6,
    },
    candidateName: {
      color: theme.colors.onSurface,
      fontWeight: '600',
    },
    candidateMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    badge: {
      paddingHorizontal: 8,
      paddingVertical: 1,
      borderRadius: 999,
    },
    badgeText: {
      color: '#FFFFFF',
      fontSize: 11,
      fontWeight: '700',
    },
    candidateSize: {
      color: theme.colors.onSurfaceVariant,
      fontSize: 12,
    },
    footerRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 8,
      marginTop: 8,
    },
    footerBtn: {
      borderRadius: 999,
    },
  });
