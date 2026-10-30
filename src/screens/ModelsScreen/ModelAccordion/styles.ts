import {StyleSheet} from 'react-native';
import {Theme} from '../../../utils';

export const createStyles = (_theme: Theme) =>
  StyleSheet.create({
    // 分组标题条（"可使用" / "推荐模型"）。
    // ⚠️ 不能写死 height —— 标题 + 描述两行文字放不下会被裁掉（Android
    // 上 Text 的 lineHeight 约为 fontSize ×1.4，13+11 两行就已经 33px 了）。
    // 用 minHeight + padding 让它自适应：只有一行时矮一点，两行时自然撑开。
    //
    // 2026-10 收紧：「可使用」只有一行标题，原来被 minHeight:40 + 上下 4px
    // padding 撑着，显得很宽松。现在 minHeight 32 / paddingVertical 2，
    // 单行表头矮约 12px，下面整块内容随之上移，视觉更扁。
    // 「推荐模型」有两行（标题 + 设备档位描述），高度由内容决定，
    // minHeight 只是下限，所以文字不会被裁，只是整体上移 2px。
    // 外层大胶囊液态玻璃容器（真实 GlassSurface）。内层的 List.Accordion 透明，
    // 玻璃背景都在这一层。
    accordionWrapper: {
      marginHorizontal: 0,
      marginTop: 8,
      marginBottom: 4,
    },
    accordion: {
      // 2026-10-22：用户要求「一整栏底部往下拉长一点」——把分组标题条整体
      // 加高（minHeight 32→42、上下内边距 2→6），标题胶囊更舒展、不挤。
      minHeight: 42,
      paddingVertical: 6,
      justifyContent: 'center',
      // List.Accordion 内部的容器默认可能裁剪，文字会被切掉半行
      overflow: 'visible',
    },
    accordionTitle: {
      fontSize: 13,
      lineHeight: 19,
      marginBottom: 0,
    },
    accordionDescription: {
      fontSize: 11,
      lineHeight: 15,
      paddingBottom: 0,
    },
  });
