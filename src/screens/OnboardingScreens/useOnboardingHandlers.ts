import {useCallback, useContext, useEffect, useRef, useState} from 'react';
import {useNavigation} from '@react-navigation/native';

import {uiStore} from '../../store';
import {L10nContext} from '../../utils';
import {ROUTES} from '../../utils/navigationConstants';
import type {OnboardingStep, TopicKey} from '../../store/onboarding/types';

/**
 * Per-screen onboarding helpers: mark `currentStep` on mount, expose
 * `goNext` / `goBack` / `skip` / `finish` / `selectTopic` that route through
 * the single-writer methods on `uiStore`. Selecting a topic on screen 5
 * finishes onboarding directly — there is no model-download step; the
 * default assistant (Pip) is seeded at boot and the user picks a model
 * later in the app.
 */
export const useOnboardingHandlers = (step: OnboardingStep) => {
  const navigation = useNavigation<any>();
  const l10n = useContext(L10nContext);
  // In-flight guard for finish(). useRef gives the synchronous early-exit
  // (a re-entrant call before React commits the next render returns
  // immediately); useState drives the disabled-CTA UI.
  const finishingRef = useRef(false);
  const [isFinishing, setIsFinishing] = useState(false);

  useEffect(() => {
    uiStore.setOnboardingStep(step);
  }, [step]);

  const skip = useCallback(() => {
    uiStore.completeOnboarding({
      topic: uiStore.onboardingState.selectedTopic,
      modelId: null,
    });
  }, []);

  const goBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  }, [navigation]);

  const goTo = useCallback(
    (name: string) => {
      navigation.navigate(name);
    },
    [navigation],
  );

  const next = useCallback(() => {
    const map: Record<OnboardingStep, string | null> = {
      1: ROUTES.ONBOARDING.STEP_2,
      2: ROUTES.ONBOARDING.STEP_3,
      3: ROUTES.ONBOARDING.STEP_4,
      4: ROUTES.ONBOARDING.STEP_5,
      5: null,
    };
    const target = map[step];
    if (target) {
      goTo(target);
    }
  }, [step, goTo]);

  const finish = useCallback(async () => {
    if (finishingRef.current) {
      return;
    }
    finishingRef.current = true;
    setIsFinishing(true);
    try {
      const topic = uiStore.onboardingState.selectedTopic;
      uiStore.completeOnboarding({topic, modelId: null});
    } finally {
      finishingRef.current = false;
      setIsFinishing(false);
    }
  }, []);

  // Screen-5 chip tap: write the topic, then finish onboarding in the same
  // handler (single forward control — there is no Continue button on screen 5).
  const selectTopic = useCallback(
    (key: TopicKey | null) => {
      uiStore.setOnboardingTopic(key);
      finish();
    },
    [finish],
  );

  return {l10n, next, goBack, skip, finish, selectTopic, isFinishing};
};
