import React, {useContext, useEffect, useRef, useState} from 'react';
import {Animated, Pressable, Text, View} from 'react-native';
import {observer} from 'mobx-react';
import {useNavigation, NavigationProp} from '@react-navigation/native';

import {XIcon} from '../../assets/icons';
import {useTheme} from '../../hooks';
import {modelStore, palStore, uiStore} from '../../store';
import {L10nContext} from '../../utils';
import {ROUTES} from '../../utils/navigationConstants';
import {DURATION} from '../../theme/motion';
import {motionTiming} from '../../utils/disableMotion';
import {bannerStyles as createStyles} from './styles';

const formatSize = (bytes: number): string => {
  if (!bytes || bytes <= 0) {
    return '';
  }
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) {
    return `${gb.toFixed(1)} GB`;
  }
  return `${Math.round(bytes / (1024 * 1024))} MB`;
};

// Users think "Pip is downloading", not the filename.
const ownerOf = (modelId: string, modelName: string) => {
  const pal = palStore.pals.find(
    p =>
      p.source === 'local' && p.defaultModel && p.defaultModel.id === modelId,
  );
  return {pal, subject: pal ? pal.name : modelName};
};

/**
 * Sticky single-row banner showing the first non-dismissed active download.
 *
 * Affordances:
 *   - Body tap → Models screen (the home for multi-download management;
 *     the +N badge telegraphs that there are more behind the visible one).
 *   - Stop pill → cancels the visible download. Pal stays bound to the
 *     model so the user can resume from the Models screen.
 *   - × icon  → dismisses the banner for this download only. Download
 *     continues. Dismissal clears when the download disappears.
 *   - Failed → Retry replaces Stop; × clears the error.
 */
export const DownloadBanner: React.FC = observer(() => {
  const theme = useTheme();
  const styles = createStyles(theme);
  const navigation = useNavigation<NavigationProp<any>>();
  const l10n = useContext(L10nContext);

  const failedId = modelStore.downloadError?.metadata?.modelId;
  const failedModel =
    failedId && !modelStore.isDownloading(failedId)
      ? modelStore.models.find(m => m.id === failedId)
      : undefined;
  const visible = modelStore.activeDownloads.find(
    d => !uiStore.isDownloadBannerDismissed(d.modelId),
  );
  const hasContent = !!failedModel || !!visible;

  // 进场动画：横幅出现时淡入 + 从上方轻轻滑入（原来是条件渲染硬弹出）。
  // 只动 opacity / translateY，元素照常在树上、动画期间也能点。
  // 消失保持瞬时：内容来自实时 store，退出快照会把进度条冻住，不值得。
  // ⚠️ hooks 必须在任何条件 return 之前调用。
  const [entered, setEntered] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;
  const bannerAnim = {
    opacity: anim,
    transform: [
      {
        translateY: anim.interpolate({
          inputRange: [0, 1],
          outputRange: [-12, 0],
        }),
      },
    ],
  };

  useEffect(() => {
    if (!hasContent) {
      // 收起后复位：下次出现重新播入场
      if (entered) {
        setEntered(false);
      }
      return;
    }
    if (entered) {
      // 已经播过（失败行 ↔ 进度行原地切换）：不再重播
      return;
    }
    setEntered(true);
    anim.setValue(0);
    motionTiming(anim, {
      toValue: 1,
      duration: DURATION.fast,
      useNativeDriver: true,
    }).start();
  }, [hasContent, entered, anim]);

  if (!hasContent) {
    return null;
  }
  if (failedModel) {
    const failedTitle = l10n.downloadBanner.failedTitle;
    const {pal: failedPal, subject: failedSubject} = ownerOf(
      failedModel.id,
      failedModel.name,
    );
    const activeCount = modelStore.activeDownloads.length;
    const failedLabel = [
      failedTitle,
      failedSubject,
      ...(activeCount > 0
        ? [
            l10n.downloadBanner.extraInProgress.replace(
              '{{count}}',
              String(activeCount),
            ),
          ]
        : []),
    ].join(', ');
    return (
      <View testID="download-banner-failed" style={[styles.root, bannerAnim]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={failedLabel}
          onPress={() => navigation.navigate(ROUTES.MODELS as never)}
          style={styles.body}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[
              styles.avatar,
              failedPal?.color?.[0]
                ? {backgroundColor: failedPal.color[0]}
                : null,
            ]}
          />
          <View style={styles.content}>
            <Text style={[styles.title, styles.failedTitle]} numberOfLines={1}>
              {failedTitle}
            </Text>
            <View
              testID="download-banner-failed-detail"
              style={styles.titleRow}>
              <Text
                style={[styles.eta, styles.failedSubject]}
                numberOfLines={1}
                ellipsizeMode="tail">
                {failedSubject}
              </Text>
              {activeCount > 0 ? (
                <View testID="download-banner-extra-badge" style={styles.badge}>
                  <Text style={styles.badgeText}>{`+${activeCount}`}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </Pressable>
        <Pressable
          testID="download-banner-retry"
          accessibilityRole="button"
          accessibilityLabel={l10n.downloadBanner.retry}
          onPress={() => modelStore.retryDownload()}
          style={styles.stop}
          hitSlop={8}>
          <Text style={styles.stopText}>{l10n.downloadBanner.retry}</Text>
        </Pressable>
        <Pressable
          testID="download-banner-dismiss"
          accessibilityRole="button"
          accessibilityLabel={l10n.common.dismiss}
          onPress={() => modelStore.clearDownloadError()}
          style={styles.dismiss}
          hitSlop={8}>
          <XIcon
            width={14}
            height={14}
            stroke={theme.colors.onSurfaceVariant}
          />
        </Pressable>
      </View>
    );
  }

  if (!visible) {
    return null;
  }

  const {pal, subject} = ownerOf(visible.modelId, visible.model.name);
  const title = (
    pal ? l10n.downloadBanner.titleByPal : l10n.downloadBanner.titleByModel
  ).replace('{{name}}', subject);
  const eta = visible.etaLabel || formatSize(visible.bytesTotal);
  const clamped = Math.max(0, Math.min(100, visible.progress));
  const extraCount = Math.max(0, modelStore.activeDownloads.length - 1);
  const extraLabel = l10n.downloadBanner.extraInProgress.replace(
    '{{count}}',
    String(extraCount),
  );

  return (
    <View style={[styles.root, bannerAnim]}>
      <Pressable
        testID="download-banner"
        accessibilityRole="button"
        accessibilityLabel={
          extraCount > 0
            ? `${title}, ${eta}, ${extraLabel}`
            : `${title}, ${eta}`
        }
        onPress={() => navigation.navigate(ROUTES.MODELS as never)}
        style={styles.body}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.avatar,
            pal?.color?.[0] ? {backgroundColor: pal.color[0]} : null,
          ]}
        />
        <View style={styles.content}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">
              {title}
            </Text>
            {extraCount > 0 ? (
              <View testID="download-banner-extra-badge" style={styles.badge}>
                <Text style={styles.badgeText}>{`+${extraCount}`}</Text>
              </View>
            ) : null}
            {eta ? <Text style={styles.eta}>{eta}</Text> : null}
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, {width: `${clamped}%`}]} />
          </View>
        </View>
      </Pressable>
      <Pressable
        testID="download-banner-stop"
        accessibilityRole="button"
        accessibilityLabel={l10n.common.stop}
        onPress={() => modelStore.cancelDownload(visible.modelId)}
        style={styles.stop}
        hitSlop={8}>
        <Text style={styles.stopText}>{l10n.common.stop}</Text>
      </Pressable>
      <Pressable
        testID="download-banner-dismiss"
        accessibilityRole="button"
        accessibilityLabel={l10n.common.dismiss}
        onPress={() => uiStore.dismissDownloadBanner(visible.modelId)}
        style={styles.dismiss}
        hitSlop={8}>
        <XIcon width={14} height={14} stroke={theme.colors.onSurfaceVariant} />
      </Pressable>
    </View>
  );
});
