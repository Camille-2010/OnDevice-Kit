import React, {useEffect, useMemo, useState} from 'react';
import {
  BackHandler,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Icon} from 'react-native-paper';
import {GlassButton as Button} from '../../components/GlassButton';
import {observer} from 'mobx-react-lite';
import {WebView} from 'react-native-webview';
import DeviceInfo from 'react-native-device-info';

import {useTheme} from '../../hooks';
import {Entrance} from '../../components/Entrance';
import {SectionLabel} from '../../components/SectionLabel';
import {BackButton} from '../../components/BackButton';
import {uiStore} from '../../store';
import {gptSovitsStore} from '../../store/GptSovitsStore';
import {GSV_LANGS} from '../../store/GptSovitsStore';
import {ttsStore} from '../../store/TTSStore';
import {
  checkLangMismatch,
  detectTextLang,
  SYSTEM_ROUTABLE_LANGS,
} from '../../services/tts/textLang';
import {cardBg, cardRadius, glassButton, buttonRing} from '../../theme/cards';
import {Theme} from '../../utils/types';
import {KeyboardAwareScrollView} from 'react-native-keyboard-controller';
import {SurfaceCard, GlassTextField} from '../../components/GlassSurface';
import {SubHeader} from '../../components/SubHeader';

// 玻璃按钮样式助手（模块级，供主组件与各子组件共用；非玻璃风格回落空对象/Papers 默认）
const glassBtn = (t: Theme) => glassButton(t);
const glassBtnFilled = (t: Theme) => glassButton(t, 'filled');
const glassBtnText = (t: Theme) => t.colors.primary;
const glassBtnActive = (t: Theme) =>
  uiStore.themeStyle === 'liquid-glass'
    ? {
        backgroundColor: t.dark
          ? 'rgba(59, 130, 246, 0.55)'
          : 'rgba(59, 130, 246, 0.62)',
        borderWidth: 1,
        borderColor: buttonRing(t),
      }
    : {};
const activeLabel = (_t: Theme) =>
  uiStore.themeStyle === 'liquid-glass' ? '#FFFFFF' : undefined;

/**
 * GPT-SoVITS · 原生 PyTorch 页。
 *
 * 【本地模式：真能在手机上出声音】
 *  · 走应用内置的本地神经网络引擎（Kokoro / Kitten / Supertonic，ONNX 推理，
 *    真机已验证），可试听、可合成，不需要连任何服务器。
 *  · 「本机模型」区块里的下载 / 删除都是真实操作（ttsStore 的下载接口），
 *    会真的下模型、占存储、可删除。
 *  · 页面上用真实设备数据（芯片 / 内存 / 可用存储）预判本机跑不跑得动，
 *    并给出 RTF 实测口径。
 *
 * 【云端模式：全部走官方 api_v2】
 *  · 连接检测：GET {api}/ 与 {webui}/，记录延迟
 *  · 推理网页：内置 WebView 加载服务端 9872 的 Gradio 页面
 *  · 角色 / 模型管理：set_gpt_weights / set_sovits_weights 切权重，
 *    角色包（参考音频+文本）保存 / 选用 / 删除
 *  · 冒烟测试（set_role + tts）：POST /tts 拿 WAV → 剥容器 → 原生播放
 *  · 终端日志：以上每一步都真实记录
 */

const SMOKE_TEXT = '你好，这是一次 GPT-SoVITS 的冒烟测试。';

/**
 * 本地合成用的播放 id。ttsStore 用 messageId 区分「谁在播」，
 * 固定 id 才不会和聊天里某条消息的播放状态互相干扰。
 */
const LOCAL_MESSAGE_ID = 'gptsovits-local';

interface DeviceFacts {
  model: string;
  osVersion: string;
  hardware: string;
  totalMemoryGb: string;
  freeDiskGb: string;
  totalDiskGb: string;
}

const formatGb = (bytes: number): string => (bytes / 1024 ** 3).toFixed(1);

/**
 * 【错误处理约定】本文件里的 `.catch(() => {})` 不是「吞错误让用户干等」：
 * 被调用的 store 方法（checkConnection / applyGptWeights / applySovitsWeights /
 * synthesize / stopPlayback）内部都已 runInAction 写 `store.error`，页面会
 * 把 `store.error` 渲染成红色错误框；ttsStore.play 同理写 `speechError`。
 * 这些 catch 的唯一作用是防止 Promise rejection 逃逸成 unhandled rejection
 * （RN 下会弹红色 LogBox）。改这个文件时请保持这个约定：要么让错误进
 * store.error，要么真的给用户可见提示，不要留既不看也不显示的静默 catch。
 */
export const GptSovitsPyTorchScreen: React.FC<{onBack: () => void}> = observer(
  ({onBack}: {onBack: () => void}) => {
    const theme = useTheme();
    const insets = useSafeAreaInsets();
    const styles = useMemo(() => createStyles(theme), [theme]);
    const store = gptSovitsStore;

    const [smokeText, setSmokeText] = useState(SMOKE_TEXT);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [roleName, setRoleName] = useState('');
    const [webViewUrl, setWebViewUrl] = useState<string | null>(null);
    const [device, setDevice] = useState<DeviceFacts | null>(null);

    // 设备信息卡：全部真实数据
    useEffect(() => {
      let alive = true;
      (async () => {
        try {
          const [model, osVersion, hardware, totalMemory, freeDisk, totalDisk] =
            await Promise.all([
              DeviceInfo.getModel(),
              DeviceInfo.getSystemVersion(),
              DeviceInfo.getHardware(),
              DeviceInfo.getTotalMemory(),
              DeviceInfo.getFreeDiskStorage('important'),
              DeviceInfo.getTotalDiskCapacity(),
            ]);
          if (alive) {
            setDevice({
              model,
              osVersion: `Android ${osVersion}`,
              hardware: hardware || '—',
              totalMemoryGb: formatGb(totalMemory),
              freeDiskGb: formatGb(freeDisk),
              totalDiskGb: formatGb(totalDisk),
            });
          }
        } catch {
          // 拿不到就保持 null，界面显示占位
        }
      })();
      return () => {
        alive = false;
      };
    }, []);

    const online = store.connected;
    const checking = store.apiStatus === 'checking';

    // 进入页面先采一次真实性能信号（芯片/内存/存储），用于本地可行性预判
    useEffect(() => {
      if (!store.perf) {
        store.refreshPerf();
      }
    }, [store]);

    // WebView 打开时，硬件返回先关网页（而不是退出整个页面）
    useEffect(() => {
      if (!webViewUrl) {
        return;
      }
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        setWebViewUrl(null);
        return true;
      });
      return () => sub.remove();
    }, [webViewUrl]);

    const onSmoke = () => {
      store.synthesize(smokeText.trim() || SMOKE_TEXT).catch(() => {});
    };

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

    return (
      <View style={styles.root}>
        <KeyboardAwareScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled">
          <SubHeader title="原生 PyTorch" onBack={onBack} />
          <View style={styles.content}>
            {/* ── 0. 推理位置（本地 / 云端）── */}
            <Entrance index={0} screenKey="gptsovits">
              <View style={styles.modeRow}>
                <Button
                  mode={isLocal ? 'contained' : 'outlined'}
                  compact
                  style={[
                    styles.modeBtn,
                    isLocal ? glassBtnActive(theme) : glassBtn(theme),
                  ]}
                  textColor={isLocal ? activeLabel(theme) : undefined}
                  onPress={() => store.setMode('local')}>
                  本地引擎
                </Button>
                <Button
                  mode={isLocal ? 'outlined' : 'contained'}
                  compact
                  style={[
                    styles.modeBtn,
                    !isLocal ? glassBtnActive(theme) : glassBtn(theme),
                  ]}
                  textColor={!isLocal ? activeLabel(theme) : undefined}
                  onPress={() => store.setMode('cloud')}>
                  云端 GPT-SoVITS
                </Button>
              </View>
              <SurfaceCard style={styles.modeHintPill}>
                <Text style={styles.modeHint}>
                  {isLocal
                    ? '本地模式：用应用内置的神经网络引擎在这台手机上直接推理，不联网。'
                    : '云端模式：连你自己的 GPT-SoVITS 服务端（api_v2），音色更接近目标角色。'}
                </Text>
              </SurfaceCard>
            </Entrance>

            {/* ── 1. 状态卡 ── */}
            <Entrance index={1} screenKey="gptsovits">
              {isLocal ? (
                <View style={[styles.statusCard, {backgroundColor: '#1565C0'}]}>
                  <View style={styles.statusBody}>
                    <Text style={styles.statusTitle}>本地运行</Text>
                    <Text style={styles.statusLine}>
                      {`引擎 ${
                        ttsStore.currentVoice
                          ? ttsStore.currentVoice.engine
                          : 'system'
                      } · 不需要联网`}
                    </Text>
                    <Text style={styles.statusLine}>
                      {ttsStore.isTTSAvailable
                        ? '本地引擎可用'
                        : '本地引擎不可用'}
                    </Text>
                    <Text style={styles.statusLine}>
                      {store.localRtf
                        ? `实测 RTF ${store.localRtf.rtf.toFixed(2)}`
                        : '尚未实测'}
                    </Text>
                  </View>
                  <View style={styles.statusBadge}>
                    <Icon
                      source="cellphone-sound"
                      size={34}
                      color="rgba(255,255,255,0.85)"
                    />
                  </View>
                </View>
              ) : (
                <View
                  style={[
                    styles.statusCard,
                    {backgroundColor: online ? '#2E7D32' : '#C62828'},
                  ]}>
                  <View style={styles.statusBody}>
                    <Text style={styles.statusTitle}>
                      {online ? '已连接' : checking ? '检测中…' : '未连接'}
                    </Text>
                    <Text style={styles.statusLine}>
                      {`完整性 ${online ? '在线' : '未连接'} · API ${
                        store.apiLatency != null ? `${store.apiLatency}ms` : '—'
                      }`}
                    </Text>
                    <Text style={styles.statusLine}>
                      {`WebUI ${
                        store.webuiStatus === 'online'
                          ? '可达'
                          : store.webuiStatus === 'checking'
                            ? '检测中'
                            : '×'
                      }`}
                    </Text>
                    <Text style={styles.statusLine}>
                      {online ? '已连接' : '已停止'}
                    </Text>
                  </View>
                  <View style={styles.statusBadge}>
                    <Icon
                      source={online ? 'check-circle' : 'alert-circle'}
                      size={34}
                      color="rgba(255,255,255,0.85)"
                    />
                  </View>
                </View>
              )}
            </Entrance>

            {/* ── 2. 设备信息卡 ── */}
            <Entrance index={1} screenKey="gptsovits">
              <SurfaceCard style={styles.card}>
                <View style={styles.grid}>
                  <View style={styles.gridItem}>
                    <Icon
                      source="cellphone"
                      size={18}
                      color={theme.colors.onSurfaceVariant}
                    />
                    <Text style={styles.gridLabel}>设备型号</Text>
                    <Text style={styles.gridValue}>{device?.model ?? '—'}</Text>
                  </View>
                  <View style={styles.gridItem}>
                    <Icon
                      source="android"
                      size={18}
                      color={theme.colors.onSurfaceVariant}
                    />
                    <Text style={styles.gridLabel}>Android 版本</Text>
                    <Text style={styles.gridValue}>
                      {device?.osVersion ?? '—'}
                    </Text>
                  </View>
                  <View style={styles.gridItem}>
                    <Icon
                      source="memory"
                      size={18}
                      color={theme.colors.onSurfaceVariant}
                    />
                    <Text style={styles.gridLabel}>处理器</Text>
                    <Text style={styles.gridValue}>
                      {device?.hardware ?? '—'}
                    </Text>
                  </View>
                  <View style={styles.gridItem}>
                    <Icon
                      source="chip"
                      size={18}
                      color={theme.colors.onSurfaceVariant}
                    />
                    <Text style={styles.gridLabel}>运行内存</Text>
                    <Text style={styles.gridValue}>
                      {device ? `${device.totalMemoryGb}GB` : '—'}
                    </Text>
                  </View>
                  <View style={styles.gridItem}>
                    <Icon
                      source="database"
                      size={18}
                      color={theme.colors.onSurfaceVariant}
                    />
                    <Text style={styles.gridLabel}>存储（可用 / 共）</Text>
                    <Text style={styles.gridValue}>
                      {device
                        ? `${device.freeDiskGb} / ${device.totalDiskGb} GB`
                        : '—'}
                    </Text>
                  </View>
                  <View style={styles.gridItem}>
                    <Icon
                      source="cloud-check"
                      size={18}
                      color={theme.colors.onSurfaceVariant}
                    />
                    <Text style={styles.gridLabel}>推理位置</Text>
                    <Text style={styles.gridValue}>
                      {isLocal ? '本机' : '服务端'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.gridFootnote}>
                  {isLocal
                    ? '本地模式在这台手机上直接推理，不依赖网络。'
                    : '云端模式本机只负责界面与播放，推理在 GPT-SoVITS 服务端完成。'}
                </Text>
              </SurfaceCard>
            </Entrance>

            {/* ── 本地可行性预判（真实设备信号，仅本地模式）── */}
            {isLocal ? (
              <Entrance index={2} screenKey="gptsovits">
                <SurfaceCard style={[styles.card, styles.perfCard]}>
                  <View style={styles.perfHead}>
                    <Icon
                      source="speedometer"
                      size={20}
                      color={theme.colors.onSurface}
                    />
                    <Text style={styles.cardTitle}>
                      这台手机跑本地推理行不行
                    </Text>
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
                      <Text style={styles.reasonsTitle}>判定依据</Text>
                      {store.perf.reasons.map(r => (
                        <View key={r} style={styles.reasonRow}>
                          <View style={styles.reasonDot} />
                          <Text style={styles.reasonText}>{r}</Text>
                        </View>
                      ))}
                    </>
                  ) : null}
                  <Button
                    mode="outlined"
                    compact
                    style={[styles.actionBtn, glassBtn(theme)]}
                    onPress={() => store.refreshPerf()}>
                    重新检测本机性能
                  </Button>
                </SurfaceCard>
              </Entrance>
            ) : null}

            {/* ── 本地模式：引擎 + 本机模型管理（全部真实可调）── */}
            {isLocal ? (
              <Entrance index={3} screenKey="gptsovits">
                <SectionLabel title="本地引擎" style={styles.sectionLabel} />
                <SurfaceCard style={styles.card}>
                  <Text style={styles.cardDesc}>
                    下面是应用内置的本地神经网络引擎，可直接试听出声；也可下载
                    音质更好的神经引擎模型（真实下载，占用存储，可随时删除）。
                  </Text>
                  <View style={styles.rowBetween}>
                    <View style={styles.flex1}>
                      <Text style={styles.voiceName} numberOfLines={1}>
                        {ttsStore.currentVoice
                          ? ttsStore.currentVoice.name
                          : '还没有选择音色'}
                      </Text>
                      <Text style={styles.hint}>
                        {ttsStore.isTTSAvailable
                          ? '系统音色开箱即用；神经引擎需先下载模型'
                          : ttsStore.ttsBlockMessage || '本地引擎当前不可用'}
                      </Text>
                    </View>
                    <Button
                      mode="outlined"
                      compact
                      style={[styles.changeBtn, glassBtn(theme)]}
                      onPress={() => ttsStore.openSetupSheet()}>
                      更换音色
                    </Button>
                  </View>

                  <View style={styles.divider} />
                  <Text style={styles.cardTitle}>本机模型</Text>
                  {(
                    [
                      [
                        'kokoro',
                        'Kokoro',
                        ttsStore.kokoroDownloadState,
                        () => ttsStore.downloadKokoro(),
                        () => ttsStore.deleteKokoro(),
                      ],
                      [
                        'kitten',
                        'Kitten',
                        ttsStore.kittenDownloadState,
                        () => ttsStore.downloadKitten(),
                        () => ttsStore.deleteKitten(),
                      ],
                      [
                        'supertonic',
                        'Supertonic',
                        ttsStore.supertonicDownloadState,
                        () => ttsStore.downloadSupertonic(),
                        () => ttsStore.deleteSupertonic(),
                      ],
                    ] as const
                  ).map(([key, name, state, onDownload, onDelete]) => {
                    const ready = state === 'ready';
                    const busy = state === 'downloading';
                    return (
                      <View key={key} style={styles.modelRow}>
                        <View style={styles.flex1}>
                          <Text style={styles.modelName}>{name}</Text>
                          <Text style={styles.hint}>
                            {ready
                              ? '已安装，可直接使用'
                              : busy
                                ? '正在处理…'
                                : state === 'error'
                                  ? '上次失败，可重试'
                                  : '未安装'}
                          </Text>
                        </View>
                        <Button
                          mode="outlined"
                          compact
                          style={[styles.changeBtn, glassBtn(theme)]}
                          loading={busy}
                          disabled={busy || ready}
                          onPress={onDownload}>
                          {ready
                            ? '已安装'
                            : state === 'error'
                              ? '重试'
                              : '下载'}
                        </Button>
                        {ready ? (
                          <Button
                            mode="text"
                            compact
                            textColor="#D32F2F"
                            style={[styles.changeBtn, glassBtn(theme)]}
                            onPress={onDelete}>
                            删除
                          </Button>
                        ) : null}
                      </View>
                    );
                  })}
                  <Text style={styles.tip}>
                    下载会真的占用存储空间；删除后随时可以重新下载。
                  </Text>
                </SurfaceCard>
              </Entrance>
            ) : null}

            {/* ── 云端：运行（推理服务） ── */}
            {!isLocal ? (
              <Entrance index={4} screenKey="gptsovits">
                <SectionLabel title="运行" style={styles.sectionLabel} />
                <SurfaceCard style={styles.card}>
                  <Text style={styles.cardDesc}>
                    Gradio 推理页 · 9872；Mobile API · 9880。推理跑在你的
                    GPT-SoVITS 服务端上，填好地址点「检测连接」，通过即可合成。
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
                  <Text style={styles.fieldLabel}>
                    推理网页地址（留空自动推导 · 9872）
                  </Text>
                  <GlassTextField
                    tintOpacity={0.68}
                    value={store.webuiBaseUrl}
                    onChangeText={v => store.setWebuiBaseUrl(v)}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    style={styles.input}
                    inputStyle={styles.inputText}
                    placeholder="http://192.168.1.10:9872"
                  />
                  <View style={styles.btnRow}>
                    <Button
                      mode="contained"
                      style={[styles.flexBtn, glassBtnFilled(theme)]}
                      textColor={glassBtnText(theme)}
                      loading={checking}
                      onPress={() => store.checkConnection().catch(() => {})}>
                      检测连接
                    </Button>
                    <Button
                      mode="outlined"
                      style={[styles.flexBtn, glassBtn(theme)]}
                      disabled={store.webuiStatus !== 'online'}
                      onPress={() =>
                        store.webuiUrl && setWebViewUrl(store.webuiUrl)
                      }>
                      打开推理网页
                    </Button>
                  </View>
                  <Text style={styles.hint}>
                    打开推理网页会用内置浏览器加载服务端的 Gradio
                    页面，选角色、调参数都在那里完成，和电脑上使用一致。
                  </Text>
                </SurfaceCard>
              </Entrance>
            ) : null}

            {/* ── 云端：角色 / 模型管理 ── */}
            {!isLocal ? (
              <Entrance index={5} screenKey="gptsovits">
                <SectionLabel
                  title="角色 / 模型管理"
                  style={styles.sectionLabel}
                />
                <SurfaceCard style={styles.card}>
                  <Text style={styles.cardDesc}>
                    切权重、配参考音频都是真实请求，直接作用于服务端。
                  </Text>

                  <Text style={styles.fieldLabel}>GPT 权重路径</Text>
                  <GlassTextField
                    tintOpacity={0.68}
                    value={store.gptWeightPath}
                    onChangeText={v => store.setGptWeightPath(v)}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.input}
                    inputStyle={styles.inputText}
                    placeholder="GPT_weights_v2/xxx-e15.ckpt"
                  />
                  <Button
                    mode="outlined"
                    compact
                    style={[styles.actionBtn, glassBtn(theme)]}
                    onPress={() => store.applyGptWeights().catch(() => {})}>
                    应用 GPT 权重
                  </Button>

                  <Text style={styles.fieldLabel}>SoVITS 权重路径</Text>
                  <GlassTextField
                    tintOpacity={0.68}
                    value={store.sovitsWeightPath}
                    onChangeText={v => store.setSovitsWeightPath(v)}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.input}
                    inputStyle={styles.inputText}
                    placeholder="SoVITS_weights_v2/xxx-e8.pth"
                  />
                  <Button
                    mode="outlined"
                    compact
                    style={[styles.actionBtn, glassBtn(theme)]}
                    onPress={() => store.applySovitsWeights().catch(() => {})}>
                    应用 SoVITS 权重
                  </Button>

                  <View style={styles.divider} />

                  <Text style={styles.fieldLabel}>
                    参考音频路径
                    {store.activeRole
                      ? `（角色：${store.activeRole.name}）`
                      : ''}
                  </Text>
                  <GlassTextField
                    tintOpacity={0.68}
                    value={store.refAudioPath}
                    onChangeText={v => store.setRefAudioPath(v)}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.input}
                    inputStyle={styles.inputText}
                    placeholder="参考音频在服务端上的路径（.wav）"
                  />
                  <Text style={styles.fieldLabel}>
                    参考文本（音频里说的内容）
                  </Text>
                  <GlassTextField
                    tintOpacity={0.68}
                    value={store.promptText}
                    onChangeText={v => store.setPromptText(v)}
                    style={styles.input}
                    inputStyle={styles.inputText}
                    placeholder="参考音频对应的文字"
                  />
                  <Text style={styles.fieldLabel}>参考文本语言</Text>
                  <View style={styles.chipWrap}>
                    {GSV_LANGS.map(lang => (
                      <Chip
                        key={`p-${lang}`}
                        label={lang}
                        active={store.promptLanguage === lang}
                        onPress={() => store.setPromptLanguage(lang)}
                        styles={styles}
                      />
                    ))}
                  </View>

                  <View style={styles.btnRow}>
                    <GlassTextField
                      tintOpacity={0.68}
                      value={roleName}
                      onChangeText={setRoleName}
                      style={styles.flexInput}
                      inputStyle={styles.inputText}
                      placeholder="角色包名称"
                    />
                    <Button
                      mode="outlined"
                      compact
                      style={[styles.flexBtn, glassBtn(theme)]}
                      onPress={() => {
                        const role = store.saveCurrentAsRole(roleName);
                        if (role) {
                          setRoleName('');
                        }
                      }}>
                      存为角色包
                    </Button>
                  </View>
                  <Text style={styles.hint}>
                    角色包保存在本机，保存后会作为当前角色，选用后即可直接合成对应音色。
                  </Text>
                </SurfaceCard>
              </Entrance>
            ) : null}

            {/* ── 合成区（按推理位置切换）── */}
            {isLocal ? (
              <LocalComposeBox
                styles={styles}
                text={smokeText}
                onChangeText={setSmokeText}
              />
            ) : (
              <CloudComposeBox
                styles={styles}
                text={smokeText}
                onChangeText={setSmokeText}
                onSmoke={onSmoke}
              />
            )}

            {/* ── 6. 高级选项 ── */}
            <Entrance index={5} screenKey="gptsovits">
              <SurfaceCard
                style={styles.advHeader}
                onPress={() => setShowAdvanced(s => !s)}
                activeOpacity={0.7}
                accessibilityRole="button">
                <Text style={styles.advTitle}>高级选项</Text>
                <Icon
                  source={showAdvanced ? 'chevron-up' : 'chevron-down'}
                  size={22}
                  color={theme.colors.onSurfaceVariant}
                />
              </SurfaceCard>

              {showAdvanced ? (
                <SurfaceCard style={styles.card}>
                  <Text style={styles.cardTitle}>Mobile API（9880）</Text>
                  <Text style={styles.cardDesc}>
                    无 Gradio 的 HTTP 引擎，供对照调试；日常请用上方 9872
                    推理网页。引擎跑在服务端，本机无需启动。
                  </Text>
                  <Button
                    mode="outlined"
                    compact
                    style={[styles.actionBtn, glassBtn(theme)]}
                    disabled={store.webuiStatus !== 'online'}
                    onPress={() =>
                      store.webuiUrl && setWebViewUrl(store.webuiUrl)
                    }>
                    打开推理界面
                  </Button>
                  <Button
                    mode="outlined"
                    compact
                    style={[styles.actionBtn, glassBtn(theme)]}
                    onPress={() =>
                      store.apiBase && setWebViewUrl(`${store.apiBase}/docs`)
                    }>
                    打开 API 文档
                  </Button>
                  <Button
                    mode="outlined"
                    compact
                    style={[styles.actionBtn, glassBtn(theme)]}
                    loading={store.isSynthesizing}
                    disabled={store.isSynthesizing || !store.apiBase}
                    onPress={onSmoke}>
                    引擎冒烟（set_role+tts）
                  </Button>

                  <View style={styles.divider} />
                  <Text style={styles.cardTitle}>引擎维护</Text>
                  <Text style={styles.cardDesc}>
                    重新检测本机性能、按当前配置跑一次冒烟、清空本地日志 ——
                    都是真实操作，会立刻生效。
                  </Text>
                  <Button
                    mode="outlined"
                    compact
                    style={[styles.actionBtn, glassBtn(theme)]}
                    onPress={() => store.refreshPerf()}>
                    重新检测本机性能
                  </Button>
                  <Button
                    mode="outlined"
                    compact
                    style={[styles.actionBtn, glassBtn(theme)]}
                    loading={store.isSynthesizing}
                    disabled={store.isSynthesizing || !store.apiBase}
                    onPress={onSmoke}>
                    引擎冒烟（set_role+tts）
                  </Button>
                  <Button
                    mode="outlined"
                    compact
                    style={[styles.actionBtn, glassBtn(theme)]}
                    onPress={() => store.clearLogs()}>
                    清空本地日志
                  </Button>

                  <View style={styles.divider} />
                  <Text style={styles.cardTitle}>操作与终端日志</Text>
                  <View style={styles.logBox}>
                    {store.logs.length === 0 ? (
                      <Text style={styles.logEmpty}>暂无日志</Text>
                    ) : (
                      store.logs
                        .slice()
                        .reverse()
                        .map((line, i) => (
                          <Text key={`${i}-${line}`} style={styles.logLine}>
                            {line}
                          </Text>
                        ))
                    )}
                  </View>
                </SurfaceCard>
              ) : null}
            </Entrance>
          </View>
        </KeyboardAwareScrollView>

        {/* ── 内置推理网页（WebUI / API 文档）── */}
        {webViewUrl ? (
          <View style={[styles.webLayer, {paddingTop: insets.top}]}>
            <View style={styles.webHeader}>
              <BackButton onPress={() => setWebViewUrl(null)} iconSize={20} />
              <Text
                style={[styles.webTitle, {color: theme.colors.onSurface}]}
                numberOfLines={1}>
                {webViewUrl}
              </Text>
            </View>
            <WebView
              source={{uri: webViewUrl}}
              style={styles.webView}
              originWhitelist={['*']}
              javaScriptEnabled
              domStorageEnabled
              startInLoadingState
            />
          </View>
        ) : null}
      </View>
    );
  },
);

/**
 * 本地合成框。走应用内置的本地神经网络引擎，真机已验证能出声。
 * 单独拆成组件是为了避免主页面里出现三层嵌套的三元表达式
 * （那种结构一旦少一个括号就会整页红屏，很难排查）。
 */
const LocalComposeBox: React.FC<{
  styles: any;
  text: string;
  onChangeText: (t: string) => void;
}> = observer(({styles, text, onChangeText}) => {
  const theme = useTheme();
  const store = gptSovitsStore;
  // 播放状态全部来自 ttsStore，按钮和动画才会跟着真实播放变
  const isPlaying =
    ttsStore.playbackState.mode !== 'idle' &&
    ttsStore.playbackState.messageId === LOCAL_MESSAGE_ID;
  const isPreparing = ttsStore.isPreparing(LOCAL_MESSAGE_ID);
  const busy = isPlaying || isPreparing;
  // 语言不匹配检测：本地神经引擎只有英文音素词典，读中文等非英文会发不出声。
  // 这种语言若是系统能回退的（中文/日文/韩文），会**自动用系统语音**读，
  // 这里只给个中性提示，而不是「换音色」的死路警告。
  const mismatch = checkLangMismatch(text, ttsStore.currentVoice);
  const textLang = detectTextLang(text);
  const isRoutable =
    mismatch.mismatched && SYSTEM_ROUTABLE_LANGS.includes(textLang);

  return (
    <Entrance index={6} screenKey="gptsovits">
      <SectionLabel title="本地合成" style={styles.sectionLabel} />
      <SurfaceCard style={styles.card}>
        <Text style={styles.fieldLabel}>合成文本</Text>
        <GlassTextField
          tintOpacity={0.68}
          value={text}
          onChangeText={onChangeText}
          multiline
          style={styles.input}
          inputStyle={styles.inputText}
        />
        {mismatch.mismatched ? (
          isRoutable ? (
            <View style={[styles.warnBox, styles.warnBoxInfo]}>
              <Text style={[styles.warnText, styles.warnTextInfo]}>
                检测到
                {textLang === 'zh'
                  ? '中文'
                  : textLang === 'ja'
                    ? '日语'
                    : '韩语'}
                ，播放时会自动改用 Supertonic（或系统语音）朗读。
              </Text>
            </View>
          ) : (
            <View style={styles.warnBox}>
              <Text style={styles.warnText}>{mismatch.hint}</Text>
              <Button
                mode="text"
                compact
                style={glassBtn(theme)}
                onPress={() => ttsStore.openSetupSheet()}>
                更换音色
              </Button>
            </View>
          )
        ) : null}
        <View style={styles.btnRow}>
          <Button
            mode="contained"
            style={[styles.flexBtn, glassBtnFilled(theme)]}
            textColor={glassBtnText(theme)}
            icon={busy ? 'stop' : 'play'}
            loading={isPreparing}
            disabled={!ttsStore.isTTSAvailable}
            onPress={() => {
              if (busy) {
                ttsStore.stop().catch(() => {});
              } else {
                ttsStore.play(LOCAL_MESSAGE_ID, text).catch(() => {});
              }
            }}>
            {isPreparing
              ? '正在加载音色…'
              : isPlaying
                ? '停止播放'
                : '本地合成并播放'}
          </Button>
          <Button
            mode="outlined"
            style={[styles.flexBtn, glassBtn(theme)]}
            disabled={!busy}
            onPress={() => ttsStore.stop().catch(() => {})}>
            停止
          </Button>
        </View>
        {isPlaying ? (
          <View style={styles.playingBar}>
            <View style={styles.playingDot} />
            <Text style={styles.playingText}>正在播放…</Text>
          </View>
        ) : null}
        <Text style={styles.tip}>
          {`英文走应用内置神经引擎，完全在这台手机上跑；中文 / 日文 / 韩文会自动改用本机系统语音朗读（系统 TTS）。第一次用某个神经音色时需要加载模型，会等几秒。`}
        </Text>
        {ttsStore.speechError ? (
          <Text style={styles.errorText}>{ttsStore.speechError}</Text>
        ) : null}
        {ttsStore.speechHint ? (
          <Text style={styles.hintText}>{ttsStore.speechHint}</Text>
        ) : null}
        {store.localRtf ? (
          <Text style={styles.rtfText}>
            {`本地实测 RTF ${store.localRtf.rtf.toFixed(2)}（耗时 ${(
              store.localRtf.elapsedMs / 1000
            ).toFixed(1)}s / 音频 ${(store.localRtf.audioMs / 1000).toFixed(
              1,
            )}s）`}
          </Text>
        ) : null}
        {store.error ? (
          <Text style={styles.errorText}>{store.error}</Text>
        ) : null}
      </SurfaceCard>
    </Entrance>
  );
});

/** 云端合成框（api_v2 /tts） */
const CloudComposeBox: React.FC<{
  styles: any;
  text: string;
  onChangeText: (t: string) => void;
  onSmoke: () => void;
}> = observer(({styles, text, onChangeText, onSmoke}) => {
  const theme = useTheme();
  const store = gptSovitsStore;
  return (
    <Entrance index={6} screenKey="gptsovits">
      <SectionLabel
        title="冒烟测试（set_role + tts）"
        style={styles.sectionLabel}
      />
      <SurfaceCard style={styles.card}>
        <Text style={styles.fieldLabel}>合成文本</Text>
        <GlassTextField
          tintOpacity={0.68}
          value={text}
          onChangeText={onChangeText}
          multiline
          style={styles.input}
          inputStyle={styles.inputText}
        />
        <Text style={styles.fieldLabel}>合成语言</Text>
        <View style={styles.chipWrap}>
          {GSV_LANGS.map(lang => (
            <Chip
              key={`t-${lang}`}
              label={lang}
              active={store.textLang === lang}
              onPress={() => store.setTextLang(lang)}
              styles={styles}
            />
          ))}
        </View>
        <View style={styles.btnRow}>
          <Button
            mode="contained"
            style={[styles.flexBtn, glassBtnFilled(theme)]}
            textColor={glassBtnText(theme)}
            loading={store.isSynthesizing}
            disabled={store.isSynthesizing || !store.apiBase}
            onPress={onSmoke}>
            {store.isSynthesizing ? '合成中…' : '合成并播放'}
          </Button>
          <Button
            mode="outlined"
            style={[styles.flexBtn, glassBtn(theme)]}
            onPress={() => store.stopPlayback().catch(() => {})}>
            停止
          </Button>
        </View>
        {store.error ? (
          <Text style={styles.errorText}>{store.error}</Text>
        ) : null}
      </SurfaceCard>
    </Entrance>
  );
});

/** 状态卡右上角的小圆徽、语言 chip 等页内小组件 */
const Chip: React.FC<{
  label: string;
  active: boolean;
  onPress: () => void;
  styles: any;
}> = ({label, active, onPress, styles}) => (
  <TouchableOpacity
    style={[styles.chip, active ? styles.chipActive : null]}
    onPress={onPress}
    accessibilityRole="button">
    <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
      {label}
    </Text>
  </TouchableOpacity>
);

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
      paddingBottom: 24,
    },
    content: {
      padding: 16,
      paddingTop: 4,
      paddingBottom: 40,
    },
    sectionLabel: {
      marginBottom: 8,
    },
    // ── 状态卡 ──
    statusCard: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: 20,
      padding: 20,
      marginBottom: 13,
    },
    statusBody: {
      flex: 1,
    },
    statusTitle: {
      fontSize: 22,
      fontWeight: '800',
      color: '#FFFFFF',
      marginBottom: 6,
    },
    statusLine: {
      fontSize: 13,
      lineHeight: 20,
      color: 'rgba(255,255,255,0.88)',
    },
    statusBadge: {
      width: 64,
      height: 64,
      borderRadius: 32,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 12,
    },
    // ── 通用卡片 ──
    card: {
      backgroundColor: cardBg(theme),
      borderRadius: cardRadius(),
      padding: 16,
      marginBottom: 18,
    },
    perfCard: {
      borderWidth: 1,
      borderColor: theme.colors.outlineVariant,
    },
    perfHead: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 4,
    },
    verdictBox: {
      borderWidth: 1,
      borderRadius: 12,
      padding: 12,
      marginTop: 10,
      marginBottom: 10,
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
    reasonDot: {
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
    modeRow: {
      flexDirection: 'row',
      marginBottom: 6,
    },
    modeBtn: {
      borderRadius: 22,
      marginRight: 10,
    },
    modeHint: {
      fontSize: 12,
      lineHeight: 18,
      color: theme.colors.onSurfaceVariant,
    },
    modeHintPill: {
      padding: 12,
      borderRadius: cardRadius(),
      marginBottom: 10,
    },
    voiceName: {
      fontSize: 15,
      fontWeight: '700',
      color: theme.colors.onSurface,
    },
    rowBetween: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 6,
    },
    flex1: {
      flex: 1,
    },
    changeBtn: {
      borderRadius: 20,
      marginLeft: 8,
    },
    modelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 6,
    },
    modelName: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.colors.onSurface,
    },
    rtfText: {
      fontSize: 12,
      lineHeight: 18,
      color: theme.colors.onSurfaceVariant,
      marginTop: 8,
    },
    playingBar: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 10,
    },
    playingDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: '#2E7D32',
      marginRight: 8,
    },
    playingText: {
      fontSize: 13,
      fontWeight: '600',
      color: '#2E7D32',
    },
    warnBox: {
      backgroundColor: 'rgba(249, 168, 37, 0.12)',
      borderRadius: 12,
      padding: 10,
      marginBottom: 8,
    },
    warnText: {
      fontSize: 12,
      lineHeight: 18,
      color: '#B26A00',
    },
    warnBoxInfo: {
      backgroundColor: 'rgba(59, 130, 246, 0.1)',
      borderRadius: 12,
      padding: 10,
      marginBottom: 8,
    },
    warnTextInfo: {
      fontSize: 12,
      lineHeight: 18,
      color: theme.colors.onSurfaceVariant,
    },
    hintText: {
      fontSize: 12,
      lineHeight: 18,
      color: theme.colors.onSurfaceVariant,
      marginTop: 4,
    },
    tip: {
      fontSize: 12,
      lineHeight: 18,
      color: theme.colors.onSurfaceVariant,
      marginTop: 6,
    },
    cardTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: theme.colors.onSurface,
      marginBottom: 6,
    },
    cardDesc: {
      fontSize: 13,
      lineHeight: 20,
      color: theme.colors.onSurfaceVariant,
      marginBottom: 10,
    },
    // ── 设备信息网格 ──
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
    },
    gridItem: {
      width: '48%',
      marginBottom: 14,
    },
    gridLabel: {
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
      marginTop: 4,
    },
    gridValue: {
      fontSize: 15,
      fontWeight: '700',
      color: theme.colors.onSurface,
      marginTop: 2,
    },
    gridFootnote: {
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
      marginTop: 2,
    },
    // ── 表单 ──
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
    flexInput: {
      flex: 1,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginRight: 10,
      backgroundColor: theme.colors.background,
    },
    btnRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 4,
      marginBottom: 6,
    },
    flexBtn: {
      flex: 1,
      borderRadius: 24,
      marginRight: 10,
    },
    actionBtn: {
      borderRadius: 24,
      marginBottom: 10,
    },
    hint: {
      fontSize: 12,
      lineHeight: 18,
      color: theme.colors.onSurfaceVariant,
      marginTop: 2,
    },
    chipWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginBottom: 8,
    },
    chip: {
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.outlineVariant,
      marginRight: 8,
      marginBottom: 8,
      backgroundColor: 'transparent',
    },
    chipActive: {
      backgroundColor:
        uiStore.themeStyle === 'liquid-glass'
          ? theme.dark
            ? 'rgba(59, 130, 246, 0.55)'
            : 'rgba(59, 130, 246, 0.62)'
          : theme.colors.secondaryContainer,
      borderColor: 'transparent',
    },
    chipText: {
      fontSize: 13,
      color: theme.colors.onSurfaceVariant,
    },
    chipTextActive: {
      color:
        uiStore.themeStyle === 'liquid-glass'
          ? '#FFFFFF'
          : theme.colors.onSurface,
      fontWeight: '700',
    },
    errorText: {
      fontSize: 13,
      lineHeight: 19,
      color: '#D32F2F',
      marginTop: 6,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.colors.outlineVariant,
      marginVertical: 12,
    },
    // ── 高级选项 ──
    advHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: cardRadius(),
      marginBottom: 10,
    },
    advTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: theme.colors.onSurface,
    },
    // ── 时间轴 ──
    timelineItem: {
      flexDirection: 'row',
      marginBottom: 12,
    },
    timelineDot: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 2,
      borderColor: theme.colors.outlineVariant,
      marginTop: 2,
      marginRight: 10,
    },
    timelineBody: {
      flex: 1,
    },
    timelineTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: theme.colors.onSurface,
    },
    timelineState: {
      fontSize: 12,
      fontWeight: '500',
      color: theme.colors.onSurfaceVariant,
    },
    timelineDesc: {
      fontSize: 12,
      lineHeight: 18,
      color: theme.colors.onSurfaceVariant,
      marginTop: 2,
    },
    // ── 日志 ──
    logBox: {
      backgroundColor: theme.dark
        ? 'rgba(255,255,255,0.05)'
        : 'rgba(0,0,0,0.04)',
      borderRadius: 12,
      padding: 10,
      maxHeight: 220,
    },
    logEmpty: {
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
    },
    logLine: {
      fontSize: 11,
      lineHeight: 17,
      color: theme.colors.onSurfaceVariant,
    },
    // ── WebView 层 ──
    webLayer: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 100,
      elevation: 100,
      backgroundColor: theme.colors.background,
    },
    webHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
      height: 48,
    },
    webTitle: {
      flex: 1,
      fontSize: 13,
      marginLeft: 4,
    },
    webView: {
      flex: 1,
    },
  });
