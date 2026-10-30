import React, {useContext} from 'react';

import {observer} from 'mobx-react';
import {Portal, Dialog, Text, Paragraph} from 'react-native-paper';
import {GlassButton as Button} from '../GlassButton';
import {StyleSheet, View} from 'react-native';

import {styles} from './styles';

import {L10nContext} from '../../utils';
import {uiStore} from '../../store';
import {SurfaceCard} from '../GlassSurface';
import {dialogGlassTint} from '../../theme/cards';
import {useTheme} from '../../hooks';

// 液态玻璃：与 components/Dialog 同一套弹窗底色——实底让位，
// 垫一层绝对定位的磨砂玻璃（Portal 覆盖层采不到壁纸，必须 forceFrosted）。
const glassStyles = StyleSheet.create({
  dialogGlass: {
    backgroundColor: 'transparent',
    borderRadius: 24,
    overflow: 'hidden',
  },
  glassFill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 24,
  },
});

type ModelsResetDialogProps = {
  testID?: string;
  visible: boolean;
  onDismiss: () => void;
  onReset: () => void;
};

export const ModelsResetDialog: React.FC<ModelsResetDialogProps> = observer(
  ({testID, visible, onDismiss, onReset}) => {
    const l10n = useContext(L10nContext);
    const theme = useTheme();
    const glassOn = uiStore?.themeStyle === 'liquid-glass';
    return (
      <Portal>
        <Dialog
          testID={testID}
          visible={visible}
          onDismiss={onDismiss}
          style={glassOn && glassStyles.dialogGlass}>
          {glassOn ? (
            <View pointerEvents="none" style={glassStyles.glassFill}>
              <SurfaceCard
                style={StyleSheet.absoluteFill}
                tint={dialogGlassTint(theme)}
                tintOpacity={0.34}
                blur
                blurAmount={50}
                blurRounds={6}
                forceFrosted
              />
            </View>
          ) : null}
          <Dialog.Title>
            {l10n.components.modelsResetDialog.confirmReset}
          </Dialog.Title>
          <Dialog.Content>
            <Paragraph style={styles.paragraph}>
              This will reset model settings (
              <Text variant="labelMedium">
                'system prompt', 'chat template', 'temperature',
              </Text>
              etc.) to their default configuration.
            </Paragraph>

            <Paragraph style={styles.paragraph}>
              - Your downloaded models will <Text style={styles.bold}>not</Text>{' '}
              be removed.
            </Paragraph>

            <Paragraph style={styles.paragraph}>
              - Your 'Local Models' will remain intact.
            </Paragraph>

            {/*<Paragraph style={styles.paragraph}>
            - This action is <Text style={styles.bold}>irreversible.</Text>
          </Paragraph>*/}
          </Dialog.Content>
          <Dialog.Actions>
            <Button testID="cancel-reset-button" onPress={onDismiss}>
              {l10n.common.cancel}
            </Button>
            <Button testID="proceed-reset-button" onPress={onReset}>
              {l10n.components.modelsResetDialog.proceedWithReset}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    );
  },
);
