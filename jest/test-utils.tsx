import React from 'react';
import {StyleSheet} from 'react-native';

import {PaperProvider} from 'react-native-paper';
import {render} from '@testing-library/react-native';
import {NavigationContainer} from '@react-navigation/native';
import {createStackNavigator} from '@react-navigation/stack';
import {BottomSheetModalProvider} from '@gorhom/bottom-sheet';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {GestureHandlerRootView} from 'react-native-gesture-handler';

import {themeFixtures} from './fixtures/theme';

import {user as userFixture} from './fixtures';

import {MarkdownProvider} from '../src/components/MarkdownView';
import {UserContext} from '../src/utils';
import type {Theme} from '../src/utils/types';

export type CustomRenderOptions = {
  theme?: Theme;
  user?: any;
  withNavigation?: boolean;
  withSafeArea?: boolean;
  withBottomSheetProvider?: boolean;
};

const customRender = (
  ui: React.ReactElement,
  {
    theme = themeFixtures.lightTheme,
    user = userFixture,
    withNavigation = false,
    withSafeArea = false,
    withBottomSheetProvider = false,
    ...renderOptions
  }: CustomRenderOptions = {},
) => {
  const Wrapper = ({children}: {children: React.ReactNode}) => {
    const withBottomSheetProviderWrapper = withBottomSheetProvider ? (
      <BottomSheetModalProvider>{children}</BottomSheetModalProvider>
    ) : (
      children
    );

    const withNavigationWrapper = withNavigation ? (
      // useRoute() 需要 Screen 上下文——裸 NavigationContainer 只够
      // useNavigation() 用（SettingsScreen 顶层 useRoute 会直接抛）。
      // 这里包一个最小 Stack（路由名 TestScreen，无导航器头）。
      <NavigationContainer>
        <TestNavigator>{withBottomSheetProviderWrapper}</TestNavigator>
      </NavigationContainer>
    ) : (
      withBottomSheetProviderWrapper
    );

    // Sits inside PaperProvider so the MarkdownProvider can read theme,
    // and provides the ambient TRenderEngineProvider/RenderHTMLConfigProvider
    // any component using RenderHTMLSource (e.g. MarkdownView) depends on.
    const withPaperProvider = (
      <PaperProvider theme={theme}>
        <MarkdownProvider>{withNavigationWrapper}</MarkdownProvider>
      </PaperProvider>
    );

    const withSafeAreaWrapper = withSafeArea ? (
      <SafeAreaProvider
        initialMetrics={{
          frame: {x: 0, y: 0, width: 0, height: 0},
          insets: {top: 0, right: 0, bottom: 0, left: 0},
        }}>
        {withPaperProvider}
      </SafeAreaProvider>
    ) : (
      withPaperProvider
    );

    return (
      <GestureHandlerRootView style={styles.root}>
        <UserContext.Provider value={user}>
          {withSafeAreaWrapper}
        </UserContext.Provider>
      </GestureHandlerRootView>
    );
  };

  return render(ui, {wrapper: Wrapper, ...renderOptions});
};

/** withNavigation 的最小导航外壳：提供 route 上下文，不渲染任何头。 */
const TestNavigator = ({children}: {children: React.ReactNode}) => {
  // 不能在模块顶层调 createStackNavigator()：不少测试整体替换了
  // @react-navigation/native（只导出 useRoute 等），工厂函数在 mock 下
  // 不存在，模块加载即崩。延迟到真正渲染时（仅 withNavigation 路径）。
  const Stack = createStackNavigator();
  // CardStack 要读 safe-area insets；不给 SafeAreaProvider 会在
  // insets.top 上抛 "Cannot read properties of null"。
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: {x: 0, y: 0, width: 0, height: 0},
        insets: {top: 0, right: 0, bottom: 0, left: 0},
      }}>
      <Stack.Navigator screenOptions={{headerShown: false}}>
        <Stack.Screen name="TestScreen">{() => <>{children}</>}</Stack.Screen>
      </Stack.Navigator>
    </SafeAreaProvider>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});

// Re-export everything
export * from '@testing-library/react-native';
export {customRender as render};
