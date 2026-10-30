import React, {useState, useContext} from 'react';
import {View, TouchableOpacity, Alert, Linking} from 'react-native';

import DeviceInfo from 'react-native-device-info';
import Clipboard from '@react-native-clipboard/clipboard';
import {Text, SegmentedButtons} from 'react-native-paper';
import {GlassButton as Button} from '../../components/GlassButton';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import {BuildInfo} from 'llama.rn';

import {submitFeedback} from '../../api/feedback';

import {CopyIcon, GithubIcon, ChevronRightIcon} from '../../assets/icons';

import {Sheet} from '../../components';
import {Entrance} from '../../components/Entrance';
import {SubHeader} from '../../components/SubHeader';
import {useNavigation} from '@react-navigation/native';
import {useTheme} from '../../hooks';
import {createStyles} from './styles';
import {L10nContext} from '../../utils';
import {KeyboardAwareScrollView} from 'react-native-keyboard-controller';
import {SurfaceCard, GlassTextField} from '../../components/GlassSurface';
import {PillLabel} from '../../components/PillLabel';
import {glassButton} from '../../theme/cards';
import {uiStore} from '../../store';

const GithubButtonIcon = ({color}: {color: string}) => (
  <GithubIcon stroke={color} />
);

const ChevronRightButtonIcon = ({color}: {color: string}) => (
  <ChevronRightIcon stroke={color} />
);

export const AboutScreen: React.FC = () => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const styles = createStyles(theme, insets);
  const l10n = useContext(L10nContext);
  const navigation = useNavigation<any>();
  const [showFeedback, setShowFeedback] = useState(false);

  // 液态玻璃：按钮玻璃化；GitHub Star 用填充玻璃（更醒目），反馈用描边玻璃
  const glassOn = uiStore.themeStyle === 'liquid-glass';
  const glassBtnOutlined = glassButton(theme);
  const glassBtnFilled = glassButton(theme, 'filled');
  const glassBtnText = theme.colors.primary;

  const [appInfo, setAppInfo] = React.useState({
    version: '',
    build: '',
  });

  const [useCase, setUseCase] = useState('');
  const [featureRequests, setFeatureRequests] = useState('');
  const [generalFeedback, setGeneralFeedback] = useState('');
  const [usageFrequency, setUsageFrequency] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  React.useEffect(() => {
    const version = DeviceInfo.getVersion();
    const buildNumber = DeviceInfo.getBuildNumber();
    setAppInfo({
      version,
      build: buildNumber,
    });
  }, []);

  const copyVersionToClipboard = () => {
    const versionString = `Version ${appInfo.version} (${appInfo.build})`;
    Clipboard.setString(versionString);
    Alert.alert(
      l10n.about.versionCopiedTitle,
      l10n.about.versionCopiedDescription,
    );
  };

  const handleSubmit = async () => {
    if (!useCase && !featureRequests && !generalFeedback) {
      Alert.alert(l10n.feedback.validation.required);
      return;
    }

    setIsSubmitting(true);
    try {
      await submitFeedback({
        useCase,
        featureRequests,
        generalFeedback,
        usageFrequency,
      });
      Alert.alert('Success', l10n.feedback.success);
      setShowFeedback(false);
      // Clear form
      setUseCase('');
      setFeatureRequests('');
      setGeneralFeedback('');
      setUsageFrequency('');
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : l10n.feedback.error.general;
      Alert.alert('Error', errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      {/* 顶栏：与主页一致的玻璃 SubHeader（液态玻璃模式下是真玻璃） */}
      <SubHeader
        title={l10n.screenTitles.appInfo}
        onBack={() => navigation.goBack()}
      />
      <KeyboardAwareScrollView contentContainerStyle={styles.container}>
        <Entrance index={0}>
          <SurfaceCard style={styles.card}>
            <View
              style={[
                styles.header,
                // 玻璃模式：头部不再是实底色块，透出整卡的玻璃
                glassOn && {
                  backgroundColor: 'transparent',
                  borderBottomColor: 'transparent',
                },
              ]}>
              <View style={styles.headerContent}>
                <Text variant="titleLarge" style={styles.title}>
                  OnDevice Kit
                </Text>
                <PillLabel style={[styles.textPill, styles.pillGap]}>
                  <Text variant="bodyMedium" style={styles.pillText}>
                    {l10n.about.description}
                  </Text>
                </PillLabel>
                <View style={styles.versionContainer}>
                  <TouchableOpacity
                    style={styles.versionButton}
                    onPress={copyVersionToClipboard}>
                    <Text style={styles.versionText}>
                      v{appInfo.version} ({appInfo.build})
                    </Text>
                    <CopyIcon
                      width={16}
                      height={16}
                      stroke={theme.colors.textSecondary}
                    />
                  </TouchableOpacity>
                </View>
                <PillLabel style={styles.textPill}>
                  <Text style={styles.pillSmallText}>
                    llama.cpp {BuildInfo.number} (
                    {BuildInfo.commit.substring(0, 7)})
                  </Text>
                </PillLabel>
              </View>
            </View>

            <View style={styles.section}>
              <PillLabel
                style={[styles.chipPill, styles.pillGap]}
                radius={12}
                opacity="strong">
                <Text style={styles.pillTitle}>
                  {l10n.about.supportProject}
                </Text>
              </PillLabel>
              <PillLabel style={[styles.textPill, styles.pillGap]}>
                <Text variant="bodyMedium" style={styles.pillText}>
                  {l10n.about.supportProjectDescription}
                </Text>
              </PillLabel>
              <Button
                mode="contained"
                onPress={() =>
                  Linking.openURL('https://github.com/a-ghorbani/pocketpal-ai')
                }
                style={[styles.actionButton, styles.starButton, glassBtnFilled]}
                icon={GithubButtonIcon}
                textColor={glassBtnText}>
                {l10n.about.githubButton}
              </Button>
              <PillLabel style={[styles.centerPill, styles.pillGap]}>
                <Text style={styles.pillOrText}>{l10n.about.orBy}</Text>
              </PillLabel>
              <Button
                mode="outlined"
                style={[styles.actionButton, glassBtnOutlined]}
                contentStyle={styles.feedbackButtonContent}
                icon={ChevronRightButtonIcon}
                onPress={() => setShowFeedback(true)}>
                {l10n.feedback.shareThoughtsButton}
              </Button>
            </View>

            <PillLabel style={styles.legalPill}>
              <View style={styles.legalRow}>
                <Text
                  style={styles.legalLink}
                  onPress={() =>
                    Linking.openURL('https://pocketpal.dev/privacy-policy')
                  }>
                  {l10n.about.privacyPolicy}
                </Text>
                <Text style={styles.legalSeparator}>·</Text>
                <Text
                  style={styles.legalLink}
                  onPress={() =>
                    Linking.openURL('https://pocketpal.dev/terms')
                  }>
                  {l10n.about.termsOfService}
                </Text>
              </View>
            </PillLabel>
          </SurfaceCard>
        </Entrance>
      </KeyboardAwareScrollView>

      <Sheet
        title={l10n.feedback.title}
        isVisible={showFeedback}
        displayFullHeight
        onClose={() => setShowFeedback(false)}>
        <Sheet.ScrollView contentContainerStyle={styles.feedbackForm}>
          <View style={styles.field}>
            <Text style={styles.label}>{l10n.feedback.useCase.label}</Text>
            <GlassTextField
              tintOpacity={0.68}
              defaultValue={useCase}
              onChangeText={setUseCase}
              placeholder={l10n.feedback.useCase.placeholder}
              multiline
              numberOfLines={4}
              style={styles.glassInput}
              inputStyle={styles.glassInputText}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>
              {l10n.feedback.featureRequests.label}
            </Text>
            <GlassTextField
              tintOpacity={0.68}
              defaultValue={featureRequests}
              onChangeText={setFeatureRequests}
              placeholder={l10n.feedback.featureRequests.placeholder}
              multiline
              numberOfLines={4}
              style={styles.glassInput}
              inputStyle={styles.glassInputText}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>
              {l10n.feedback.generalFeedback.label}
            </Text>
            <GlassTextField
              tintOpacity={0.68}
              defaultValue={generalFeedback}
              onChangeText={setGeneralFeedback}
              placeholder={l10n.feedback.generalFeedback.placeholder}
              multiline
              numberOfLines={4}
              style={styles.glassInput}
              inputStyle={styles.glassInputText}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>
              {l10n.feedback.usageFrequency.label}
            </Text>
            <SegmentedButtons
              value={usageFrequency}
              onValueChange={setUsageFrequency}
              buttons={[
                {
                  value: 'daily',
                  label: l10n.feedback.usageFrequency.options.daily,
                },
                {
                  value: 'weekly',
                  label: l10n.feedback.usageFrequency.options.weekly,
                },
                {
                  value: 'monthly',
                  label: l10n.feedback.usageFrequency.options.monthly,
                },
                {
                  value: 'rarely',
                  label: l10n.feedback.usageFrequency.options.rarely,
                },
              ]}
              style={styles.segmentedButtons}
            />
          </View>
        </Sheet.ScrollView>
        <Sheet.Actions>
          <View style={styles.secondaryButtons}>
            <Button
              mode="text"
              style={glassBtnOutlined}
              onPress={() => setShowFeedback(false)}>
              {l10n.common.cancel}
            </Button>
          </View>
          <Button
            mode="contained"
            style={glassBtnFilled}
            textColor={glassBtnText}
            onPress={handleSubmit}
            loading={isSubmitting}
            disabled={isSubmitting}>
            {l10n.feedback.submit}
          </Button>
        </Sheet.Actions>
      </Sheet>
    </SafeAreaView>
  );
};
