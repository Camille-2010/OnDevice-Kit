import React from 'react';
import {ScrollView, StyleSheet, Text, View, Alert} from 'react-native';
import {observer} from 'mobx-react-lite';
import {useNavigation} from '@react-navigation/native';

import {useTheme} from '../../hooks';
import {Theme} from '../../utils/types';
import {ModelType, type Model} from '../../utils/types';
import {formatBytes} from '../../utils/formatters';
import {
  modelStore,
  ttsStore,
  imageGenStore,
  gptSovitsStore,
  voiceChangeStore,
  uiStore,
} from '../../store';
import {
  SUPERTONIC_MODEL_ESTIMATED_BYTES,
  KOKORO_MODEL_ESTIMATED_BYTES,
  KITTEN_MODEL_ESTIMATED_BYTES,
} from '../../services/tts/constants';
import {SurfaceCard} from '../../components/GlassSurface';
import {SubHeader} from '../../components/SubHeader';
import {PillLabel} from '../../components/PillLabel';
import {ROUTES} from '../../utils/navigationConstants';
import {createStyles} from './styles';

/**
 * 下载管理：把散在各处的「已下载模型」收到一个页面里统一管控。
 *
 * 覆盖范围：
 *  · 对话模型（LLM GGUF）—— modelStore，可「设为当前 / 删除」
 *  · 视觉投影模型（mmproj）—— 同 store，可删除（被对话模型依赖时会拦）
 *  · 下载中的任务 —— 实时进度
 *  · 语音合成模型 —— Supertonic / Kokoro / Kitten，可下载 / 删除
 *  · 图像生成模型 —— 位于用户自连的 Stable Diffusion WebUI 上，只读展示
 *  · 语音克隆 / 音色转换 —— 云端或本地引擎，给出真实入口
 */
export const DownloadManagementScreen: React.FC = observer(() => {
  const navigation = useNavigation<any>();
  const theme = useTheme();
  const styles = createStyles(theme);
  const isGlass = uiStore.themeStyle === 'liquid-glass';

  // ── 语音合成引擎：本地确实会下载大文件的三档 ──
  // 必须在组件内部构造：observer 只有读到 store 的瞬时值才会在下载进度/
  // 完成状态变化时重渲染；放在模块顶层只会在首次 import 时抓一份快照，
  // 之后 TTS 引擎的下载进度、安装完成都不会刷新。
  const ttsEngines: {
    id: 'supertonic' | 'kokoro' | 'kitten';
    name: string;
    desc: string;
    bytes: number;
    state: 'not_installed' | 'downloading' | 'ready' | 'error';
    progress: number;
    install: () => void;
    remove: () => Promise<void>;
  }[] = [
    {
      id: 'supertonic',
      name: 'Supertonic',
      desc: '多语言，音质最好',
      bytes: SUPERTONIC_MODEL_ESTIMATED_BYTES,
      state: ttsStore.supertonicDownloadState,
      progress: ttsStore.supertonicDownloadProgress,
      install: () => ttsStore.downloadSupertonic(),
      remove: () => ttsStore.deleteSupertonic(),
    },
    {
      id: 'kokoro',
      name: 'Kokoro',
      desc: '中英双语，速度快',
      bytes: KOKORO_MODEL_ESTIMATED_BYTES,
      state: ttsStore.kokoroDownloadState,
      progress: ttsStore.kokoroDownloadProgress,
      install: () => ttsStore.downloadKokoro(),
      remove: () => ttsStore.deleteKokoro(),
    },
    {
      id: 'kitten',
      name: 'Kitten',
      desc: '轻量，低端机可用',
      bytes: KITTEN_MODEL_ESTIMATED_BYTES,
      state: ttsStore.kittenDownloadState,
      progress: ttsStore.kittenDownloadProgress,
      install: () => ttsStore.downloadKitten(),
      remove: () => ttsStore.deleteKitten(),
    },
  ];

  // ── 数据：直接读 store，observer 会自动重渲染 ──
  const downloaded = modelStore.models.filter(m => m.isDownloaded);
  const llms = downloaded.filter(m => m.modelType !== ModelType.PROJECTION);
  const projections = downloaded.filter(m => m.modelType === ModelType.PROJECTION);
  const inFlight = modelStore.models.filter(
    m => !m.isDownloaded && m.progress > 0 && m.progress < 100,
  );

  const installedTts = ttsEngines.filter(e => e.state === 'ready');
  const totalBytes =
    downloaded.reduce((sum, m) => sum + (m.size || 0), 0) +
    installedTts.reduce((sum, e) => sum + e.bytes, 0);
  const totalCount = downloaded.length + installedTts.length;

  const confirmDeleteModel = (model: Model) => {
    const isActive = modelStore.activeModelId === model.id;
    Alert.alert(
      '删除模型',
      `确定删除「${model.name || model.filename}」？文件会从本机移除，且无法恢复。`,
      [
        {text: '取消', style: 'cancel'},
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            modelStore.deleteModel(model).catch(err => {
              Alert.alert(
                '删不掉',
                err instanceof Error ? err.message : String(err),
              );
            });
          },
        },
      ],
    );
  };

  const confirmRemoveTts = (name: string, remove: () => Promise<void>) => {
    Alert.alert('删除语音模型', `确定删除「${name}」的已下载模型文件？`, [
      {text: '取消', style: 'cancel'},
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          remove().catch(err =>
            Alert.alert('删除失败', err instanceof Error ? err.message : String(err)),
          );
        },
      },
    ]);
  };

  const renderSectionTitle = (title: string, count?: number) =>
    isGlass ? (
      <PillLabel radius={14} style={styles.sectionTitle}>
        <View style={styles.sectionTitleInner}>
          <View style={styles.sectionTitleMarker} />
          <Text style={styles.sectionTitleText}>
            {title}
            {count != null && count > 0 ? ` · ${count}` : ''}
          </Text>
        </View>
      </PillLabel>
    ) : (
      <View style={styles.sectionTitlePlain}>
        <View style={styles.sectionTitleMarkerPlain} />
        <Text style={styles.sectionTitleTextPlain}>
          {title}
          {count != null && count > 0 ? ` · ${count}` : ''}
        </Text>
      </View>
    );

  /** 一行模型：名称 + 体积 + 右侧操作 */
  const renderModelRow = (model: Model, trailing: React.ReactNode) => {
    const isActive = modelStore.activeModelId === model.id;
    return (
      <View key={model.id} style={styles.row}>
        <View style={styles.rowMain}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {model.name || model.filename}
          </Text>
          <Text style={styles.rowSub} numberOfLines={1}>
            {formatBytes(model.size || 0, 2, true)}
            {isActive ? ' · 当前使用' : ''}
          </Text>
        </View>
        <View style={styles.rowActions}>{trailing}</View>
      </View>
    );
  };

  const ActionBtn: React.FC<{
    label: string;
    onPress: () => void;
    danger?: boolean;
    disabled?: boolean;
  }> = ({label, onPress, danger, disabled}) => (
    <Text
      onPress={disabled ? undefined : onPress}
      style={[
        styles.actionBtn,
        danger && styles.actionBtnDanger,
        disabled && styles.actionBtnDisabled,
      ]}>
      {label}
    </Text>
  );

  return (
    <View style={styles.screen}>
      <SubHeader title="下载管理" onBack={() => navigation.goBack()} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        {/* ── 总览 ── */}
        <SurfaceCard style={styles.overview} backdrop="wallpaper">
          <View style={styles.overviewRow}>
            <View style={styles.overviewItem}>
              <Text style={styles.overviewNum}>{totalCount}</Text>
              <Text style={styles.overviewLabel}>已下载</Text>
            </View>
            <View style={styles.overviewDivider} />
            <View style={styles.overviewItem}>
              <Text style={styles.overviewNum}>
                {formatBytes(totalBytes, 1, true)}
              </Text>
              <Text style={styles.overviewLabel}>占用空间</Text>
            </View>
            <View style={styles.overviewDivider} />
            <View style={styles.overviewItem}>
              <Text style={styles.overviewNum}>{inFlight.length}</Text>
              <Text style={styles.overviewLabel}>下载中</Text>
            </View>
          </View>
        </SurfaceCard>

        {totalCount === 0 && inFlight.length === 0 ? (
          <SurfaceCard style={styles.card}>
            <Text style={styles.emptyText}>
              还没有下载任何模型。对话、图像识别、语音合成都需要先下载模型才能本地运行。
            </Text>
            <ActionBtn
              label="去下载模型 →"
              onPress={() => navigation.navigate(ROUTES.MODELS)}
            />
          </SurfaceCard>
        ) : null}

        {/* ── 下载中 ── */}
        {inFlight.length > 0 ? (
          <View style={styles.section}>
            {renderSectionTitle('下载中', inFlight.length)}
            <SurfaceCard style={styles.card}>
              {inFlight.map(m => (
                <View key={m.id} style={styles.progressRow}>
                  <View style={styles.rowMain}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {m.name || m.filename}
                    </Text>
                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          {width: `${Math.round(m.progress)}%`},
                        ]}
                      />
                    </View>
                  </View>
                  <Text style={styles.progressText}>
                    {Math.round(m.progress)}%
                  </Text>
                </View>
              ))}
            </SurfaceCard>
          </View>
        ) : null}

        {/* ── 对话模型 ── */}
        <View style={styles.section}>
          {renderSectionTitle('对话模型', llms.length)}
          {llms.length > 0 ? (
            <SurfaceCard style={styles.card}>
              {llms.map(m =>
                renderModelRow(
                  m,
                  <>
                    {modelStore.activeModelId !== m.id && (
                      <ActionBtn
                        label="设为当前"
                        onPress={() => modelStore.setActiveModel(m.id)}
                      />
                    )}
                    <ActionBtn
                      label="删除"
                      danger
                      onPress={() => confirmDeleteModel(m)}
                    />
                  </>,
                ),
              )}
            </SurfaceCard>
          ) : (
            <SurfaceCard style={styles.card}>
              <Text style={styles.emptyText}>没有已下载的对话模型。</Text>
              <ActionBtn
                label="去下载 →"
                onPress={() => navigation.navigate(ROUTES.MODELS)}
              />
            </SurfaceCard>
          )}
        </View>

        {/* ── 视觉投影模型 ── */}
        <View style={styles.section}>
          {renderSectionTitle('视觉模型（投影）', projections.length)}
          {projections.length > 0 ? (
            <SurfaceCard style={styles.card}>
              {projections.map(m =>
                renderModelRow(
                  m,
                  <ActionBtn
                    label="删除"
                    danger
                    onPress={() => confirmDeleteModel(m)}
                  />,
                ),
              )}
            </SurfaceCard>
          ) : (
            <SurfaceCard style={styles.card}>
              <Text style={styles.emptyText}>
                没有投影模型。图像识别用的多模态模型会自带或单独下载一个。
              </Text>
            </SurfaceCard>
          )}
        </View>

        {/* ── 语音合成模型 ── */}
        <View style={styles.section}>
          {renderSectionTitle('语音合成模型')}
          <SurfaceCard style={styles.card}>
            {ttsEngines.map((e, i) => (
              <View
                key={e.id}
                style={[styles.row, i > 0 && styles.rowDivider]}>
                <View style={styles.rowMain}>
                  <Text style={styles.rowTitle}>{e.name}</Text>
                  <Text style={styles.rowSub}>
                    {e.desc} · {formatBytes(e.bytes, 0, true)}
                    {e.state === 'ready' ? ' · 已安装' : ''}
                  </Text>
                  {e.state === 'downloading' ? (
                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          {width: `${Math.round(e.progress * 100)}%`},
                        ]}
                      />
                    </View>
                  ) : null}
                </View>
                <View style={styles.rowActions}>
                  {e.state === 'ready' ? (
                    <ActionBtn
                      label="删除"
                      danger
                      onPress={() => confirmRemoveTts(e.name, e.remove)}
                    />
                  ) : e.state === 'downloading' ? (
                    <Text style={styles.rowSub}>
                      {Math.round(e.progress * 100)}%
                    </Text>
                  ) : (
                    <ActionBtn label="下载" onPress={e.install} />
                  )}
                </View>
              </View>
            ))}
          </SurfaceCard>
        </View>

        {/* ── 图像生成模型 ── */}
        <View style={styles.section}>
          {renderSectionTitle('图像生成模型')}
          <SurfaceCard style={styles.card}>
            <Text style={styles.rowSub}>
              图像生成走你连接的 Stable Diffusion WebUI，模型文件在那一侧，不在本机，
              所以这里只展示不删除。
            </Text>
            <View style={styles.row}>
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle}>
                  {imageGenStore.serverUrl.trim() || '未配置服务地址'}
                </Text>
                <Text style={styles.rowSub}>
                  {imageGenStore.serverModels.length > 0
                    ? `服务端 ${imageGenStore.serverModels.length} 个模型`
                    : '尚未拉到模型列表'}
                </Text>
              </View>
              <View style={styles.rowActions}>
                <ActionBtn
                  label="刷新"
                  onPress={() => {
                    imageGenStore.probe().catch(() => undefined);
                  }}
                />
                <ActionBtn
                  label="去配置"
                  onPress={() => navigation.navigate(ROUTES.IMAGE_GEN)}
                />
              </View>
            </View>
          </SurfaceCard>
        </View>

        {/* ── 语音克隆 / 音色转换 ── */}
        <View style={styles.section}>
          {renderSectionTitle('语音克隆与音色转换')}
          <SurfaceCard style={styles.card}>
            <View style={styles.row}>
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle}>语音克隆（GPT-SoVITS）</Text>
                <Text style={styles.rowSub}>
                  已保存 {gptSovitsStore.roles.length} 个音色 ·
                  推理跑在本地引擎或你自己的服务端，无需下载大模型
                </Text>
              </View>
              <View style={styles.rowActions}>
                <ActionBtn
                  label="去管理"
                  onPress={() => {
                    uiStore.requestMoreSub('gptsovits');
                    navigation.navigate(ROUTES.CHAT);
                  }}
                />
              </View>
            </View>
            <View style={[styles.row, styles.rowDivider]}>
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle}>音色转换</Text>
                <Text style={styles.rowSub}>
                  {voiceChangeStore.modelName.trim()
                    ? `当前模型：${voiceChangeStore.modelName.trim()}`
                    : '未配置模型，走云端推理'}
                </Text>
              </View>
              <View style={styles.rowActions}>
                <ActionBtn
                  label="去配置"
                  onPress={() => {
                    uiStore.requestMoreSub('voiceChange');
                    navigation.navigate(ROUTES.CHAT);
                  }}
                />
              </View>
            </View>
          </SurfaceCard>
        </View>
      </ScrollView>
    </View>
  );
});

export default DownloadManagementScreen;
