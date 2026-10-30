import {Dimensions, StyleSheet} from 'react-native';

import {Theme} from '../../utils/types';

const dialogHeight = Dimensions.get('window').height * 0.65;

export const createStyles = (theme: Theme, scrollableBorderShown?: boolean) =>
  StyleSheet.create({
    dialog: {
      //maxHeight: '90%',
      backgroundColor: theme.colors.background,
      borderRadius: 15,
      margin: 0,
      padding: 0,
      width: '92%',
      // 平板：弹窗不拉满全宽
      maxWidth: 560,
      alignSelf: 'center',
    },
    dialogTitle: {
      fontSize: 16,
      fontWeight: 'bold',
    },
    dialogContent: {
      maxHeight: dialogHeight,
      paddingHorizontal: 24,
      borderTopWidth: scrollableBorderShown ? 1 : 0,
      borderBottomWidth: scrollableBorderShown ? 1 : 0,
      backgroundColor: theme.colors.background,
    },
    dialogActionButton: {
      minWidth: 70,
    },
    actionsContainer: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      paddingHorizontal: 16,
      paddingBottom: 16,
    },
    // 液态玻璃模式：面板实底与内容底色让给垫在下面的磨砂 SurfaceCard。
    // 圆角加大到 24（与其它玻璃弹窗一致），玻璃垫层同角。
    dialogGlass: {
      backgroundColor: 'transparent',
      borderRadius: 24,
      overflow: 'hidden',
    },
    glassFill: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: 24,
    },
  });
