import React from 'react';
import {Image} from 'react-native';
import {observer} from 'mobx-react';

import {OnboardingScaffold} from './components/OnboardingScaffold';
import {OnboardingBottomBar} from './components/OnboardingBottomBar';
import {OnboardingContent} from './components/OnboardingContent';
import {ItalicAccentTitle} from './components/ItalicAccentTitle';
import {HighlightText} from './components/HighlightText';
import {useOnboardingHandlers} from './useOnboardingHandlers';
import {useTheme} from '../../hooks';

// Real launcher app icon (the mark users see on their home screen), swapped
// for the brand splash mark so the first screen reads as "this app".
const APP_ICON_DARK = require('../../assets/pocketpal-dark.png');
const APP_ICON_LIGHT = require('../../assets/pocketpal-light.png');

export const Onboarding1Screen: React.FC = observer(() => {
  const {l10n, next} = useOnboardingHandlers(1);
  const theme = useTheme();
  const t = l10n.onboarding;
  return (
    <OnboardingScaffold
      step={1}
      illustration={
        <Image
          source={theme.dark ? APP_ICON_LIGHT : APP_ICON_DARK}
          style={{width: 112, height: 112, borderRadius: 26}}
          resizeMode="contain"
        />
      }
      content={
        <OnboardingContent
          eyebrow={t.screen1.eyebrow}
          title={
            <ItalicAccentTitle
              title={t.screen1.title}
              accent={t.screen1.titleAccent}
            />
          }
          body={<HighlightText body={t.screen1.body} phrases={[]} />}
        />
      }
      bottomBar={
        <OnboardingBottomBar
          primaryLabel={t.screen1.cta}
          onPrimary={next}
          showBack={false}
          backAccessibilityLabel={t.back}
        />
      }
    />
  );
});
