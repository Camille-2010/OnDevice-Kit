import React, {useEffect, useMemo, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {Icon} from 'react-native-paper';
import {GlassButton as Button} from '../../components/GlassButton';
import {observer} from 'mobx-react-lite';

import {useTheme} from '../../hooks';
import {Entrance} from '../../components/Entrance';
import {SectionLabel} from '../../components/SectionLabel';
import {gptSovitsStore} from '../../store/GptSovitsStore';
import {ttsStore} from '../../store/TTSStore';
import {uiStore} from '../../store';
import {cardBg, cardRadius, glassButton, buttonRing} from '../../theme/cards';
import {Theme} from '../../utils/types';
import {GsvPageTopBar} from './GsvPageTopBar';
import {KeyboardAwareScrollView} from 'react-native-keyboard-controller';
import {SurfaceCard, GlassTextField} from '../../components/GlassSurface';

/**
 * GPT-SoVITS · Mini ONNX（轻量 ONNX 推理）页。
 *
 * 本页做成**本地 / 云端双模式**，最上面就用真实数据回答一个问题：
 * 「这台手机能不能流畅跑本地推理？」
 *
 * 【本地模式】真的在手机上出声音 —— 走应用已内置的本地神经网络引擎
 *   （Kokoro / Kitten / Supertonic，ONNX 推理，真机已验证）。
 *   GPT-SoVITS 自身的 ONNX 导出物各项目契约不统一、且需要中文 g2p
 *   词典，无法在没有模型的情况下保证可用，所以这里不硬塞一条跑不通的管线；
 *   需要 GPT-SoVITS 专属音色时走云端模式。
 * 【云端模式】连 GPT-SoVITS 服务端（api_v2，9880），音色更接近目标角色。
 *
 * 【可行性标注的来源】
 *   1. 静态预判：芯片 / 内存 / 可用存储（真实读取，列出依据）
 *   2. RTF 实测：真跑一次，「耗时 ÷ 音频时长」，RTF < 1 即快于实时
 *      实测优先于预判，页面会标明当前结论基于哪一个。
 */

const SAMPLE = '你好，这是一次语音合成的测试。';

export const GptSovitsOnnxScreen: React.FC<{onBack: () => void}> = observer(
  ({onBack}: {onBack: () => void}) => {
    const theme = useTheme();
    const styles = useMemo(() => createStyles(theme), [theme]);
    const store = gptSovitsStore;
    const [text, setText] = useState(SAMPLE);

    // 液态玻璃按钮 + 选中态蓝玻璃（非玻璃风格回落 Paper 默认）
    const glassBtnOutlined = glassButton(theme);
    const glassBtnFilled = glassButton(theme, 'filled');
    const glassBtnText = theme.colors.primary;
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

    useEffect(() => {
      if (!store.perf) {
        store.refreshPerf();
      }
    }, [store]);

    const isLocal = store.mode === 'local';
    const verdict = store.localVerdict;
    const verdictColor =
      verdict.tier === 'fast'
        ? '#2E7D32'
        : verdict.tier === 'usable'
          ? '#F9A825'
          : verdict.tier === 'struggling'
            ? '#C62828'
            : theme.colors.onSurfaceVariant;

    const rtf = isLocal ? store.localRtf : store.cloudRtf;

    return (
      <View style={styles.root}>
        <KeyboardAwareScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag">
          <GsvPageTopBar title="Mini ONNX（轻量 ONNX 推理）" onBack={onBack} />
          <View style={styles.content}>
            <Entrance index={0} screenKey="gptsovits">
              <SurfaceCard style={styles.card}>
                <Text style={styles.title}>轻量 ONNX 推理（experimental）</Text>
                <Text style={styles.desc}>
                  本地模式用应用内置的 ONNX 神经网络引擎在手机上直接出声音，
                  不联网；云端模式连你自己的 GPT-SoVITS
                  服务端，音色更接近目标角色。两种都能真正出声。
                </Text>
              </SurfaceCard>
            </Entrance>

            {/* ── 这台手机能不能流畅跑本地推理（仅本地模式）── */}
            {isLocal ? (
              <Entrance index={1} screenKey="gptsovits">
                <SurfaceCard style={[styles.card, styles.perfCard]}>
                  <View style={styles.perfHead}>
                    <Icon
                      source="speedometer"
                      size={20}
                      color={theme.colors.onSurface}
                    />
                    <Text style={styles.title}>这台手机能跑本地推理吗</Text>
                  </View>

                  <View
                    style={[styles.verdictBox, {borderColor: verdictColor}]}>
                    <Text style={[styles.verdictText, {color: verdictColor}]}>
                      {verdict.text}
                    </Text>
                    <Text style={styles.verdictBasis}>
                      依据：{verdict.basedOn}
                    </Text>
                  </View>

                  {store.perf ? (
                    <>
                      <View style={styles.factGrid}>
                        <View style={styles.factItem}>
                          <Text style={styles.factLabel}>处理器</Text>
                          <Text style={styles.factValue}>
                            {store.perf.facts.hardware || '未识别'}
                          </Text>
                        </View>
                        <View style={styles.factItem}>
                          <Text style={styles.factLabel}>内存</Text>
                          <Text style={styles.factValue}>
                            {store.perf.facts.totalMemoryGb.toFixed(1)} GB
                          </Text>
                        </View>
                        <View style={styles.factItem}>
                          <Text style={styles.factLabel}>可用存储</Text>
                          <Text style={styles.factValue}>
                            {store.perf.facts.freeDiskGb.toFixed(1)} GB
                          </Text>
                        </View>
                        <View style={styles.factItem}>
                          <Text style={styles.factLabel}>模型占用</Text>
                          <Text style={styles.factValue}>0.1–0.7 GB</Text>
                        </View>
                      </View>

                      <Text style={styles.reasonsTitle}>判定依据</Text>
                      {store.perf.reasons.map(r => (
                        <View key={r} style={styles.reasonRow}>
                          <View style={styles.dot} />
                          <Text style={styles.reasonText}>{r}</Text>
                        </View>
                      ))}
                    </>
                  ) : (
                    <Text style={styles.desc}>正在读取设备信息…</Text>
                  )}

                  <Button
                    mode="outlined"
                    compact
                    style={[styles.actionBtn, glassBtnOutlined]}
                    onPress={() => store.refreshPerf()}>
                    重新检测本机性能
                  </Button>

                  <Text style={styles.tip}>
                    静态预判只看硬件。真正决定「跑不跑得动实时」的是实测 RTF ——
                    合成一次后，页面会用实测结果覆盖上面的预判。
                  </Text>
                </SurfaceCard>
              </Entrance>
            ) : null}

            {/* ── 推理位置 ── */}
            <Entrance index={2} screenKey="gptsovits">
              <SectionLabel title="推理位置" style={styles.sectionLabel} />
              <View style={styles.modeRow}>
                <Button
                  mode={isLocal ? 'contained' : 'outlined'}
                  compact
                  style={[
                    styles.modeBtn,
                    isLocal ? glassBtnActive : glassBtnOutlined,
                  ]}
                  textColor={isLocal ? activeText : undefined}
                  onPress={() => store.setMode('local')}>
                  本地 ONNX 引擎
                </Button>
                <Button
                  mode={isLocal ? 'outlined' : 'contained'}
                  compact
                  style={[
                    styles.modeBtn,
                    !isLocal ? glassBtnActive : glassBtnOutlined,
                  ]}
                  textColor={!isLocal ? activeText : undefined}
                  onPress={() => store.setMode('cloud')}>
                  云端 GPT-SoVITS
                </Button>
              </View>
            </Entrance>

            {/* ── 合成区 ── */}
            <Entrance index={3} screenKey="gptsovits">
              <SurfaceCard style={styles.card}>
                <Text style={styles.fieldLabel}>要合成的文本</Text>
                <GlassTextField
                  tintOpacity={0.68}
                  value={text}
                  onChangeText={setText}
                  multiline
                  style={styles.input}
                  inputStyle={styles.inputText}
                />

                {isLocal ? (
                  <LocalEnginePanel styles={styles} />
                ) : (
                  <>
                    <Text style={styles.desc}>
                      连你自己的 GPT-SoVITS 服务端（api_v2，默认 9880）。
                      地址在「原生 PyTorch」页配置过的话这里直接复用。
                    </Text>
                    <Text style={styles.fieldLabel}>
                      API 服务地址（api_v2 · 9880）
                    </Text>
                    <GlassTextField
                      tintOpacity={0.68}
                      value={store.apiBaseUrl}
                      onChangeText={v => store.setApiBaseUrl(v)}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      style={styles.input}
                      inputStyle={styles.inputText}
                      placeholder="http://192.168.1.10:9880"
                    />
                    <Button
                      mode="contained"
                      style={[styles.actionBtn, glassBtnFilled]}
                      textColor={glassBtnText}
                      disabled={store.isSynthesizing || !store.apiBase}
                      onPress={() => store.synthesize(text).catch(() => {})}>
                      {store.isSynthesizing ? '合成中…' : '云端合成'}
                    </Button>
                    <Text style={styles.hint}>
                      云端不受本机算力限制：合成速度取决于服务端显卡，
                      手机只负责发请求和播放。
                    </Text>
                  </>
                )}

                {store.error ? (
                  <Text style={styles.errorText}>{store.error}</Text>
                ) : null}

                {rtf ? (
                  <Text style={styles.rtfText}>
                    {isLocal ? '本地' : '云端'}实测 RTF {rtf.rtf.toFixed(2)}（
                    耗时 {(rtf.elapsedMs / 1000).toFixed(1)}s / 音频{' '}
                    {(rtf.audioMs / 1000).toFixed(1)}s）
                  </Text>
                ) : null}
              </SurfaceCard>
            </Entrance>
          </View>
        </KeyboardAwareScrollView>
      </View>
    );
  },
);

/**
 * 本地引擎面板：复用「生成语音」页那套本地引擎选择与试听能力，
 * 保证本地模式是真能出声的，而不是一个空壳。
 */
const LocalEnginePanel: React.FC<{styles: any}> = observer(({styles}) => {
  const theme = useTheme();
  const glassBtnOutlined = glassButton(theme);
  const voice = ttsStore.currentVoice;
  const preparing = voice ? ttsStore.isPreparingVoice(voice) : false;
  const previewing = voice ? ttsStore.isPreviewingVoice(voice) : false;

  return (
    <View>
      <Text style={styles.desc}>
        用应用内置的本地神经网络引擎（Kokoro / Kitten /
        Supertonic）在手机上直接推理，不联网。首次用某个音色要加载模型，会有几秒等待。
      </Text>
      <View style={styles.rowBetween}>
        <View style={styles.flex1}>
          <Text style={styles.voiceName} numberOfLines={1}>
            {voice ? voice.name : '还没有选择音色'}
          </Text>
          <Text style={styles.hint}>
            {ttsStore.isTTSAvailable
              ? '系统音色开箱即用，不需要下载模型'
              : ttsStore.ttsBlockMessage || '本地引擎当前不可用'}
          </Text>
        </View>
        <Button
          mode="outlined"
          compact
          style={[styles.changeBtn, glassBtnOutlined]}
          onPress={() => ttsStore.openSetupSheet()}>
          更换音色
        </Button>
      </View>
      {voice ? (
        <Button
          mode="text"
          compact
          loading={previewing && preparing}
          icon={previewing ? 'stop' : 'play'}
          style={glassBtnOutlined}
          onPress={() => {
            if (previewing) {
              ttsStore.stop().catch(() => {});
            } else {
              ttsStore.preview(voice).catch(() => {});
            }
          }}>
          {previewing
            ? preparing
              ? '正在加载音色…'
              : '停止试听'
            : '试听这个音色'}
        </Button>
      ) : null}
    </View>
  );
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      paddingBottom: 40,
    },
    content: {
      padding: 16,
      paddingTop: 4,
    },
    sectionLabel: {
      marginBottom: 8,
    },
    card: {
      backgroundColor: cardBg(theme),
      borderRadius: cardRadius(),
      padding: 16,
      marginBottom: 14,
    },
    perfCard: {
      borderWidth: 1,
      borderColor: theme.colors.outlineVariant,
    },
    title: {
      fontSize: 15,
      fontWeight: '700',
      color: theme.colors.onSurface,
    },
    perfHead: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 10,
    },
    desc: {
      fontSize: 13,
      lineHeight: 20,
      color: theme.colors.onSurfaceVariant,
      marginTop: 6,
      marginBottom: 6,
    },
    verdictBox: {
      borderWidth: 1,
      borderRadius: 12,
      padding: 12,
      marginTop: 10,
      marginBottom: 12,
    },
    verdictText: {
      fontSize: 14,
      fontWeight: '700',
      lineHeight: 20,
    },
    verdictBasis: {
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
      marginTop: 4,
    },
    factGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
    },
    factItem: {
      width: '48%',
      marginBottom: 10,
    },
    factLabel: {
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
    },
    factValue: {
      fontSize: 15,
      fontWeight: '700',
      color: theme.colors.onSurface,
      marginTop: 2,
    },
    reasonsTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: theme.colors.onSurface,
      marginBottom: 6,
    },
    reasonRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginBottom: 4,
    },
    dot: {
      width: 5,
      height: 5,
      borderRadius: 3,
      backgroundColor: theme.colors.onSurfaceVariant,
      marginTop: 7,
      marginRight: 8,
    },
    reasonText: {
      flex: 1,
      fontSize: 12,
      lineHeight: 18,
      color: theme.colors.onSurfaceVariant,
    },
    tip: {
      fontSize: 12,
      lineHeight: 18,
      color: theme.colors.onSurfaceVariant,
      marginTop: 6,
    },
    modeRow: {
      flexDirection: 'row',
      marginBottom: 6,
    },
    modeBtn: {
      borderRadius: 22,
      marginRight: 10,
    },
    fieldLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.colors.onSurface,
      marginTop: 6,
      marginBottom: 6,
    },
    input: {
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 8,
      backgroundColor: theme.colors.background,
    },
    inputText: {fontSize: 13, color: theme.colors.onSurface},
    actionBtn: {
      borderRadius: 22,
      marginTop: 4,
      marginBottom: 8,
    },
    changeBtn: {
      borderRadius: 20,
      marginLeft: 10,
    },
    hint: {
      fontSize: 12,
      lineHeight: 18,
      color: theme.colors.onSurfaceVariant,
      marginTop: 2,
    },
    voiceName: {
      fontSize: 15,
      fontWeight: '700',
      color: theme.colors.onSurface,
    },
    rowBetween: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 6,
      marginBottom: 4,
    },
    flex1: {
      flex: 1,
    },
    errorText: {
      fontSize: 13,
      lineHeight: 19,
      color: '#D32F2F',
      marginTop: 6,
    },
    rtfText: {
      fontSize: 12,
      lineHeight: 18,
      color: theme.colors.onSurfaceVariant,
      marginTop: 8,
    },
  });
