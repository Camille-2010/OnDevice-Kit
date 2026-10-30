import React, {useMemo, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {Card, Icon, Text} from 'react-native-paper';
import {GlassButton as Button} from '../../components/GlassButton';
import {observer} from 'mobx-react';

import {useTheme} from '../../hooks';
import {Entrance} from '../../components/Entrance';
import {SectionLabel} from '../../components/SectionLabel';
import {cardRadius, glassButton} from '../../theme/cards';
import {ttsStore, cloudTTSStore} from '../../store';
import {
  checkLangMismatch,
  detectTextLang,
  SYSTEM_ROUTABLE_LANGS,
  type LangMismatch,
} from '../../services/tts/textLang';
import {Theme} from '../../utils/types';
import {KeyboardAwareScrollView} from 'react-native-keyboard-controller';
import {GlassTextField, SurfaceCard} from '../../components/GlassSurface';
import {PillLabel} from '../../components/PillLabel';

/**
 * 本页自己的播放 id（本地模式用）。
 * ttsStore 用 messageId 区分「谁在播」，用固定 id 就不会和聊天里
 * 某条消息的播放状态互相干扰（也不会被那边的清理逻辑误停）。
 */
const LAB_MESSAGE_ID = 'voice-lab';

type Mode = 'local' | 'cloud';

/**
 * 生成语音（二级页）。
 *
 * 两种「跑」的方式，界面上一个开关切换：
 *
 * 【本地引擎】（离线，开箱可用）
 *   底层是项目已有的 TTS 服务（`@pocketpalai/react-native-speech`），
 *   系统引擎恒可用；「试听」调 `preview`，「生成语音」调 `play`，
 *   音色选择复用全局 TTSSetupSheet。
 *
 * 【云端服务】（在线，音色更好、不用下模型）
 *   POST `{baseUrl}/v1/audio/speech`（OpenAI 兼容），
 *   拿回裸 PCM 交给原生播放器播，实现在 services/tts/cloudPlayer.ts。
 *   请求与错误处理在 cloudTTSStore 里。
 */
export const VoiceScreen: React.FC<{header?: React.ReactNode}> = observer(
  ({header}: {header?: React.ReactNode}) => {
    const theme = useTheme();
    const styles = useMemo(() => createStyles(theme), [theme]);
    // 液态玻璃风格下按钮 = 半透明玻璃底 + 高光描边（非玻璃风格展开空对象）
    const glassBtnOutlined = glassButton(theme);
    const glassBtnFilled = glassButton(theme, 'filled');
    // 选中项的淡蓝底：跟随关键色（secondary 是 hex，自己转 rgba）。
    // 非玻璃模式下 Paper contained 本就是主色实底，只有玻璃模式被半透明
    // 灰盖住 → 这里补回蓝色（深色主题浓度高一点保证可辨）
    const selectedBlue = (() => {
      const h = theme.colors.secondary.replace('#', '');
      const r = parseInt(h.substring(0, 2), 16);
      const g = parseInt(h.substring(2, 4), 16);
      const b = parseInt(h.substring(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${theme.dark ? 0.34 : 0.18})`;
    })();

    const [text, setText] = useState('');
    // 上次用的是云端就还开在云端（cloudTTSStore.enabled 是持久化的）
    const [mode, setMode] = useState<Mode>(
      cloudTTSStore.enabled ? 'cloud' : 'local',
    );

    // ── 本地模式的状态 ──
    const voice = ttsStore.currentVoice;
    const playingLocal =
      ttsStore.playbackState.mode === 'playing' &&
      ttsStore.playbackState.messageId === LAB_MESSAGE_ID;
    const previewing = voice ? ttsStore.isPreviewingVoice(voice) : false;
    // 本会话第一次用这个音色时，引擎要先加载音色嵌入（几秒、全程无声）。
    // 这段时间按钮显示「正在加载音色…」，而不是直接跳成「停止试听」。
    const previewPreparing = voice ? ttsStore.isPreparingVoice(voice) : false;
    const playPreparing = ttsStore.isPreparing(LAB_MESSAGE_ID);
    const localAvailable = ttsStore.isTTSAvailable;
    const canLocal =
      localAvailable && !!voice && text.trim().length > 0 && !playingLocal;

    // ── 云端模式的状态 ──
    const cloud = cloudTTSStore;
    const playingCloud = cloud.isSpeaking;
    const canCloud = cloud.ready && text.trim().length > 0 && !playingCloud;

    const onGenerateLocal = () => {
      if (!canLocal) {
        return;
      }
      ttsStore.play(LAB_MESSAGE_ID, text).catch(() => {});
    };

    const onGenerateCloud = () => {
      if (!canCloud) {
        return;
      }
      cloud.speak(text).catch(() => {});
    };

    const onStop = () => {
      if (mode === 'local') {
        ttsStore.stop().catch(() => {});
      } else {
        cloud.stop();
      }
    };

    const playing = mode === 'local' ? playingLocal : playingCloud;

    // 语言不匹配：本地神经引擎只有英文音素词典，读中文等非英文会发不出声。
    // 这类语言若系统能回退（中文/日文/韩文），会自动用系统语音读，只给中性提示；
    // 否则才提示换音色。
    const langMismatch: LangMismatch =
      mode === 'local'
        ? checkLangMismatch(text, voice)
        : {mismatched: false, textLang: 'en', voiceLang: '', hint: ''};
    const isRoutable =
      mode === 'local' &&
      langMismatch.mismatched &&
      SYSTEM_ROUTABLE_LANGS.includes(detectTextLang(text));

    return (
      <KeyboardAwareScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        {/* 顶部栏由外层传入，放在内容最前面 —— 和主页一样会跟着滚走 */}
        {header}
        <View style={styles.content}>
          <Entrance index={0} screenKey="tts">
            <SurfaceCard paper elevation={0} style={styles.tipCard}>
              <Card.Content>
                <Text style={styles.tipTitle}>生成语音</Text>
                <Text style={styles.tipText}>
                  输入文字，用本机引擎或云端服务念出来。本地模式离线可用；
                  云端模式音色更自然，需要填一个兼容 OpenAI 格式的服务地址。
                </Text>
              </Card.Content>
            </SurfaceCard>
          </Entrance>

          <Entrance index={1} screenKey="tts">
            <SectionLabel title="合成方式" style={styles.sectionLabel} />
            <View style={styles.chipWrap}>
              {(
                [
                  ['local', '本地引擎'],
                  ['cloud', '云端服务'],
                ] as [Mode, string][]
              ).map(([key, label]) => {
                const active = mode === key;
                return (
                  <Button
                    key={key}
                    mode={active ? 'contained' : 'outlined'}
                    compact
                    style={[
                      styles.modeBtn,
                      active
                        ? // 选中：淡蓝玻璃底 + 主色描边 + 主色字
                          {...glassBtnFilled, backgroundColor: selectedBlue}
                        : glassBtnOutlined,
                    ]}
                    textColor={active ? theme.colors.primary : undefined}
                    labelStyle={styles.modeBtnLabel}
                    onPress={() => {
                      onStop();
                      setMode(key);
                      cloud.setEnabled(key === 'cloud');
                    }}>
                    {label}
                  </Button>
                );
              })}
            </View>
          </Entrance>

          {mode === 'local' ? (
            <>
              {/* 语音功能被关掉 / 内存不足时给一个明确的出口，并说清是哪一种 */}
              {!localAvailable ? (
                <Entrance index={2} screenKey="tts">
                  <SurfaceCard style={styles.warnBox}>
                    <Icon
                      source="alert-circle-outline"
                      size={16}
                      color={theme.colors.onSurfaceVariant}
                    />
                    <View style={styles.warnBody}>
                      <Text style={styles.warnText}>
                        {ttsStore.ttsBlockMessage}
                      </Text>
                      <Button
                        mode="outlined"
                        compact
                        style={glassBtnOutlined}
                        onPress={() => ttsStore.setUserTTSOverride(true)}
                        labelStyle={styles.warnBtnLabel}>
                        打开语音功能
                      </Button>
                    </View>
                  </SurfaceCard>
                </Entrance>
              ) : null}

              <Entrance index={3} screenKey="tts">
                <SectionLabel title="音色" style={styles.sectionLabel} />
                <SurfaceCard paper elevation={0} style={styles.card}>
                  <Card.Content>
                    <View style={styles.rowBetween}>
                      <View style={styles.flex1}>
                        <Text style={styles.valueName} numberOfLines={1}>
                          {voice ? voice.name : '还没有选择音色'}
                        </Text>
                        <Text style={styles.valueMeta} numberOfLines={1}>
                          {voice
                            ? `来源：${
                                voice.engine === 'system'
                                  ? '系统引擎'
                                  : voice.engine.charAt(0).toUpperCase() +
                                    voice.engine.slice(1)
                              }${voice.language ? ` · ${voice.language}` : ''}`
                            : '点右边「更换」挑一个，系统音色开箱即用'}
                        </Text>
                      </View>
                      <Button
                        mode="outlined"
                        compact
                        style={[glassBtnOutlined, styles.smallBtn]}
                        labelStyle={styles.smallBtnLabel}
                        onPress={() => ttsStore.openSetupSheet()}>
                        更换
                      </Button>
                    </View>

                    {voice ? (
                      <Button
                        mode="outlined"
                        compact
                        loading={previewing && previewPreparing}
                        style={[glassBtnOutlined, styles.previewBtn]}
                        icon={previewing ? 'stop' : 'play'}
                        labelStyle={styles.previewBtnLabel}
                        onPress={() => {
                          if (previewing) {
                            onStop();
                          } else {
                            ttsStore.preview(voice).catch(() => {});
                          }
                        }}>
                        {previewing
                          ? previewPreparing
                            ? '正在加载音色…'
                            : '停止试听'
                          : '试听这个音色'}
                      </Button>
                    ) : null}
                  </Card.Content>
                </SurfaceCard>
              </Entrance>
            </>
          ) : (
            <Entrance index={2} screenKey="tts">
              <SectionLabel title="云端服务" style={styles.sectionLabel} />
              <SurfaceCard paper elevation={0} style={styles.card}>
                <Card.Content>
                  <Text style={styles.fieldLabel}>服务地址</Text>
                  <GlassTextField
                    value={cloud.baseUrl}
                    onChangeText={v => cloud.setBaseUrl(v)}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.inputGlass}
                    inputStyle={styles.inputText}
                    placeholder="https://api.openai.com"
                  />
                  <Text style={styles.fieldLabel}>API Key</Text>
                  <GlassTextField
                    value={cloud.apiKey}
                    onChangeText={v => cloud.setApiKey(v)}
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry
                    style={styles.inputGlass}
                    inputStyle={styles.inputText}
                    placeholder="sk-..."
                  />
                  <View style={styles.twoCol}>
                    <View style={styles.flex1}>
                      <Text style={styles.fieldLabel}>模型</Text>
                      <GlassTextField
                        value={cloud.model}
                        onChangeText={v => cloud.setModel(v)}
                        autoCapitalize="none"
                        autoCorrect={false}
                        style={styles.inputGlass}
                        inputStyle={styles.inputText}
                        placeholder="tts-1"
                      />
                    </View>
                    <View style={styles.flex1}>
                      <Text style={styles.fieldLabel}>音色</Text>
                      <GlassTextField
                        value={cloud.voice}
                        onChangeText={v => cloud.setVoice(v)}
                        autoCapitalize="none"
                        autoCorrect={false}
                        style={styles.inputGlass}
                        inputStyle={styles.inputText}
                        placeholder="alloy"
                      />
                    </View>
                  </View>
                  <PillLabel
                    style={styles.hintPillInCard}
                    radius={15}
                    rimWidth={1.4}>
                    <Text style={styles.hintText}>
                      走 OpenAI 兼容的 /v1/audio/speech；地址带不带 /v1
                      都行，会自动补。 请求用 PCM
                      返回，由本机直接播放，不落临时文件。
                    </Text>
                  </PillLabel>
                  {!cloud.ready ? (
                    <PillLabel
                      style={styles.hintPillInCard}
                      radius={15}
                      rimWidth={1.4}
                      tint="#EF4444"
                      tintOpacity={0.12}>
                      <Text style={styles.warnInline}>
                        地址、Key、模型名三项都要填。
                      </Text>
                    </PillLabel>
                  ) : null}
                </Card.Content>
              </SurfaceCard>
            </Entrance>
          )}

          <Entrance index={4} screenKey="tts">
            <SectionLabel title="朗读文本" style={styles.sectionLabel} />
            <SurfaceCard paper elevation={0} style={styles.card}>
              <Card.Content>
                <GlassTextField
                  multiline
                  numberOfLines={4}
                  value={text}
                  onChangeText={setText}
                  style={[styles.inputGlass, styles.areaGlass]}
                  inputStyle={[styles.inputText, styles.areaText]}
                  placeholder="输入想让它念出来的文字"
                />
                {mode === 'local' && langMismatch.mismatched ? (
                  isRoutable ? (
                    <SurfaceCard
                      tint="#3B82F6"
                      tintOpacity={0.12}
                      style={[styles.warnBox, styles.warnBoxInCard]}>
                      <Text style={[styles.warnText, {color: '#475569'}]}>
                        检测到
                        {langMismatch.textLang === 'zh'
                          ? '中文'
                          : langMismatch.textLang === 'ja'
                            ? '日语'
                            : '韩语'}
                        ，播放时会自动改用 Supertonic（或系统语音）朗读。
                      </Text>
                    </SurfaceCard>
                  ) : (
                    <SurfaceCard style={[styles.warnBox, styles.warnBoxInCard]}>
                      <Text style={styles.warnText}>{langMismatch.hint}</Text>
                      <Button
                        mode="outlined"
                        compact
                        style={glassBtnOutlined}
                        labelStyle={styles.warnBtnLabel}
                        onPress={() => ttsStore.openSetupSheet()}>
                        更换音色
                      </Button>
                    </SurfaceCard>
                  )
                ) : null}
              </Card.Content>
            </SurfaceCard>
          </Entrance>

          <Entrance index={5} screenKey="tts">
            {mode === 'local' ? (
              playPreparing ? (
                <PillLabel style={styles.hintPill} radius={15} rimWidth={1.4}>
                  <Text style={styles.hintText}>
                    正在加载音色…首次使用这个音色要先把它读进内存，可能要几秒。
                  </Text>
                </PillLabel>
              ) : ttsStore.speechError ? (
                <SurfaceCard
                  style={styles.errorBox}
                  tint="#EF4444"
                  tintOpacity={0.12}>
                  <Text style={styles.errorText}>{ttsStore.speechError}</Text>
                </SurfaceCard>
              ) : ttsStore.speechHint ? (
                <PillLabel style={styles.hintPill} radius={15} rimWidth={1.4}>
                  <Text style={styles.hintText}>{ttsStore.speechHint}</Text>
                </PillLabel>
              ) : (
                <PillLabel style={styles.hintPill} radius={15} rimWidth={1.4}>
                  <Text style={styles.hintText}>
                    首次使用某个音色时，引擎要先把模型载入内存，头一句可能要等几秒。
                  </Text>
                </PillLabel>
              )
            ) : cloud.error ? (
              <SurfaceCard
                style={styles.errorBox}
                tint="#EF4444"
                tintOpacity={0.12}>
                <Text style={styles.errorText}>{cloud.error}</Text>
              </SurfaceCard>
            ) : (
              <PillLabel style={styles.hintPill} radius={15} rimWidth={1.4}>
                <Text style={styles.hintText}>
                  云端合成会把文字发到你所填的服务地址，注意甄别内容是否需要外发。
                </Text>
              </PillLabel>
            )}

            {playing ? (
              <Button
                mode="contained"
                style={[styles.genBtn, glassBtnFilled]}
                textColor={theme.colors.primary}
                loading={mode === 'local' && playPreparing}
                icon="stop"
                onPress={onStop}>
                {mode === 'local' && playPreparing
                  ? '正在加载音色…'
                  : '停止播放'}
              </Button>
            ) : (
              <Button
                mode="contained"
                style={[styles.genBtn, glassBtnFilled]}
                textColor={theme.colors.primary}
                icon="play"
                disabled={mode === 'local' ? !canLocal : !canCloud}
                onPress={mode === 'local' ? onGenerateLocal : onGenerateCloud}>
                生成语音
              </Button>
            )}
          </Entrance>

          <View style={styles.bottomSpace} />
        </View>
      </KeyboardAwareScrollView>
    );
  },
);

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    scroll: {flex: 1, backgroundColor: 'transparent'},
    // 滚动容器本身不带内边距，顶部栏才能整条通栏
    scrollContent: {paddingBottom: 0},
    // 底部给悬浮胶囊栏留空间；顶部留 4，加上顶栏自带的 marginBottom 10 = 原来那 14
    content: {paddingHorizontal: 16, paddingTop: 4, paddingBottom: 126},
    bottomSpace: {height: 40},
    sectionLabel: {marginTop: 22, marginBottom: 10},
    tipCard: {
      borderRadius: cardRadius(),
      backgroundColor: theme.colors.surface,
      marginTop: 4,
    },
    tipTitle: {
      fontSize: 18,
      fontWeight: '800',
      color: theme.colors.onSurface,
      marginBottom: 6,
    },
    tipText: {
      fontSize: 13,
      lineHeight: 20,
      color: theme.colors.onSurfaceVariant,
    },
    chipWrap: {flexDirection: 'row', gap: 10},
    // 胶囊满圆角：高 ≈34，一半 17（不能写 999，SVG rx 不钳制会成椭圆弧）
    modeBtn: {borderRadius: 17},
    modeBtnLabel: {fontSize: 13},
    warnBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
      marginTop: 16,
      padding: 12,
      borderRadius: cardRadius(),
      backgroundColor: theme.colors.surfaceVariant,
    },
    // 卡内嵌的警告框：去掉外边距（外层卡已有间距）
    warnBoxInCard: {marginTop: 12},
    warnBody: {flex: 1},
    warnText: {
      fontSize: 12,
      lineHeight: 18,
      color: theme.colors.onSurfaceVariant,
    },
    warnBtnLabel: {fontSize: 12, marginHorizontal: 0},
    card: {borderRadius: cardRadius(), backgroundColor: theme.colors.surface},
    rowBetween: {flexDirection: 'row', alignItems: 'center', gap: 10},
    flex1: {flex: 1, flexShrink: 1},
    valueName: {fontSize: 15, fontWeight: '700', color: theme.colors.onSurface},
    valueMeta: {
      fontSize: 12,
      lineHeight: 17,
      color: theme.colors.onSurfaceVariant,
      marginTop: 2,
    },
    smallBtn: {borderRadius: 17},
    smallBtnLabel: {fontSize: 13},
    // 之前 marginLeft: -8 把按钮推出卡片内容区，被玻璃卡的 overflow:hidden
    // 从左侧裁掉圆角（截图反馈「试听按钮被裁了一部分」）。去掉负 margin。
    previewBtn: {alignSelf: 'flex-start', marginTop: 6, marginBottom: 2},
    previewBtnLabel: {fontSize: 13},
    fieldLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.colors.onSurface,
      marginBottom: 6,
      marginTop: 4,
    },
    twoCol: {flexDirection: 'row', gap: 10},
    // 输入框玻璃容器（GlassTextField 外层）
    inputGlass: {
      borderRadius: 12,
      backgroundColor: theme.colors.background,
      paddingHorizontal: 12,
      paddingTop: 6,
      paddingBottom: 8,
      marginBottom: 10,
    },
    inputText: {fontSize: 13, backgroundColor: 'transparent'},
    areaGlass: {minHeight: 96},
    areaText: {minHeight: 72},
    // 浮空提示小字的玻璃胶囊（撑满换行）
    hintPill: {alignSelf: 'stretch', marginTop: 22},
    // 卡内提示小字的胶囊（去掉大外边距）
    hintPillInCard: {alignSelf: 'stretch', marginTop: 12},
    hintText: {
      flex: 1,
      fontSize: 12,
      lineHeight: 18,
      color: theme.colors.onSurfaceVariant,
    },
    warnInline: {
      flex: 1,
      fontSize: 12,
      lineHeight: 18,
      color: '#B91C1C',
    },
    errorBox: {
      borderRadius: cardRadius(),
      padding: 12,
      marginTop: 22,
      backgroundColor: 'rgba(239,68,68,0.12)',
    },
    errorText: {fontSize: 12, lineHeight: 18, color: '#B91C1C'},
    genBtn: {marginTop: 12, borderRadius: 20, paddingVertical: 6},
  });
