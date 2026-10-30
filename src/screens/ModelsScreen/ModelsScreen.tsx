import React, {useState, useContext, useEffect} from 'react';
import {
  FlatList,
  RefreshControl,
  Platform,
  Alert,
  View,
  TouchableOpacity,
  StyleSheet,
  BackHandler,
} from 'react-native';

import {reaction, computed} from 'mobx';
import {v4 as uuidv4} from 'uuid';
import 'react-native-get-random-values';
import {observer} from 'mobx-react-lite';
import * as RNFS from '@dr.pogodin/react-native-fs';
import {pick, types} from '@react-native-documents/picker';
import {Portal, Text, Icon, ActivityIndicator} from 'react-native-paper';
import {GlassButton as Button} from '../../components/GlassButton';

import {useTheme} from '../../hooks';
import {Entrance} from '../../components/Entrance';
import {SurfaceCard} from '../../components/GlassSurface';
import {PillLabel} from '../../components/PillLabel';
import {dialogGlassTint} from '../../theme/cards';

import {FABGroup} from './FABGroup';
import {ModelCard} from './ModelCard';
import {createStyles} from './styles';
import {ModelAccordion} from './ModelAccordion';
import {
  DownloadErrorDialog,
  ErrorSnackbar,
  ModelSettingsSheet,
  ModelErrorReportSheet,
  ServerDetailsSheet,
} from '../../components';

import {
  uiStore,
  modelStore,
  hfStore,
  UIStore,
  serverStore,
  imageGenStore,
  ttsStore,
} from '../../store';
import {ModelConfigSheet} from './ModelConfigSheet';
import {AttachVisionSheet} from './ModelCard/AttachVisionSheet';
import {HFModelSearch} from './HFModelSearch';

import {L10nContext} from '../../utils';
import {t} from '../../locales';
import {useNavigation} from '@react-navigation/native';
import {ROUTES} from '../../utils/navigationConstants';
import {pickGgufFile, probeUri} from '../../services/modelUri';
import {ImportMethodDialog} from './ImportMethodDialog';
import {Model, ModelOrigin} from '../../utils/types';
import {ErrorState} from '../../utils/errors';

/* ── 模型页「按用途分类」用的小节标题与数据 ─────────────────────── */

const TTS_ENGINES: {id: 'supertonic' | 'kokoro' | 'kitten'; label: string}[] = [
  {id: 'supertonic', label: 'Supertonic'},
  {id: 'kokoro', label: 'Kokoro'},
  {id: 'kitten', label: 'Kitten'},
];

const ttsEngineState = (id: (typeof TTS_ENGINES)[number]['id']) =>
  id === 'supertonic'
    ? ttsStore.supertonicDownloadState
    : id === 'kokoro'
      ? ttsStore.kokoroDownloadState
      : ttsStore.kittenDownloadState;

/** 各引擎下载进度（0~1） */
const ttsEngineProgress = (id: (typeof TTS_ENGINES)[number]['id']) =>
  id === 'supertonic'
    ? ttsStore.supertonicDownloadProgress
    : id === 'kokoro'
      ? ttsStore.kokoroDownloadProgress
      : ttsStore.kittenDownloadProgress;

/** 触发对应引擎的真实下载 */
const triggerTtsDownload = (id: (typeof TTS_ENGINES)[number]['id']) => {
  if (id === 'supertonic') {
    return ttsStore.downloadSupertonic();
  }
  if (id === 'kokoro') {
    return ttsStore.downloadKokoro();
  }
  return ttsStore.downloadKitten();
};

const formatMb = (bytes?: number) =>
  bytes && bytes > 0 ? `${Math.round(bytes / (1024 * 1024))} MB` : '';

const catStyles = StyleSheet.create({
  section: {paddingHorizontal: 16, paddingTop: 20},
  footer: {paddingBottom: 24},
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // 标题玻璃胶囊与下方内容卡片拉开距离，避免贴太近
    marginBottom: 12,
  },
  headText: {flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1},
  // 标题玻璃胶囊：PillLabel 默认 alignSelf: flex-start，这里垂直居中并允许收缩
  titleGlass: {alignSelf: 'center', flexShrink: 1},
  marker: {width: 4, height: 16, borderRadius: 2},
  title: {fontSize: 15, fontWeight: '800'},
  action: {paddingVertical: 4, paddingHorizontal: 10, borderRadius: 13},
  actionText: {fontSize: 12, fontWeight: '700'},
  subtitle: {fontSize: 12, lineHeight: 17},
  subtitlePill: {alignSelf: 'stretch', marginTop: 4, marginBottom: 4},
  // 信息行：液态玻璃底（替代原来的灰色实底）。标准风格下 SurfaceCard 回退为
  // 实底，观感不变；液态玻璃/MIUIX 下走玻璃，与整页一致。
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  rowBody: {flex: 1, minWidth: 0},
  rowName: {flex: 1, fontSize: 13, fontWeight: '600'},
  rowSub: {fontSize: 11, marginTop: 2},
  empty: {fontSize: 12, lineHeight: 17},
  emptyPill: {alignSelf: 'stretch', marginTop: 6, marginBottom: 2},
  // 语音引擎卡片：比信息行更大、更醒目，右侧带下载按钮
  ttsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 16,
    marginTop: 10,
  },
  ttsIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ttsBody: {flex: 1, minWidth: 0},
  ttsName: {fontSize: 14, fontWeight: '700'},
  ttsSub: {fontSize: 11, marginTop: 2},
  ttsBtn: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  ttsBtnDisabled: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  ttsBtnText: {fontSize: 13, fontWeight: '700'},
  ttsDonePill: {flexDirection: 'row', alignItems: 'center', gap: 4},
  ttsDoneText: {fontSize: 12, fontWeight: '700'},
});

/**
 * 模型页分类小节标题：竖杠 + 标题 + 可选操作。用于把页面按「用途」分区
 * （对话/图像识别、图像生成、语音）。
 */
const CategorySection: React.FC<{
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  children?: React.ReactNode;
}> = ({title, subtitle, actionLabel, onAction, children}) => {
  const theme = useTheme();
  return (
    <View style={catStyles.section}>
      <View style={catStyles.headRow}>
        <PillLabel style={catStyles.titleGlass} radius={13} rimWidth={1.4}>
          <View style={catStyles.headText}>
            <View
              style={[
                catStyles.marker,
                {backgroundColor: theme.colors.secondary},
              ]}
            />
            <Text style={[catStyles.title, {color: theme.colors.onSurface}]}>
              {title}
            </Text>
          </View>
        </PillLabel>
        {actionLabel && onAction ? (
          <SurfaceCard
            onPress={onAction}
            radius={13}
            rimWidth={1.4}
            tint={theme.colors.primary}
            tintOpacity={0.18}
            style={catStyles.action}>
            <Text style={[catStyles.actionText, {color: theme.colors.primary}]}>
              {actionLabel} →
            </Text>
          </SurfaceCard>
        ) : null}
      </View>
      {subtitle ? (
        <PillLabel style={catStyles.subtitlePill} radius={13} rimWidth={1.4}>
          <Text
            style={[
              catStyles.subtitle,
              {color: theme.colors.onSurfaceVariant},
            ]}>
            {subtitle}
          </Text>
        </PillLabel>
      ) : null}
      {children}
    </View>
  );
};

/**
 * 「模型」页里通往视觉模型的入口卡。
 *
 * 图像识别（VisionScreen）用的是支持多模态的模型（如 Qwen2-VL）+ 配套的
 * mmproj 投影模型，和普通对话模型是两套东西。此前「模型」页里完全没有
 * 视觉模型的影子，用户加载好主模型后找不到去哪切视觉模型 —— 这张卡就是
 * 那个入口：显示当前视觉模型状态，一点进「视觉模型」页。
 */
/**
 * 空状态：一个模型都没有时的引导。
 *
 * 参考 App 的结构（我们只借它的「先给主按钮、再解释、再给去处」这个
 * 信息层级，不照抄文案）：
 *   ① 主按钮：导入本地 GGUF —— 用户来这个页面九成就是为了这个
 *   ② 说明卡：模型文件从哪来
 *   ③ 推荐去处：不会下载模型的话，去 HuggingFace 搜现成的
 */
const ModelsEmptyState: React.FC<{
  onImport: () => void;
  onOpenHfSearch: () => void;
}> = ({onImport, onOpenHfSearch}) => {
  const theme = useTheme();
  // 液态玻璃主题：说明卡 / 导入按钮 / 获取指南换成玻璃面板；
  // 其它主题保持原来的描边纸卡 + 实心按钮。
  const glassOn = uiStore.themeStyle === 'liquid-glass';

  return (
    <View style={emptyStyles.wrap}>
      <SurfaceCard
        style={[
          emptyStyles.tipBox,
          !glassOn && {borderColor: theme.colors.outlineVariant},
        ]}>
        <Text
          style={[emptyStyles.tipText, {color: theme.colors.onSurfaceVariant}]}>
          模型文件是 GGUF 格式（.gguf）。可以从Hugging Face 下载别人转换好的，
          也可以用 llama.cpp / Ollama 等工具把 Hugging Face 上的原始模型转成
          GGUF 放进手机，再点这里导入。
        </Text>
      </SurfaceCard>

      {glassOn ? (
        <SurfaceCard style={emptyStyles.importBtnGlass} radius={23}>
          <TouchableOpacity
            style={emptyStyles.importBtnHit}
            onPress={onImport}
            activeOpacity={0.7}>
            <Icon
              source="file-plus-outline"
              size={20}
              color={theme.colors.onSurface}
            />
            <Text
              style={[
                emptyStyles.importBtnText,
                {color: theme.colors.onSurface},
              ]}>
              从本地导入 GGUF 文件
            </Text>
          </TouchableOpacity>
        </SurfaceCard>
      ) : (
        <Button
          mode="contained"
          icon="file-plus-outline"
          onPress={onImport}
          style={emptyStyles.importBtn}
          contentStyle={emptyStyles.importBtnContent}>
          从本地导入 GGUF 文件
        </Button>
      )}

      <SurfaceCard
        style={[
          emptyStyles.infoCard,
          !glassOn && {borderColor: theme.colors.outlineVariant},
        ]}>
        <View style={emptyStyles.infoHead}>
          <Icon
            source="help-circle-outline"
            size={18}
            color={theme.colors.primary}
          />
          <Text
            style={[emptyStyles.infoTitle, {color: theme.colors.onSurface}]}>
            如何获取模型？
          </Text>
        </View>
        <Text
          style={[
            emptyStyles.infoBody,
            {color: theme.colors.onSurfaceVariant},
          ]}>
          ① 在 Hugging Face 搜 GGUF 格式的模型，下载 .gguf 文件
          {'\n'}② 把文件传到手机（数据线 / 网盘 / 文件互传都行）
          {'\n'}③ 回到这里点上面的按钮导入
        </Text>
      </SurfaceCard>

      <SurfaceCard
        onPress={onOpenHfSearch}
        radius={13}
        rimWidth={1.4}
        tint={theme.colors.primary}
        tintOpacity={0.18}
        style={emptyStyles.linkRow}>
        <Text style={[emptyStyles.linkText, {color: theme.colors.primary}]}>
          推荐模型 →
        </Text>
      </SurfaceCard>
    </View>
  );
};

const emptyStyles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 40,
  },
  tipBox: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
  },
  tipText: {
    fontSize: 12,
    lineHeight: 19,
  },
  importBtn: {
    borderRadius: 12,
    marginBottom: 18,
  },
  importBtnContent: {
    height: 46,
  },
  // 玻璃版导入按钮（与纸卡版同位置同高度）
  importBtnGlass: {
    borderRadius: 23,
    marginBottom: 18,
    overflow: 'hidden',
  },
  importBtnHit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 46,
  },
  importBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  infoCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  infoHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  infoTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  infoBody: {
    fontSize: 12,
    lineHeight: 20,
  },
  linkRow: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 13,
  },
  linkText: {
    fontSize: 14,
    fontWeight: '600',
  },
});

export const ModelsScreen: React.FC<{header?: React.ReactNode}> = observer(
  ({header}: {header?: React.ReactNode}) => {
    const l10n = useContext(L10nContext);
    const navigation = useNavigation<any>();
    const [refreshing, setRefreshing] = useState<boolean>(false);
    const [importMethodVisible, setImportMethodVisible] = useState(false);
    const [isCopyingModel, setIsCopyingModel] = useState(false);
    const [selectedModel, setSelectedModel] = useState<Model | undefined>();
    const [settingsVisible, setSettingsVisible] = useState(false);
    // 「配置模型参数」面板（加载配置 / 默认会话配置 / 视觉配置）
    const [configSheetVisible, setConfigSheetVisible] = useState(false);
    // 从参数面板的「视觉配置」跳到导入 MMProj 流程
    const [attachSheetVisible, setAttachSheetVisible] = useState(false);

    // Centralized error state tracking - derive directly from MobX stores
    const [activeError, setActiveError] = useState<ErrorState | null>(null);
    const [isShowingErrorDialog, setIsShowingErrorDialog] = useState(false);

    // Model error report sheet state
    const [isErrorReportVisible, setIsErrorReportVisible] = useState(false);
    const [errorToReport, setErrorToReport] = useState<ErrorState | null>(null);

    // Server details sheet（远端模型的添加入口已移到「设置 → AI 服务」）
    const [serverDetailsSheetVisible, setServerDetailsSheetVisible] =
      useState(false);
    // Hugging Face 模型搜索弹窗（空态「推荐模型 →」入口）
    const [hfSearchVisible, setHfSearchVisible] = useState(false);
    const [selectedServerId, setSelectedServerId] = useState<string | null>(
      null,
    );

    const theme = useTheme();
    const styles = createStyles(theme);

    // ── 弹窗的硬件返回键 ────────────────────────────────────────
    // RN 的 Modal / BottomSheet 在 Android 上默认不拦返回键，事件会冒泡到
    // App 的 BackHandler，于是「弹窗开着按返回」变成「直接退回主页」。
    // 这里按打开顺序反向关：一次只关最上面那个，和用户预期一致。
    useEffect(() => {
      if (Platform.OS !== 'android') {
        return;
      }
      // 顺序 = 打开的前后（后面的盖在前面的上面）
      const layers: [boolean, () => void][] = [
        [hfSearchVisible, () => setHfSearchVisible(false)],
        [serverDetailsSheetVisible, () => setServerDetailsSheetVisible(false)],
        [settingsVisible, () => setSettingsVisible(false)],
        [importMethodVisible, () => setImportMethodVisible(false)],
        [isErrorReportVisible, () => setIsErrorReportVisible(false)],
        [isShowingErrorDialog, () => setIsShowingErrorDialog(false)],
      ];
      if (!layers.some(([open]) => open)) {
        return;
      }
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        // 从后往前找第一个开着的（最上面那层）
        for (let i = layers.length - 1; i >= 0; i--) {
          if (layers[i][0]) {
            layers[i][1]();
            return true;
          }
        }
        return false;
      });
      return () => sub.remove();
    }, [
      hfSearchVisible,
      serverDetailsSheetVisible,
      settingsVisible,
      importMethodVisible,
      isErrorReportVisible,
      isShowingErrorDialog,
    ]);

    const filters = uiStore.pageStates.modelsScreen.filters;
    const expandedGroups = uiStore.pageStates.modelsScreen.expandedGroups;

    // Set up MobX reactions to track store changes
    useEffect(() => {
      // Create a reaction for error handling
      const errorDisposer = reaction(
        // Track these observable values
        () => ({
          hfError: hfStore.error,
          downloadError: modelStore.downloadError,
          modelLoadError: modelStore.modelLoadError,
        }),
        // React to changes
        data => {
          // First check if there's a download error that should show a dialog
          const hasDialogError =
            data.downloadError && data.downloadError.metadata?.modelId;

          setIsShowingErrorDialog(!!hasDialogError);

          // Then determine which error to show in the snackbar
          if (hasDialogError) {
            // If showing a dialog, don't show snackbar
            setActiveError(null);
          } else if (data.modelLoadError) {
            // Model load errors should show in snackbar
            setActiveError(data.modelLoadError);
          } else if (data.hfError) {
            // If we have an HF error, show it
            setActiveError(data.hfError);
          } else if (data.downloadError) {
            // For download errors without model ID, show in snackbar
            setActiveError(data.downloadError);
          } else {
            // No errors to show
            setActiveError(null);
          }
        },
      );

      // Clean up the reaction when component unmounts
      return () => {
        errorDisposer();
      };
    }, []); // Only run setup once

    const onRefresh = async () => {
      setRefreshing(true);
      await modelStore.refreshDownloadStatuses();
      setRefreshing(false);
    };

    const handleOpenSettings = (model: Model) => {
      setSelectedModel(model);
      setConfigSheetVisible(true);
    };

    const handleCloseSettings = () => {
      setSettingsVisible(false);
      setSelectedModel(undefined);
    };

    // 远端（云端）模型的统一入口已收敛到「设置 → AI 服务」：
    // 云端对话模型、远程服务器都在那儿配置，模型页不再单独开一个添加面板。
    const handleAddRemoteModel = () => {
      navigation.navigate(ROUTES.SETTINGS, {subPage: 'api'});
    };

    const handleManageServers = () => {
      const servers = serverStore.servers;
      if (servers.length === 1) {
        handleOpenServerDetails(servers[0].id);
      } else if (servers.length > 1) {
        Alert.alert(l10n.settings.manageServers, undefined, [
          ...servers.map(server => ({
            text: server.name,
            onPress: () => handleOpenServerDetails(server.id),
          })),
          {text: l10n.common.cancel, style: 'cancel' as const},
        ]);
      }
    };

    const handleOpenServerDetails = (serverId: string) => {
      setSelectedServerId(serverId);
      setServerDetailsSheetVisible(true);
    };

    const handleDismissError = () => {
      // Clear errors from all stores
      hfStore.clearError();
      modelStore.clearDownloadError();
      modelStore.clearModelLoadError();
    };

    const handleRetryAction = () => {
      if (activeError?.context === 'search') {
        hfStore.fetchModels();
      } else if (activeError?.context === 'download') {
        modelStore.retryDownload();
      } else if (activeError?.context === 'modelInit') {
        // Retry model initialization
        const modelId = activeError.metadata?.modelId;
        if (modelId) {
          const model = modelStore.models.find(m => m.id === modelId);
          if (model) {
            modelStore.selectModel(model);
          }
        }
      }
      handleDismissError();
    };

    const handleReportModelError = () => {
      if (activeError?.context === 'modelInit') {
        setErrorToReport(activeError);
        setIsErrorReportVisible(true);
        handleDismissError();
      }
    };

    const handleCloseErrorReport = () => {
      setIsErrorReportVisible(false);
      setErrorToReport(null);
    };

    const handleAddLocalModel = () => {
      if (isCopyingModel) {
        return;
      }
      setImportMethodVisible(true);
    };

    /** 方式一：直接引用外部文件（content://，零拷贝） */
    const doImportByReference = async () => {
      setImportMethodVisible(false);
      try {
        const file = await pickGgufFile();
        if (!file) {
          return;
        }
        setIsCopyingModel(true);
        const ok = await probeUri(file.uri);
        if (!ok) {
          Alert.alert(
            '无法读取该文件',
            '系统没有授予持久读取权限，或该文件已被移动/删除。请换一个文件，或改用「复制导入」。',
          );
          return;
        }
        await modelStore.addLocalModelByUri(file.uri, file.name, file.size);
        Alert.alert(
          '导入成功（零拷贝）',
          `模型：${file.name}\n\n模型路径：${file.uri}\n\n` +
            '文件本体仍在原位置，App 未占用额外存储。若源文件被移动或删除，需要重新导入。',
        );
      } catch (e) {
        Alert.alert('导入失败', e instanceof Error ? e.message : String(e));
      } finally {
        setIsCopyingModel(false);
      }
    };

    /** 方式二：复制到 App 目录（传统方式，占空间但最稳） */
    const doImportByCopy = async () => {
      setImportMethodVisible(false);
      pick({
        type: Platform.OS === 'ios' ? 'public.data' : types.allFiles,
      })
        .then(async res => {
          let [file] = res;
          if (file) {
            // Assign a default name if file.name is null or undefined
            // Not sure if this can ever happen, though.
            let fileName =
              file.name || file.uri.split('/').pop() || `file_${uuidv4()}`;

            const permanentDir = `${RNFS.DocumentDirectoryPath}/models/local`;
            let permanentPath = `${permanentDir}/${fileName}`;
            if (!(await RNFS.exists(permanentDir))) {
              await RNFS.mkdir(permanentDir);
            }

            if (await RNFS.exists(permanentPath)) {
              const choice = await new Promise<'replace' | 'keep' | 'cancel'>(
                resolve => {
                  Alert.alert(
                    l10n.models.fileManagement.fileAlreadyExists,
                    l10n.models.fileManagement.fileAlreadyExistsMessage,
                    [
                      {
                        text: l10n.models.fileManagement.replace,
                        onPress: () => resolve('replace'),
                      },
                      {
                        text: l10n.models.fileManagement.keepBoth,
                        onPress: () => resolve('keep'),
                      },
                      {
                        text: l10n.common.cancel,
                        onPress: () => resolve('cancel'),
                        style: 'cancel',
                      },
                    ],
                  );
                },
              );

              switch (choice) {
                case 'replace':
                  await RNFS.unlink(permanentPath);
                  modelStore.removeModelByFullPath(permanentPath);
                  break;
                case 'keep':
                  let counter = 1;
                  const nameParts = fileName.split('.');
                  const ext = nameParts.length > 1 ? nameParts.pop() : '';
                  const name = nameParts.join('.');
                  do {
                    permanentPath = `${permanentDir}/${name}_${counter}.${ext}`;
                    counter++;
                  } while (await RNFS.exists(permanentPath));
                  break;
                case 'cancel':
                  console.log('File copy cancelled by user');
                  return;
              }
            }

            try {
              setIsCopyingModel(true);
              await RNFS.copyFile(file.uri, permanentPath);
              await modelStore.addLocalModel(permanentPath);
            } catch (e) {
              Alert.alert(
                l10n.models.fileManagement.copyFailed,
                e instanceof Error ? e.message : String(e),
              );
            } finally {
              setIsCopyingModel(false);
            }
          }
        })
        .catch(e => console.log('No file picked, error: ', e.message));
    };

    const activeModelId = modelStore.activeModel?.id;
    const models = modelStore.displayModels;

    // 图像生成：按本机档位推荐一个适配的 SD1.5 GGUF，并提供一键下载状态。
    const recSd = imageGenStore.recommendedSdDownload(
      modelStore.deviceTier ?? undefined,
    );
    const sdDownloading = imageGenStore.downloadingLocal;
    const sdPct = Math.round(imageGenStore.downloadProgress * 100);
    const sdRecName = recSd.fileName.replace(/\.gguf$/i, '');
    const sdRecAlready = imageGenStore.localModels.some(
      m => m.name === sdRecName,
    );

    // useMemo uses shallow comaprison for dependencies,
    // so we use computed instead for deep comparison
    // (model state changes not-downloaded -> downloaded)
    const filteredAndSortedModels = computed(() => {
      let result = models;
      if (filters.includes('downloaded')) {
        result = result.filter(model => model.isDownloaded);
      }
      if (!filters.includes('grouped')) {
        result = result.sort((a, b) => {
          if (a.isDownloaded && !b.isDownloaded) {
            return -1;
          }
          if (!a.isDownloaded && b.isDownloaded) {
            return 1;
          }
          return 0;
        });
      }
      if (filters.includes('hf')) {
        result = result.filter(model => model.origin === ModelOrigin.HF);
      }
      return result;
    }).get();

    const getGroupDisplayName = (key: string) => {
      switch (key) {
        case UIStore.GROUP_KEYS.READY_TO_USE:
          return l10n.models.labels.availableToUse;
        case UIStore.GROUP_KEYS.AVAILABLE_TO_DOWNLOAD:
          return l10n.models.labels.availableToDownload;
        default:
          return key;
      }
    };

    // 当前设备被判定出的档位（low / mid / high / flagship 由设备规则引擎给出）
    const deviceTierLabel = modelStore.deviceTier
      ? l10n.models.labels.deviceTier[modelStore.deviceTier]
      : undefined;

    const groupedModels = computed(() => {
      if (!filters.includes('grouped')) {
        return {
          [UIStore.GROUP_KEYS.READY_TO_USE]: filteredAndSortedModels.filter(
            model => model.isDownloaded,
          ),
          // 「推荐模型」：设备规则引擎按手机档位挑出来的（isRulePreset）排最前
          [UIStore.GROUP_KEYS.AVAILABLE_TO_DOWNLOAD]: filteredAndSortedModels
            .filter(model => !model.isDownloaded)
            .sort(
              (a, b) =>
                Number(Boolean(b.isRulePreset)) -
                Number(Boolean(a.isRulePreset)),
            ),
        };
      }

      return filteredAndSortedModels.reduce(
        (acc, item) => {
          const groupKey =
            item.origin === ModelOrigin.LOCAL || item.isLocal
              ? l10n.models.labels.localModel
              : item.type || l10n.models.labels.unknownGroup;

          if (!acc[groupKey]) {
            acc[groupKey] = [];
          }
          acc[groupKey].push(item);
          return acc;
        },
        {} as Record<string, Model[]>,
      );
    }).get();

    const toggleGroup = (type: string) => {
      const currentExpandedGroups =
        uiStore.pageStates.modelsScreen.expandedGroups;
      const updatedExpandedGroups = {
        ...currentExpandedGroups,
        [type]: !currentExpandedGroups[type],
      };
      uiStore.setValue('modelsScreen', 'expandedGroups', updatedExpandedGroups);
    };

    const renderGroupHeader = ({item: group, index}) => {
      // 空态（一个已下载/可用模型都没有）时，「推荐模型」分组默认展开，
      // 让用户一进模型页就能直接看到可下载的推荐项（截图反馈的诉求）。
      // 一旦有任一可用模型则恢复默认收起；用户手动展开/收起后以持久化值为准。
      const noDownloadedModels = !modelStore.models.some(m => m.isDownloaded);
      const isExpanded =
        expandedGroups[group.type] ??
        (group.type === UIStore.GROUP_KEYS.AVAILABLE_TO_DOWNLOAD &&
          noDownloadedModels);
      const displayName = filters.includes('grouped')
        ? group.type
        : getGroupDisplayName(group.type);
      // 「推荐模型」分组：关掉点击动画（表头水波纹 + 卡片按压缩放/高光）
      const isRecommendedGroup =
        !filters.includes('grouped') &&
        group.type === UIStore.GROUP_KEYS.AVAILABLE_TO_DOWNLOAD;
      const description = isRecommendedGroup
        ? deviceTierLabel
          ? t(l10n.models.labels.recommendedForDevice, {tier: deviceTierLabel})
          : l10n.models.labels.useAddButtonForMore
        : undefined;
      return (
        <Entrance index={index ?? 0} screenKey="models">
          <ModelAccordion
            group={{...group, type: displayName}}
            expanded={isExpanded}
            description={description}
            flatPress={isRecommendedGroup}
            onPress={() => toggleGroup(group.type)}>
            <FlatList
              data={group.items}
              keyExtractor={subItem => subItem.id}
              renderItem={({item: subItem}) => (
                <ModelCard
                  model={subItem}
                  activeModelId={activeModelId}
                  flatPress={isRecommendedGroup}
                  onOpenSettings={() => handleOpenSettings(subItem)}
                  onOpenServerDetails={handleOpenServerDetails}
                />
              )}
            />
          </ModelAccordion>
        </Entrance>
      );
    };

    const flatListModels = Object.keys(groupedModels)
      .map(type => ({
        type,
        items: groupedModels[type],
      }))
      .filter(group => group.items.length > 0);

    return (
      <View style={styles.container} testID="models-screen">
        {/* Show Error Snackbar only if no dialog is visible */}
        {!isShowingErrorDialog && activeError && (
          <ErrorSnackbar
            error={activeError}
            onDismiss={handleDismissError}
            onRetry={handleRetryAction}
            onReport={handleReportModelError}
          />
        )}

        <FlatList
          testID="flat-list"
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <>
              {header}
              {/* 分类一：对话与图像识别（GGUF 主模型 + 多模态） */}
              {flatListModels.length > 0 ? (
                <CategorySection
                  title="对话与图像识别模型"
                  subtitle="GGUF · 本机或远程；支持多模态的模型可用于图像识别"
                />
              ) : null}
              {/* 视觉模型入口卡已移除：视觉能力现在直接在模型卡片的
                类型 chip（视觉/投影）+ 「配置模型参数 → 视觉配置」里管理，
                不需要再单独开一个入口页。 */}
              {flatListModels.length === 0 ? (
                // 初始化未完成前显示加载中，避免冷启动/刚清数据时闪一下误导人的空状态
                modelStore.isInitialized ? (
                  <ModelsEmptyState
                    onImport={handleAddLocalModel}
                    onOpenHfSearch={() => setHfSearchVisible(true)}
                  />
                ) : (
                  <View style={{paddingVertical: 48, alignItems: 'center'}}>
                    <ActivityIndicator size="small" />
                  </View>
                )
              ) : null}
            </>
          }
          contentContainerStyle={styles.listContainer}
          data={flatListModels}
          keyExtractor={item => item.type}
          extraData={activeModelId}
          renderItem={renderGroupHeader}
          ListFooterComponent={
            <View style={catStyles.footer}>
              {/* 分类二：图像生成模型（本机 SD 权重，来自图像生成页） */}
              <CategorySection
                title="图像生成模型"
                subtitle={`本机 SD 权重 · ${imageGenStore.localModels.length} 个`}
                actionLabel="打开图像生成"
                onAction={() => navigation.navigate(ROUTES.IMAGE_GEN)}>
                {/* 推荐下载：按本机档位自动选一个适配的 SD1.5 GGUF */}
                <SurfaceCard
                  style={catStyles.ttsCard}
                  radius={16}
                  rimWidth={1.6}>
                  <View
                    style={[
                      catStyles.ttsIconWrap,
                      {
                        backgroundColor: theme.dark
                          ? 'rgba(255,255,255,0.08)'
                          : 'rgba(125,125,128,0.10)',
                      },
                    ]}>
                    <Icon
                      source="image-outline"
                      size={22}
                      color={theme.colors.primary}
                    />
                  </View>
                  <View style={catStyles.ttsBody}>
                    <Text
                      style={[
                        catStyles.ttsName,
                        {color: theme.colors.onSurface},
                      ]}>
                      {recSd.label}
                    </Text>
                    <Text
                      style={[
                        catStyles.ttsSub,
                        {
                          color: sdDownloading
                            ? theme.colors.primary
                            : theme.colors.onSurfaceVariant,
                        },
                      ]}>
                      {sdDownloading
                        ? `下载中 ${sdPct}%`
                        : sdRecAlready
                          ? '已下载'
                          : `适配本机 · ${recSd.sizeGB} GB`}
                    </Text>
                  </View>
                  {sdDownloading ? (
                    <View style={catStyles.ttsBtnDisabled}>
                      <Text
                        style={[
                          catStyles.ttsBtnText,
                          {color: theme.colors.onSurfaceVariant},
                        ]}>
                        {sdPct}%
                      </Text>
                    </View>
                  ) : sdRecAlready ? (
                    <View style={catStyles.ttsDonePill}>
                      <Icon
                        source="check-circle"
                        size={16}
                        color={theme.colors.primary}
                      />
                      <Text
                        style={[
                          catStyles.ttsDoneText,
                          {color: theme.colors.primary},
                        ]}>
                        已装
                      </Text>
                    </View>
                  ) : (
                    <SurfaceCard
                      onPress={() =>
                        imageGenStore.downloadRecommendedModel(
                          modelStore.deviceTier ?? undefined,
                        )
                      }
                      radius={12}
                      rimWidth={1.4}
                      tint={theme.colors.primary}
                      tintOpacity={0.22}
                      style={catStyles.ttsBtn}>
                      <Text
                        style={[
                          catStyles.ttsBtnText,
                          {color: theme.colors.primary},
                        ]}>
                        下载
                      </Text>
                    </SurfaceCard>
                  )}
                </SurfaceCard>

                {/* 已下载的本机 SD 权重 */}
                {imageGenStore.localModels.slice(0, 5).map(m => (
                  <SurfaceCard
                    key={m.id}
                    style={catStyles.row}
                    radius={12}
                    rimWidth={1.4}>
                    <Icon
                      source="image-outline"
                      size={18}
                      color={theme.colors.primary}
                    />
                    <View style={catStyles.rowBody}>
                      <Text
                        style={[
                          catStyles.rowName,
                          {color: theme.colors.onSurface},
                        ]}
                        numberOfLines={1}>
                        {m.name}
                      </Text>
                      {m.sizeBytes ? (
                        <Text
                          style={[
                            catStyles.rowSub,
                            {color: theme.colors.onSurfaceVariant},
                          ]}>
                          {formatMb(m.sizeBytes)}
                        </Text>
                      ) : null}
                    </View>
                  </SurfaceCard>
                ))}
                {imageGenStore.localModels.length === 0 ? (
                  <PillLabel
                    style={catStyles.emptyPill}
                    radius={13}
                    rimWidth={1.4}>
                    <Text
                      style={[
                        catStyles.empty,
                        {color: theme.colors.onSurfaceVariant},
                      ]}>
                      点上方「下载」自动获取适配本机的 SD1.5
                      权重；也可去「图像生成」页导入本地 .gguf。
                    </Text>
                  </PillLabel>
                ) : null}
              </CategorySection>

              {/* 分类三：语音模型（本地 TTS 引擎） */}
              <CategorySection
                title="语音模型"
                subtitle={`本地 TTS 引擎 · 已安装 ${
                  TTS_ENGINES.filter(e => ttsEngineState(e.id) === 'ready')
                    .length
                }/${TTS_ENGINES.length}`}>
                {TTS_ENGINES.map(e => {
                  const st = ttsEngineState(e.id);
                  const ready = st === 'ready';
                  const downloading = st === 'downloading';
                  const errored = st === 'error';
                  const pct = Math.round(ttsEngineProgress(e.id) * 100);
                  const statusText = ready
                    ? '已安装'
                    : downloading
                      ? `下载中 ${pct}%`
                      : errored
                        ? '下载失败'
                        : '未安装';
                  return (
                    <SurfaceCard
                      key={e.id}
                      style={catStyles.ttsCard}
                      radius={16}
                      rimWidth={1.6}>
                      <View
                        style={[
                          catStyles.ttsIconWrap,
                          {
                            backgroundColor: theme.dark
                              ? 'rgba(255,255,255,0.08)'
                              : 'rgba(125,125,128,0.10)',
                          },
                        ]}>
                        <Icon
                          source="waveform"
                          size={22}
                          color={theme.colors.primary}
                        />
                      </View>
                      <View style={catStyles.ttsBody}>
                        <Text
                          style={[
                            catStyles.ttsName,
                            {color: theme.colors.onSurface},
                          ]}>
                          {e.label}
                        </Text>
                        <Text
                          style={[
                            catStyles.ttsSub,
                            {
                              color: ready
                                ? theme.colors.primary
                                : errored
                                  ? theme.colors.error
                                  : theme.colors.onSurfaceVariant,
                            },
                          ]}>
                          {statusText}
                        </Text>
                      </View>
                      {ready ? (
                        <View style={catStyles.ttsDonePill}>
                          <Icon
                            source="check-circle"
                            size={16}
                            color={theme.colors.primary}
                          />
                          <Text
                            style={[
                              catStyles.ttsDoneText,
                              {color: theme.colors.primary},
                            ]}>
                            已装
                          </Text>
                        </View>
                      ) : downloading ? (
                        <View style={catStyles.ttsBtnDisabled}>
                          <Text
                            style={[
                              catStyles.ttsBtnText,
                              {color: theme.colors.onSurfaceVariant},
                            ]}>
                            {pct}%
                          </Text>
                        </View>
                      ) : (
                        <SurfaceCard
                          onPress={() => triggerTtsDownload(e.id)}
                          radius={12}
                          rimWidth={1.4}
                          tint={theme.colors.primary}
                          tintOpacity={0.22}
                          style={catStyles.ttsBtn}>
                          <Text
                            style={[
                              catStyles.ttsBtnText,
                              {color: theme.colors.primary},
                            ]}>
                            {errored ? '重试' : '下载'}
                          </Text>
                        </SurfaceCard>
                      )}
                    </SurfaceCard>
                  );
                })}
                <PillLabel
                  style={catStyles.emptyPill}
                  radius={13}
                  rimWidth={1.4}>
                  <Text
                    style={[
                      catStyles.empty,
                      {color: theme.colors.onSurfaceVariant},
                    ]}>
                    可直接点右侧「下载」安装；切换音色请到「更多 → 生成语音」。
                  </Text>
                </PillLabel>
              </CategorySection>
            </View>
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[theme.colors.primary]}
            />
          }
        />

        {/* DownloadErrorDialog with Portal for better visibility */}
        <Portal>
          <DownloadErrorDialog
            visible={isShowingErrorDialog}
            onDismiss={() => {
              modelStore.clearDownloadError();
            }}
            error={modelStore.downloadError}
            model={
              modelStore.downloadError?.metadata?.modelId
                ? modelStore.models.find(
                    m => m.id === modelStore.downloadError?.metadata?.modelId,
                  )
                : undefined
            }
            onTryAgain={modelStore.retryDownload}
          />
        </Portal>

        {/* 导入方式选择（直接引用 / 复制到 App 目录） */}
        <ImportMethodDialog
          visible={importMethodVisible}
          onDismiss={() => setImportMethodVisible(false)}
          onPick={method =>
            method === 'reference' ? doImportByReference() : doImportByCopy()
          }
        />

        {/* 正在复制模型：玻璃胶囊浮在底部导航栏上方（Snackbar 会被导航栏挡住） */}
        {isCopyingModel ? (
          <View
            pointerEvents="none"
            style={styles.copyingOverlay}
            testID="copy-model-snackbar">
            <SurfaceCard
              style={styles.copyingPill}
              tint={dialogGlassTint(theme)}
              tintOpacity={0.72}
              blur
              blurAmount={40}
              blurRounds={4}
              forceFrosted
              rimWidth={1.4}>
              <ActivityIndicator size={16} color={theme.colors.primary} />
              <Text
                style={[styles.copyingText, {color: theme.colors.onSurface}]}>
                {l10n.models.fileManagement.copyingModel}
              </Text>
            </SurfaceCard>
          </View>
        ) : null}
        <FABGroup
          onAddLocalModel={handleAddLocalModel}
          onAddRemoteModel={handleAddRemoteModel}
          onManageServers={handleManageServers}
          hasServers={serverStore.servers.length > 0}
        />
        <ModelSettingsSheet
          isVisible={settingsVisible}
          onClose={handleCloseSettings}
          model={selectedModel}
        />
        {selectedModel ? (
          <>
            <ModelConfigSheet
              visible={configSheetVisible}
              model={selectedModel}
              onClose={() => setConfigSheetVisible(false)}
              onPickExistingVision={() => {
                // 「导入 MMProj 文件」现在直接在面板内完成（选文件→校验→绑定）；
                // 这个回调是给「从已导入的模型中选择」用的
                setConfigSheetVisible(false);
                setTimeout(() => setAttachSheetVisible(true), 220);
              }}
            />
            <AttachVisionSheet
              visible={attachSheetVisible}
              model={selectedModel}
              onClose={() => {
                setAttachSheetVisible(false);
                setConfigSheetVisible(true);
              }}
            />
          </>
        ) : null}
        <ModelErrorReportSheet
          isVisible={isErrorReportVisible}
          onClose={handleCloseErrorReport}
          error={errorToReport}
        />
        <HFModelSearch
          visible={hfSearchVisible}
          onDismiss={() => setHfSearchVisible(false)}
        />
        <ServerDetailsSheet
          isVisible={serverDetailsSheetVisible}
          onDismiss={() => {
            setServerDetailsSheetVisible(false);
            setSelectedServerId(null);
          }}
          serverId={selectedServerId}
        />
      </View>
    );
  },
);
