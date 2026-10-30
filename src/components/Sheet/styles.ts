import {StyleSheet} from 'react-native';

export const styles = StyleSheet.create({
  // 平板：底部弹窗内容不拉满全屏宽，收窄居中（玻璃垫层仍全宽）
  contentRoot: {
    flex: 1,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },

  container: {
    position: 'relative',
  },
  closeBtn: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    marginHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
});
