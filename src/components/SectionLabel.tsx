import React from 'react';
import {StyleSheet, Text, View, ViewStyle} from 'react-native';

import {useTheme} from '../hooks';
import {sectionAccent} from '../theme/cards';
import {PillLabel} from './PillLabel';

// BAVoice 风格小节标题：蓝色竖杠 + 深色粗体文字。
// 默认自带液态玻璃小胶囊底（与页面大卡片同款玻璃），因为小节标题是
// 浮在壁纸上的「小字」、没有卡片模块承载；若该标签已处在卡片内部，
// 传 pill={false} 退回纯文字（避免胶囊套胶囊）。
interface Props {
  title: string;
  style?: ViewStyle | ViewStyle[];
  color?: string;
  /** 是否带玻璃胶囊底；默认 true。已在卡片内时用 false */
  pill?: boolean;
}

export const SectionLabel: React.FC<Props> = ({
  title,
  style,
  color,
  pill = true,
}) => {
  const theme = useTheme();
  const inner = (
    <View style={styles.row}>
      {/* 竖杠颜色跟随「关键色」，所以放在组件里算（StyleSheet 是模块级、只算一次） */}
      <View style={[styles.bar, {backgroundColor: sectionAccent()}]} />
      <Text style={[styles.text, {color: color ?? theme.colors.onSurface}]}>
        {title}
      </Text>
    </View>
  );
  if (!pill) {
    return <View style={style}>{inner}</View>;
  }
  // 外层的 margin 由调用方通过 style 传进来（落在胶囊上），内部 row 不再带 margin。
  return <PillLabel style={style}>{inner}</PillLabel>;
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bar: {
    width: 4,
    height: 15,
    borderRadius: 2,
    marginRight: 8,
  },
  text: {
    fontSize: 15,
    fontWeight: '700',
    // includeFontPadding:false 去掉 Android 字体上下额外 padding，
    // 让行盒高度贴合字形；再给一个固定 lineHeight，使 alignItems:center
    // 时蓝杠中心与文字字形中心精确对齐（不再需要手调 margin）。
    lineHeight: 20,
    includeFontPadding: false,
  },
});
