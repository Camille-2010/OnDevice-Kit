import React, {useCallback, useState, useEffect, useMemo} from 'react';
import {Alert, View, TouchableOpacity, UIManager, Platform} from 'react-native';

import {observer} from 'mobx-react-lite';
import {useNavigation} from '@react-navigation/native';
import {DrawerNavigationProp} from '@react-navigation/drawer';
import {
  Icon,
  ProgressBar,
  IconButton,
  Text,
  TouchableRipple,
  Snackbar,
  HelperText,
} from 'react-native-paper';
import {GlassButton as Button} from '../../../components/GlassButton';

import {useTheme, useMemoryCheck, useStorageCheck} from '../../../hooks';
import {buttonRing} from '../../../theme/cards';

import {createStyles} from './styles';

import {getModelKind, MODEL_KIND_LABEL} from '../../../utils/modelKind';
import {ModelInfoOverlay} from '../../../components/ModelInfoOverlay';
import {GlassIconButton} from '../../../components/GlassIconButton';

import {uiStore, modelStore, serverStore} from '../../../store';
import {t} from '../../../locales';
import {SurfaceCard} from '../../../components/GlassSurface';
import {PillLabel} from '../../../components/PillLabel';

import {
  Model,
  ModelOrigin,
  ModelType,
  RootDrawerParamList,
} from '../../../utils/types';
import {
  getModelSizeString,
  L10nContext,
  checkModelFileIntegrity,
  isDraftOnlyModel,
} from '../../../utils';

import {
  TrashIcon,
  SettingsIcon,
  EyeIcon,
  ProjectorIcon,
  ChatIcon,
  WavesIcon,
  XIcon,
} from '../../../assets/icons';

type ChatScreenNavigationProp = DrawerNavigationProp<RootDrawerParamList>;

interface ModelCardProps {
  model: Model;
  activeModelId?: string;
  onFocus?: () => void;
  onOpenSettings?: () => void;
  onOpenServerDetails?: (serverId: string) => void;
  /**
   * 关掉卡片内所有按钮的按压动画（缩放 0.88 + 高光）。
   *
   * 只给「推荐模型」分组用：那一组是浏览/挑选为主，按压回弹反而显得
   * 每次点击都在动。`PressFeedback` 在 scaleTo===1 且 glowOpacity===0 时
   * 会直接跳过动画，所以这里传这两个值就够了，不用改组件。
   */
  flatPress?: boolean;
}

// Enable LayoutAnimation on Android
if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export const ModelCard: React.FC<ModelCardProps> = observer(
  ({model, activeModelId, onOpenSettings, onOpenServerDetails, flatPress}) => {
    const l10n = React.useContext(L10nContext);
    const theme = useTheme();
    const styles = createStyles(theme);

    // TouchableOpacity 的默认 activeOpacity 是 0.2（按下变半透明）；
    // flatPress 时给 1，按下完全不变色。
    const pressActiveOpacity = flatPress ? 1 : undefined;

    const navigation = useNavigation<ChatScreenNavigationProp>();

    const [snackbarVisible, setSnackbarVisible] = useState(false); // Snackbar visibility
    const [integrityError, setIntegrityError] = useState<string | null>(null);
    // 「模型信息」悬浮窗（取代原来卡片的展开详情）
    const [infoVisible, setInfoVisible] = useState(false);

    // Mirrors ModelStore.checkMemoryAndConfirm's projection-model resolution.
    const projectionModelForCheck = useMemo(
      () => {
        if (
          model.supportsMultimodal &&
          modelStore.getModelVisionPreference(model) &&
          model.defaultProjectionModel
        ) {
          return modelStore.models.find(
            m => m.id === model.defaultProjectionModel,
          );
        }
        return undefined;
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps -- MobX observable tracked by observer()
      [model, modelStore.models],
    );

    const {memoryWarning, shortMemoryWarning, multimodalWarning} =
      useMemoryCheck(model, projectionModelForCheck);
    const {isOk: storageOk, message: storageNOkMessage} = useStorageCheck(
      model,
      {
        enablePeriodicCheck: true,
        checkInterval: 10000,
      },
    );

    const isActiveModel = activeModelId === model.id;
    const isDraftOnly = isDraftOnlyModel(model);
    const isDownloaded = model.isDownloaded;
    const isDownloading = modelStore.isDownloading(model.id);
    const isHfModel = model.origin === ModelOrigin.HF;
    const isRemoteModel = model.origin === ModelOrigin.REMOTE;
    const cardId = model.filename || model.id;

    const modelCaps = modelStore.capsFor(model);
    const visionLabel =
      modelCaps.vision === 'yes'
        ? l10n.models.modelCard.labels.visionSupported
        : modelCaps.vision === 'no'
          ? l10n.models.modelCard.labels.visionNotSupported
          : l10n.models.modelCard.labels.visionUnknown;

    // Check projection model status for downloaded vision models
    const projectionModelStatus = modelStore.getProjectionModelStatus(model);
    const hasProjectionModelWarning =
      isDownloaded &&
      model.supportsMultimodal &&
      modelStore.getModelVisionPreference(model) && // Only show warning when vision is enabled
      projectionModelStatus.state === 'missing';

    // Check integrity when model is downloaded (skip remote models — no local file)
    useEffect(() => {
      if (isDownloaded && !isRemoteModel) {
        checkModelFileIntegrity(model).then(({errorMessage}) => {
          setIntegrityError(errorMessage);
        });
      } else {
        setIntegrityError(null);
      }
    }, [isDownloaded, isRemoteModel, model]);

    const handleDelete = useCallback(() => {
      if (model.isDownloaded) {
        // Special handling for projection models
        if (model.modelType === ModelType.PROJECTION) {
          const canDeleteResult = modelStore.canDeleteProjectionModel(model.id);

          if (!canDeleteResult.canDelete) {
            // Show error dialog with specific reason
            let message =
              canDeleteResult.reason ||
              l10n.models.multimodal.cannotDeleteTitle;

            if (
              canDeleteResult.reason === 'Projection model is currently active'
            ) {
              message = l10n.models.multimodal.cannotDeleteActive;
            } else if (
              canDeleteResult.dependentModels &&
              canDeleteResult.dependentModels.length > 0
            ) {
              const modelNames = canDeleteResult.dependentModels
                .map(m => m.name)
                .join(', ');
              message = `${l10n.models.multimodal.cannotDeleteInUse}\n\n${l10n.models.multimodal.dependentModels} ${modelNames}`;
            }

            Alert.alert(l10n.models.multimodal.cannotDeleteTitle, message, [
              {text: l10n.common.ok, style: 'default'},
            ]);
            return;
          }

          // Show projection-specific confirmation dialog
          Alert.alert(
            l10n.models.multimodal.deleteProjectionTitle,
            l10n.models.multimodal.deleteProjectionMessage,
            [
              {text: l10n.common.cancel, style: 'cancel'},
              {
                text: l10n.common.delete,
                style: 'destructive',
                onPress: async () => {
                  try {
                    await modelStore.deleteModel(model);
                  } catch (error) {
                    console.error('Failed to delete projection model:', error);
                    Alert.alert(
                      l10n.models.multimodal.cannotDeleteTitle,
                      error instanceof Error
                        ? error.message
                        : 'Unknown error occurred',
                      [{text: l10n.common.ok, style: 'default'}],
                    );
                  }
                },
              },
            ],
          );
        } else {
          // Standard model deletion
          Alert.alert(
            l10n.models.modelCard.alerts.deleteTitle,
            l10n.models.modelCard.alerts.deleteMessage,
            [
              {text: l10n.common.cancel, style: 'cancel'},
              {
                text: l10n.common.delete,
                onPress: async () => {
                  await modelStore.deleteModel(model);
                },
              },
            ],
          );
        }
      }
    }, [model, l10n]);

    const handleRemove = useCallback(() => {
      Alert.alert(
        l10n.models.modelCard.alerts.removeTitle,
        l10n.models.modelCard.alerts.removeMessage,
        [
          {text: l10n.common.cancel, style: 'cancel'},
          {
            text: l10n.models.modelCard.buttons.remove,
            style: 'destructive',
            onPress: () => modelStore.removeModelFromList(model),
          },
        ],
      );
    }, [model, l10n]);

    const handleWarningPress = () => {
      setSnackbarVisible(true);
    };

    // 模型类型图标：按 图像 / 语音 / 文本 换图标 + 换颜色，
    // 和名字前面的类型标签是同一套色彩语言，扫一眼就能对上。
    //
    // 远程模型的视觉能力是运行时从服务器 fetch 回来的（modelCaps.vision），
    // 不在 supportsMultimodal 里，所以要先让服务器的能力说话，本地模型才
    // 走 GGUF architecture 那条路（顺带识别语音模型）。
    const kind: ReturnType<typeof getModelKind> =
      modelCaps.vision === 'yes' ? 'vision' : getModelKind(model);
    const KIND_ICON_STROKE: Record<typeof kind, {stroke: string; bg: string}> =
      {
        vision: {
          stroke: theme.colors.iconModelTypeVision,
          bg: theme.colors.secondaryContainer,
        },
        // 投影模型（mmproj）不是对话模型，用琥珀色区分
        projection: {
          stroke: theme.dark ? '#FBBF24' : '#B45309',
          bg: theme.dark ? 'rgba(251,191,36,0.16)' : 'rgba(245,158,11,0.16)',
        },
        audio: {
          stroke: theme.dark ? '#34D399' : '#0F766E',
          bg: 'rgba(16,185,129,0.16)',
        },
        text: {
          stroke: theme.colors.iconModelTypeText,
          bg: theme.colors.surfaceVariant,
        },
      };

    const getModelTypeIcon = () => {
      const tone = KIND_ICON_STROKE[kind];
      const icon =
        kind === 'vision' ? (
          <EyeIcon width={15} height={15} stroke={tone.stroke} />
        ) : kind === 'projection' ? (
          <ProjectorIcon width={15} height={15} stroke={tone.stroke} />
        ) : kind === 'audio' ? (
          <WavesIcon width={15} height={15} stroke={tone.stroke} />
        ) : (
          <ChatIcon width={15} height={15} stroke={tone.stroke} />
        );
      return (
        <PillLabel
          radius={10}
          backdrop="wallpaper"
          style={styles.modelTypeIconGlass}>
          <View
            style={[styles.modelTypeIcon, {backgroundColor: 'transparent'}]}
            testID={`model-card-vision-${model.id}`}
            accessible={isRemoteModel}
            accessibilityLabel={
              isRemoteModel
                ? `${l10n.models.modelCard.labels.vision}: ${visionLabel}`
                : undefined
            }>
            {icon}
          </View>
        </PillLabel>
      );
    };

    // Helper function to get status dot
    const getStatusDot = () => {
      if (!isDownloaded) {
        return null;
      }
      return (
        <View
          style={[
            styles.statusDot,
            {
              backgroundColor: isActiveModel
                ? theme.colors.bgStatusActive
                : theme.colors.bgStatusIdle,
            },
          ]}
        />
      );
    };

    // Helper function to toggle expanded state with smooth LayoutAnimation
    /** 打开「模型信息」悬浮窗（原来这个按钮是展开/收起详情） */
    const openModelInfo = useCallback(() => {
      setInfoVisible(true);
    }, []);

    const handleRemoteDelete = useCallback(() => {
      if (!model.serverId || !model.remoteModelId) {
        return;
      }
      const sName = model.serverName || 'Remote';
      Alert.alert(
        l10n.common.delete,
        t(l10n.settings.removeRemoteModel, {
          modelName: model.name,
          serverName: sName,
        }),
        [
          {text: l10n.common.cancel, style: 'cancel'},
          {
            text: l10n.common.delete,
            style: 'destructive',
            onPress: () => {
              if (isActiveModel) {
                modelStore.manualReleaseContext();
              }
              serverStore.removeUserSelectedModel(
                model.serverId!,
                model.remoteModelId!,
              );
              serverStore.removeServerIfOrphaned(model.serverId!);
            },
          },
        ],
      );
    }, [model, l10n, isActiveModel]);

    const renderActionButtons = () => {
      // Remote models: load/offload + settings (reasoning override) + delete
      if (isRemoteModel) {
        return (
          <View style={styles.actionButtonsRow}>
            {renderModelLoadButton()}
            <GlassIconButton
              testID="settings-button"
              onPress={onOpenSettings}
              accessibilityLabel={l10n.models.modelCard.buttons.settings}
              flatPress={flatPress}
              glassStyle={styles.iconButton}>
              <SettingsIcon
                width={16}
                height={16}
                stroke={theme.colors.onSurfaceVariant}
              />
            </GlassIconButton>
            <GlassIconButton
              testID="delete-button"
              onPress={handleRemoteDelete}
              accessibilityLabel={l10n.common.delete}
              flatPress={flatPress}
              glassStyle={styles.iconButton}>
              <TrashIcon width={16} height={16} stroke={theme.colors.error} />
            </GlassIconButton>
            {/*
              2026-10-19：移除标题行的 `!` 详情按钮（原 testID=expand-details-button）。
              它和卡片底部的 model-info-button 是同一个 openModelInfo，
              两个入口重复。保留底部那个即可。
            */}
          </View>
        );
      }

      if (isDownloading) {
        // Downloading state - show cancel button
        return (
          <View style={styles.actionButtonsRow}>
            <Button
              testID="cancel-button"
              icon="close"
              mode="outlined"
              // paper 的 label 默认 marginVertical:9，36px 高的按钮会把字裁掉
              labelStyle={{marginVertical: 0}}
              onPress={() => modelStore.cancelDownload(model.id)}
              style={[
                styles.primaryActionButton,
                {
                  backgroundColor: theme.colors.errorContainer,
                  borderColor: theme.colors.error,
                },
              ]}
              textColor={theme.colors.error}>
              {l10n.common.cancel}
            </Button>
          </View>
        );
      }

      if (!isDownloaded) {
        // Not downloaded state
        return (
          <View style={styles.actionButtonsRow}>
            <Button
              testID="download-button"
              icon="download"
              mode="outlined"
              // paper 的 label 默认 marginVertical:9，36px 高的按钮会把字裁掉
              labelStyle={{marginVertical: 0}}
              onPress={() => modelStore.checkSpaceAndDownload(model.id)}
              disabled={!storageOk}
              style={[
                styles.primaryActionButton,
                storageOk
                  ? {
                      backgroundColor: theme.colors.btnDownloadBg,
                      borderColor: theme.colors.btnDownloadBorder,
                    }
                  : {
                      backgroundColor: theme.colors.surfaceDim,
                      borderColor: theme.colors.outline,
                    },
                // 按键最外圈高光：必须放数组最后，才能覆盖上面的主题边框色
                {borderWidth: 1, borderColor: buttonRing(theme)},
              ]}
              textColor={theme.colors.btnDownloadText}>
              {l10n.models.modelCard.buttons.download}
            </Button>

            <GlassIconButton
              testID="settings-button"
              onPress={onOpenSettings}
              accessibilityLabel={l10n.models.modelCard.buttons.settings}
              flatPress={flatPress}
              glassStyle={styles.iconButton}>
              <SettingsIcon
                width={16}
                height={16}
                stroke={theme.colors.onSurfaceVariant}
              />
            </GlassIconButton>

            {isHfModel && (
              <GlassIconButton
                testID="remove-model-button"
                onPress={handleRemove}
                accessibilityLabel={l10n.models.modelCard.buttons.remove}
                flatPress={flatPress}
                glassStyle={styles.iconButton}>
                <XIcon width={20} height={20} stroke={theme.colors.error} />
              </GlassIconButton>
            )}
          </View>
        );
      }

      // Downloaded state - soft blue styling
      return (
        <>
          <View style={styles.actionButtonsRow}>
            {renderModelLoadButton()}

            <GlassIconButton
              testID="settings-button"
              onPress={onOpenSettings}
              accessibilityLabel={l10n.models.modelCard.buttons.settings}
              flatPress={flatPress}
              glassStyle={styles.iconButton}>
              <SettingsIcon
                width={16}
                height={16}
                stroke={theme.colors.onSurfaceVariant}
              />
            </GlassIconButton>

            <GlassIconButton
              testID="delete-button"
              onPress={handleDelete}
              accessibilityLabel={l10n.common.delete}
              flatPress={flatPress}
              glassStyle={styles.iconButton}>
              <TrashIcon width={16} height={16} stroke={theme.colors.error} />
            </GlassIconButton>
          </View>
          {isDraftOnly && (
            <Text style={styles.draftOnlyHint}>
              {l10n.models.modelCard.labels.draftOnlyReason}
            </Text>
          )}
        </>
      );
    };

    const renderModelLoadButton = () => {
      if (
        modelStore.isContextLoading &&
        modelStore.loadingModel?.id === model.id
      ) {
        return (
          <SurfaceCard style={styles.primaryActionButton} backdrop="wallpaper">
            <Button
              testID="loading-indicator"
              disabled={true}
              loading={true}
              labelStyle={{marginVertical: 0}}
              style={styles.primaryActionButtonFill}
              textColor={theme.colors.btnPrimaryText}>
              {''}
            </Button>
          </SurfaceCard>
        );
      }

      const handlePress = async () => {
        if (isActiveModel) {
          modelStore.manualReleaseContext();
        } else {
          try {
            await modelStore.selectModel(model);
            if (uiStore.autoNavigatetoChat) {
              navigation.navigate('Chat');
            }
          } catch (e) {
            console.log(`Error: ${e}`);
          }
        }
      };

      const getButtonText = () => {
        if (isActiveModel) {
          return l10n.models.modelCard.buttons.offload;
        }
        return l10n.models.modelCard.buttons.load;
      };

      const getTextColor = () => {
        if (isActiveModel) {
          return theme.colors.btnReadyText;
        }
        // 浅灰底 → 深色字
        return theme.colors.onSurface;
      };

      // llama.rn cannot open a draft as a context; loading one only ever fails.
      if (isDraftOnly) {
        return (
          <SurfaceCard style={styles.primaryActionButton} backdrop="wallpaper">
            <Button
              testID="draft-only-load-disabled"
              accessibilityLabel={l10n.models.modelCard.labels.draftOnlyReason}
              icon="play-circle-outline"
              disabled
              labelStyle={{marginVertical: 0}}
              style={styles.primaryActionButtonFill}
              textColor={getTextColor()}>
              {getButtonText()}
            </Button>
          </SurfaceCard>
        );
      }

      return (
        <SurfaceCard style={styles.primaryActionButton} backdrop="wallpaper">
          <Button
            testID={isActiveModel ? 'offload-button' : 'load-button'}
            accessibilityLabel={isActiveModel ? 'Offload model' : 'Load model'}
            icon={isActiveModel ? 'eject' : 'play-circle-outline'}
            onPress={handlePress}
            labelStyle={{marginVertical: 0}}
            style={styles.primaryActionButtonFill}
            textColor={getTextColor()}>
            {getButtonText()}
          </Button>
        </SurfaceCard>
      );
    };

    return (
      <>
        <SurfaceCard
          paper
          elevation={0}
          style={styles.card}
          testID={`model-card-${cardId}`}>
          {/* Compact Header */}
          <View style={styles.compactHeader}>
            <View style={styles.titleRow}>
              <View style={styles.headerLeft}>
                <View>{getModelTypeIcon()}</View>
                <Text
                  variant="titleSmall"
                  style={styles.titleText}
                  numberOfLines={1}
                  ellipsizeMode="middle">
                  {model.name}
                </Text>
              </View>
              {/* ℹ️ 弹「模型信息」悬浮窗（原来这里是一个折叠箭头） */}
              <GlassIconButton
                testID="model-info-button"
                onPress={openModelInfo}
                accessibilityLabel="查看模型信息"
                flatPress={flatPress}
                glassStyle={styles.titleInfoButton}>
                <Icon
                  source="information-outline"
                  size={18}
                  color={theme.colors.onSurfaceVariant}
                />
              </GlassIconButton>
            </View>

            {/* 元信息 chips：大小 · 日期 · 类型（参考 App 的版式） */}
            <View style={styles.metaRow}>
              {isRemoteModel ? (
                <TouchableOpacity
                  testID="server-link"
                  activeOpacity={pressActiveOpacity}
                  onPress={() => {
                    if (model.serverId && onOpenServerDetails) {
                      onOpenServerDetails(model.serverId);
                    }
                  }}
                  style={styles.metaChip}>
                  <Text style={styles.metaChipText}>
                    {model.serverName || 'Remote'}
                  </Text>
                </TouchableOpacity>
              ) : (
                <PillLabel
                  radius={12}
                  backdrop="wallpaper"
                  style={styles.metaChipGlass}>
                  <Text style={styles.metaChipText}>
                    {getModelSizeString(model, isActiveModel, l10n)}
                  </Text>
                </PillLabel>
              )}
              {model.addedAt ? (
                <PillLabel
                  radius={12}
                  backdrop="wallpaper"
                  style={styles.metaChipGlass}>
                  <Text style={styles.metaChipText}>
                    {formatDateChip(model.addedAt)}
                  </Text>
                </PillLabel>
              ) : null}
              {/* 类型 chip 按类别上色，一眼分清 视觉/文本/投影/语音 */}
              {(() => {
                const chipKind: ReturnType<typeof getModelKind> =
                  modelCaps.vision === 'yes' ? 'vision' : kind;
                // 玻璃色调 + 文字色成套：视觉=绿、文本=蓝、投影=琥珀、语音=青。
                // 背景由玻璃胶囊 tint 提供（2026-10-22 用户要求），
                // 文字保留同色系深/浅色保证在彩玻璃上可读。
                const chipTone =
                  chipKind === 'vision'
                    ? {tint: '#10B981', fg: styles.metaChipVisionText}
                    : chipKind === 'projection'
                      ? {tint: '#F59E0B', fg: styles.metaChipProjectionText}
                      : chipKind === 'audio'
                        ? {tint: '#14B8A6', fg: styles.metaChipAudioText}
                        : {tint: '#3B82F6', fg: styles.metaChipTextBlue};
                return (
                  <PillLabel
                    radius={12}
                    backdrop="wallpaper"
                    tint={chipTone.tint}
                    style={styles.metaChipGlass}>
                    <Text style={[styles.metaChipText, chipTone.fg]}>
                      {MODEL_KIND_LABEL[chipKind]}
                    </Text>
                  </PillLabel>
                );
              })()}
              {getStatusDot()}
            </View>
          </View>

          {/* Content */}
          <View style={styles.cardContent}>
            {/* Storage Error Display */}
            {!isRemoteModel && !storageOk && !isDownloaded && (
              <HelperText
                testID="storage-error-text"
                type="error"
                visible={!storageOk}
                padding="none"
                style={styles.storageErrorText}>
                {storageNOkMessage}
              </HelperText>
            )}

            {/* Display warnings */}
            {!isRemoteModel &&
              (shortMemoryWarning || multimodalWarning) &&
              isDownloaded && (
                <TouchableRipple
                  testID="memory-warning-button"
                  onPress={handleWarningPress}
                  style={styles.warningContainer}>
                  <View style={styles.warningContent}>
                    <IconButton
                      icon="alert-circle-outline"
                      iconColor={theme.colors.error}
                      size={20}
                      style={styles.warningIcon}
                    />
                    <Text style={styles.warningText}>
                      {shortMemoryWarning || multimodalWarning}
                    </Text>
                  </View>
                </TouchableRipple>
              )}

            {!isRemoteModel && integrityError && (
              <TouchableRipple
                testID="integrity-warning-button"
                style={styles.warningContainer}>
                <View style={styles.warningContent}>
                  <IconButton
                    icon="alert-circle-outline"
                    iconColor={theme.colors.error}
                    size={20}
                    style={styles.warningIcon}
                  />
                  <Text style={styles.warningText}>{integrityError}</Text>
                </View>
              </TouchableRipple>
            )}

            {/* Download Progress */}
            {isDownloading && (
              <View style={styles.downloadProgressContainer}>
                <ProgressBar
                  testID="download-progress-bar"
                  progress={model.progress / 100}
                  color={theme.colors.tertiary}
                  style={styles.progressBar}
                />
                {model.downloadSpeed && (
                  <Text style={styles.downloadSpeed}>
                    {model.downloadSpeed}
                  </Text>
                )}
              </View>
            )}

            {/* Action Buttons Section */}
            <View style={styles.actionButtonsContainer}>
              {renderActionButtons()}
            </View>

            {/* 展开详情已移除：这些元数据现在放进「模型信息」悬浮窗，
                点卡片右上角的 ℹ️ 直接弹，不再在卡片里往下撑半屏。*/}
          </View>
        </SurfaceCard>
        <ModelInfoOverlay
          visible={infoVisible}
          model={model}
          onClose={() => setInfoVisible(false)}
        />
        {/* Snackbar to show full memory warning */}
        <Snackbar
          testID="memory-warning-snackbar"
          visible={snackbarVisible}
          onDismiss={() => setSnackbarVisible(false)}
          duration={Snackbar.DURATION_MEDIUM}
          action={{
            label: l10n.common.dismiss,
            onPress: () => {
              setSnackbarVisible(false);
            },
          }}>
          {memoryWarning ||
            multimodalWarning ||
            (hasProjectionModelWarning &&
              l10n.models.multimodal.projectionMissingWarning)}
        </Snackbar>
      </>
    );
  },
);

/** 元信息 chips 里的日期：2026-10-17 */
function formatDateChip(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
