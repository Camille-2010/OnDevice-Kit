import React, {useEffect, useMemo, useState} from 'react';
import {BackHandler, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Icon} from 'react-native-paper';
import {observer} from 'mobx-react-lite';

import {useTheme} from '../../hooks';
import {Entrance} from '../../components/Entrance';
import {cardBg, cardRadius} from '../../theme/cards';
import {Theme} from '../../utils/types';
import {GptSovitsPyTorchScreen} from './GptSovitsPyTorchScreen';
import {GptSovitsOnnxScreen} from './GptSovitsOnnxScreen';
import {GsvOnnxLocalScreen} from './GsvOnnxLocalScreen';
import {SurfaceCard} from '../../components/GlassSurface';

type Page = 'menu' | 'pytorch' | 'onnx' | 'onnxLocal';

/**
 * GPT-SoVITS · 引擎选择页（更多页入口）。
 *
 * 两个入口：
 *  · 原生 PyTorch —— 本地引擎与云端 api_v2 都能真跑，带设备性能预判。
 *  · Mini ONNX —— 轻量 ONNX 推理，本地/云端可切换。
 *
 * 【返回层级】
 *   App.tsx 的硬件返回只看得到 moreSub（'gptsovits'），看不到本页内部的
 *   子页层级。所以这里自己注册 BackHandler：在子页按返回先退回引擎选择页，
 *   由引擎选择页再交回 App 处理（→ 更多列表）。否则在子页按返回会直接跳出
 *   整个 GPT-SoVITS。
 */
export const GptSovitsScreen: React.FC<{header?: React.ReactNode}> = observer(
  ({header}: {header?: React.ReactNode}) => {
    const theme = useTheme();
    const styles = useMemo(() => createStyles(theme), [theme]);
    const [page, setPage] = useState<Page>('menu');

    // 只在子页拦截；menu 页返回 false，交给 App 的 backFromMoreSub 处理
    useEffect(() => {
      if (page === 'menu') {
        return;
      }
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        setPage('menu');
        return true;
      });
      return () => sub.remove();
    }, [page]);

    if (page === 'pytorch') {
      return <GptSovitsPyTorchScreen onBack={() => setPage('menu')} />;
    }
    if (page === 'onnx') {
      return <GptSovitsOnnxScreen onBack={() => setPage('menu')} />;
    }
    if (page === 'onnxLocal') {
      return <GsvOnnxLocalScreen onBack={() => setPage('menu')} />;
    }

    const engines: {
      key: Page;
      icon: string;
      title: string;
      desc: string;
      onPress: () => void;
    }[] = [
      {
        key: 'onnxLocal',
        icon: 'phone',
        title: '端侧 ONNX（本机推理）',
        desc: '手机离线运行完整 GPT-SoVITS，默认角色阿罗娜，需一次性导入约 1GB 模型',
        onPress: () => setPage('onnxLocal'),
      },
      {
        key: 'pytorch',
        icon: 'memory',
        title: '原生 PyTorch',
        desc: '连 GPT-SoVITS 服务端：WebUI + api_v2，功能最全',
        onPress: () => setPage('pytorch'),
      },
      {
        key: 'onnx',
        icon: 'flash',
        title: 'Mini ONNX',
        desc: '本机引擎发声 + 云端 GPT-SoVITS，附性能预判',
        onPress: () => setPage('onnx'),
      },
    ];

    return (
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled">
        {header}
        <View style={styles.content}>
          <SurfaceCard style={styles.descPill}>
            <Text style={styles.desc}>
              选择推理引擎。原生 PyTorch 功能完整但更重；Mini ONNX 基于
              GPT-SoVITS_minimal_inference，可在手机上把权重转为 ONNX
              后再加速推理。
            </Text>
          </SurfaceCard>
          {engines.map((item, idx) => (
            <Entrance key={item.key} index={idx} screenKey="gptsovits">
              <SurfaceCard
                style={styles.card}
                onPress={item.onPress}
                accessibilityRole="button">
                <View style={styles.titleRow}>
                  <Icon
                    source={item.icon}
                    size={26}
                    color={theme.colors.primary}
                  />
                  <Text style={styles.cardTitle}>{item.title}</Text>
                </View>
                <View style={styles.descRow}>
                  <Text style={styles.cardDesc} numberOfLines={2}>
                    {item.desc}
                  </Text>
                  <Icon
                    source="chevron-right"
                    size={20}
                    color={theme.colors.onSurfaceVariant}
                  />
                </View>
              </SurfaceCard>
            </Entrance>
          ))}
        </View>
      </ScrollView>
    );
  },
);

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    scroll: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    scrollContent: {
      paddingBottom: 24,
    },
    content: {
      padding: 16,
      paddingTop: 4,
      paddingBottom: 126,
    },
    desc: {
      fontSize: 14,
      lineHeight: 21,
      color: theme.colors.onSurfaceVariant,
    },
    descPill: {
      padding: 14,
      borderRadius: cardRadius(),
      marginBottom: 16,
    },
    // 一行一张卡：第一行 图标+标题，第二行 小字+右箭头；整体压扁
    card: {
      backgroundColor: cardBg(theme),
      borderRadius: cardRadius(),
      paddingHorizontal: 16,
      paddingVertical: 12,
      marginBottom: 10,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    cardTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: theme.colors.onSurface,
    },
    descRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 4,
      // 与标题左对齐：跳过图标 26 + 间距 10
      paddingLeft: 36,
    },
    cardDesc: {
      flex: 1,
      fontSize: 13,
      color: theme.colors.onSurfaceVariant,
      lineHeight: 18,
    },
  });
