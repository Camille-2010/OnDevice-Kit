import React from 'react';
import {observer} from 'mobx-react';

import {OnboardingScaffold} from '../components/OnboardingScaffold';
import {OnboardingBottomBar} from '../components/OnboardingBottomBar';
import {OnboardingContent} from '../components/OnboardingContent';
import {ItalicAccentTitle} from '../components/ItalicAccentTitle';
import {HighlightText} from '../components/HighlightText';
import {useOnboardingHandlers} from '../useOnboardingHandlers';
import {styles} from './styles';

// Screen 3 illustration — three OnDevice Kit feature cards (fast /
// private / on-device AI) in the app's warm-orange + cool-blue palette.
// Vector asset consumed via react-native-svg-transformer.
import Screen3Cards from '../../../assets/onboarding/screen-3-cards.svg';

export const Onboarding3Screen: React.FC = observer(() => {
  const {l10n, next, goBack} = useOnboardingHandlers(3);
  const t = l10n.onboarding;
  return (
    <OnboardingScaffold
      step={3}
      illustration={
        <Screen3Cards width={styles.cards.width} height={styles.cards.height} />
      }
      content={
        <OnboardingContent
          eyebrow={t.screen3.eyebrow}
          title={
            <ItalicAccentTitle
              title={t.screen3.title}
              accent={t.screen3.titleAccent}
            />
          }
          body={
            <HighlightText
              body={t.screen3.body}
              phrases={[t.screen3.highlight]}
            />
          }
        />
      }
      bottomBar={
        <OnboardingBottomBar
          primaryLabel={t.screen3.cta}
          onPrimary={next}
          onBack={goBack}
          backAccessibilityLabel={t.back}
        />
      }
    />
  );
});
