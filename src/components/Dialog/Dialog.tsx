import React, {ReactNode} from 'react';
import {
  ViewStyle,
  Keyboard,
  StyleSheet,
  TouchableWithoutFeedback,
  View,
} from 'react-native';

import {ScrollView} from 'react-native-gesture-handler';
import {Portal, Dialog as PaperDialog} from 'react-native-paper';
import {GlassButton as Button} from '../GlassButton';
import {KeyboardAwareScrollView} from 'react-native-keyboard-controller';

import {useTheme} from '../../hooks';
import {uiStore} from '../../store';
import {SurfaceCard} from '../GlassSurface';
import {dialogGlassTint} from '../../theme/cards';

import {createStyles} from './styles';

export interface DialogAction {
  label: string;
  onPress: () => void;
  mode?: 'text' | 'contained' | 'outlined';
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
}

interface CustomDialogProps {
  testID?: string;
  visible: boolean;
  onDismiss: () => void;
  title: string;
  children: ReactNode;
  actions?: DialogAction[];
  style?: ViewStyle;
  contentStyle?: ViewStyle;
  scrollAreaStyle?: ViewStyle;
  scrollable?: boolean;
  scrollableBorderShown?: boolean;
  dismissableBackButton?: boolean;
  dismissable?: boolean;
  avoidKeyboard?: boolean;
}

export const Dialog: React.FC<CustomDialogProps> = ({
  testID,
  visible,
  onDismiss,
  title,
  children,
  actions = [],
  style,
  contentStyle,
  scrollAreaStyle,
  scrollable = false,
  scrollableBorderShown = false,
  dismissableBackButton = true,
  dismissable = true,
  avoidKeyboard = false,
}) => {
  const theme = useTheme();
  const styles = createStyles(theme, scrollableBorderShown);
  // 液态玻璃：PaperDialog 的实底与内容底色都让位，垫一层绝对定位的
  // 磨砂 SurfaceCard（与 Sheet/ImportMethodDialog 同一套弹窗底色）。
  // Portal 覆盖层采不到壁纸，必须 forceFrosted + blur，任何 ROM 都稳定。
  const glassOn = uiStore?.themeStyle === 'liquid-glass';
  const glassContentStyle = glassOn
    ? [{backgroundColor: 'transparent'}]
    : undefined;

  const content = scrollable ? (
    <PaperDialog.ScrollArea
      style={[styles.dialogContent, contentStyle, glassContentStyle]}>
      {avoidKeyboard ? (
        <KeyboardAwareScrollView
          bottomOffset={10}
          style={[scrollAreaStyle]}
          //keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          //bounces={false}
        >
          {children}
        </KeyboardAwareScrollView>
      ) : (
        <ScrollView
          style={scrollAreaStyle}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          //bounces={false}
        >
          {children}
        </ScrollView>
      )}
    </PaperDialog.ScrollArea>
  ) : (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <PaperDialog.Content
        style={[styles.dialogContent, contentStyle, glassContentStyle]}>
        {avoidKeyboard ? (
          <KeyboardAwareScrollView>{children}</KeyboardAwareScrollView>
        ) : (
          children
        )}
      </PaperDialog.Content>
    </TouchableWithoutFeedback>
  );

  return (
    <Portal>
      <PaperDialog
        testID={testID}
        dismissableBackButton={dismissableBackButton}
        dismissable={dismissable}
        visible={visible}
        onDismiss={onDismiss}
        style={[styles.dialog, glassOn && styles.dialogGlass, style]}>
        {glassOn ? (
          <View pointerEvents="none" style={styles.glassFill}>
            <SurfaceCard
              style={StyleSheet.absoluteFill}
              tint={dialogGlassTint(theme)}
              // 0.34：与 SheetGlass 保持一致，让模糊层透出来、面板更亮更通透
              // （用户反馈磨砂偏暗）；文字可读性由模糊层兜底。
              tintOpacity={0.34}
              blur
              blurAmount={50}
              blurRounds={6}
              forceFrosted
            />
          </View>
        ) : null}
        <PaperDialog.Title style={styles.dialogTitle}>
          {title}
        </PaperDialog.Title>
        <View>
          {content}
          {actions.length > 0 && (
            <PaperDialog.Actions style={styles.actionsContainer}>
              {actions.map(action => (
                <Button
                  key={action.label}
                  testID={action.testID}
                  mode={action.mode || 'text'}
                  onPress={action.onPress}
                  loading={action.loading}
                  disabled={action.disabled}
                  style={styles.dialogActionButton}>
                  {action.label}
                </Button>
              ))}
            </PaperDialog.Actions>
          )}
        </View>
      </PaperDialog>
    </Portal>
  );
};
