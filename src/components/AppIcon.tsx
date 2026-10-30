import React from 'react';
import {
  BoxIso,
  Brain,
  ChatBubble,
  ChatPlusIn,
  Cloud,
  ColorPicker,
  Cpu,
  DatabaseExport,
  DotsGrid3x3,
  Download,
  Github,
  InfoCircle,
  Internet,
  Key,
  MediaImage,
  Microphone,
  NavArrowLeft,
  NavArrowRight,
  Plus,
  OpenNewWindow,
  Settings,
  Clock,
  SoundHigh,
  Sparks,
  StyleBorder,
  Translate,
  Voice,
  WarningTriangle,
  Trash,
  Check,
  Xmark,
} from 'iconoir-react-native';

// 全应用统一图标映射：业务键名 -> Iconoir 组件。
// 入口图标（主页 8 宫格 / 更多 5 行 / 我的常用 / 下载弹层）一律走这里的键名，
// 保证风格统一，也方便以后整体换图标库。
export const APP_ICONS = {
  chat: ChatBubble,
  chatPlus: ChatPlusIn,
  image: MediaImage,
  asr: Microphone,
  tts: SoundHigh,
  voice: Voice,
  models: Brain,
  settings: Settings,
  more: DotsGrid3x3,
  chevronRight: NavArrowRight,
  github: Github,
  download: Download,
  openNew: OpenNewWindow,
  info: InfoCircle,
  spark: Sparks,
  // 设置页分组入口补充图标
  translate: Translate,
  palette: ColorPicker,
  shape: StyleBorder,
  memory: Cpu,
  cloud: Cloud,
  web: Internet,
  key: Key,
  database: DatabaseExport,
  box: BoxIso,
  // 通用动作图标（陆续把 MaterialCommunityIcons 替换掉）
  back: NavArrowLeft,
  warning: WarningTriangle,
  chip: Cpu,
  loading: Clock,
  plus: Plus,
  // 删除 / 勾选 / 关闭 —— 历史记录的单个删除、批量多选、弹窗关闭都要用
  trash: Trash,
  check: Check,
  close: Xmark,
} as const;

export type AppIconName = keyof typeof APP_ICONS;

interface Props {
  name: AppIconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export const AppIcon: React.FC<Props> = ({
  name,
  size = 22,
  color = '#111827',
  strokeWidth = 1.7,
}) => {
  const Cmp = APP_ICONS[name];
  if (!Cmp) {
    return null;
  }
  return (
    <Cmp width={size} height={size} color={color} strokeWidth={strokeWidth} />
  );
};
