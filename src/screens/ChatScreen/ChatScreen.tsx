import React, {useRef, ReactNode, useState} from 'react';

import {observer} from 'mobx-react';
import {runInAction} from 'mobx';

import {Icon} from 'react-native-paper';
import {AppIcon} from '../../components/AppIcon';
import {
  Alert,
  Animated,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  Bubble,
  ChatView,
  ErrorSnackbar,
  ModelErrorReportSheet,
} from '../../components';
import {ChatSessionList} from './ChatSessionList';
import {PressFeedback} from '../../components/PressFeedback';
import {ModelConfigSheet} from '../ModelsScreen/ModelConfigSheet';
import {Model} from '../../utils/types';
import {BackButton} from '../../components/BackButton';
import {PalSheet} from '../../components/PalsSheets';
import {AddAssistantSheet} from '../../components/AddAssistantSheet';

import {useChatSession, useTheme} from '../../hooks';
import {SurfaceCard, GlassSurface} from '../../components/GlassSurface';
import {usePendingMessage} from '../../hooks/useDeepLinking';
import {Pal} from '../../types/pal';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import {ROUTES} from '../../utils/navigationConstants';
import {
  headerBg,
  HEADER_EXTRA,
  HEADER_HEIGHT,
  HEADER_TITLE_SIZE,
  HEADER_TITLE_WEIGHT,
  headerBottomRadius,
  headerTranslucent,
} from '../../theme/cards';

import {
  apiStore,
  modelStore,
  chatSessionStore,
  palStore,
  serverStore,
  uiStore,
} from '../../store';
import {hasVideoCapability} from '../../utils/pal-capabilities';

import {L10nContext} from '../../utils';
import {resolveReasoningCapability} from '../../utils/reasoningCapability';
import {MessageType} from '../../utils/types';
import {ErrorState} from '../../utils/errors';
import {user, assistant} from '../../utils/chat';

import {VideoPalScreen} from './VideoPalScreen';

const renderBubble = ({
  child,
  message,
  nextMessageInGroup,
  scale,
}: {
  child: ReactNode;
  message: MessageType.Any;
  nextMessageInGroup: boolean;
  scale?: any;
}) => (
  <Bubble
    child={child}
    message={message}
    nextMessageInGroup={nextMessageInGroup}
    scale={scale}
  />
);

interface ChatScreenProps {
  // 在主页"开始新对话"子页上下文传入：顶栏返回图标回主页
  onBackToHome?: () => void;
}

export const ChatScreen: React.FC<ChatScreenProps> = observer(
  ({onBackToHome}: ChatScreenProps) => {
    const theme = useTheme();
    const insets = useSafeAreaInsets();
    const currentMessageInfo = useRef<{
      createdAt: number;
      id: string;
      sessionId: string;
    } | null>(null);
    const l10n = React.useContext(L10nContext);
    const navigation = useNavigation<any>();

    // 对话页两态：list = 历史会话列表（模型未加载时为加载提示），chat = 聊天视图
    const [viewMode, setViewMode] = useState<'list' | 'chat'>('list');

    const activePalId = chatSessionStore.activePalId;
    const activePal = activePalId
      ? palStore.pals.find(p => p.id === activePalId)
      : undefined;
    const isVideoPal = activePal && hasVideoCapability(activePal);

    // State for pal sheet
    const [isPalSheetVisible, setIsPalSheetVisible] = useState(false);
    const [isAddAssistantVisible, setIsAddAssistantVisible] = useState(false);

    // 顶栏 ⋮ 下拉面板
    const [moreMenuVisible, setMoreMenuVisible] = useState(false);
    // 「模型设置」打开的模型参数面板（与模型页同一套，真正可设置）
    const [configureModel, setConfigureModel] = useState<Model | undefined>();

    const openMoreMenu = React.useCallback(() => {
      setMoreMenuVisible(true);
    }, []);
    // 只跑 timing、从不 setValue —— 符合项目铁律，可以用 native driver
    const menuAnim = React.useRef(new Animated.Value(0)).current;

    React.useEffect(() => {
      Animated.timing(menuAnim, {
        toValue: moreMenuVisible ? 1 : 0,
        duration: 160,
        useNativeDriver: true,
      }).start();
    }, [moreMenuVisible, menuAnim]);

    const closeMoreMenu = React.useCallback((action?: () => void) => {
      setMoreMenuVisible(false);
      action?.();
    }, []);

    const moreMenuItems = [
      {
        label: '历史记录',
        icon: 'loading' as const, // AppIcon 没有 history，用 Clock 图标
        onPress: () => closeMoreMenu(() => setViewMode('list')),
      },
      {
        label: '开始新对话',
        icon: 'chatPlus' as const,
        onPress: () =>
          closeMoreMenu(() => {
            chatSessionStore.resetActiveSession();
            setViewMode('chat');
          }),
      },
      {
        label: '模型设置',
        icon: 'settings' as const,
        // 打开模型的参数面板：加载配置 / 默认会话配置 / 视觉配置。
        // ⚠️ 对话还没开始时 activeModel 可能是空的 —— 这时用列表里的第一个模型，
        //    不要直接跳去「模型」页（用户会被弹走）。只有**一个模型都没有**时才跳过去导入。
        onPress: () =>
          closeMoreMenu(() => {
            const target = modelStore.activeModel ?? modelStore.models[0];
            if (target) {
              setConfigureModel(target);
            } else {
              navigation.navigate('Models' as never);
            }
          }),
      },
    ];

    // State for model error report sheet
    const [isErrorReportVisible, setIsErrorReportVisible] = useState(false);
    const [errorToReport, setErrorToReport] = useState<ErrorState | null>(null);

    const {handleSendPress, handleStopPress} = useChatSession(
      currentMessageInfo,
      user,
      assistant,
    );

    // Handle deep linking for message prefill
    const {pendingMessage, clearPendingMessage} = usePendingMessage();

    // Callback handler for opening pal sheet
    /**
     * 「添加助手」：按模板创建一个带系统提示词的 Pal，并**绑到当前会话**。
     *
     * ⚠️ 失败必须给反馈：以前这里纯 await，createPal / 落库任何一步抛错都变成
     * 一次未处理的 Promise rejection —— 弹窗不关、不报错、也不绑定，
     * 用户看到的就是「选了助手没有任何反应」。
     */
    const handleCreateAssistant = React.useCallback(
      async (payload: {name: string; systemPrompt: string}) => {
        try {
          const pal = await palStore.createPal({
            name: payload.name,
            systemPrompt: payload.systemPrompt,
            description: '',
            // 其余字段用 store 的默认值
          } as any);
          await chatSessionStore.updateSessionActivePal(pal.id);
        } catch (e) {
          console.error('[ChatScreen] 创建助手失败:', e);
          Alert.alert(
            '创建助手失败',
            e instanceof Error ? e.message : String(e),
          );
          throw e;
        }
      },
      [],
    );

    const handleOpenPalSheet = React.useCallback((_pal: Pal) => {
      setIsPalSheetVisible(true);
    }, []);

    /**
     * 删除自定义助手：从 PalStore 删库，并清理会话绑定。
     * 若删的是当前活动助手，回退到剩余第一个助手；一个都不剩则清空活动绑定。
     */
    const handleDeletePal = React.useCallback(async (id: string) => {
      try {
        await palStore.deletePal(id);
        if (chatSessionStore.activePalId === id) {
          const next = palStore.pals[0];
          await chatSessionStore.updateSessionActivePal(next ? next.id : '');
        }
      } catch (e) {
        console.error('[ChatScreen] 删除助手失败:', e);
        Alert.alert('删除助手失败', e instanceof Error ? e.message : String(e));
      }
    }, []);

    const handleClosePalSheet = React.useCallback(() => {
      setIsPalSheetVisible(false);
    }, []);

    // Handlers for model error report
    const handleReportModelError = React.useCallback(() => {
      if (modelStore.modelLoadError) {
        setErrorToReport(modelStore.modelLoadError);
        setIsErrorReportVisible(true);
        modelStore.clearModelLoadError();
      }
    }, []);

    const handleCloseErrorReport = React.useCallback(() => {
      setIsErrorReportVisible(false);
      setErrorToReport(null);
    }, []);

    const visionEnabled = modelStore.activeModelCaps.visionActive;

    // Resolver is the single source of truth for reasoning capability.
    // Pill is reachable whenever the model is not known to be non-reasoning
    // (fail-open on 'unknown' so remote + missed-local models are reachable).
    const reasoningCapability = resolveReasoningCapability(
      modelStore.activeModel,
      serverStore.remoteReasoning,
    );
    const thinkingSupported =
      !!modelStore.activeModel && reasoningCapability.isReasoning !== 'no';

    const [thinkingEnabled, setThinkingEnabled] = useState(true);
    const [reasoningEffort, setReasoningEffort] = useState<string | undefined>(
      undefined,
    );
    const activeSession = chatSessionStore.sessions.find(
      s => s.id === chatSessionStore.activeSessionId,
    );
    // 聊天视图下物理返回键先回会话列表；列表模式放行给上层（回主页）
    React.useEffect(() => {
      if (viewMode !== 'chat') {
        return;
      }
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        setViewMode('list');
        return true;
      });
      return () => sub.remove();
    }, [viewMode]);
    React.useEffect(() => {
      let cancelled = false;
      chatSessionStore.getCurrentCompletionSettings().then(settings => {
        if (!cancelled) {
          setThinkingEnabled(settings.enable_thinking ?? true);
          setReasoningEffort(settings.reasoning?.effort);
        }
      });
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      chatSessionStore.activeSessionId,
      activeSession?.settingsSource,
      activeSession?.completionSettings,
      chatSessionStore.newChatCompletionSettings,
      chatSessionStore.newChatThinkingOverride,
      chatSessionStore.newChatReasoningEffort,
      activePalId,
    ]);

    // Tool-compatibility one-time banner: when the active Pal declares
    // tools but the loaded model's jinja metadata signals no tool support
    // in any of its slots (see below), surface an inline warning.
    // Persisted per model id so the warning fires at most once.
    React.useEffect(() => {
      const palDeclaresTools =
        activePal?.pact?.talents !== undefined &&
        activePal.pact.talents.length > 0;
      if (!palDeclaresTools) {
        return;
      }
      const model = (modelStore.context as any)?.model;
      const modelId = modelStore.activeModelId;
      if (!model || !modelId) {
        return;
      }
      // Tool support surfaces in four independent places in llama.rn's
      // jinja metadata: defaultCaps.tools/toolCalls (model declares it
      // inline in the default template — Ministral, Llama 3.x, etc.) or
      // toolUse/toolUseCaps (separate tool-use template — Qwen3, etc.).
      // Any one is sufficient; only warn when all four are absent.
      const jinja = model.chatTemplates?.jinja;
      const hasToolSupport =
        !!jinja?.defaultCaps?.tools ||
        !!jinja?.defaultCaps?.toolCalls ||
        !!jinja?.toolUse ||
        !!jinja?.toolUseCaps;
      if (hasToolSupport) {
        return;
      }
      if (uiStore.hasWarnedToolCompat(modelId)) {
        return;
      }
      uiStore.setChatWarning({
        code: 'unknown',
        message: l10n.chat.toolCompatWarning,
        context: 'chat',
        recoverable: true,
        severity: 'warning',
        metadata: {modelId},
      });
      uiStore.markToolCompatWarned(modelId);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activePalId, modelStore.activeModelId, modelStore.context]);

    // Persist the on/off intent (and optional effort) onto both the local
    // enable_thinking flag and the reasoning carrier so the remote wire path
    // (the profile in src/api/servers/) and the local hook both see it.
    // Preserves pal overrides. No active session: stage on the new-chat
    // override field — the resolver applies it as the last layer and session
    // creation bakes it in, without touching newChatCompletionSettings.
    const persistReasoning = async (enabled: boolean, effort?: string) => {
      const currentSession = chatSessionStore.sessions.find(
        s => s.id === chatSessionStore.activeSessionId,
      );
      if (currentSession) {
        const resolvedSettings =
          await chatSessionStore.getCurrentCompletionSettings();
        await chatSessionStore.updateSessionCompletionSettings({
          ...resolvedSettings,
          enable_thinking: enabled,
          reasoning: {enabled, effort},
        });
      } else {
        runInAction(() => {
          chatSessionStore.newChatThinkingOverride = enabled;
          chatSessionStore.newChatReasoningEffort = effort;
        });
      }
    };

    // Simple on/off pill (effortless models): carries the on/off intent on the
    // reasoning carrier (effort undefined) so remote OFF is not a no-op.
    const handleThinkingToggle = async (enabled: boolean) => {
      await persistReasoning(enabled);
    };

    // Graded pill cycle: off -> values[0] -> ... -> values[n] -> off.
    const handleEffortCycle = async () => {
      const values = reasoningCapability.effortValues;
      if (values.length === 0) {
        return;
      }
      let nextEnabled: boolean;
      let nextEffort: string | undefined;
      if (!thinkingEnabled) {
        nextEnabled = true;
        nextEffort = values[0];
      } else {
        const idx = reasoningEffort ? values.indexOf(reasoningEffort) : -1;
        if (idx < 0 || idx >= values.length - 1) {
          nextEnabled = false;
          nextEffort = undefined;
        } else {
          nextEnabled = true;
          nextEffort = values[idx + 1];
        }
      }
      setThinkingEnabled(nextEnabled);
      setReasoningEffort(nextEffort);
      await persistReasoning(nextEnabled, nextEffort);
    };

    // If the active pal is a video pal, show the video pal screen
    if (isVideoPal) {
      return <VideoPalScreen activePal={activePal} />;
    }

    // Otherwise, show the regular chat view
    const styles = createStyles(theme);
    const showTopBar = !!onBackToHome;
    return (
      <View style={styles.page}>
        {showTopBar && (
          <View
            style={[
              styles.subHeader,
              // 液态玻璃：底色让给下面的玻璃层。原 headerTranslucent 的
              // rgba(241,242,247,0.40) 压在深色壁纸上就是用户反馈的
              // 「很突兀的白色长方形」—— 改成和主屏顶栏同款的真玻璃。
              uiStore.themeStyle === 'liquid-glass'
                ? {backgroundColor: 'transparent'}
                : null,
              // 与主屏幕顶部栏同一套尺寸：状态栏高度 + 基准高度 + 向下加长
              {
                height: HEADER_HEIGHT + insets.top + HEADER_EXTRA,
                paddingTop: insets.top,
                paddingBottom: HEADER_EXTRA,
                // ⚠️ 必须压在 chatWrap 之上。
                // RN 的兄弟节点按文档顺序绘制，**后者在上** —— subHeader 排在
                // chatWrap 之前，不给 zIndex 的话 ⋮ 下拉面板会被聊天内容盖住
                // （用户反馈「弹出来的内容被遮了」）。
                // elevation 一起给：Android 上 zIndex 单独用不够稳。
                zIndex: 20,
                elevation: 20,
              },
            ]}>
            {/* 玻璃层：绝对定位铺满顶栏、不吃触摸，内容照常画在它上面。
              不把整个顶栏包进 GlassSurface 的原因：⋮ 下拉面板要伸出
              顶栏外（top:'100%'），玻璃视图会裁剪子树，包进去面板就被裁了。 */}
            {uiStore.themeStyle === 'liquid-glass' ? (
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <GlassSurface
                  style={StyleSheet.absoluteFill}
                  radii={{bl: headerBottomRadius(), br: headerBottomRadius()}}
                  backdrop="wallpaper"
                />
              </View>
            ) : null}
            <BackButton
              onPress={() => {
                if (viewMode === 'chat') {
                  setViewMode('list');
                } else {
                  onBackToHome?.();
                }
              }}
            />
            <Text style={styles.subTitle}>对话</Text>
            {/*
            当前助手（系统提示词）指示器：点一下打开助手面板。
            以前选完助手界面上没有任何变化，用户的反馈是
            「选中了以后没有反应」—— 这里把状态显式画出来。
          */}
            {activePal ? (
              <PressFeedback
                testID="chat-active-assistant-chip"
                onPress={() => setIsAddAssistantVisible(true)}
                scaleTo={0.95}
                glowOpacity={0.12}
                style={styles.assistantChip}>
                {/* ⚠️ PressFeedback 内层 Animated.View 是默认 column，
                  chip 的 row 只作用在 Pressable 上 —— 不包这层 row，
                  图标和文字会被竖着排（用户反馈「没放在一行」） */}
                <View style={styles.assistantChipInner}>
                  <AppIcon
                    name="spark"
                    size={14}
                    color={theme.colors.onSecondaryContainer}
                  />
                  <Text
                    style={[
                      styles.assistantChipText,
                      {color: theme.colors.onSecondaryContainer},
                    ]}
                    numberOfLines={1}
                    testID="chat-active-assistant-name">
                    {activePal.name}
                  </Text>
                </View>
              </PressFeedback>
            ) : null}
            {/*
            三个点菜单移到最右侧，与「对话」标题同一行、同一高度。
            参考 App 的顶栏：返回 + 标题 + ⋮，没有 tab 一排。
          */}
            <View style={styles.subHeaderSpacer} />
            {/* 添加助手：打开系统提示词模板面板 */}
            <PressFeedback
              testID="chat-add-assistant-button"
              onPress={() => setIsAddAssistantVisible(true)}
              scaleTo={0.9}
              glowOpacity={0.12}
              style={styles.moreBtn}
              accessibilityRole="button"
              accessibilityLabel="添加助手">
              <Icon source="plus" size={22} color={theme.colors.onSurface} />
            </PressFeedback>
            {/*
               云端对话模型配置：一键跳到「设置 → AI 服务」。
               云端模式下不用先加载本地模型，直接在这里填地址 / Key / 模型名。
             */}
            <PressFeedback
              testID="chat-cloud-config-button"
              onPress={() =>
                navigation.navigate(ROUTES.SETTINGS, {subPage: 'api'})
              }
              scaleTo={0.9}
              glowOpacity={0.12}
              style={styles.moreBtn}
              accessibilityRole="button"
              accessibilityLabel="云端模型设置">
              <Icon
                source="cloud-outline"
                size={22}
                color={theme.colors.onSurface}
              />
            </PressFeedback>
            {/*
            下拉面板挂在这个容器里，用 position:absolute + top:'100%' + right:0。
            「100%」= 容器自身高度，也就是 ⋮ 的底边 —— 不需要测量、
            不需要算屏宽，天然紧贴三个点正下方、右边缘对齐。
            （之前用 measureInWindow + Portal，坐标还是会飘。）
          */}
            <View style={styles.moreBtnWrap}>
              <PressFeedback
                testID="chat-more-button"
                onPress={openMoreMenu}
                scaleTo={0.9}
                glowOpacity={0.12}
                style={styles.moreBtn}
                accessibilityRole="button"
                accessibilityLabel="更多">
                <Icon
                  source="dots-vertical"
                  size={22}
                  color={theme.colors.onSurface}
                />
              </PressFeedback>

              {moreMenuVisible ? (
                <Animated.View
                  testID="chat-more-panel"
                  style={[
                    styles.menuPanel,
                    // 液态玻璃：外层底色让给玻璃层（否则玻璃被自己的底色盖住）
                    uiStore.themeStyle === 'liquid-glass'
                      ? {backgroundColor: 'transparent'}
                      : null,
                    {
                      opacity: menuAnim,
                      transform: [
                        {
                          translateY: menuAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [-8, 0],
                          }),
                        },
                        {
                          scale: menuAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.96, 1],
                          }),
                        },
                      ],
                    },
                  ]}>
                  <SurfaceCard style={styles.menuPanelInner}>
                    {moreMenuItems.map(item => (
                      <Pressable
                        key={item.label}
                        testID={`chat-more-item-${item.label}`}
                        style={styles.menuPanelItem}
                        onPress={item.onPress}>
                        <AppIcon
                          name={item.icon}
                          size={17}
                          color={theme.colors.onSurfaceVariant}
                          strokeWidth={2}
                        />
                        <Text style={styles.menuPanelItemText}>
                          {item.label}
                        </Text>
                      </Pressable>
                    ))}
                  </SurfaceCard>
                </Animated.View>
              ) : null}
            </View>
          </View>
        )}
        {/*
        遮罩：点菜单外区域关闭下拉面板。
        ⚠️ 2026-10-19 之前用的是 <Portal>，而 Portal 渲染在 App 根节点、
        层级天然高于 subHeader 里的菜单面板 —— 结果用户点每一个菜单项
        都先落在遮罩上，菜单直接被关掉，表现就是「点不动里面的内容」。
        改成 page 下的普通兄弟节点，并把 zIndex 压在菜单之下即可。
      */}
        {moreMenuVisible ? (
          <Pressable
            testID="chat-more-mask"
            style={[styles.menuMask, {zIndex: 15}]}
            onPress={() => setMoreMenuVisible(false)}
          />
        ) : null}

        {viewMode === 'list' ? (
          <ChatSessionList onOpenChat={() => setViewMode('chat')} />
        ) : (
          <View style={styles.chatWrap}>
            <ChatView
              renderBubble={renderBubble}
              messages={chatSessionStore.currentSessionMessages}
              activePal={activePal}
              onSendPress={handleSendPress}
              onStopPress={handleStopPress}
              onPalSettingsSelect={handleOpenPalSheet}
              user={user}
              isStopVisible={modelStore.inferencing}
              isStreaming={modelStore.isStreaming}
              sendButtonVisibilityMode="always"
              showImageUpload={true}
              // ChatScreen 自己画了「对话」顶栏（含 ⋮ 菜单），
              // ChatView 内置的 ChatHeader（「聊天」+ 编辑 + ⋮）必须关掉，
              // 否则屏幕上会出现两行标题栏。
              showHeader={false}
              // 本地视觉模型 或 云端对话已就绪 时都允许附图：
              // 云端多模态模型不需要本地视觉模型也能看图。
              isVisionEnabled={visionEnabled || apiStore.ready}
              initialInputText={pendingMessage || undefined}
              onInitialTextConsumed={clearPendingMessage}
              inputProps={{
                showThinkingToggle: thinkingSupported,
                isThinkingEnabled: thinkingEnabled,
                onThinkingToggle: handleThinkingToggle,
                supportsEffort: reasoningCapability.supportsEffort,
                effortValues: reasoningCapability.effortValues,
                reasoningEffort,
                onEffortCycle: handleEffortCycle,
              }}
              textInputProps={{
                placeholder: apiStore.ready
                  ? l10n.chat.typeYourMessage
                  : !modelStore.engine
                    ? modelStore.isContextLoading
                      ? l10n.chat.loadingModel
                      : l10n.chat.modelNotLoaded
                    : l10n.chat.typeYourMessage,
              }}
            />
            {uiStore.chatWarning && (
              <ErrorSnackbar
                error={uiStore.chatWarning}
                onDismiss={() => uiStore.clearChatWarning()}
              />
            )}
            {modelStore.modelLoadError && (
              <ErrorSnackbar
                error={modelStore.modelLoadError}
                onDismiss={() => modelStore.clearModelLoadError()}
                onReport={handleReportModelError}
              />
            )}
            <ModelErrorReportSheet
              isVisible={isErrorReportVisible}
              onClose={handleCloseErrorReport}
              error={errorToReport}
            />
            {activePal && (
              <PalSheet
                isVisible={isPalSheetVisible}
                onClose={handleClosePalSheet}
                pal={activePal}
              />
            )}
          </View>
        )}

        {/* 助手选择面板：放在页面级（不依赖 viewMode），
            在会话列表页 / 未开始新对话时也能选择或切换助手 */}
        <AddAssistantSheet
          isVisible={isAddAssistantVisible}
          onClose={() => setIsAddAssistantVisible(false)}
          activePalId={chatSessionStore.activePalId}
          existingPals={palStore.pals.map(p => ({id: p.id, name: p.name}))}
          onCreate={handleCreateAssistant}
          onSelectPal={id => {
            void chatSessionStore.updateSessionActivePal(id);
          }}
          onDeletePal={handleDeletePal}
        />

        {/* 「模型设置」：当前激活模型的参数面板（与模型页同一套） */}
        {configureModel ? (
          <ModelConfigSheet
            visible={!!configureModel}
            model={configureModel}
            onClose={() => setConfigureModel(undefined)}
            onPickExistingVision={() => setConfigureModel(undefined)}
          />
        ) : null}
      </View>
    );
  },
);

const createStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    page: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    chatWrap: {
      flex: 1,
    },
    /* 对话二级页顶部栏：与主屏幕顶部栏完全一致（浅灰底 + 大标题 + 底部圆角）
       高度由组件里的内联样式补状态栏高度 + HEADER_EXTRA */
    subHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: headerTranslucent(theme, headerBg(theme)),
      paddingHorizontal: 14,
      borderBottomLeftRadius: headerBottomRadius(),
      borderBottomRightRadius: headerBottomRadius(),
      // 不能 overflow:'hidden' —— 下拉面板要伸出顶栏外，会被裁掉
    },
    subHeaderSpacer: {
      flex: 1,
    },
    /** 顶栏上的「当前助手」小胶囊 */
    assistantChip: {
      // gap 移到 assistantChipInner（PressFeedback 内层只有一个子 View，
      // 在 chip 上写 gap 无效）
      maxWidth: 200,
      marginLeft: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: theme.colors.secondaryContainer,
    },
    // 图标 + 文字真正横排的一层（绕开 PressFeedback 内层 column）
    assistantChipInner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    assistantChipText: {
      fontSize: 12,
      fontWeight: '600',
      flexShrink: 1,
    },
    // ⋮ 的定位锚点：下拉面板以这个容器的底边为 top
    moreBtnWrap: {
      position: 'relative',
      zIndex: 21,
      elevation: 21,
    },
    moreBtn: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 999,
    },
    menuMask: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.28)',
    },
    // top:'100%' = 锚点容器底边（即 ⋮ 底边），right:0 = 右边缘与 ⋮ 对齐
    menuPanel: {
      position: 'absolute',
      top: '100%',
      right: 0,
      marginTop: 2,
      minWidth: 168,
      backgroundColor: theme.colors.surface,
      borderRadius: 16,
      elevation: 8,
      shadowColor: '#000',
      shadowOpacity: 0.16,
      shadowRadius: 16,
      shadowOffset: {width: 0, height: 6},
    },
    /**
     * 「更多」浮层的内容容器。
     * 上下内边距从外层挪到这里 —— 液态玻璃模式下外层底色要让给玻璃层，
     * 内边距必须跟着内容一起进玻璃里，否则玻璃面板会比内容大一圈。
     */
    menuPanelInner: {
      borderRadius: 16,
      paddingVertical: 6,
    },
    menuPanelItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 11,
    },
    menuPanelItemText: {
      fontSize: 14,
      color: theme.colors.onSurface,
      fontWeight: '500',
    },
    backBtn: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    subTitle: {
      fontSize: HEADER_TITLE_SIZE,
      fontWeight: HEADER_TITLE_WEIGHT,
      color: theme.colors.onSurface,
    },
  });
