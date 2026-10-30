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

const CONVERT_MESSAGE_ID = 'voice-convert';

type Mode = 'local' | 'cloud';
type CloudKind = 'rvc' | 'reread';

/**
 * 音色转换（二级页）。
 *
 * 云端两种形态：
 *  - RVC 变声（真变声）：录/选一段源音频，连 RVC 变声服务端换成目标音色。
 *  - 跨音色重读：把文字用 GPT-SoVITS 目标音色重新念一遍。
 * 本地：固定音色朗读（本机无变声引擎，如实标注）。
 */
export const VoiceChangeScreen: React.FC<{header?: React.ReactNode}> = observer(
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
    const [cloudKind, setCloudKind] = useState<CloudKind>('rvc');

    const gsv = gptSovitsStore;
    const vc = voiceChangeStore;

    // ── 跨音色重读（GPT-SoVITS）状态 ──
    const cloudBusy = gsv.isSynthesizing;
    const canReread =
      gsv.apiBase.length > 0 &&
      gsv.refAudioPath.trim().length > 0 &&
      text.trim().length > 0 &&
      !cloudBusy;

    // ── 本地状态 ──
    const voice = ttsStore.currentVoice;
    const playingLocal =
      ttsStore.playbackState.mode === 'playing' &&
      ttsStore.playbackState.messageId === CONVERT_MESSAGE_ID;
    const previewing = voice ? ttsStore.isPreviewingVoice(voice) : false;
    const previewPreparing = voice ? ttsStore.isPreparingVoice(voice) : false;
    const playPreparing = ttsStore.isPreparing(CONVERT_MESSAGE_ID);
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
      } else if (cloudKind === 'rvc') {
        vc.stopPlayback();
      } else {
        gsv.stopPlayback();
      }
    };

    const playing =
      mode === 'local'
        ? playingLocal || playPreparing
        : cloudKind === 'rvc'
          ? vc.isPlaying || vc.isConverting
          : cloudBusy;

    return (
      <KeyboardAwareScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        {header}
        <View style={styles.content}>
          <Entrance index={0} screenKey="voiceChange">
            <SurfaceCard paper elevation={0} style={styles.tipCard}>
              <Card.Content>
                <Text style={styles.tipTitle}>音色转换</Text>
                <Text style={styles.tipText}>
                  把一段声音换成目标音色。云端支持 RVC 真变声和跨音色重读；
                  本地模式用固定音色朗读。
                </Text>
              </Card.Content>
            </SurfaceCard>
          </Entrance>

          <Entrance index={1} screenKey="voiceChange">
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
              <Entrance index={2} screenKey="voiceChange">
                <SectionLabel title="变声方式" style={styles.sectionLabel} />
                <View style={styles.chipWrap}>
                  {(
                    [
                      ['rvc', 'RVC 变声（真变声）'],
                      ['reread', '跨音色重读'],
                    ] as [CloudKind, string][]
                  ).map(([key, label]) => {
                    const active = cloudKind === key;
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
                          setCloudKind(key);
                        }}>
                        {label}
                      </Button>
                    );
                  })}
                </View>
              </Entrance>

              {cloudKind === 'rvc' ? (
                <>
                  <Entrance index={3} screenKey="voiceChange">
                    <SectionLabel
                      title="源音频（要转换的声音）"
                      style={styles.sectionLabel}
                    />
                    <SurfaceCard paper elevation={0} style={styles.card}>
                      <Card.Content>
                        <View style={styles.rowGap}>
                          {vc.isRecording ? (
                            <Button
                              mode="contained"
                              icon="stop"
                              style={[styles.smallBtn, glassBtnFilled]}
                              labelStyle={styles.smallBtnLabel}
                              textColor={glassBtnText}
                              onPress={() => vc.endRecording()}>
                              停止录音
                            </Button>
                          ) : (
                            <Button
                              mode="outlined"
                              icon="microphone"
                              style={[styles.smallBtn, glassBtnOutlined]}
                              labelStyle={styles.smallBtnLabel}
                              onPress={() => vc.beginRecording()}>
                              录一段
                            </Button>
                          )}
                          <Button
                            mode="outlined"
                            icon="folder-open"
                            style={[styles.smallBtn, glassBtnOutlined]}
                            labelStyle={styles.smallBtnLabel}
                            onPress={() => vc.chooseSourceFile()}>
                            选文件
                          </Button>
                          {vc.hasSource ? (
                            <Button
                              mode="text"
                              compact
                              icon={vc.isPlaying ? 'stop' : 'play'}
                              style={[styles.smallBtn, glassBtnOutlined]}
                              labelStyle={styles.smallBtnLabel}
                              onPress={() => vc.previewSource()}>
                              {vc.isPlaying ? '停止' : '试听'}
                            </Button>
                          ) : null}
                        </View>
                        <Text style={styles.valueMeta} numberOfLines={1}>
                          {vc.isRecording
                            ? '正在录音…点「停止录音」结束'
                            : vc.sourceName
                              ? `当前：${vc.sourceName}`
                              : '还没有源音频，录一段或选一个文件（建议 WAV）'}
                        </Text>
                      </Card.Content>
                    </SurfaceCard>
                  </Entrance>

                  <Entrance index={4} screenKey="voiceChange">
                    <SectionLabel
                      title="RVC 变声服务"
                      style={styles.sectionLabel}
                    />
                    <SurfaceCard paper elevation={0} style={styles.card}>
                      <Card.Content>
                        <Text style={styles.fieldLabel}>服务地址</Text>
                        <GlassTextField
                          tintOpacity={0.68}
                          value={vc.rvcBaseUrl}
                          onChangeText={v => vc.setRvcBaseUrl(v)}
                          autoCapitalize="none"
                          autoCorrect={false}
                          style={styles.input}
                          inputStyle={styles.inputText}
                          placeholder="http://192.168.x.x:9870"
                        />
                        <Text style={styles.fieldLabel}>
                          目标音色模型（.pth 文件名）
                        </Text>
                        <GlassTextField
                          tintOpacity={0.68}
                          value={vc.modelName}
                          onChangeText={v => vc.setModelName(v)}
                          autoCapitalize="none"
                          autoCorrect={false}
                          style={styles.input}
                          inputStyle={styles.inputText}
                          placeholder="my_voice.pth"
                        />
                        <View style={styles.twoCol}>
                          <View style={styles.flex1}>
                            <Text style={styles.fieldLabel}>变调（半音）</Text>
                            <GlassTextField
                              tintOpacity={0.68}
                              keyboardType="numbers-and-punctuation"
                              value={String(vc.f0UpKey)}
                              onChangeText={v => vc.setF0UpKey(Number(v) || 0)}
                              style={styles.input}
                              inputStyle={styles.inputText}
                              placeholder="0"
                            />
                          </View>
                          <View style={styles.flex1}>
                            <Text style={styles.fieldLabel}>检索比例</Text>
                            <GlassTextField
                              tintOpacity={0.68}
                              keyboardType="decimal-pad"
                              value={String(vc.indexRate)}
                              onChangeText={v => vc.setIndexRate(Number(v))}
                              style={styles.input}
                              inputStyle={styles.inputText}
                              placeholder="0.75"
                            />
                          </View>
                        </View>
                        <SurfaceCard style={styles.hintPill}>
                          <Text style={styles.hintText}>
                            需要你在电脑上跑一个 RVC 变声服务（脚本见交接目录
                            rvc_server.py）。音频以 base64
                            上传，换好音色后返回，本机不落模型。
                          </Text>
                        </SurfaceCard>
                      </Card.Content>
                    </SurfaceCard>
                  </Entrance>

                  <Entrance index={5} screenKey="voiceChange">
                    {vc.error ? (
                      <SurfaceCard
                        tint="#EF4444"
                        tintOpacity={0.14}
                        style={styles.errorBox}>
                        <Text style={styles.errorText}>{vc.error}</Text>
                      </SurfaceCard>
                    ) : vc.hint ? (
                      <SurfaceCard style={styles.hintPill}>
                        <Text style={styles.hintText}>{vc.hint}</Text>
                      </SurfaceCard>
                    ) : (
                      <SurfaceCard style={styles.hintPill}>
                        <Text style={styles.hintText}>
                          源音频 + 服务地址 +
                          模型名三项齐了就能变声。首次变声服务端要加载模型，可能等几秒。
                        </Text>
                      </SurfaceCard>
                    )}

                    {vc.isConverting ? (
                      <Button
                        mode="contained"
                        style={[styles.genBtn, glassBtnFilled]}
                        loading
                        icon="cog"
                        textColor={glassBtnText}>
                        正在变声…
                      </Button>
                    ) : vc.resultPath ? (
                      <View style={styles.rowGap}>
                        <Button
                          mode="contained"
                          style={[styles.genBtn, styles.flex1, glassBtnFilled]}
                          icon={vc.isPlaying ? 'stop' : 'play'}
                          textColor={glassBtnText}
                          onPress={() => vc.playResult()}>
                          {vc.isPlaying ? '停止播放' : '播放结果'}
                        </Button>
                        <Button
                          mode="outlined"
                          style={[
                            styles.genBtn,
                            styles.flex1,
                            glassBtnOutlined,
                          ]}
                          onPress={() => vc.convert()}>
                          再变一次
                        </Button>
                      </View>
                    ) : (
                      <Button
                        mode="contained"
                        style={[styles.genBtn, glassBtnFilled]}
                        icon="cog"
                        textColor={glassBtnText}
                        disabled={
                          !vc.hasSource || !vc.modelName || !vc.rvcBaseUrl
                        }
                        onPress={() => vc.convert()}>
                        开始变声
                      </Button>
                    )}
                  </Entrance>
                </>
              ) : (
                <>
                  <Entrance index={3} screenKey="voiceChange">
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

                  <Entrance index={4} screenKey="voiceChange">
                    <SectionLabel
                      title="目标音色（要换成的声音）"
                      style={styles.sectionLabel}
                    />
                    <SurfaceCard paper elevation={0} style={styles.card}>
                      <Card.Content>
                        <Text style={styles.fieldLabel}>
                          目标音色参考音频（服务端路径）
                        </Text>
                        <GlassTextField
                          tintOpacity={0.68}
                          value={gsv.refAudioPath}
                          onChangeText={v => gsv.setRefAudioPath(v)}
                          autoCapitalize="none"
                          autoCorrect={false}
                          style={styles.input}
                          inputStyle={styles.inputText}
                          placeholder="D:/GPT-SoVITS/refs/target.wav"
                        />
                        <Text style={styles.fieldLabel}>
                          参考音频里说的文本
                        </Text>
                        <GlassTextField
                          tintOpacity={0.68}
                          value={gsv.promptText}
                          onChangeText={v => gsv.setPromptText(v)}
                          style={styles.input}
                          inputStyle={styles.inputText}
                          placeholder="参考音频对应的文字（尽量一致）"
                        />
                        {gsv.roles.length > 0 ? (
                          <SurfaceCard rimWidth={1.6} style={styles.rolesBox}>
                            <Text style={styles.rolesTitle}>
                              已保存的角色包
                            </Text>
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

                  <Entrance index={5} screenKey="voiceChange">
                    <SectionLabel
                      title="要重读的文字（原音频说的内容）"
                      style={styles.sectionLabel}
                    />
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
                          placeholder="输入原音频说的文字，将用目标音色重读"
                        />
                      </Card.Content>
                    </SurfaceCard>
                  </Entrance>

                  <Entrance index={6} screenKey="voiceChange">
                    {gsv.error ? (
                      <SurfaceCard
                        tint="#EF4444"
                        tintOpacity={0.14}
                        style={styles.errorBox}>
                        <Text style={styles.errorText}>{gsv.error}</Text>
                      </SurfaceCard>
                    ) : (
                      <SurfaceCard style={styles.hintPill}>
                        <Text style={styles.hintText}>
                          这是「跨音色重读」，不是逐帧换声。要真正保留原音频、只换音色，请用上面的
                          RVC 变声。
                        </Text>
                      </SurfaceCard>
                    )}
                    {playing ? (
                      <Button
                        mode="contained"
                        style={[styles.genBtn, glassBtnFilled]}
                        icon="stop"
                        textColor={glassBtnText}
                        onPress={onStop}>
                        停止
                      </Button>
                    ) : (
                      <Button
                        mode="contained"
                        style={[styles.genBtn, glassBtnFilled]}
                        icon="play"
                        textColor={glassBtnText}
                        disabled={!canReread}
                        onPress={() => gsv.synthesize(text)}>
                        开始重读
                      </Button>
                    )}
                  </Entrance>
                </>
              )}
            </>
          ) : (
            <>
              {!localAvailable ? (
                <Entrance index={2} screenKey="voiceChange">
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

              <Entrance index={3} screenKey="voiceChange">
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

              <Entrance index={4} screenKey="voiceChange">
                <SurfaceCard style={styles.warnBox}>
                  <Icon
                    source="information-outline"
                    size={16}
                    color={theme.colors.onSurfaceVariant}
                  />
                  <Text style={styles.warnText}>
                    本机没有变声引擎，本地模式用固定音色朗读文字，不是真正的音色转换。
                    要真变声 / 跨音色重读，请切到云端服务。
                  </Text>
                </SurfaceCard>
              </Entrance>

              <Entrance index={5} screenKey="voiceChange">
                <SectionLabel
                  title="要朗读的文字"
                  style={styles.sectionLabel}
                />
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
                      placeholder="输入要朗读的文字"
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
                        <SurfaceCard
                          style={[styles.warnBox, styles.warnBoxInCard]}>
                          <Text style={styles.warnText}>
                            {langMismatch.hint}
                          </Text>
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

              <Entrance index={6} screenKey="voiceChange">
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
                      <Text style={styles.errorText}>
                        {ttsStore.speechError}
                      </Text>
                    </SurfaceCard>
                  ) : ttsStore.speechHint ? (
                    <SurfaceCard style={styles.hintPill}>
                      <Text style={styles.hintText}>{ttsStore.speechHint}</Text>
                    </SurfaceCard>
                  ) : null
                ) : null}

                {playing ? (
                  <Button
                    mode="contained"
                    style={[styles.genBtn, glassBtnFilled]}
                    loading={mode === 'local' && playPreparing}
                    icon="stop"
                    textColor={glassBtnText}
                    onPress={onStop}>
                    {mode === 'local' && playPreparing
                      ? '正在加载音色…'
                      : '停止'}
                  </Button>
                ) : (
                  <Button
                    mode="contained"
                    style={[styles.genBtn, glassBtnFilled]}
                    icon="play"
                    textColor={glassBtnText}
                    disabled={!canLocal}
                    onPress={() =>
                      ttsStore.play(CONVERT_MESSAGE_ID, text).catch(() => {})
                    }>
                    生成语音
                  </Button>
                )}
              </Entrance>
            </>
          )}

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
    chipWrap: {flexDirection: 'row', gap: 10, flexWrap: 'wrap'},
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
    flex1: {flex: 1, flexShrink: 1},
    twoCol: {flexDirection: 'row', gap: 10},
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
