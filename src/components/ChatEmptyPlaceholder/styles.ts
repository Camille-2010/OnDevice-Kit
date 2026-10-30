import {StyleSheet} from 'react-native';
import {Theme} from '../../utils/types';

/**
 * 对话页空状态的样式。
 *
 * 参考 App 的结构：图标 → 标题 → 一句描述 → 一个主按钮 → 一行文字链。
 * **不要**快捷入口网格、不要「模型下载直达」卡片 —— 用户明确要求去掉，
 * 空状态只留「引导去下载/加载模型」这一件事。
 */
export const createStyles = ({theme}: {theme: Theme}) =>
  StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 32,
      gap: 4,
    },
    // 玻璃圆角方块 + 立方体图标（参考 App）。
    // 圆角 18 小于半高 32 —— 玻璃原生视图会把圆角再乘一次密度，
    // 但只有「远超半高」才会渲染成椭圆，18 是安全的偏方圆角。
    iconBox: {
      width: 64,
      height: 64,
      borderRadius: 18,
      backgroundColor: theme.colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 20,
    },
    title: {
      color: theme.colors.onSurface,
      textAlign: 'center',
      marginBottom: 8,
      fontSize: 20,
      fontWeight: '700',
    },
    description: {
      color: theme.colors.onSurfaceVariant,
      textAlign: 'center',
      fontSize: 13,
      lineHeight: 20,
    },
    // 说明小字外的扁平液态玻璃胶囊（margin 移到胶囊外层）
    descPill: {
      alignSelf: 'center',
      maxWidth: '100%',
      marginBottom: 24,
    },
    // 主按钮：玻璃胶囊，通栏。壳 50px 高、圆角 25（半高），
    // 标准模式保留 primary 实心底回退。
    primaryBtn: {
      width: '100%',
      height: 50,
      backgroundColor: theme.colors.primary,
      borderRadius: 25,
    },
    primaryBtnHit: {
      flex: 1,
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 8,
    },
    primaryBtnText: {
      color: theme.colors.onPrimary,
      fontSize: 16,
      fontWeight: '700',
    },
    // 「或从 GitHub 导入 >」文字链
    textLink: {
      marginTop: 18,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 6,
      paddingHorizontal: 10,
    },
    textLinkText: {
      color: theme.colors.onSurfaceVariant,
      fontSize: 13,
    },
  });
