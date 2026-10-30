// 统一为「只有彩色线条、透明底」的图标（浅色背景已抠掉）
export const ICON3D = {
  chat: require('./chat.png'),
  vision: require('./vision.png'),
  asr: require('./asr.png'),
  tts: require('./tts.png'),
  voice: require('./voice.png'),
  models: require('./models.png'),
  settings: require('./settings.png'),
  more: require('./more.png'),
  gallery: require('./gallery.png'),
  imagegen: require('./imagegen.png'),
  imageenhance: require('./imageenhance.png'),
} as const;

export type Icon3DName = keyof typeof ICON3D;
