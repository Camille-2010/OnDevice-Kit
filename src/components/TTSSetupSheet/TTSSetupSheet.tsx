import React, {useContext} from 'react';
import {View, StyleSheet, TouchableOpacity} from 'react-native';
import {Text} from 'react-native-paper';
import {observer} from 'mobx-react';

import {ttsStore, uiStore} from '../../store';
import {L10nContext} from '../../utils';
import {useTheme} from '../../hooks';
import {AnimatedSheet} from '../AnimatedSheet';
import {SheetGlass} from '../SheetGlass';
import {CloseIcon} from '../../assets/icons';

import {VoicePickerView} from './VoicePickerView';

/**
 * Voice-led TTS sheet — single view.
 *
 * Voices grouped by engine; each group surfaces its own install/manage
 * affordances inline. No separate Manage Engines route — it lives in
 * the group headers.
 *
 * 2026-10-23：gorhom 的 Sheet 底层是 RN Modal（独立窗口），原生玻璃
 * 采不到壁纸 → 弹窗内全部显白。改用 AnimatedSheet 的 inPage 模式
 * （页面内覆盖层，capture root 是页面 Screen），面板走 SheetGlass
 * 真玻璃，与「添加助手 / 图像生成」两个弹窗同一套机制。
 */
export const TTSSetupSheet: React.FC = observer(() => {
  const l10n = useContext(L10nContext);
  const theme = useTheme();
  const glassOn = uiStore.themeStyle === 'liquid-glass';

  const isVisible = ttsStore.isSetupSheetOpen;

  return (
    <AnimatedSheet
      visible={isVisible}
      onClose={() => ttsStore.closeSetupSheet()}
      inPage
      sheetStyle={[
        styles.sheet,
        {backgroundColor: theme.colors.background},
        // 玻璃模式：面板本体透明（玻璃由 SheetGlass 画）、内边距移交
        glassOn
          ? {
              backgroundColor: 'transparent',
              paddingHorizontal: 0,
              paddingBottom: 0,
            }
          : {},
      ]}>
      <SheetGlass
        // tint / tintOpacity 用 SheetGlass 默认值（dialogGlassTint + 0.55）：
        // 磨砂质感要靠「真实模糊层透出来」，tint 拉太实就成死灰板。
        // 小米(Android 13+)走原生 LiquidGlassView，磨砂/模糊由 glassType
        // ='regular'（SheetGlass 内部固定）负责；下面 blur 三件套仅对
        // Android <13 的磨砂路径生效（荣耀测试机），两者互补。
        blur
        blurAmount={60}
        blurRounds={8}>
        <View style={styles.header}>
          <Text
            variant="titleMedium"
            style={[styles.title, {color: theme.colors.onSurface}]}>
            {l10n.voiceAndSpeech.voicesTitle}
          </Text>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={() => ttsStore.closeSetupSheet()}
            hitSlop={10}
            testID="sheet-close-button"
            accessibilityLabel="Close">
            <CloseIcon stroke={theme.colors.primary} />
          </TouchableOpacity>
        </View>
        <VoicePickerView />
      </SheetGlass>
    </AnimatedSheet>
  );
});

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    // 弹窗整体上移（与图像生成页两个弹窗一致）
    bottom: '5%',
    maxHeight: '75%',
    paddingTop: 14,
    paddingBottom: 20,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 4,
  },
});
