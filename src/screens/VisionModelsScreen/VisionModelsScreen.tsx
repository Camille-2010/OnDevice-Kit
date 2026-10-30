import React from 'react';
import {View, StyleSheet, ScrollView} from 'react-native';
import {Text, Card, Icon} from 'react-native-paper';
import {GlassButton as Button} from '../../components/GlassButton';
import {observer} from 'mobx-react';
import {useNavigation} from '@react-navigation/native';

import {modelStore} from '../../store';
import {SubHeader} from '../../components/SubHeader';
import {Entrance} from '../../components/Entrance';
import {useTheme} from '../../hooks';
import {ModelType} from '../../utils/types';
import type {Model, Theme} from '../../utils/types';
import {SurfaceCard} from '../../components/GlassSurface';
import {cardRadius, glassButton} from '../../theme/cards';
import {PillLabel} from '../../components/PillLabel';

/**
 * 视觉模型选择页。
 *
 * 图像识别需要的是「支持多模态的 LLM（如 Qwen2-VL）」，而**投影模型
 * （mmproj）不是视觉模型**：它自己不能对话、不能设为主模型，只能被绑给
 * 某个主模型。之前这里直接按 `supportsMultimodal` 筛选，而读 GGUF 头时
 * 给 mmproj 也打了 `supportsMultimodal = true`，于是投影模型被列进来、
 * 点一下就去 setActiveModel → 加载报错。现在按 modelType 严格区分。
 *
 * 页面分两块：
 *  · 视觉对话模型：可选为当前模型（带缺投影模型提示）
 *  · 投影模型（mmproj）：显示它当前被哪些主模型绑定着；没被绑的会告诉
 *    用户「到模型页的主模型卡片上点绑定视觉模型」
 */
export const VisionModelsScreen: React.FC = observer(() => {
  const navigation = useNavigation<any>();
  const theme = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  // 真正的视觉对话模型（排除投影模型）
  const visionModels = modelStore.models.filter(
    m => m.supportsMultimodal && m.modelType !== ModelType.PROJECTION,
  );
  // 投影模型单独一组
  const projectionModels = modelStore.models.filter(
    m => m.modelType === ModelType.PROJECTION,
  );
  /** 某投影模型当前被哪些主模型绑定着 */
  const boundTo = (proj: Model): string[] =>
    modelStore.models
      .filter(
        m =>
          m.id !== proj.id &&
          (m.defaultProjectionModel === proj.id ||
            m.compatibleProjectionModels?.includes(proj.id)),
      )
      .map(m => m.name);
  const activeId = modelStore.activeModelId;

  /** 该模型声明的投影模型是否缺失/未下载 */
  const projectionMissing = (m: Model): boolean => {
    if (!m.defaultProjectionModel) {
      return false;
    }
    const proj = modelStore.models.find(p => p.id === m.defaultProjectionModel);
    return !proj || !proj.isDownloaded;
  };

  const handlePress = async (m: Model) => {
    if (!m.isDownloaded) {
      // 未安装：触发下载（缺投影模型时一并下载，与模型页行为一致）
      modelStore.checkSpaceAndDownload(m.id);
      if (m.defaultProjectionModel) {
        const proj = modelStore.models.find(
          p => p.id === m.defaultProjectionModel,
        );
        if (proj && !proj.isDownloaded) {
          modelStore.checkSpaceAndDownload(m.defaultProjectionModel);
        }
      }
      return;
    }
    if (projectionMissing(m)) {
      // 主模型装了但投影模型没装：先补投影模型
      if (m.defaultProjectionModel) {
        modelStore.checkSpaceAndDownload(m.defaultProjectionModel);
      }
      return;
    }
    await modelStore.setActiveModel(m.id);
    navigation.goBack();
  };

  return (
    <View style={styles.container}>
      <SubHeader title="视觉模型" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.content}>
        <Entrance index={0}>
          {/* 两行小字直接浮在壁纸上 → 垫一个玻璃小胶囊（与「更多」页一致）。
              radius=26 ≈ 高度一半 → 满圆角胶囊形 */}
          <PillLabel style={styles.subtitlePill} radius={26}>
            <Text style={styles.subtitle}>
              图像识别要用多模态模型（会看图的语言模型）。选中后回「图像识别」即可上传图片识别。
            </Text>
          </PillLabel>
        </Entrance>

        {visionModels.length === 0 ? (
          <Entrance index={1}>
            <SurfaceCard paper style={styles.emptyCard}>
              <Card.Content>
                <Text style={styles.emptyTitle}>还没有可用的视觉模型</Text>
                <Text style={styles.emptyDesc}>
                  当前设备上没有多模态对话模型。回到「模型」页用右下角 ＋
                  导入一个 会看图的语言模型（如
                  Qwen2-VL），纯文本模型也可以在卡片上点
                  「绑定视觉模型」接一个投影模型。
                </Text>
                <Button
                  mode="outlined"
                  style={[styles.emptyBtn, glassButton(theme)]}
                  onPress={() => navigation.goBack()}>
                  去模型页导入
                </Button>
              </Card.Content>
            </SurfaceCard>
          </Entrance>
        ) : (
          visionModels.map((m, idx) => {
            const isActive = m.id === activeId;
            const missingProj = m.isDownloaded && projectionMissing(m);
            return (
              <Entrance key={m.id} index={idx + 1}>
                <SurfaceCard
                  paper
                  activeOpacity={0.7}
                  onPress={() => handlePress(m)}
                  style={[
                    styles.modelCard,
                    isActive ? styles.modelCardActive : null,
                  ]}>
                  <Card.Content>
                    <View style={styles.rowBetween}>
                      <Text style={styles.modelName} numberOfLines={1}>
                        {m.name}
                      </Text>
                      {isActive ? (
                        <Icon
                          source="check-circle"
                          size={20}
                          color={theme.colors.primary}
                        />
                      ) : null}
                    </View>

                    <View style={styles.tagRow}>
                      <Text
                        style={[
                          styles.statusTag,
                          m.isDownloaded
                            ? styles.tagInstalled
                            : styles.tagMissing,
                        ]}>
                        {m.isDownloaded ? '已安装' : '未安装'}
                      </Text>
                      {isActive ? (
                        <Text style={[styles.statusTag, styles.tagActive]}>
                          使用中
                        </Text>
                      ) : null}
                      {missingProj ? (
                        <Text style={[styles.statusTag, styles.tagMissing]}>
                          缺投影模型
                        </Text>
                      ) : null}
                    </View>

                    {/* 操作提示（点击下载/补齐/切换）垫玻璃小胶囊，贴字宽 */}
                    <PillLabel
                      style={styles.hintPill}
                      radius={12}
                      backdrop="solid">
                      <Text style={styles.actionHint}>
                        {!m.isDownloaded
                          ? '点击下载（会一并下载配套投影模型）'
                          : missingProj
                            ? '点击补齐配套投影模型'
                            : isActive
                              ? '当前使用中的视觉模型'
                              : '点击切换为当前模型'}
                      </Text>
                    </PillLabel>
                  </Card.Content>
                </SurfaceCard>
              </Entrance>
            );
          })
        )}

        {/* 投影模型（mmproj）：不能单独加载，只能被主模型绑定 */}
        {projectionModels.length > 0 && (
          <>
            <Entrance index={1}>
              {/* 小节标题也垫玻璃胶囊（贴字宽，不满撑） */}
              <PillLabel style={styles.sectionTitlePill} radius={16}>
                <Text style={styles.sectionTitle}>投影模型（mmproj）</Text>
              </PillLabel>
              {/* 这段说明同样浮在壁纸上 → 一并垫玻璃胶囊 */}
              <PillLabel style={styles.descPill} radius={24}>
                <Text style={styles.sectionDesc}>
                  这类模型自己不能对话，也不能单独加载。它负责把图片编码成主模型
                  能看懂的形式，必须绑定给上面的对话模型才能用。
                </Text>
              </PillLabel>
            </Entrance>
            {projectionModels.map((m, idx) => {
              const owners = boundTo(m);
              return (
                <Entrance key={m.id} index={Math.min(idx + 2, 6)}>
                  <SurfaceCard paper style={styles.modelCard}>
                    <Card.Content>
                      <View style={styles.rowBetween}>
                        <Text style={styles.modelName} numberOfLines={1}>
                          {m.name}
                        </Text>
                        <Text
                          style={[
                            styles.statusTag,
                            m.isDownloaded
                              ? styles.tagInstalled
                              : styles.tagMissing,
                          ]}>
                          {m.isDownloaded ? '已安装' : '未安装'}
                        </Text>
                      </View>
                      {/* 未绑定提示较长 → 胶囊撑满卡片宽、内部文字换行 */}
                      <PillLabel
                        style={styles.hintPillWide}
                        radius={12}
                        backdrop="solid">
                        <Text style={styles.actionHint}>
                          {owners.length > 0
                            ? `已绑定：${owners.join('、')}`
                            : '尚未绑定。到「模型」页找到要加视觉的对话模型，卡片上点「绑定视觉模型」来使用它'}
                        </Text>
                      </PillLabel>
                    </Card.Content>
                  </SurfaceCard>
                </Entrance>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {flex: 1, backgroundColor: 'transparent'},
    content: {paddingHorizontal: 16, paddingBottom: 40},
    subtitlePill: {alignSelf: 'stretch', marginBottom: 16},
    subtitle: {
      flex: 1,
      fontSize: 13,
      lineHeight: 20,
      color: theme.colors.onSurfaceVariant,
    },
    // Paper Card 默认 contained → surfaceVariant（偏深）。显式压回卡片面。
    modelCard: {
      marginBottom: 12,
      borderRadius: cardRadius(),
      backgroundColor: theme.colors.surface,
    },
    sectionTitlePill: {
      alignSelf: 'flex-start',
      marginTop: 18,
      marginBottom: 10,
    },
    sectionTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: theme.colors.onSurface,
    },
    descPill: {alignSelf: 'stretch', marginBottom: 10},
    sectionDesc: {
      flex: 1,
      fontSize: 12,
      lineHeight: 18,
      color: theme.colors.onSurfaceVariant,
    },
    modelCardActive: {
      borderWidth: 1,
      borderColor: theme.colors.secondary,
      backgroundColor: theme.colors.secondaryContainer,
    },
    rowBetween: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    modelName: {
      flex: 1,
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.onSurface,
    },
    tagRow: {flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap'},
    statusTag: {
      fontSize: 12,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 999,
      overflow: 'hidden',
    },
    tagInstalled: {
      color: '#0F766E',
      backgroundColor: 'rgba(16,185,129,0.14)',
    },
    tagMissing: {
      color: '#B45309',
      backgroundColor: 'rgba(245,158,11,0.16)',
    },
    tagActive: {
      color: '#1D4ED8',
      backgroundColor: 'rgba(59,130,246,0.16)',
    },
    actionHint: {
      flex: 1,
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
    },
    // 卡片内的操作提示胶囊：短提示贴字宽，长提示撑满换行
    hintPill: {alignSelf: 'flex-start', marginTop: 10},
    hintPillWide: {alignSelf: 'stretch', marginTop: 10},
    emptyCard: {
      borderRadius: cardRadius(),
      marginTop: 8,
      backgroundColor: theme.colors.surface,
    },
    emptyTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: theme.colors.onSurface,
    },
    emptyDesc: {
      fontSize: 13,
      lineHeight: 20,
      marginTop: 6,
      color: theme.colors.onSurfaceVariant,
    },
    emptyBtn: {marginTop: 12, borderRadius: 999, alignSelf: 'flex-start'},
  });
