import React, {useMemo, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {Card, Icon, Text} from 'react-native-paper';
import {GlassButton as Button} from '../../components/GlassButton';
import {observer} from 'mobx-react';

import {useTheme} from '../../hooks';
import {Entrance} from '../../components/Entrance';
import {SectionLabel} from '../../components/SectionLabel';
import {cardRadius, glassButton, buttonRing} from '../../theme/cards';
import {ttsStore} from '../../store/TTSStore';
import {uiStore} from '../../store';
import {gptSovitsStore} from '../../store/GptSovitsStore';
import {voiceChangeStore} from '../../store/VoiceChangeStore';
import {
  checkLangMismatch,
  detectTextLang,
  SYSTEM_ROUTABLE_LANGS,
  type LangMismatch,
} from '../../services/tts/textLang';
import {Theme} from '../../utils/types';
import {KeyboardAwareScrollView} from 'react-native-keyboard-controller';
import {SurfaceCard, GlassTextField} from '../../components/GlassSurface';

/**
 * 本页自己的播放 id（本地模式用），和聊天消息的播放状态隔离开。
 */
const CLONE_MESSAGE_ID = 'voice-clone';

type Mode = 'local' | 'cloud';

/**
 * 语音克隆（二级页）。
 *
 * 两种「跑」的方式，界面上一个开关切换：
 *
 * 【云端服务】（真·音色克隆）
 *   复用 GPT-SoVITS api_v2：填参考音频（服务端可见路径）+ 参考文本，
 *   `gptSovitsStore.synthesize()` 用参考音频克隆出音色，再把输入文字念出来。
 *   这是 few-shot voice cloning，是「克隆」最贴切的实现。
 *
 * 【本地引擎】（离线，固定音色朗读）
 *   本机没有克隆引擎（本地神经引擎是固定音色 TTS，不是克隆）。本地模式
 *   用已下载的固定音色把文字念出来，并如实标注：真正的音色克隆请用云端。
 */
export const VoiceCloneScreen: React.FC<{header?: React.ReactNode}> = observer(
  ({header}: {header?: React.ReactNode}) => {
    const theme = useTheme();
    const styles = useMemo(() => createStyles(theme), [theme]);

    // 液态玻璃风格下按钮 = 半透明玻璃底 + 高光描边（非玻璃风格展开空对象）
    const glassBtnOutlined = glassButton(theme);
    const glassBtnFilled = glassButton(theme, 'filled');
    // 玻璃底上的主操作用主色文字（Paper contained 的实底被玻璃底覆盖）
    const glassBtnText = theme.colors.primary;
    // 选中的选项 = 蓝色玻璃底 + 白字（非玻璃风格下回落成 Paper 默认蓝实底 + 白字）
    const isGlass = uiStore.themeStyle === 'liquid-glass';
    const glassBtnActive = isGlass
      ? {
          backgroundColor: theme.dark
            ? 'rgba(59, 130, 246, 0.55)'
            : 'rgba(59, 130, 246, 0.62)',
          borderWidth: 1,
          borderColor: buttonRing(theme),
        }
      : {};
    const activeText = isGlass ? '#FFFFFF' : undefined;

    const [text, setText] = useState('');
    const [mode, setMode] = useState<Mode>('cloud');

    // ── 云端状态 ──
    const gsv = gptSovitsStore;
    const cloudBusy = gsv.isSynthesizing;
    const canCloud =
      gsv.apiBase.length > 0 &&
      gsv.refAudioPath.trim().length > 0 &&
      text.trim().length > 0 &&
      !cloudBusy;

    // ── 本地状态 ──
    const voice = ttsStore.currentVoice;
    const playingLocal =
      ttsStore.playbackState.mode === 'playing' &&
      ttsStore.playbackState.messageId === CLONE_MESSAGE_ID;
    const previewing = voice ? ttsStore.isPreviewingVoice(voice) : false;
    const previewPreparing = voice ? ttsStore.isPreparingVoice(voice) : false;
    const playPreparing = ttsStore.isPreparing(CLONE_MESSAGE_ID);
    const localAvailable = ttsStore.isTTSAvailable;
    const canLocal =
      localAvailable && !!voice && text.trim().length > 0 && !playingLocal;

    const langMismatch: LangMismatch =
      mode === 'local'
        ? checkLangMismatch(text, voice)
        : {mismatched: false, textLang: 'en', voiceLang: '', hint: ''};
    const isRoutable =
      mode === 'local' &&
      langMismatch.mismatched &&
      SYSTEM_ROUTABLE_LANGS.includes(detectTextLang(text));

    const onStop = () => {
      if (mode === 'local') {
        ttsStore.stop().catch(() => {});
      } else {
        gsv.stopPlayback();
      }
    };

    const onGenerate = () => {
      if (mode === 'local') {
        if (canLocal) {
          ttsStore.play(CLONE_MESSAGE_ID, text).catch(() => {});
        }
      } else if (canCloud) {
        gsv.synthesize(text);
      }
    };

    const playing =
      mode === 'local' ? playingLocal || playPreparing : cloudBusy;

    return (
      <KeyboardAwareScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        {header}
        <View style={styles.content}>
          <Entrance index={0} screenKey="voiceClone">
            <SurfaceCard paper elevation={0} style={styles.tipCard}>
              <Card.Content>
                <Text style={styles.tipTitle}>语音克隆</Text>
                <Text style={styles.tipText}>
                  给一段参考音频，克隆出它的音色，再用这个音色朗读任意文字。
                  云端走 GPT-SoVITS，本地模式用固定音色朗读。
                </Text>
              </Card.Content>
            </SurfaceCard>
          </Entrance>

          <Entrance index={1} screenKey="voiceClone">
            <SectionLabel title="合成方式" style={styles.sectionLabel} />
            <View style={styles.chipWrap}>
              {(
                [
                  ['cloud', '云端服务'],
                  ['local', '本地引擎'],
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
                      active ? glassBtnActive : glassBtnOutlined,
                    ]}
                    labelStyle={styles.modeBtnLabel}
                    textColor={active ? activeText : undefined}
                    onPress={() => {
                      onStop();
                      setMode(key);
                    }}>
                    {label}
                  </Button>
                );
              })}
            </View>
          </Entrance>

          {mode === 'cloud' ? (
            <>
              <Entrance index={2} screenKey="voiceClone">
                <SectionLabel
                  title="GPT-SoVITS 服务"
                  style={styles.sectionLabel}
                />
                <SurfaceCard paper elevation={0} style={styles.card}>
                  <Card.Content>
                    <Text style={styles.fieldLabel}>服务地址</Text>
                    <GlassTextField
                      tintOpacity={0.68}
                      value={gsv.apiBaseUrl}
                      onChangeText={v => gsv.setApiBaseUrl(v)}
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={styles.input}
                      inputStyle={styles.inputText}
                      placeholder="http://192.168.x.x:9880"
                    />
                    <View style={styles.rowBetween}>
                      <Text style={styles.statusText}>
                        {gsv.apiStatus === 'online'
                          ? `● 已连接${gsv.apiLatency != null ? ` · ${gsv.apiLatency}ms` : ''}`
                          : gsv.apiStatus === 'checking'
                            ? '检测中…'
                            : gsv.apiStatus === 'offline'
                              ? '未连接'
                              : '尚未检测'}
                      </Text>
                      <Button
                        mode="outlined"
                        compact
                        style={[styles.smallBtn, glassBtnOutlined]}
                        labelStyle={styles.smallBtnLabel}
                        loading={gsv.apiStatus === 'checking'}
                        onPress={() => gsv.checkConnection()}>
                        检测连接
                      </Button>
                    </View>
                  </Card.Content>
                </SurfaceCard>
              </Entrance>

              <Entrance index={3} screenKey="voiceClone">
                <SectionLabel
                  title="参考音频（要克隆的音色）"
                  style={styles.sectionLabel}
                />
                <SurfaceCard paper elevation={0} style={styles.card}>
                  <Card.Content>
                    <Text style={styles.fieldLabel}>服务端音频路径</Text>
                    <GlassTextField
                      tintOpacity={0.68}
                      value={gsv.refAudioPath}
                      onChangeText={v => gsv.setRefAudioPath(v)}
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={styles.input}
                      inputStyle={styles.inputText}
                      placeholder="D:/GPT-SoVITS/refs/me.wav"
                    />
                    <Text style={styles.fieldLabel}>参考音频里说的文本</Text>
                    <GlassTextField
                      tintOpacity={0.68}
                      value={gsv.promptText}
                      onChangeText={v => gsv.setPromptText(v)}
                      style={styles.input}
                      inputStyle={styles.inputText}
                      placeholder="这段参考音频对应的文字（尽量一致）"
                    />
                    <SurfaceCard style={styles.hintPill}>
                      <Text style={styles.hintText}>
                        参考音频建议 5~15
                        秒、安静环境、单人连续说话。填的是服务端能看到的路径
                        （GPT-SoVITS 跑在哪台机器上，就填那台机器上的路径）。
                      </Text>
                    </SurfaceCard>

                    <SurfaceCard rimWidth={1.6} style={styles.audioBox}>
                      <Text style={styles.audioTitle}>
                        或从手机录音 / 选文件（仅本地试听）
                      </Text>
                      <View style={styles.rowGap}>
                        {voiceChangeStore.isRecording ? (
                          <Button
                            mode="contained"
                            icon="stop"
                            compact
                            style={[styles.smallBtn, glassBtnFilled]}
                            labelStyle={styles.smallBtnLabel}
                            textColor={glassBtnText}
                            onPress={() => voiceChangeStore.endRecording()}>
                            停止录音
                          </Button>
                        ) : (
                          <Button
                            mode="outlined"
                            icon="microphone"
                            compact
                            style={[styles.smallBtn, glassBtnOutlined]}
                            labelStyle={styles.smallBtnLabel}
                            onPress={() => voiceChangeStore.beginRecording()}>
                            录音
                          </Button>
                        )}
                        <Button
                          mode="outlined"
                          icon="folder-open"
                          compact
                          style={[styles.smallBtn, glassBtnOutlined]}
                          labelStyle={styles.smallBtnLabel}
                          onPress={() => voiceChangeStore.chooseSourceFile()}>
                          选文件
                        </Button>
                        {voiceChangeStore.hasSource ? (
                          <Button
                            mode="text"
                            compact
                            icon={voiceChangeStore.isPlaying ? 'stop' : 'play'}
                            style={[styles.smallBtn, glassBtnOutlined]}
                            labelStyle={styles.smallBtnLabel}
                            onPress={() => voiceChangeStore.previewSource()}>
                            {voiceChangeStore.isPlaying ? '停止' : '试听'}
                          </Button>
                        ) : null}
                      </View>
                      <Text style={styles.valueMeta} numberOfLines={1}>
                        {voiceChangeStore.sourceName
                          ? `当前：${voiceChangeStore.sourceName}`
                          : '录音/选文件只在本地试听，云端克隆仍需上面的服务端路径'}
                      </Text>
                    </SurfaceCard>

                    {gsv.roles.length > 0 ? (
                      <SurfaceCard rimWidth={1.6} style={styles.rolesBox}>
                        <Text style={styles.rolesTitle}>已保存的角色包</Text>
                        {gsv.roles.map(r => (
                          <View key={r.id} style={styles.roleRow}>
                            <Text style={styles.roleName} numberOfLines={1}>
                              {r.name}
                              {gsv.activeRoleId === r.id ? '（当前）' : ''}
                            </Text>
                            <Button
                              mode="text"
                              compact
                              style={[styles.smallBtn, glassBtnOutlined]}
                              labelStyle={styles.smallBtnLabel}
                              onPress={() => gsv.selectRole(r.id)}>
                              选用
                            </Button>
                          </View>
                        ))}
                      </SurfaceCard>
                    ) : null}
                  </Card.Content>
                </SurfaceCard>
              </Entrance>
            </>
          ) : (
            <>
              {!localAvailable ? (
                <Entrance index={2} screenKey="voiceClone">
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
                        mode="text"
                        compact
                        style={[styles.warnBtn, glassBtnOutlined]}
                        onPress={() => ttsStore.setUserTTSOverride(true)}
                        labelStyle={styles.warnBtnLabel}>
                        打开语音功能
                      </Button>
                    </View>
                  </SurfaceCard>
                </Entrance>
              ) : null}

              <Entrance index={3} screenKey="voiceClone">
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
                        style={[styles.smallBtn, glassBtnOutlined]}
                        labelStyle={styles.smallBtnLabel}
                        onPress={() => ttsStore.openSetupSheet()}>
                        更换
                      </Button>
                    </View>
                    {voice ? (
                      <Button
                        mode="text"
                        compact
                        loading={previewing && previewPreparing}
                        icon={previewing ? 'stop' : 'play'}
                        style={[styles.previewBtn, glassBtnOutlined]}
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

              <Entrance index={4} screenKey="voiceClone">
                <SurfaceCard style={styles.warnBox}>
                  <Icon
                    source="information-outline"
                    size={16}
                    color={theme.colors.onSurfaceVariant}
                  />
                  <Text style={styles.warnText}>
                    本机没有音色克隆引擎，本地模式用固定音色朗读文字，不是真克隆。
                    要「从一段音频克隆出音色」，请切到云端服务。
                  </Text>
                </SurfaceCard>
              </Entrance>
            </>
          )}

          <Entrance index={5} screenKey="voiceClone">
            <SectionLabel title="要朗读的文字" style={styles.sectionLabel} />
            <SurfaceCard paper elevation={0} style={styles.card}>
              <Card.Content>
                <GlassTextField
                  tintOpacity={0.68}
                  multiline
                  numberOfLines={4}
                  value={text}
                  onChangeText={setText}
                  style={styles.textArea}
                  inputStyle={styles.textAreaText}
                  placeholder="输入想用克隆音色朗读的内容"
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
                        mode="text"
                        compact
                        style={[styles.warnBtn, glassBtnOutlined]}
                        onPress={() => ttsStore.openSetupSheet()}
                        labelStyle={styles.warnBtnLabel}>
                        更换音色
                      </Button>
                    </SurfaceCard>
                  )
                ) : null}
              </Card.Content>
            </SurfaceCard>
          </Entrance>

          <Entrance index={6} screenKey="voiceClone">
            {mode === 'local' ? (
              playPreparing ? (
                <SurfaceCard style={styles.hintPill}>
                  <Text style={styles.hintText}>
                    正在加载音色…首次使用这个音色要先把它读进内存，可能要几秒。
                  </Text>
                </SurfaceCard>
              ) : ttsStore.speechError ? (
                <SurfaceCard
                  tint="#EF4444"
                  tintOpacity={0.14}
                  style={styles.errorBox}>
                  <Text style={styles.errorText}>{ttsStore.speechError}</Text>
                </SurfaceCard>
              ) : ttsStore.speechHint ? (
                <SurfaceCard style={styles.hintPill}>
                  <Text style={styles.hintText}>{ttsStore.speechHint}</Text>
                </SurfaceCard>
              ) : null
            ) : gsv.error ? (
              <SurfaceCard
                tint="#EF4444"
                tintOpacity={0.14}
                style={styles.errorBox}>
                <Text style={styles.errorText}>{gsv.error}</Text>
              </SurfaceCard>
            ) : (
              <SurfaceCard style={styles.hintPill}>
                <Text style={styles.hintText}>
                  云端模式会把参考音频路径和文字发给 GPT-SoVITS
                  服务端，注意内容是否需要外发。
                </Text>
              </SurfaceCard>
            )}

            {playing ? (
              <Button
                mode="contained"
                style={[styles.genBtn, glassBtnFilled]}
                loading={mode === 'local' && playPreparing}
                icon="stop"
                textColor={glassBtnText}
                onPress={onStop}>
                {mode === 'local' && playPreparing ? '正在加载音色…' : '停止'}
              </Button>
            ) : (
              <Button
                mode="contained"
                style={[styles.genBtn, glassBtnFilled]}
                icon="play"
                textColor={glassBtnText}
                disabled={mode === 'local' ? !canLocal : !canCloud}
                onPress={onGenerate}>
                {mode === 'cloud' ? '克隆并生成' : '生成语音'}
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
    scrollContent: {paddingBottom: 0},
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
    modeBtn: {borderRadius: 999},
    modeBtnLabel: {fontSize: 13},
    card: {borderRadius: cardRadius(), backgroundColor: theme.colors.surface},
    rowBetween: {flexDirection: 'row', alignItems: 'center', gap: 10},
    rowGap: {
      flexDirection: 'row',
      gap: 10,
      flexWrap: 'wrap',
      alignItems: 'center',
    },
    audioBox: {
      marginTop: 14,
      padding: 12,
      borderRadius: cardRadius(),
    },
    audioTitle: {
      fontSize: 12,
      fontWeight: '700',
      color: theme.colors.onSurfaceVariant,
      marginBottom: 8,
    },
    flex1: {flex: 1, flexShrink: 1},
    valueName: {fontSize: 15, fontWeight: '700', color: theme.colors.onSurface},
    valueMeta: {
      fontSize: 12,
      lineHeight: 17,
      color: theme.colors.onSurfaceVariant,
      marginTop: 4,
    },
    fieldLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.colors.onSurface,
      marginBottom: 6,
      marginTop: 4,
    },
    input: {
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginBottom: 10,
      backgroundColor: theme.colors.background,
    },
    inputText: {fontSize: 13, color: theme.colors.onSurface},
    textArea: {
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 12,
      minHeight: 96,
      marginBottom: 10,
      backgroundColor: theme.colors.background,
    },
    textAreaText: {fontSize: 13, color: theme.colors.onSurface},
    smallBtn: {borderRadius: 999},
    smallBtnLabel: {fontSize: 13},
    previewBtn: {alignSelf: 'flex-start', marginTop: 6, marginLeft: -8},
    previewBtnLabel: {fontSize: 13},
    statusText: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.colors.onSurface,
    },
    rolesBox: {marginTop: 10, padding: 10, borderRadius: 14},
    rolesTitle: {
      fontSize: 12,
      fontWeight: '700',
      color: theme.colors.onSurfaceVariant,
      marginBottom: 4,
    },
    roleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    roleName: {flex: 1, fontSize: 13, color: theme.colors.onSurface},
    warnBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
      marginTop: 16,
      padding: 12,
      borderRadius: cardRadius(),
      backgroundColor: theme.colors.surfaceVariant,
    },
    warnBoxInCard: {marginTop: 12},
    warnBody: {flex: 1},
    warnText: {
      fontSize: 12,
      lineHeight: 18,
      color: theme.colors.onSurfaceVariant,
    },
    warnBtn: {borderRadius: 999, alignSelf: 'flex-start', marginTop: 2},
    warnBtnLabel: {fontSize: 12, marginHorizontal: 0},
    hintPill: {
      marginTop: 22,
      padding: 12,
      borderRadius: cardRadius(),
    },
    hintText: {
      fontSize: 12,
      lineHeight: 18,
      color: theme.colors.onSurfaceVariant,
    },
    errorBox: {
      borderRadius: cardRadius(),
      padding: 12,
      marginTop: 22,
      backgroundColor: 'rgba(239,68,68,0.12)',
    },
    errorText: {fontSize: 12, lineHeight: 18, color: '#B91C1C'},
    genBtn: {marginTop: 12, borderRadius: 999, paddingVertical: 6},
  });
