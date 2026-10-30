import {renderHook, act} from '@testing-library/react-hooks';

import {uiStore} from '../../../store';
import {ROUTES} from '../../../utils/navigationConstants';
import {useOnboardingHandlers} from '../useOnboardingHandlers';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockCanGoBack = jest.fn(() => true);

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: mockCanGoBack,
  }),
}));

describe('useOnboardingHandlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    uiStore.hasCompletedOnboarding = false;
    uiStore.onboardingTopicsSnapshot = [];
    uiStore.onboardingState = {
      currentStep: 1,
      selectedTopic: null,
      selectedModelId: null,
    };
    (uiStore.completeOnboarding as jest.Mock) = jest.fn();
    (uiStore.setOnboardingStep as jest.Mock) = jest.fn();
    (uiStore.setOnboardingTopic as jest.Mock).mockImplementation((key: any) => {
      uiStore.onboardingState.selectedTopic = key;
    });
  });

  it('marks the current step on mount via the single-writer method', () => {
    renderHook(() => useOnboardingHandlers(3));
    expect(uiStore.setOnboardingStep).toHaveBeenCalledWith(3);
  });

  describe('next', () => {
    it('navigates 1 -> Onboarding2, 4 -> Onboarding5', () => {
      const {result: r1} = renderHook(() => useOnboardingHandlers(1));
      act(() => r1.current.next());
      expect(mockNavigate).toHaveBeenLastCalledWith(ROUTES.ONBOARDING.STEP_2);

      const {result: r4} = renderHook(() => useOnboardingHandlers(4));
      act(() => r4.current.next());
      expect(mockNavigate).toHaveBeenLastCalledWith(ROUTES.ONBOARDING.STEP_5);
    });

    it('next on the final step (5) is a no-op — topic chips finish instead', () => {
      const {result} = renderHook(() => useOnboardingHandlers(5));
      act(() => result.current.next());
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe('goBack', () => {
    it('delegates to navigation.goBack when canGoBack is true', () => {
      mockCanGoBack.mockReturnValueOnce(true);
      const {result} = renderHook(() => useOnboardingHandlers(2));
      act(() => result.current.goBack());
      expect(mockGoBack).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when canGoBack is false (covers screen 1 / Splash guard)', () => {
      mockCanGoBack.mockReturnValueOnce(false);
      const {result} = renderHook(() => useOnboardingHandlers(1));
      act(() => result.current.goBack());
      expect(mockGoBack).not.toHaveBeenCalled();
    });
  });

  describe('selectTopic (screen 5 — single forward control)', () => {
    it('writes the picked topic and finishes onboarding (no navigation)', () => {
      const {result} = renderHook(() => useOnboardingHandlers(5));
      act(() => result.current.selectTopic('smartchat'));
      expect(uiStore.setOnboardingTopic).toHaveBeenCalledWith('smartchat');
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(uiStore.completeOnboarding).toHaveBeenCalledTimes(1);
      expect(uiStore.completeOnboarding).toHaveBeenCalledWith({
        topic: 'smartchat',
        modelId: null,
      });
    });

    it("the 'else' escape-hatch tap writes null and still finishes", () => {
      const {result} = renderHook(() => useOnboardingHandlers(5));
      act(() => result.current.selectTopic(null));
      expect(uiStore.setOnboardingTopic).toHaveBeenCalledWith(null);
      expect(uiStore.completeOnboarding).toHaveBeenCalledWith({
        topic: null,
        modelId: null,
      });
    });
  });

  describe('skip', () => {
    it('completeOnboarding with current topic + modelId=null; no model writes', () => {
      uiStore.onboardingState.selectedTopic = 'smartchat';
      const {result} = renderHook(() => useOnboardingHandlers(4));
      act(() => result.current.skip());

      expect(uiStore.completeOnboarding).toHaveBeenCalledTimes(1);
      expect(uiStore.completeOnboarding).toHaveBeenCalledWith({
        topic: 'smartchat',
        modelId: null,
      });
    });
  });

  describe('finish', () => {
    it('completes onboarding with the selected topic and modelId=null, no pal/model writes', async () => {
      uiStore.onboardingState.selectedTopic = 'smartchat';

      const {result} = renderHook(() => useOnboardingHandlers(5));
      await act(async () => {
        await result.current.finish();
      });

      expect(uiStore.completeOnboarding).toHaveBeenCalledTimes(1);
      expect(uiStore.completeOnboarding).toHaveBeenCalledWith({
        topic: 'smartchat',
        modelId: null,
      });
    });
  });
});
