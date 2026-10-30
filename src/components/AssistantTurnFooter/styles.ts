import {StyleSheet} from 'react-native';

import {Theme} from '../../utils/types';

export const styles = ({theme}: {theme: Theme}) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingBottom: 12,
      gap: 5,
    },
    /**
     * 生成结束后那行统计数据（ms/token、tokens/s、TTFT、草稿命中）的容器。
     * 做成「特别扁平的胶囊」：横向 padding 稍大、纵向只有 3，圆角拉满，
     * 底色用比气泡更淡的 surfaceVariant —— 读起来像一枚标签，而不是
     * 一行与正文抢注意力的文字。
     */
    metricsPill: {
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 1,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: theme.colors.surfaceVariant,
      gap: 6,
    },
    metricsSeparator: {
      color: theme.colors.textSecondary,
      fontSize: 10,
      opacity: 0.6,
    },
    timing: {
      color: theme.colors.textSecondary,
      fontSize: 10,
      flexShrink: 1,
    },
    interruptedStatus: {
      color: theme.colors.error,
      fontSize: 10,
    },
  });
