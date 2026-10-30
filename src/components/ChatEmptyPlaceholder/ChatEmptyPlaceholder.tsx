import React, {useContext} from 'react';
import {TouchableOpacity, View} from 'react-native';
import {Text} from 'react-native-paper';
import {AppIcon} from '../AppIcon';
import {observer} from 'mobx-react';

import {useTheme} from '../../hooks';
import {createStyles} from './styles';
import {modelStore, palStore, chatSessionStore, uiStore} from '../../store';
import {useNavigation} from '@react-navigation/native';
import {NavigationProp} from '@react-navigation/native';
import {L10nContext} from '../../utils';
import {SurfaceCard} from '../GlassSurface';
import {PillLabel} from '../PillLabel';

interface ChatEmptyPlaceholderProps {
  onSelectModel: () => void;
  bottomComponentHeight: number;
}

export const ChatEmptyPlaceholder = observer(
  ({onSelectModel, bottomComponentHeight}: ChatEmptyPlaceholderProps) => {
    const theme = useTheme();
    const navigation = useNavigation<NavigationProp<any>>();
    const l10n = useContext(L10nContext);
    const styles = createStyles({theme});

    const hasAvailableModels = modelStore.availableModels.length > 0;
    const hasActiveModel = modelStore.activeModelId !== undefined;
    // When the user lands here from onboarding-finish, the pal exists
    // and its defaultModel is downloading. The DownloadOverlay banner is
    // already showing progress at the top of the screen — the empty
    // state's job is just to telegraph "your pal is on the way, no
    // model picker needed."
    const pendingPalDownload = modelStore.activeDownloads
      .map(d =>
        palStore.pals.find(
          p =>
            p.source === 'local' &&
            p.defaultModel &&
            p.defaultModel.id === d.modelId,
        ),
      )
      .find(p => p !== undefined);

    const getContent = () => {
      if (pendingPalDownload) {
        return {
          title:
            l10n.components.chatEmptyPlaceholder.gettingReadyTitle?.replace(
              '{{name}}',
              pendingPalDownload.name,
            ) ?? `${pendingPalDownload.name} is getting ready`,
          description:
            l10n.components.chatEmptyPlaceholder.gettingReadyDescription ??
            'We’ll let you know the moment your pal can chat. Tap the banner up top to see how it’s going.',
          buttonText: null,
          onPress: () => {},
        };
      }

      if (!hasAvailableModels) {
        return {
          title: l10n.components.chatEmptyPlaceholder.noModelsTitle,
          description: l10n.components.chatEmptyPlaceholder.noModelsDescription,
          buttonText: l10n.components.chatEmptyPlaceholder.noModelsButton,
          onPress: () => {
            navigation.navigate('Models');
          },
        };
      }

      return {
        title: l10n.components.chatEmptyPlaceholder.activateModelTitle,
        description:
          l10n.components.chatEmptyPlaceholder.activateModelDescription,
        buttonText: l10n.components.chatEmptyPlaceholder.activateModelButton,
        onPress: onSelectModel,
      };
    };

    const {title, description} = getContent();

    // 主按钮：按草图做成"开始新对话"；无模型时仍引导去选模型
    const primaryLabel = !hasAvailableModels
      ? (l10n.components.chatEmptyPlaceholder.noModelsButton ?? '选择模型')
      : '开始新对话';
    const primaryAction = !hasAvailableModels
      ? () => navigation.navigate('Models')
      : () => chatSessionStore.resetActiveSession();

    // 液态玻璃模式：玻璃壳自带底色，壳内文字/图标换深色（onSurface），
    // 否则反白字压在浅玻璃上看不清。
    const glassOn = uiStore.themeStyle === 'liquid-glass';

    if (hasActiveModel) {
      return <View />;
    }
    return (
      <View
        style={[styles.container, {marginBottom: bottomComponentHeight + 60}]}>
        {/* 玻璃圆角方块 + 立方体图标 */}
        <SurfaceCard style={styles.iconBox} backdrop="wallpaper" radius={18}>
          <AppIcon
            name="models"
            size={30}
            color={glassOn ? theme.colors.onSurface : theme.colors.onPrimary}
            strokeWidth={2}
          />
        </SurfaceCard>

        <Text style={styles.title}>{title}</Text>
        {/* 未加载模型时的说明小字：扁平液态玻璃胶囊（浮在壁纸上的小字底衬） */}
        <PillLabel style={styles.descPill} radius={14}>
          <Text style={styles.description}>{description}</Text>
        </PillLabel>

        {/* 主按钮：玻璃胶囊（无模型 → 下载模型；有模型未激活 → 加载模型） */}
        <SurfaceCard style={styles.primaryBtn} backdrop="wallpaper" radius={25}>
          <TouchableOpacity
            style={styles.primaryBtnHit}
            onPress={primaryAction}>
            <AppIcon
              name={!hasAvailableModels ? 'download' : 'models'}
              size={19}
              color={glassOn ? theme.colors.onSurface : theme.colors.onPrimary}
              strokeWidth={2.2}
            />
            <Text
              style={[
                styles.primaryBtnText,
                glassOn && {color: theme.colors.onSurface},
              ]}>
              {modelStore.isContextLoading ? '加载中…' : primaryLabel}
            </Text>
          </TouchableOpacity>
        </SurfaceCard>
      </View>
    );
  },
);
