import React, {useEffect, useMemo, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {Icon} from 'react-native-paper';
import {GlassButton as Button} from '../../components/GlassButton';
import {observer} from 'mobx-react-lite';

import {useTheme} from '../../hooks';
import {Entrance} from '../../components/Entrance';
import {gsvOnnxStore} from '../../store/GsvOnnxStore';
import {uiStore} from '../../store';
import {cardRadius, glassButton} from '../../theme/cards';
import {Theme} from '../../utils/types';
import {GsvPageTopBar} from './GsvPageTopBar';
import {KeyboardAwareScrollView} from 'react-native-keyboard-controller';
import {SurfaceCard, GlassTextField} from '../../components/GlassSurface';

/**
 * GPT-SoVITS · 端侧 ONNX（本机推理）页。
 *
 * 模型分两部分：
 *  · 角色包（几百 KB，预计算特征 + 参考音频）随 APK 自带，默认角色阿罗娜；
 *  · ONNX 权重（约 1GB）从电脑局域网拉取，或 USB 拷贝到 Download 目录导入。
 * 权重就位后一切在手机本地完成，不联网。
 */

const fmtBytes = (n: number): string =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(0)} MB`;

export const GsvOnnxLocalScreen: React.FC<{onBack: () => void}> = observer(
  ({onBack}: {onBack: () => void}) => {
    const theme = useTheme();
    const styles = useMemo(() => createStyles(theme), [theme]);
    const store = gsvOnnxStore;
    const [url, setUrl] = useState(store.baseUrl);

    useEffect(() => {
      store.initialize();
    }, [store]);

    const glassBtn = glassButton(theme);
    const glassBtnFilled = glassButton(theme, 'filled');
    const isGlass = uiStore.themeStyle === 'liquid-glass';

    const readyCount = store.modelInfos.filter(i => i.exists).length;
    const totalExpected = store.modelInfos.length || 4;
    const verdictColor =
      store.rtf == null
        ? theme.colors.onSurfaceVariant
        : store.rtf.rtf < 1
          ? '#2E7D32'
          : store.rtf.rtf <= 3
            ? '#F9A825'
            : '#C62828';

    return (
      <View style={styles.root}>
        <KeyboardAwareScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag">
          <GsvPageTopBar title="端侧 ONNX（本机推理）" onBack={onBack} />
          <View style={styles.content}>
            <Entrance index={0} screenKey="gsv-onnx-local">
              <SurfaceCard style={styles.card}>
                <Text style={styles.title}>
                  GPT-SoVITS 端侧推理（experimental）
                </Text>
                <Text style={styles.desc}>
                  在手机上离线运行完整的 GPT-SoVITS v2：BERT 韵律 → GPT 语义解码
                  → SoVITS 声码。默认角色「阿罗娜」的角色包已内置； 权重约
                  1GB，只需导入/下载一次，之后完全离线。
                </Text>
                <Text style={styles.small}>
                  当前仅支持中文文本；英文与日文请使用云端引擎。
                </Text>
              </SurfaceCard>
            </Entrance>

            <Entrance index={1} screenKey="gsv-onnx-local">
              <SurfaceCard style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text style={styles.cardTitle}>
                    模型权重（{readyCount}/{totalExpected}）
                  </Text>
                  <Icon
                    source={
                      readyCount === totalExpected ? 'check-circle' : 'download'
                    }
                    size={20}
                    color={
                      readyCount === totalExpected
                        ? '#2E7D32'
                        : theme.colors.primary
                    }
                  />
                </View>
                {store.modelInfos.map(info => (
                  <View key={info.name} style={styles.fileRow}>
                    <Icon
                      source={
                        info.exists ? 'check' : 'checkbox-blank-circle-outline'
                      }
                      size={16}
                      color={
                        info.exists ? '#2E7D32' : theme.colors.onSurfaceVariant
                      }
                    />
                    <Text style={styles.fileName}>{info.name}</Text>
                    <Text style={styles.fileSize}>
                      {info.exists
                        ? fmtBytes(info.size)
                        : `未下载 · ${fmtBytes(info.expectedBytes)}`}
                    </Text>
                  </View>
                ))}
                {store.downloadActive ? (
                  <View style={styles.progressBox}>
                    <Text style={styles.small}>
                      正在下载 {store.downloadFile}…{' '}
                      {(store.downloadRatio * 100).toFixed(0)}%
                    </Text>
                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          {width: `${store.downloadRatio * 100}%`},
                        ]}
                      />
                    </View>
                    <Button
                      mode="text"
                      onPress={() => store.cancelDownload()}
                      labelStyle={styles.smallBtn}
                      compact>
                      取消
                    </Button>
                  </View>
                ) : (
                  <>
                    <GlassTextField
                      label="电脑服务地址（如 http://192.168.1.5:8000）"
                      value={url}
                      onChangeText={t => {
                        setUrl(t);
                        store.setBaseUrl(t);
                      }}
                      autoCapitalize="none"
                      keyboardType="url"
                      // 嵌在玻璃卡内：走磨砂路径 + 更高底色不透明度，
                      // 让输入框比卡片更实，壁纸不透过字缝干扰阅读。
                      forceFrosted
                      tintOpacity={0.8}
                    />
                    <View style={styles.btnRow}>
                      <Button
                        mode="outlined"
                        style={glassBtn}
                        onPress={() => store.downloadFromUrl()}
                        disabled={!url.trim()}>
                        从电脑下载
                      </Button>
                      <Button
                        mode="outlined"
                        style={glassBtn}
                        onPress={() => store.importFromDownloads()}>
                        从下载目录导入
                      </Button>
                    </View>
                  </>
                )}
                {readyCount === totalExpected ? (
                  <Button
                    mode="text"
                    onPress={() => store.removeModels()}
                    labelStyle={styles.smallBtn}
                    textColor="#C62828"
                    compact>
                    删除模型
                  </Button>
                ) : null}
                <Text style={styles.small}>
                  电脑端：在模型目录运行 `python -m http.server
                  8000`，手机连同一 Wi-Fi 后填入电脑 IP；或把 4 个 .onnx 文件用
                  USB 拷到手机 Download 目录点「导入」。
                </Text>
              </SurfaceCard>
            </Entrance>

            <Entrance index={2} screenKey="gsv-onnx-local">
              <SurfaceCard style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text style={styles.cardTitle}>
                    默认角色 · 阿罗娜（中配）
                  </Text>
                  <Icon source="star" size={20} color="#F9A825" />
                </View>
                <Text style={styles.desc}>
                  角色包随应用自带：参考音频、参考文本与预计算特征已就位，
                  无需任何配置。
                </Text>
                <View style={styles.rowBetween}>
                  <Text style={styles.small}>
                    {store.loaded
                      ? '引擎已就绪'
                      : store.loading
                        ? '引擎加载中…'
                        : store.assetsReady
                          ? '角色包就绪，加载引擎后可用'
                          : '准备角色包…'}
                  </Text>
                  <Text style={[styles.small, {color: verdictColor}]}>
                    {store.verdictText}
                  </Text>
                </View>
              </SurfaceCard>
            </Entrance>

            <Entrance index={3} screenKey="gsv-onnx-local">
              <SurfaceCard style={styles.card}>
                <Text style={styles.cardTitle}>合成</Text>
                <GlassTextField
                  label="要合成的中文文本"
                  value={store.lastText}
                  onChangeText={t => store.setLastText(t)}
                  multiline
                  // 同上：更磨砂、更实的输入框底色
                  forceFrosted
                  tintOpacity={0.8}
                />
                <View style={styles.btnRow}>
                  <Button
                    mode="contained"
                    style={[glassBtnFilled, isGlass && styles.glassFilled]}
                    onPress={() => store.synthesize()}
                    disabled={
                      store.synthesizing || store.loading || !store.assetsReady
                    }
                    loading={store.synthesizing}>
                    {store.synthesizing
                      ? `合成中 · ${store.progressTokens} tokens`
                      : '合成并播放'}
                  </Button>
                  {store.loaded ? (
                    <Button
                      mode="outlined"
                      style={glassBtn}
                      onPress={() => store.releasePipeline()}
                      disabled={store.synthesizing}>
                      释放内存
                    </Button>
                  ) : null}
                </View>
                {store.error ? (
                  <Text style={styles.error}>{store.error}</Text>
                ) : null}
              </SurfaceCard>
            </Entrance>

            {store.logs.length > 0 ? (
              <Entrance index={4} screenKey="gsv-onnx-local">
                <SurfaceCard style={styles.card}>
                  <Text style={styles.cardTitle}>日志</Text>
                  {store.logs.slice(0, 8).map((l, i) => (
                    <Text key={i} style={styles.logLine} numberOfLines={2}>
                      {l}
                    </Text>
                  ))}
                </SurfaceCard>
              </Entrance>
            ) : null}
          </View>
        </KeyboardAwareScrollView>
      </View>
    );
  },
);

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    // 透明根底：壁纸由 App 根层 ImageBackground 提供，页面必须透明，
    // 否则不透明底会挡住壁纸，SurfaceCard 的液态玻璃就没有可透出的背景。
    root: {flex: 1, backgroundColor: 'transparent'},
    scroll: {flex: 1},
    scrollContent: {paddingBottom: 32},
    content: {paddingHorizontal: 16, gap: 12, marginTop: 4},
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: cardRadius(),
      padding: 16,
      gap: 10,
    },
    title: {color: theme.colors.onSurface, fontSize: 16, fontWeight: '600'},
    cardTitle: {color: theme.colors.onSurface, fontSize: 15, fontWeight: '600'},
    desc: {color: theme.colors.onSurfaceVariant, fontSize: 13, lineHeight: 20},
    small: {color: theme.colors.onSurfaceVariant, fontSize: 12, lineHeight: 17},
    smallBtn: {fontSize: 12},
    rowBetween: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    fileRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 2,
    },
    fileName: {color: theme.colors.onSurface, fontSize: 13, flex: 1},
    fileSize: {color: theme.colors.onSurfaceVariant, fontSize: 12},
    btnRow: {flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginTop: 4},
    progressBox: {gap: 6, marginTop: 4},
    progressTrack: {
      height: 6,
      borderRadius: 3,
      backgroundColor: theme.colors.surfaceVariant,
      overflow: 'hidden',
    },
    progressFill: {height: 6, backgroundColor: theme.colors.primary},
    error: {color: '#C62828', fontSize: 12},
    logLine: {
      color: theme.colors.onSurfaceVariant,
      fontSize: 11,
      lineHeight: 16,
    },
    glassFilled: {},
  });
