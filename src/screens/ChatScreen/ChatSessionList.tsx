import React, {useState} from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {IconTile} from '../../components/IconTile';
import {AppIcon} from '../../components/AppIcon';
import {Entrance} from '../../components/Entrance';
import {useNavigation} from '@react-navigation/native';
import {NavigationProp} from '@react-navigation/native';
import {observer} from 'mobx-react';
import {chatSessionStore, modelStore, uiStore} from '../../store';
import {useTheme} from '../../hooks';
import {Portal, Dialog} from 'react-native-paper';
import {GlassButton as Button} from '../../components/GlassButton';
import {SurfaceCard} from '../../components/GlassSurface';
import {dialogGlassTint} from '../../theme/cards';

// 液态玻璃弹窗底色：实底让位，垫一层绝对定位的磨砂玻璃
const dlgGlass = StyleSheet.create({
  dialogBase: {
    width: '88%',
    maxWidth: 420,
    alignSelf: 'center',
    // 面板自己不留内边距：内容统一放进 content 里排版，
    // 玻璃垫层才能铺满整块面板（见下方注释）。
    margin: 0,
    padding: 0,
    borderRadius: 24,
    overflow: 'hidden',
    // 半透明面板不能带 elevation：阴影会被画进面板内部，看起来像蒙了层灰。
    elevation: 0,
  },
  dialogGlass: {
    backgroundColor: 'transparent',
  },
  glassFill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 24,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 10,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    marginTop: 18,
  },
});
import {PillLabel} from '../../components/PillLabel';
import {GlassIconButton} from '../../components/GlassIconButton';

// 对话页统一布局：
// 顶部：模型未加载 -> 提示卡（请先加载模型+模型管理）；加载中 -> 加载条
// 中间：开始新对话按钮
// 下方：小标题「历史记录」+ 历史会话列表（每条长方形卡片，点击可打开）
// 任意状态历史记录都可打开进入聊天

interface Props {
  onOpenChat: () => void;
}

export const ChatSessionList = observer(({onOpenChat}: Props) => {
  const theme = useTheme();
  const styles = createStyles(theme);
  const navigation = useNavigation<NavigationProp<any>>();
  const modelReady = !!modelStore.engine;
  const loading = modelStore.isContextLoading;
  const sessions = chatSessionStore.sessions;

  // 液态玻璃模式：玻璃壳自带底色，壳内文字/图标要换成深色（onSurface），
  // 否则原来是「反白字压彩色底」的按钮会变成白字压浅玻璃，看不清。
  // 标准模式沿用原来的彩色底 + 反白文字，观感零变化。
  const glassOn = uiStore.themeStyle === 'liquid-glass';

  // 历史记录的删除：两种入口
  //   · 每条卡片右侧的垃圾桶 —— 单个删除（弹确认）
  //   · 「历史记录」标题右侧的「批量」—— 进多选模式，底部一条操作栏全选/删除
  const [selectMode, setSelectMode] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const allChecked = sessions.length > 0 && checked.length === sessions.length;

  const toggleCheck = (id: string) => {
    setChecked(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    );
  };

  const confirmSingleDelete = async () => {
    if (!confirmId) {
      return;
    }
    await chatSessionStore.deleteSession(confirmId);
    setConfirmId(null);
  };

  const confirmBatchDelete = async () => {
    if (checked.length === 0) {
      return;
    }
    for (const id of checked) {
      await chatSessionStore.deleteSession(id);
    }
    setChecked([]);
    setSelectMode(false);
  };

  return (
    <ScrollView
      style={styles.wrap}
      contentContainerStyle={styles.listScroll}
      keyboardShouldPersistTaps="handled">
      {!modelReady && !loading ? (
        <SurfaceCard style={styles.promptCard} backdrop="wallpaper">
          <View style={styles.promptBanner}>
            <AppIcon name="warning" size={26} color="#F59E0B" strokeWidth={2} />
            <Text style={styles.promptTitle}>请先加载模型</Text>
          </View>
          <Text style={styles.promptDesc}>
            模型加载后才能开始对话，去模型管理里选择并加载一个模型吧。
          </Text>
          <SurfaceCard
            style={styles.manageBtn}
            backdrop="wallpaper"
            radius={25}
            scaleOnAnyTouch>
            <TouchableOpacity
              style={styles.manageBtnHit}
              activeOpacity={1}
              onPress={() => navigation.navigate('Models' as never)}>
              <AppIcon
                name="chip"
                size={20}
                color={
                  glassOn ? theme.colors.onSurface : theme.colors.onSecondary
                }
              />
              <Text
                style={[
                  styles.manageBtnText,
                  glassOn && {color: theme.colors.onSurface},
                ]}>
                模型管理
              </Text>
            </TouchableOpacity>
          </SurfaceCard>
        </SurfaceCard>
      ) : loading ? (
        <SurfaceCard style={styles.loadingRow} backdrop="wallpaper" radius={24}>
          <AppIcon
            name="loading"
            size={20}
            color={theme.colors.onSurfaceVariant}
          />
          <Text style={styles.loadingText}>正在加载模型…</Text>
        </SurfaceCard>
      ) : null}

      <SurfaceCard
        style={styles.newChatBtn}
        backdrop="wallpaper"
        radius={25}
        scaleOnAnyTouch>
        <TouchableOpacity
          style={styles.newChatBtnHit}
          activeOpacity={1}
          onPress={() => {
            chatSessionStore.resetActiveSession();
            onOpenChat();
          }}>
          <AppIcon
            name="plus"
            size={20}
            color={glassOn ? theme.colors.onSurface : theme.colors.onPrimary}
            strokeWidth={2.2}
          />
          <Text
            style={[
              styles.newChatBtnText,
              glassOn && {color: theme.colors.onSurface},
            ]}>
            开始新对话
          </Text>
        </TouchableOpacity>
      </SurfaceCard>

      <View style={styles.sectionHeader}>
        {/* 小节标题：玻璃小胶囊（和 FAB 菜单的文字标签同款） */}
        <PillLabel radius={15} style={styles.sectionTitleGlass}>
          <Text style={styles.sectionTitle}>历史记录</Text>
        </PillLabel>
        {sessions.length > 0 ? (
          <SurfaceCard
            style={styles.batchBtn}
            backdrop="wallpaper"
            radius={15}
            scaleOnAnyTouch>
            <TouchableOpacity
              testID="batch-delete-toggle"
              style={styles.batchBtnHit}
              activeOpacity={1}
              onPress={() => {
                setSelectMode(v => !v);
                setChecked([]);
              }}>
              <AppIcon
                name={selectMode ? 'close' : 'trash'}
                size={16}
                color={theme.colors.primary}
                strokeWidth={2}
              />
              <Text style={styles.batchBtnText}>
                {selectMode ? '取消' : '批量'}
              </Text>
            </TouchableOpacity>
          </SurfaceCard>
        ) : null}
      </View>

      {sessions.length === 0 ? (
        <View style={styles.emptyWrap}>
          <PillLabel radius={15} style={styles.emptyGlass}>
            <Text style={styles.emptyText}>还没有对话记录</Text>
          </PillLabel>
        </View>
      ) : (
        sessions.map((s, idx) => {
          const isChecked = checked.includes(s.id);
          return (
            <Entrance key={s.id} index={idx} screenKey="home">
              <SurfaceCard
                style={[
                  styles.sessionCard,
                  selectMode && isChecked && styles.sessionCardChecked,
                ]}
                backdrop="wallpaper"
                scaleOnAnyTouch>
                <TouchableOpacity
                  testID={`session-card-${s.id}`}
                  style={styles.sessionCardHit}
                  activeOpacity={1}
                  onPress={() => {
                    if (selectMode) {
                      toggleCheck(s.id);
                      return;
                    }
                    chatSessionStore.setActiveSession(s.id);
                    onOpenChat();
                  }}>
                  {selectMode ? (
                    <View
                      style={[styles.checkBox, isChecked && styles.checkBoxOn]}>
                      {isChecked ? (
                        <AppIcon
                          name="check"
                          size={16}
                          color={theme.colors.onPrimary}
                          strokeWidth={2.4}
                        />
                      ) : null}
                    </View>
                  ) : (
                    <IconTile
                      icon="chat"
                      color="#3B82F6"
                      size={40}
                      iconSize={20}
                    />
                  )}
                  <View style={styles.sessionTextWrap}>
                    <Text style={styles.sessionTitle} numberOfLines={1}>
                      {s.title}
                    </Text>
                    <Text style={styles.sessionDate} numberOfLines={1}>
                      {s.date && String(s.date).slice(0, 10)}
                    </Text>
                  </View>
                  {selectMode ? null : (
                    <>
                      <GlassIconButton
                        testID={`session-delete-${s.id}`}
                        onPress={() => setConfirmId(s.id)}
                        accessibilityLabel="删除对话"
                        glassStyle={styles.sessionDeleteBtn}>
                        <AppIcon
                          name="trash"
                          size={18}
                          color={theme.colors.error}
                          strokeWidth={2}
                        />
                      </GlassIconButton>
                      <AppIcon
                        name="chevronRight"
                        size={22}
                        color={theme.colors.onSurfaceVariant}
                      />
                    </>
                  )}
                </TouchableOpacity>
              </SurfaceCard>
            </Entrance>
          );
        })
      )}

      {selectMode ? (
        <SurfaceCard style={styles.batchBar} backdrop="wallpaper">
          <TouchableOpacity
            style={styles.batchBarBtn}
            activeOpacity={0.7}
            onPress={() =>
              setChecked(allChecked ? [] : sessions.map(x => x.id))
            }>
            <Text style={styles.batchBarBtnText}>
              {allChecked ? '取消全选' : '全选'}
            </Text>
          </TouchableOpacity>
          <View style={styles.batchBarSpacer} />
          <Text style={styles.batchBarCount}>已选 {checked.length} 项</Text>
          <TouchableOpacity
            testID="batch-delete-confirm"
            style={[
              styles.batchDeleteBtn,
              checked.length === 0 && styles.batchDeleteBtnDisabled,
            ]}
            activeOpacity={0.7}
            disabled={checked.length === 0}
            onPress={confirmBatchDelete}>
            <AppIcon
              name="trash"
              size={18}
              color={theme.colors.onError}
              strokeWidth={2}
            />
            <Text style={styles.batchDeleteBtnText}>删除</Text>
          </TouchableOpacity>
        </SurfaceCard>
      ) : null}

      {/* 单个删除确认。
          ⚠️ 之前直接用 Paper 的 Dialog.Title / Content / Actions 叠一层玻璃垫层，
          标题会被排到玻璃面板的上边缘之外（用户截图反馈「文字不在对话框里」）。
          现在内容全部收进一个自带 padding 的 content 容器，玻璃垫层铺满整块面板，
          两种风格（液态玻璃 / 标准实底）都走同一套排版。 */}
      <Portal>
        <Dialog
          visible={!!confirmId}
          onDismiss={() => setConfirmId(null)}
          style={[
            dlgGlass.dialogBase,
            glassOn
              ? dlgGlass.dialogGlass
              : {backgroundColor: theme.colors.background},
          ]}>
          {glassOn ? (
            <View pointerEvents="none" style={dlgGlass.glassFill}>
              <SurfaceCard
                style={StyleSheet.absoluteFill}
                tint={dialogGlassTint(theme)}
                tintOpacity={0.34}
                blur
                blurAmount={50}
                blurRounds={6}
                forceFrosted
              />
            </View>
          ) : null}
          <View style={dlgGlass.content}>
            <Text style={[dlgGlass.title, {color: theme.colors.onSurface}]}>
              删除这条对话？
            </Text>
            <Text
              style={[dlgGlass.body, {color: theme.colors.onSurfaceVariant}]}>
              删除后无法恢复。
            </Text>
            <View style={dlgGlass.actions}>
              <Button onPress={() => setConfirmId(null)}>取消</Button>
              <Button
                testID="confirm-single-delete"
                onPress={confirmSingleDelete}>
                删除
              </Button>
            </View>
          </View>
        </Dialog>
      </Portal>
    </ScrollView>
  );
});

const createStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    wrap: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    dialogBody: {
      color: theme.colors.onSurfaceVariant,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 20,
      marginBottom: 10,
    },
    // 「历史记录」玻璃小胶囊：和右侧「批量」钮等高（30px），
    // 圆角 15 = 半高（玻璃圆角铁律，不能 999）。
    sectionTitleGlass: {
      height: 30,
      paddingVertical: 0,
    },
    // 「批量 / 取消」玻璃小钮：壳 30px 高、圆角 15（半高），
    // 标准模式保留 secondaryContainer 彩色底回退。
    batchBtn: {
      height: 30,
      borderRadius: 15,
      backgroundColor: theme.colors.secondaryContainer,
    },
    batchBtnHit: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingHorizontal: 10,
    },
    batchBtnText: {
      fontSize: 12,
      fontWeight: '600',
      color: theme.colors.primary,
    },
    sessionCardChecked: {
      borderWidth: 1,
      borderColor: theme.colors.primary,
    },
    checkBox: {
      width: 22,
      height: 22,
      borderRadius: 999,
      borderWidth: 1.5,
      borderColor: theme.colors.outline,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkBoxOn: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
    },
    sessionDeleteBtn: {
      width: 34,
      height: 34,
      // ⚠️ 圆角必须是半尺寸（17）—— 玻璃模式下原生视图会把圆角再乘一次
      // 屏幕密度，写 999 会渲染成椭圆（见 ReactNativeLiquidGlassView）。
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
    },
    batchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.outlineVariant,
      backgroundColor: theme.colors.surface,
    },
    batchBarSpacer: {
      flex: 1,
    },
    batchBarBtn: {
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: 999,
      backgroundColor: theme.colors.secondaryContainer,
    },
    batchBarBtnText: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.colors.onSecondaryContainer,
    },
    batchBarCount: {
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
    },
    batchDeleteBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 9,
      paddingHorizontal: 16,
      borderRadius: 999,
      backgroundColor: theme.colors.error,
    },
    batchDeleteBtnDisabled: {
      opacity: 0.45,
    },
    batchDeleteBtnText: {
      fontSize: 14,
      fontWeight: '700',
      color: theme.colors.onError,
    },
    listScroll: {
      padding: 16,
      paddingBottom: 32,
    },
    promptCard: {
      backgroundColor: theme.colors.surface,
      borderRadius: 18,
      padding: 20,
      marginBottom: 14,
    },
    promptBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.secondaryContainer,
      borderRadius: 14,
      paddingVertical: 14,
      paddingHorizontal: 16,
    },
    promptTitle: {
      color: theme.colors.onSecondaryContainer,
      fontSize: 17,
      fontWeight: '700',
      marginLeft: 10,
    },
    promptDesc: {
      color: theme.colors.onSurfaceVariant,
      fontSize: 14,
      lineHeight: 21,
      marginTop: 14,
    },
    // 「模型管理」玻璃钮：壳 50px 高、圆角 25（半高），
    // 标准模式保留 secondary 彩色底回退。
    manageBtn: {
      height: 50,
      borderRadius: 25,
      backgroundColor: theme.colors.secondary,
      paddingHorizontal: 16,
    },
    manageBtnHit: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    manageBtnText: {
      color: theme.colors.onSecondary,
      fontSize: 16,
      fontWeight: '600',
    },
    loadingRow: {
      height: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surface,
      borderRadius: 24,
      marginBottom: 14,
    },
    loadingText: {
      marginLeft: 8,
      color: theme.colors.onSurfaceVariant,
      fontSize: 14,
    },
    // 「开始新对话」玻璃主钮：壳 50px 高、圆角 25（半高），
    // 标准模式保留 primary 实心底回退。
    newChatBtn: {
      height: 50,
      borderRadius: 25,
      backgroundColor: theme.colors.primary,
      paddingHorizontal: 16,
    },
    newChatBtnHit: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    newChatBtnText: {
      color: theme.colors.onPrimary,
      fontSize: 16,
      fontWeight: '600',
    },
    sectionTitle: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.colors.onSurfaceVariant,
    },
    // 空状态提示文字：垫一层玻璃小胶囊，和「历史记录」标题同款
    emptyGlass: {
      paddingHorizontal: 14,
      paddingVertical: 7,
    },
    emptyWrap: {
      paddingVertical: 40,
      alignItems: 'center',
    },
    emptyText: {
      color: theme.colors.onSurfaceVariant,
      fontSize: 14,
    },
    // 会话卡片：玻璃壳（圆角 14 远小于半高，无椭圆风险）；
    // 行布局与触摸区移到内层 hit，壳只管尺寸/底色/圆角。
    sessionCard: {
      backgroundColor: theme.colors.surface,
      borderRadius: 14,
      paddingVertical: 14,
      paddingHorizontal: 14,
      marginBottom: 10,
    },
    sessionCardHit: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
    },
    sessionIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: theme.colors.secondaryContainer,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sessionTextWrap: {
      flex: 1,
      marginLeft: 12,
    },
    sessionTitle: {
      fontSize: 15,
      fontWeight: '600',
      color: theme.colors.onSurface,
    },
    sessionDate: {
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
      marginTop: 3,
    },
  });
