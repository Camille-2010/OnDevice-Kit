import React, {useContext, useEffect, useRef} from 'react';
import {Animated, Pressable, View} from 'react-native';
import {observer} from 'mobx-react';

import {useTheme} from '../../hooks';
import {chatSessionStore, ttsStore} from '../../store';
import {L10nContext} from '../../utils';
import {assistant, derivedText} from '../../utils/chat';
import type {MessageType} from '../../utils/types';
import {
  ChevronDownIcon,
  StopIcon,
  VolumeOnIcon,
  VolumeMinIcon,
} from '../../assets/icons';

import {createStyles} from './styles';
import {motionTiming} from '../../utils/disableMotion';

const EXPAND_DURATION_MS = 220;
// Collapsed width = speaker half only; expanded adds divider (1) + chevron (26).
const RIGHT_SIDE_WIDTH = 27;

const pickSpeakerIcon = (
  autoSpeakEnabled: boolean,
  isPlaying: boolean,
  canPlay: boolean,
) => {
  if (isPlaying) {
    return StopIcon;
  }
  return autoSpeakEnabled || canPlay ? VolumeOnIcon : VolumeMinIcon;
};

/**
 * Compact voice control. Collapses to a dimmed speaker icon when auto-speak
 * is OFF (quietly present, doesn't compete with send). Expands to a full
 * split-pill — speaker + divider + chevron — when active, playing, or when
 * setup is still needed. Hidden entirely when TTS is unavailable.
 */
export const VoiceChip: React.FC = observer(() => {
  const theme = useTheme();
  const l10n = useContext(L10nContext);
  const styles = createStyles(theme);

  const isAvailable = ttsStore.isTTSAvailable;
  const currentVoice = ttsStore.currentVoice;
  const autoSpeakEnabled = ttsStore.autoSpeakEnabled;
  const playbackState = ttsStore.playbackState;
  const isPlaying =
    playbackState.mode === 'playing' || playbackState.mode === 'streaming';

  const hasVoice = currentVoice != null;

  // 找到当前会话里「最新一条 AI 文本」—— 语音键点击时朗读它。
  // 放在 render 里直接读 observable，mobx 会自动追踪、消息更新时重渲染。
  const lastAssistant: MessageType.Text | MessageType.AssistantTurn | null =
    (() => {
      const sid = chatSessionStore.activeSessionId;
      const session = sid
        ? chatSessionStore.sessions.find(s => s.id === sid)
        : undefined;
      const msgs = session?.messages ?? [];
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i]!;
        if (
          (m.type === 'text' || m.type === 'assistant_turn') &&
          m.author?.id === assistant.id
        ) {
          return m;
        }
      }
      return null;
    })();
  const canPlay = hasVoice && lastAssistant != null;

  // Expand when the user needs the whole control: active, playing, there is
  // an AI message to read, or hasn't picked a voice yet (chevron is the only
  // way into setup).
  const shouldExpand = !hasVoice || autoSpeakEnabled || isPlaying || canPlay;

  const progress = useRef(new Animated.Value(shouldExpand ? 1 : 0)).current;

  useEffect(() => {
    motionTiming(progress, {
      toValue: shouldExpand ? 1 : 0,
      duration: EXPAND_DURATION_MS,
      useNativeDriver: false,
    }).start();
  }, [shouldExpand, progress]);

  if (!isAvailable) {
    return null;
  }

  const handleSpeakerPress = () => {
    if (!hasVoice) {
      ttsStore.openSetupSheet();
      return;
    }
    if (isPlaying) {
      ttsStore.stop().catch(() => {});
      return;
    }
    // 点击语音键：朗读当前会话里最新一条 AI 输出（正在输出就用当前内容）。
    if (lastAssistant) {
      const text = derivedText(lastAssistant);
      if (text.trim()) {
        const hadReasoning =
          lastAssistant.type === 'text'
            ? !!lastAssistant.metadata?.completionResult?.reasoning_content?.trim()
            : (lastAssistant.steps ?? []).some(s => s.reasoningContent?.trim());
        ttsStore
          .play(lastAssistant.id, text, {hadReasoning, fromChat: true})
          .catch(() => {});
        return;
      }
    }
    // 没有可朗读内容时，退回切换自动朗读。
    ttsStore.setAutoSpeak(!autoSpeakEnabled);
  };

  const handleSecondaryPress = () => {
    ttsStore.openSetupSheet();
  };

  const CurrentSpeakerIcon = pickSpeakerIcon(
    autoSpeakEnabled,
    isPlaying,
    canPlay,
  );
  const speakerIconColor = isPlaying
    ? theme.colors.primary
    : theme.colors.onSurfaceVariant;

  const containerAnimStyle = {
    backgroundColor: progress.interpolate({
      inputRange: [0, 1],
      outputRange: ['rgba(0,0,0,0)', theme.colors.surfaceVariant],
    }),
  };
  // Icon goes from 50% (dimmed / "off") to 100% (live) as the pill opens.
  const iconOpacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.5, 1],
  });
  const rightSideStyle = {
    width: progress.interpolate({
      inputRange: [0, 1],
      outputRange: [0, RIGHT_SIDE_WIDTH],
    }),
    opacity: progress,
  };

  return (
    <Animated.View
      style={[styles.pillContainer, containerAnimStyle]}
      testID="voicechip">
      <Pressable
        style={styles.pillSpeakerHalf}
        onPress={handleSpeakerPress}
        accessibilityRole="button"
        accessibilityLabel={
          isPlaying
            ? l10n.voiceAndSpeech.stopMessageLabel
            : hasVoice
              ? l10n.voiceAndSpeech.toggleAutoSpeakLabel
              : l10n.voiceAndSpeech.openSettingsLabel
        }
        accessibilityState={
          hasVoice && !isPlaying ? {selected: autoSpeakEnabled} : undefined
        }
        testID="voicechip-speaker">
        <Animated.View style={{opacity: iconOpacity}}>
          <CurrentSpeakerIcon
            width={18}
            height={18}
            stroke={speakerIconColor}
          />
        </Animated.View>
      </Pressable>
      <Animated.View style={[styles.pillRightSide, rightSideStyle]}>
        <View style={styles.pillDivider} />
        <Pressable
          style={styles.pillSecondaryHalf}
          onPress={handleSecondaryPress}
          accessibilityRole="button"
          accessibilityLabel={l10n.voiceAndSpeech.openSettingsLabel}
          testID="voicechip-secondary">
          <ChevronDownIcon
            width={14}
            height={14}
            stroke={theme.colors.onSurfaceVariant}
          />
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
});
