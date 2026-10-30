import React from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {Portal, Text} from 'react-native-paper';
import {GlassButton as Button} from '../../components/GlassButton';

import {useTheme} from '../../hooks';
import {SurfaceCard} from '../../components/GlassSurface';
import {dialogGlassTint} from '../../theme/cards';

export type ImportMethod = 'reference' | 'copy';

/**
 * 导入方式选择弹窗。
 *
 * 两种方式在「空间占用 / 稳定性」上完全相反，所以把原理和代价都摆出来
 * 让用户自己选，而不是替他们决定：
 *   · 直接引用：零拷贝、不占存储，但源文件被动过就要重新导入
 *   · 复制进沙盒：占一份空间，但从此与源文件无关，最稳
 *
 * 液态玻璃风格下整个弹窗 + 内部两张说明卡都是 `SurfaceCard`
 * （真玻璃 + 边缘高光）；其余风格自动回落实底，零视觉变化。
 */
export const ImportMethodDialog: React.FC<{
  visible: boolean;
  onDismiss: () => void;
  onPick: (method: ImportMethod) => void;
}> = ({visible, onDismiss, onPick}) => {
  const theme = useTheme();

  if (!visible) {
    return null;
  }

  return (
    <Portal>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
        <SurfaceCard
          style={styles.dialog}
          // 弹窗底色：沉灰 tint + 模糊；0.55 与全局弹窗统一——真实模糊层
          // 透出来才是毛玻璃（见 SheetGlass 的统一注释）。
          // forceFrosted：强制磨砂路径，blur 才会真正生效（原生 AGSL 路径下
          // blur 被忽略），并避开小米 HyperOS 覆盖层采样透明的坑。
          tint={dialogGlassTint(theme)}
          tintOpacity={0.34}
          blur
          blurAmount={50}
          blurRounds={6}
          forceFrosted
          testID="import-method-dialog">
          <Text variant="titleMedium" style={styles.title}>
            选择导入方式
          </Text>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}>
            <SurfaceCard style={styles.card}>
              <View style={styles.cardHead}>
                <Text variant="labelLarge" style={styles.cardTitle}>
                  直接引用外部文件
                </Text>
                <View
                  style={[
                    styles.badge,
                    {backgroundColor: theme.colors.primary},
                  ]}>
                  <Text style={styles.badgeText}>推荐</Text>
                </View>
              </View>

              <Text variant="bodySmall" style={styles.hint}>
                原理：用系统文件选择器拿到 content://
                访问地址，再由系统打开成文件
                描述符交给推理引擎直接读取。文件本体仍在你原来的位置，App
                内部不做任何拷贝。
              </Text>

              <Text variant="labelMedium" style={styles.listHead}>
                优势
              </Text>
              <Text variant="bodySmall" style={styles.line}>
                · 零拷贝，
                <Text style={styles.strong}>完全不占 App 存储</Text>
              </Text>
              <Text variant="bodySmall" style={styles.line}>
                · 几个 GB 的模型也是秒级导入，不用等复制
              </Text>
              <Text variant="bodySmall" style={styles.line}>
                · 同一份模型可反复导入，不产生副本
              </Text>

              <Text variant="labelMedium" style={styles.listHead}>
                注意
              </Text>
              <Text variant="bodySmall" style={styles.line}>
                · 源文件被移动、改名或删除后，模型会加载失败，需重新导入
              </Text>
              <Text variant="bodySmall" style={styles.line}>
                · 依赖系统授予的持久读取权限（应用内自动申请）
              </Text>
            </SurfaceCard>

            <SurfaceCard style={styles.card}>
              <Text variant="labelLarge" style={styles.cardTitle}>
                复制到 App 目录
              </Text>

              <Text variant="bodySmall" style={styles.hint}>
                原理：把文件复制一份到 App 私有目录，加载时读取这份副本。
                与原文件彻底解耦。
              </Text>

              <Text variant="labelMedium" style={styles.listHead}>
                优势
              </Text>
              <Text variant="bodySmall" style={styles.line}>
                · 源文件移动 / 删除都不影响，随时可用
              </Text>
              <Text variant="bodySmall" style={styles.line}>
                · 兼容性最好，任何设备都不会出问题
              </Text>

              <Text variant="labelMedium" style={styles.listHead}>
                注意
              </Text>
              <Text variant="bodySmall" style={styles.line}>
                · <Text style={styles.strong}>占用等量手机存储</Text>
                ，4GB 模型就多占 4GB
              </Text>
              <Text variant="bodySmall" style={styles.line}>
                · 大文件需要等待复制完成
              </Text>
            </SurfaceCard>
          </ScrollView>

          <View style={styles.actions}>
            <Button onPress={onDismiss}>取消</Button>
            <Button testID="import-method-copy" onPress={() => onPick('copy')}>
              复制导入
            </Button>
            <Button
              testID="import-method-reference"
              onPress={() => onPick('reference')}>
              直接引用
            </Button>
          </View>
        </SurfaceCard>
      </View>
    </Portal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.38)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  dialog: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '86%',
    borderRadius: 24,
    paddingTop: 16,
    overflow: 'hidden',
  },
  title: {textAlign: 'center', fontWeight: '700', marginBottom: 10},
  scroll: {flexGrow: 0, flexShrink: 1},
  content: {paddingHorizontal: 16, paddingBottom: 10, gap: 12},
  card: {
    borderRadius: 16,
    padding: 14,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {fontWeight: '700'},
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 1,
    borderRadius: 999,
  },
  badgeText: {color: '#FFFFFF', fontSize: 11, fontWeight: '700'},
  hint: {marginTop: 6, opacity: 0.75, lineHeight: 19},
  listHead: {marginTop: 10, marginBottom: 2, opacity: 0.6},
  line: {lineHeight: 19, marginBottom: 1},
  strong: {fontWeight: '700'},
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
});
