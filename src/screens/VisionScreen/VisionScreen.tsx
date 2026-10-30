import React, {useEffect, useRef, useState} from 'react';
import {StyleSheet, View, Image, Alert} from 'react-native';
import {Text, Card, Icon} from 'react-native-paper';
import {GlassButton as Button} from '../../components/GlassButton';
import {SafeAreaView} from 'react-native-safe-area-context';
import {observer} from 'mobx-react';
import {launchImageLibrary} from 'react-native-image-picker';

import {useTheme} from '../../hooks';
import {modelStore, chatSessionStore, apiStore} from '../../store';
import {user, assistant} from '../../utils/chat';
import {persistPickedImage} from '../../utils/imageStorage';
import {useChatSession} from '../../hooks';
import {Theme} from '../../utils/types';
import {useNavigation} from '@react-navigation/native';
import {Entrance} from '../../components/Entrance';
import {KeyboardAwareScrollView} from 'react-native-keyboard-controller';
import {
  GlassSurface,
  GlassTextField,
  SurfaceCard,
} from '../../components/GlassSurface';
import {PillLabel} from '../../components/PillLabel';
import {cardRadius, glassButton} from '../../theme/cards';

// 图像识别页：选图 → 提问 → 多模态推理 → 流式输出结果
export const VisionScreen: React.FC = observer(() => {
  const theme = useTheme();
  const navigation = useNavigation<any>();
  const currentMessageInfo = useRef<{
    createdAt: number;
    id: string;
    sessionId: string;
  } | null>(null);

  const {handleSendPress, handleStopPress} = useChatSession(
    currentMessageInfo,
    user,
    assistant,
  );

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  // 「重新加载模型」按钮的忙碌态。补初始化 mmproj 通常一两秒，
  // 但第一次要拷几百 MB 的 mmproj 进内部存储，可能更久 —— 有反馈才不会
  // 让用户以为按钮失灵、又去点一次。
  const [reloadingVision, setReloadingVision] = useState(false);

  // 订阅当前会话消息，取最新一条 assistant 文本消息作为识别结果
  const messages = chatSessionStore.currentSessionMessages;
  const lastAssistantMsg = [...messages]
    .reverse()
    .find(
      m =>
        m.author === assistant &&
        m.type === 'text' &&
        (m as {text?: string}).text,
    ) as {text?: string} | undefined;

  const visionEnabled = modelStore.activeModelCaps.visionActive;
  const engineReady = !!modelStore.engine;
  // 云端 AI 已启用且配置完整（开关开 + 有地址 + 有 Key）时，识别直接走
  // 「AI 服务」里的云端对话（可带图）。未启用/没配齐时**绝不调用云端**，
  // 仍走本地视觉模型。
  const cloudReady = apiStore.ready;

  // 「选图」会打开系统相册 → App 走 active → inactive → background，
  // 触发 auto-release（releaseContext），回前台再 initContext 重载，
  // 低端机 6~7 秒。这段时间 engine 是 undefined。
  //
  // 以前只分「已加载 / 未加载」两种，用户看到的就是：
  // 选完图突然冒出「请先加载模型」，等几秒卡片又消失 —— 像出 bug。
  // 现在三态：加载中 / 已加载 / 从未加载。
  const isReloading = !!modelStore.loadingModel;
  const isModelLoaded = engineReady || isReloading;

  // 选图动作本身也置位：相册还没关掉时就已经知道「模型马上会被释放」，
  // 这段窗口内不要闪「未加载」。
  const [pickingImage, setPickingImage] = useState(false);

  // ⚠️ 必须和 handleSendPress 里的并发守卫用同一组条件。
  //
  // 之前按钮只看 isStreaming，而守卫看 inferencing || isStreaming ||
  // isGenerating —— 「准备阶段」和「生成收尾」这两个窗口里按钮是亮的，
  // 点下去却被守卫静默 return，用户看到的就是「点了完全没反应」。
  const chatBusy =
    modelStore.inferencing ||
    modelStore.isStreaming ||
    chatSessionStore.isGenerating;

  // 区分「没绑视觉模型」和「绑了但当前会话没生效」—— 两者的修法完全不同，
  // 但旧文案一律说"请加载视觉模型"，用户明明加载了模型，只能干瞪眼。
  const activeModel = modelStore.activeModel;
  const hasProjectionBound = !!activeModel?.defaultProjectionModel;
  // 重新加载模型，让它带上 mmproj。
  // 先走快路径（只补 initMultimodal，不重载主模型），失败再退回整模型重载。
  const reloadModel = async () => {
    if (!activeModel || reloadingVision) {
      return;
    }
    setReloadingVision(true);
    try {
      const fast = await modelStore.retryMultimodalOnActiveContext();
      if (fast) {
        return;
      }
      await modelStore.selectModel(activeModel);
    } catch (e) {
      Alert.alert('重新加载失败', String(e));
    } finally {
      setReloadingVision(false);
    }
  };
  const isStreaming = modelStore.isStreaming;

  // 图片转存统一走 utils/imageStorage：把 content:// 落到
  // DocumentDirectoryPath/vision 并返回 file:// 路径。llama.rn 只认真实
  // 文件路径；落私有目录还能保证历史会话里的图片不会因清缓存而失效。
  const handlePickImage = async () => {
    setPickingImage(true);
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        quality: 0.8,
        // ⚠️ 必须限边长：相册原图动辄 4000×3000，mtmd 编码一张这么大的图
        // 在手机上要几十秒到几分钟，n_ctx 2048 也装不下它切出来的 token。
        // 768 与主流应用一致：识别内容够用，视觉编码量比 1024 少约 44%。
        maxWidth: 768,
        maxHeight: 768,
        selectionLimit: 1,
      });
      if (result.assets && result.assets[0] && result.assets[0].uri) {
        const raw = result.assets[0].uri;
        const local = await persistPickedImage(raw);
        setImageUri(local);
      }
    } catch (e) {
      Alert.alert('选图失败', String(e));
    } finally {
      // 相册关闭后模型才开始重载，再多守一小段，避免闪「未加载」
      setTimeout(() => setPickingImage(false), 1500);
    }
  };

  const handleSend = async () => {
    if (!imageUri) {
      Alert.alert('请先选择图片');
      return;
    }
    // 云端模式不需要本地引擎 / 视觉模型；只有未启用云端时才做本地校验。
    if (!cloudReady) {
      // ⚠️ 引擎没就绪时要区分「正在重载」和「从未加载」——
      // 前者等几秒就好，后者要用户去加载。
      if (!engineReady) {
        if (isReloading || pickingImage) {
          Alert.alert(
            '模型正在重新加载',
            '请等模型加载完成（约 5~8 秒）后再试。',
          );
        } else {
          Alert.alert(
            '模型未加载',
            '请先到"模型"页加载一个视觉模型（如 Qwen2-VL）；或在「设置 → AI 服务」开启云端对话。',
          );
        }
        return;
      }
      if (!visionEnabled) {
        Alert.alert(
          '无法使用图像识别',
          hasProjectionBound
            ? '已绑定视觉模型，但当前会话还没生效。请重新加载模型后再试；或在「设置 → AI 服务」开启云端对话。'
            : '当前模型没有绑定视觉模型（MMProj）。请先到模型卡片 → 视觉配置里绑定；或在「设置 → AI 服务」开启云端对话。',
        );
        return;
      }
    }
    const q = question.trim() || '描述这张图片的内容';
    try {
      await handleSendPress({
        type: 'text',
        text: q,
        imageUris: [imageUri],
      });
    } catch (e) {
      Alert.alert('识别出错', String(e));
    }
  };

  // ⚠️ 自动补初始化：进这个页面时，如果「绑了 mmproj 但当前会话没启用视觉」，
  // 直接自动补一次，不等用户点按钮。
  //
  // 用户的原话是「我已经都绑定好了，他说这个」—— 绑定状态是对的，
  // 只是 isMultimodalActive（加载时的判定）没跟上。让用户自己去点
  // 「重新加载模型」是在把自己的状态同步问题转嫁给用户。
  //
  // 用 ref 保证只自动试一次：真失败的话（比如 mmproj 与主模型不兼容）
  // 不能死循环重试，这时才让用户看到按钮、自己决定。
  const autoTriedRef = useRef(false);
  useEffect(() => {
    if (autoTriedRef.current) {
      return;
    }
    if (!isModelLoaded || visionEnabled || !hasProjectionBound) {
      return;
    }
    autoTriedRef.current = true;
    modelStore.retryMultimodalOnActiveContext().catch(() => {});
  }, [isModelLoaded, visionEnabled, hasProjectionBound]);

  const styles = createStyles(theme);
  // 液态玻璃风格下按钮 = 半透明玻璃底 + 高光描边（非玻璃风格展开空对象）
  const glassBtnOutlined = glassButton(theme);
  const glassBtnFilled = glassButton(theme, 'filled');
  // 玻璃底上的主操作用主色文字（Paper contained 的实底被玻璃底覆盖）
  const glassBtnText = theme.colors.primary;

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <KeyboardAwareScrollView contentContainerStyle={styles.container}>
        {/* 识别方式提示：云端已启用时用云端，不再纠缠本地模型状态 */}
        <PillLabel style={styles.modeHintPill} radius={14}>
          <Text style={styles.modeHint}>
            {cloudReady
              ? '识别方式：云端 AI（使用「设置 → AI 服务」里的云端对话设置）'
              : '识别方式：本地视觉模型（未启用云端 AI）'}
          </Text>
        </PillLabel>

        {/* 模型状态提示（仅在未启用云端时才有意义） */}
        {/* 三态：正在重载 / 选图中 / 从未加载 */}
        {!cloudReady && !engineReady && (isReloading || pickingImage) && (
          <Entrance index={0}>
            <SurfaceCard style={styles.warningCard}>
              <Text style={styles.warningText}>
                模型正在重新加载，完成后即可识别。{'\n'}
                （打开系统相册会释放模型， 返回后自动恢复，低端机约需 5~8 秒）
              </Text>
              <Button
                mode="contained"
                icon="reload"
                loading={isReloading}
                disabled={isReloading}
                onPress={() => {
                  if (!modelStore.loadingModel && activeModel) {
                    modelStore
                      .selectModel(activeModel)
                      .catch(e => Alert.alert('加载失败', String(e)));
                  }
                }}
                style={[styles.loadModelBtn, glassBtnFilled]}
                textColor={glassBtnText}>
                {isReloading ? '正在加载…' : '重新加载模型'}
              </Button>
            </SurfaceCard>
          </Entrance>
        )}
        {!cloudReady && !engineReady && !isReloading && !pickingImage && (
          <Entrance index={0}>
            <SurfaceCard style={styles.warningCard}>
              <Text style={styles.warningText}>
                模型未加载，请先加载视觉模型（如 Qwen2-VL）
              </Text>
              <Button
                mode="contained"
                icon="robot"
                onPress={() => navigation.navigate('VisionModels')}
                style={[styles.loadModelBtn, glassBtnFilled]}
                textColor={glassBtnText}>
                去加载模型
              </Button>
            </SurfaceCard>
          </Entrance>
        )}
        {!cloudReady && engineReady && !visionEnabled && (
          <Entrance index={0}>
            <SurfaceCard style={styles.warningCard}>
              <Text style={styles.warningText}>
                {hasProjectionBound
                  ? '视觉模型已绑定，但当前会话还没生效。\n重新加载模型即可启用图像识别。'
                  : '当前模型没有绑定视觉模型（MMProj），无法识别图像。\n到模型卡片 → 视觉配置里绑定一个即可。'}
              </Text>
              {hasProjectionBound ? (
                <Button
                  testID="vision-reload-model"
                  mode="contained"
                  icon="reload"
                  style={[styles.warningBtn, glassBtnFilled]}
                  textColor={glassBtnText}
                  loading={reloadingVision}
                  disabled={reloadingVision}
                  onPress={reloadModel}>
                  {reloadingVision ? '正在启用视觉…' : '重新加载模型'}
                </Button>
              ) : (
                <Button
                  testID="vision-goto-bind"
                  mode="contained"
                  icon="cog-outline"
                  style={[styles.warningBtn, glassBtnFilled]}
                  textColor={glassBtnText}
                  onPress={() => navigation.navigate('Models')}>
                  去模型页绑定
                </Button>
              )}
            </SurfaceCard>
          </Entrance>
        )}

        {/* 选图按钮：液态玻璃按钮（regular 玻璃 + 高光边），点击区整块玻璃 */}
        <Entrance index={1}>
          <SurfaceCard
            glassType="regular"
            tintOpacity={0.55}
            onPress={handlePickImage}
            disabled={isStreaming}
            accessibilityRole="button"
            accessibilityLabel={imageUri ? '重新选择图片' : '选择图片'}
            testID="vision-pick-image"
            style={[styles.pickButton, isStreaming && styles.pickDisabled]}>
            <View style={styles.pickInner}>
              <Icon source="image" size={20} color={theme.colors.primary} />
              <Text style={[styles.pickText, {color: theme.colors.primary}]}>
                {imageUri ? '重新选择图片' : '选择图片'}
              </Text>
            </View>
          </SurfaceCard>
        </Entrance>

        {/* 图片预览 */}
        <Entrance index={2}>
          {imageUri ? (
            // rimOnly：照片保持原样清晰，只在外圈描一道玻璃高光边
            <GlassSurface rimOnly style={styles.preview}>
              <Image
                source={{uri: imageUri}}
                style={styles.previewImage}
                resizeMode="contain"
              />
            </GlassSurface>
          ) : (
            <SurfaceCard style={styles.placeholderBox}>
              <Text style={styles.placeholderText}>尚未选择图片</Text>
            </SurfaceCard>
          )}
        </Entrance>

        {/* 问题输入：磨砂比普通 GlassTextField 更重一档
            （tintOpacity 0.72 > 默认 0.55），文字框的液态玻璃更「实」，
            背后壁纸花纹不会从字缝里透出来，符合「文字框模糊加强」的要求。 */}
        <GlassTextField
          label="问题（留空则默认描述图片）"
          placeholder="例如：这张图片里有什么？"
          value={question}
          onChangeText={setQuestion}
          style={styles.inputGlass}
          inputStyle={styles.inputText}
          glassType="regular"
          tintOpacity={0.72}
          disabled={isStreaming}
          multiline
        />

        {/* 发送按钮 */}
        <Button
          mode="contained"
          icon="send"
          onPress={handleSend}
          style={[styles.sendButton, glassBtnFilled]}
          textColor={glassBtnText}
          loading={chatBusy}
          disabled={chatBusy || !imageUri || (!cloudReady && !engineReady)}>
          {chatBusy ? '识别中…' : '开始识别'}
        </Button>

        {/* 识别中给一个「停止」出口：视觉编码 + 首 token 在低端机上可能要
            十几秒，没有出口的话用户只能干等（或以为 App 卡死了）。 */}
        {chatBusy && (
          <Button
            mode="outlined"
            icon="stop"
            onPress={() => {
              handleStopPress().catch(e =>
                console.warn('[vision] stop failed', e),
              );
            }}
            style={[styles.stopButton, glassBtnOutlined]}>
            停止
          </Button>
        )}

        {/* 识别结果 */}
        {lastAssistantMsg && (
          <SurfaceCard paper style={styles.resultCard}>
            <Card.Content>
              <Text variant="titleSmall" style={styles.resultTitle}>
                识别结果
              </Text>
              <Text style={styles.resultText}>
                {lastAssistantMsg.text || ''}
              </Text>
            </Card.Content>
          </SurfaceCard>
        )}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    container: {
      flexGrow: 1,
      padding: 16,
    },
    modeHint: {
      color: theme.colors.onSurfaceVariant,
      fontSize: 12,
      lineHeight: 17,
    },
    // 「识别方式」小字：扁平液态玻璃胶囊（浮在壁纸上的小字底衬）
    modeHintPill: {
      alignSelf: 'stretch',
      marginBottom: 10,
    },
    title: {
      color: theme.colors.onBackground,
      marginBottom: 4,
    },
    subtitle: {
      color: theme.colors.textSecondary,
      marginBottom: 16,
    },
    warningBtn: {
      marginTop: 12,
      borderRadius: 999,
    },
    warningCard: {
      backgroundColor: theme.colors.secondaryContainer,
      borderRadius: cardRadius(),
      padding: 12,
      marginBottom: 12,
    },
    warningText: {
      color: theme.colors.onSecondaryContainer,
    },
    pickButton: {
      marginBottom: 12,
      borderRadius: cardRadius(),
    },
    pickInner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 12,
    },
    pickText: {
      fontSize: 15,
      fontWeight: '700',
    },
    pickDisabled: {
      opacity: 0.5,
    },
    // 预览容器：只当玻璃高光边的载体（rimOnly），底色透明
    preview: {
      width: '100%',
      height: 220,
      borderRadius: cardRadius(),
      marginBottom: 12,
      overflow: 'hidden',
    },
    previewImage: {
      width: '100%',
      height: '100%',
    },
    placeholderBox: {
      width: '100%',
      height: 160,
      borderRadius: cardRadius(),
      backgroundColor: theme.colors.background,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 12,
    },
    placeholderText: {
      color: theme.colors.onSurfaceVariant,
    },
    // 问题输入框的玻璃容器（ GlassTextField 外层）：磨砂加强档
    inputGlass: {
      borderRadius: cardRadius(),
      backgroundColor: theme.colors.surface,
      paddingHorizontal: 14,
      paddingTop: 6,
      paddingBottom: 8,
      marginBottom: 12,
    },
    inputText: {
      fontSize: 14,
      backgroundColor: 'transparent',
    },
    sendButton: {
      marginBottom: 16,
    },
    stopButton: {
      marginBottom: 16,
      marginTop: -8,
      borderRadius: 999,
    },
    resultCard: {
      marginTop: 8,
      backgroundColor: theme.colors.surface,
      // 玻璃模式下边缘由 GlassSurface 的高光描边提供，不再叠加实色边框
    },
    resultTitle: {
      marginBottom: 8,
      color: theme.colors.onSurface,
    },
    resultText: {
      color: theme.colors.onSurface,
      lineHeight: 20,
    },
    loadModelBtn: {
      marginTop: 10,
    },
  });
