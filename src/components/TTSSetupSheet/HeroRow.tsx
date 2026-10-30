import React, {useContext, useMemo, useState} from 'react';
import {View} from 'react-native';
import {IconButton, SegmentedButtons, Text} from 'react-native-paper';
import {observer} from 'mobx-react';

import type {SupertonicLanguageOption} from '../../store/TTSStore';

import {ChevronDownIcon} from '../../assets/icons';
import {Pressable} from '../ui/primitives/Pressable';
import {SearchableSelectSheet} from '../SearchableSelectSheet';
import {useTheme} from '../../hooks';
import {t} from '../../locales';
import type {EngineId, SupertonicSteps} from '../../services/tts';
import {ttsStore} from '../../store';
import {L10nContext} from '../../utils';

import {createStyles} from './styles';
import {VoiceAvatar, getEngineAccent, getEngineTint} from './VoiceAvatar';
import {ENGINE_LANGS_KEY} from './engineMeta';
import {SurfaceCard} from '../GlassSurface';

const engineChipKey = {
  kitten: 'engineChipKitten',
  kokoro: 'engineChipKokoro',
  supertonic: 'engineChipSupertonic',
  system: 'engineChipSystem',
} as const satisfies Record<EngineId, string>;

// `showSelectedCheck=false` + per-button `minWidth:0` lets the row shrink
// to fit small screens. Without these RNP forces ~60pt per button, which
// overflows on iPhone SE width with 6 cells.
const STEPS_BUTTONS = [1, 2, 3, 5, 10, 20].map(v => ({
  value: String(v),
  label: String(v),
  style: {minWidth: 0},
  labelStyle: {marginHorizontal: 0, marginVertical: 4},
}));

/**
 * Compact "current voice" strip used as the header of the unified Voices
 * sheet. Renders nothing when no voice is set — the voices list itself is
 * the answer in that state. When the current voice is Supertonic, the
 * strip embeds an inline quality (steps) selector since quality is a
 * property of that voice.
 */
export const HeroRow: React.FC = observer(() => {
  const theme = useTheme();
  const l10n = useContext(L10nContext);
  const styles = createStyles(theme);
  const [languageSheetOpen, setLanguageSheetOpen] = useState(false);

  // 顺序：自动(na) → 31 种语言（按显示名排序）。
  //
  // 2026-10-20 移除过「中文」这一项：Supertonic 的 31 个语言码里没有 zh，
  // 虽然字符索引器覆盖 CJK，实测中文出来是杂音。中文请用 Kokoro 的中文音色
  // （内置汉字→音素，见 services/tts/chineseG2P.ts）。
  // 不在联合里的旧持久值不显示，触发器回落到「自动」，不重写用户数据。
  const languageOptions = useMemo<
    Array<{value: SupertonicLanguageOption; label: string}>
  >(() => {
    const names = l10n.voiceAndSpeech.supertonicLanguageNames;
    const languages: Array<{value: SupertonicLanguageOption; label: string}> = (
      Object.keys(names) as Array<keyof typeof names>
    )
      .map(code => ({value: code, label: names[code]}))
      .sort((a, b) => a.label.localeCompare(b.label));
    return [
      {
        value: 'na',
        label: l10n.voiceAndSpeech.supertonicLanguageAuto,
      },
      ...languages,
    ];
  }, [l10n]);

  const current = ttsStore.currentVoice;
  if (!current) {
    return null;
  }

  const accent = getEngineAccent(current.engine);
  const tint = getEngineTint(current.engine, 0.1);
  const border = getEngineTint(current.engine, 0.18);

  const isPreviewing = ttsStore.isPreviewingVoice(current);

  const handlePreviewToggle = () => {
    if (isPreviewing) {
      ttsStore.stop().catch(err => {
        console.warn('[HeroRow] stop failed:', err);
      });
    } else {
      ttsStore.preview(current).catch(err => {
        console.warn('[HeroRow] preview failed:', err);
      });
    }
  };

  const showSupertonicQuality =
    current.engine === 'supertonic' &&
    ttsStore.supertonicDownloadState === 'ready';

  const selectedLanguage = languageOptions.find(
    o => o.value === ttsStore.supertonicLanguage,
  );
  const languageTriggerLabel =
    selectedLanguage?.label ?? l10n.voiceAndSpeech.supertonicLanguageAuto;

  const subtitleParts = [
    l10n.voiceAndSpeech[ENGINE_LANGS_KEY[current.engine]],
    l10n.voiceAndSpeech[engineChipKey[current.engine]],
    showSupertonicQuality
      ? t(l10n.voiceAndSpeech.stepsCount, {steps: ttsStore.supertonicSteps})
      : null,
  ].filter(Boolean);

  return (
    <SurfaceCard
      style={[styles.heroRow, {backgroundColor: tint, borderColor: border}]}
      testID="tts-hero-row">
      <View style={styles.heroRowBody}>
        <View style={styles.heroAvatarWrap}>
          <VoiceAvatar voice={current} size={48} />
        </View>
        <View style={styles.heroRowMain}>
          <Text style={styles.heroRowName} testID="tts-hero-voice-name">
            {current.name}
          </Text>
          <Text style={styles.heroSubtitle}>{subtitleParts.join('  ·  ')}</Text>
        </View>
        <IconButton
          icon={isPreviewing ? 'stop' : 'play'}
          size={20}
          iconColor={accent}
          containerColor={theme.colors.surface}
          onPress={handlePreviewToggle}
          accessibilityLabel={
            isPreviewing
              ? l10n.voiceAndSpeech.stopPreviewButton
              : l10n.voiceAndSpeech.previewButton
          }
          testID="tts-hero-preview-button"
          style={styles.heroPreviewButton}
        />
      </View>
      {showSupertonicQuality ? (
        <View style={styles.heroQualityBlock}>
          <Text style={styles.heroQualityLabel}>
            {l10n.voiceAndSpeech.supertonicStepsLabel}
          </Text>
          <SegmentedButtons
            density="high"
            value={String(ttsStore.supertonicSteps)}
            onValueChange={value =>
              ttsStore.setSupertonicSteps(Number(value) as SupertonicSteps)
            }
            // Tint the selected pill with the engine accent so the control
            // matches the Supertonic brand instead of RNP's default
            // secondaryContainer color.
            theme={{
              colors: {
                secondaryContainer: accent,
                onSecondaryContainer: '#FFFFFF',
              },
            }}
            buttons={STEPS_BUTTONS.map(b => ({
              ...b,
              showSelectedCheck: false,
            }))}
          />
          <View style={styles.heroLanguageWrap}>
            <Text style={styles.heroQualityLabel}>
              {l10n.voiceAndSpeech.supertonicLanguageLabel}
            </Text>
            <Pressable
              testID="tts-hero-language-picker"
              accessibilityRole="button"
              accessibilityLabel={l10n.voiceAndSpeech.supertonicLanguageLabel}
              onPress={() => setLanguageSheetOpen(true)}
              style={styles.heroLanguageTrigger}>
              <Text style={styles.heroLanguageTriggerLabel} numberOfLines={1}>
                {languageTriggerLabel}
              </Text>
              <ChevronDownIcon
                width={18}
                height={18}
                stroke={theme.colors.onSurface}
              />
            </Pressable>
          </View>
        </View>
      ) : null}
      {showSupertonicQuality ? (
        <SearchableSelectSheet
          testID="tts-language-sheet"
          searchTestID="tts-language-search"
          optionTestIDPrefix="tts-language-option"
          isVisible={languageSheetOpen}
          onClose={() => setLanguageSheetOpen(false)}
          title={l10n.voiceAndSpeech.supertonicLanguageSheetTitle}
          searchPlaceholder={
            l10n.voiceAndSpeech.supertonicLanguageSearchPlaceholder
          }
          options={languageOptions}
          value={ttsStore.supertonicLanguage}
          onSelect={value =>
            ttsStore.setSupertonicLanguage(value as SupertonicLanguageOption)
          }
        />
      ) : null}
    </SurfaceCard>
  );
});
