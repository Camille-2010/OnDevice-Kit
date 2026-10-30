/**
 * @format
 */

// Hermes/React Native ship no URL; it must exist before the app graph loads.
import 'react-native-url-polyfill/auto';

import {AppRegistry, LogBox} from 'react-native';

// Silence LogBox in E2E builds so the in-app warning toast doesn't cover
// chat-bottom controls Appium needs. Left active otherwise so warnings
// surface during development.
if (__E2E__) {
  LogBox.ignoreAllLogs(true);
}

// 开发时屏蔽与测试机无关的噪音警告：这台测试机没有 Google Play，
// 应用内购（IAP）必然初始化失败，弹窗会盖住底部胶囊栏、妨碍点按调试。
// 只忽略这一条，其它警告照常显示。
if (__DEV__) {
  LogBox.ignoreLogs([
    '[RN-IAP] Failed to initialize IAP connection',
    'Failed to initialize billing connection',
  ]);
}

import App from './App';
import {name as appName} from './app.json';

AppRegistry.registerComponent(appName, () => App);
