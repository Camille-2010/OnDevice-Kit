import React, {useState} from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  type ViewStyle,
} from 'react-native';
import {KeyboardAwareScrollView} from 'react-native-keyboard-controller';
import {Text} from 'react-native-paper';
import {GlassButton as Button} from './GlassButton';

import {AppIcon} from './AppIcon';
import {useTheme} from '../hooks';
import {ASSISTANT_TEMPLATES} from '../constants/assistantTemplates';
import {AnimatedSheet} from './AnimatedSheet';
import {SheetGlass} from './SheetGlass';
import {SurfaceCard, GlassTextField} from './GlassSurface';
import {PillLabel} from './PillLabel';
import {cardBg, glassButton, dialogGlassTint} from '../theme/cards';
import {uiStore} from '../store';
import {CloseIcon} from '../assets/icons';

export interface AddAssistantSheetProps {
  isVisible: boolean;
  onClose: () => void;
  /**
   * 当前会话正在用的助手 id（用于标记「使用中」）。
   * 由调用方从 chatSessionStore.activePalId 传入。
   */
  activePalId?: string;
  /**
   * 当前已存在的助手列表（id + name）。
   * 用来判断某个模板是否已经创建过、是否正在被使用，以及列出全部自定义助手。
   */
  existingPals: {id: string; name: string}[];
  /** 确认创建：name + systemPrompt。由调用方负责创建 Pal 并绑到会话 */
  onCreate: (payload: {name: string; systemPrompt: string}) => Promise<void>;
  /**
   * 切换助手。传 `undefined` 表示**关闭助手**（取消当前会话的助手绑定）。
   * 由调用方负责绑到会话。
   */
  onSelectPal?: (id: string | undefined) => void;
  /** 删除某个助手（永久，仅手动触发）。由调用方负责删库与活动回退 */
  onDeletePal?: (id: string) => void;
}

/**
 * 「添加助手」弹窗（对话页右上角 + 号）。
 *
 * 两态：
 *  - `list`  选模板（通用/翻译/写作/编程/学习/自定义）—— **整张卡片可点**
 *  - `edit`  自定义模式：填名字 + 系统提示词
 *
 * 2026-10-19：按用户要求去掉卡片上的「使用」按钮，改为点整张卡片；
 * 并且再次打开时要能看出哪个助手「正在使用中」。
 *
 * 2026-10-27：点一下选中、**再点一下同一个助手即关闭**（取消绑定）。
 * 关闭后会话回到无助手状态，用模型自身的默认系统提示词。
 *
 * 2026-10-22：gorhom 的 Sheet 底层是 RN Modal（独立窗口），原生玻璃
 * 采不到壁纸 → 弹窗内全部显白。改用 AnimatedSheet 的 inPage 模式
 * （页面内覆盖层，capture root 是页面 Screen），面板走 SheetGlass
 * 真玻璃，卡片/输入框/小字全部玻璃化。
 */
export const AddAssistantSheet: React.FC<AddAssistantSheetProps> = ({
  isVisible,
  onClose,
  activePalId,
  existingPals,
  onCreate,
  onSelectPal,
  onDeletePal,
}) => {
  const theme = useTheme();
  const [mode, setMode] = useState<'list' | 'edit'>('list');
  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setMode('list');
    setName('');
    setSystemPrompt('');
  };

  const close = () => {
    reset();
    onClose();
  };

  const startCustom = () => {
    setName('');
    setSystemPrompt('');
    setMode('edit');
  };

  /**
   * 当前正在使用的助手的名字。
   * 用 activePalId 反查，避免「同名旧助手排在前、被当成使用中」而漏标新助手。
   */
  const activePalName = existingPals.find(p => p.id === activePalId)?.name;
  // 所有「自定义助手」：名字不匹配任何模板名的已存在助手。
  // 它们不会出现在 ASSISTANT_TEMPLATES 里，必须单独常驻列出（可切换 / 可删除），
  // 否则建好之后就再也找不到、也标不出「使用中」。
  const customPals = existingPals.filter(
    p => !ASSISTANT_TEMPLATES.some(t => t.name === p.name),
  );

  const submit = async () => {
    const trimmedPrompt = systemPrompt.trim();
    const trimmedName = name.trim();
    if (!trimmedPrompt) {
      return;
    }
    setSaving(true);
    try {
      await onCreate({
        name: trimmedName || '自定义助手',
        systemPrompt: trimmedPrompt,
      });
      close();
    } finally {
      setSaving(false);
    }
  };

  // 删除自定义助手：二次确认，避免误删常驻助手
  const handleDelete = (pal: {id: string; name: string}) => {
    Alert.alert('删除助手', `确定删除「${pal.name}」吗？删除后不可恢复。`, [
      {text: '取消', style: 'cancel'},
      {
        text: '删除',
        style: 'destructive',
        onPress: () => onDeletePal?.(pal.id),
      },
    ]);
  };

  const glassOn = uiStore.themeStyle === 'liquid-glass';
  const glassBtnOutlined = glassButton(theme);
  const glassBtnFilled = glassButton(theme, 'filled');
  // 玻璃模式：面板本体透明（玻璃由 SheetGlass 画）、内边距移交 SheetGlass
  const glassSheet: ViewStyle = glassOn
    ? {backgroundColor: 'transparent', paddingHorizontal: 0, paddingBottom: 0}
    : {};

  return (
    <AnimatedSheet
      visible={isVisible}
      onClose={close}
      inPage
      // 75% 高 + 底部离屏 5%（对齐图像生成页两个弹窗）；
      // 玻璃模式下面板本体透明，玻璃由 SheetGlass 画
      sheetStyle={[
        styles.sheet,
        {backgroundColor: theme.colors.background},
        glassSheet,
      ]}>
      <SheetGlass>
        <View style={styles.header}>
          <Text
            variant="titleMedium"
            style={[styles.title, {color: theme.colors.onSurface}]}>
            添加助手
          </Text>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={close}
            hitSlop={10}
            testID="sheet-close-button"
            accessibilityLabel="Close">
            <CloseIcon stroke={theme.colors.primary} />
          </TouchableOpacity>
        </View>

        {/* 一句话说清「助手」是什么：只在列表页展示。
            进入「自定义」编辑页时由下方合并后的提示胶囊统一说明，
            避免两枚胶囊叠在顶部（用户反馈「两句话合并成一个胶囊」）。 */}
        {mode === 'list' ? (
          <PillLabel style={styles.introPill} radius={12} rimWidth={1.4}>
            <Text
              style={[
                styles.introText,
                {color: theme.colors.onSurfaceVariant},
              ]}>
              助手是预设好角色和规则的系统提示词，选一个就能让当前会话按它的风格回复。
            </Text>
          </PillLabel>
        ) : null}

        {mode === 'list' ? (
          <ScrollView contentContainerStyle={styles.list}>
            {/* 活动中的自定义助手（名字不在模板里）：模板列表没有对应卡，单独置顶标「使用中」 */}
            {/* 已创建的自定义助手：常驻列出，可一键切换 / 删除（除手动删除外永久保留） */}
            {customPals.length > 0 ? (
              <Text
                style={[
                  styles.sectionLabel,
                  {color: theme.colors.onSurfaceVariant},
                ]}>
                我的自定义助手
              </Text>
            ) : null}
            {customPals.map(p => {
              const inUse = p.id === activePalId;
              return (
                <SurfaceCard
                  key={p.id}
                  activeOpacity={0.7}
                  onPress={() => {
                    // 已在使用 → 再点一次关闭助手；否则切换到这个助手。
                    onSelectPal?.(inUse ? undefined : p.id);
                    close();
                  }}
                  contentStyle={styles.cardInner}
                  style={[styles.card, {backgroundColor: cardBg(theme)}]}
                  tint={theme.dark ? undefined : '#FFFFFF'}
                  tintOpacity={theme.dark ? 0.3 : 0.55}
                  rimWidth={1.6}>
                  <View style={styles.iconWrap}>
                    <AppIcon
                      name="spark"
                      size={20}
                      color={theme.colors.primary}
                    />
                  </View>
                  <View style={styles.body}>
                    <View style={styles.titleLine}>
                      <Text
                        style={[styles.name, {color: theme.colors.onSurface}]}>
                        {p.name}
                      </Text>
                      {inUse ? (
                        <View style={styles.badge}>
                          <AppIcon
                            name="check"
                            size={14}
                            color="#059669"
                            strokeWidth={2.4}
                          />
                          <Text style={styles.badgeText}>使用中</Text>
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.descRow}>
                      <Text
                        style={[
                          styles.descInline,
                          {color: theme.colors.onSurfaceVariant},
                        ]}
                        numberOfLines={1}>
                        我的自定义助手
                      </Text>
                      {/* 删除按钮：内嵌 TouchableOpacity，命中即由它接管响应，不触发整卡切换 */}
                      <TouchableOpacity
                        style={styles.deleteBtn}
                        onPress={() => handleDelete(p)}
                        hitSlop={8}
                        accessibilityLabel={`删除助手 ${p.name}`}>
                        <AppIcon
                          name="trash"
                          size={18}
                          color={theme.colors.onSurfaceVariant}
                        />
                      </TouchableOpacity>
                    </View>
                  </View>
                </SurfaceCard>
              );
            })}

            {ASSISTANT_TEMPLATES.map(tpl => {
              const isCustom = tpl.key === 'custom';
              // 选中的模板名 == 当前使用中的助手名 → 标「使用中」
              const inUse = activePalName === tpl.name;
              // 同名助手是否已经创建过：已存在就只切换，不再重复建一个。
              const existing = existingPals.find(p => p.name === tpl.name);

              return (
                <SurfaceCard
                  key={tpl.key}
                  testID={`assistant-template-${tpl.key}`}
                  activeOpacity={0.7}
                  onPress={() => {
                    if (isCustom) {
                      startCustom();
                      return;
                    }
                    // 再点一次正在使用的助手 → 关闭助手（回到无助手状态）。
                    if (inUse) {
                      onSelectPal?.(undefined);
                      close();
                      return;
                    }
                    // 已经创建过同名助手：直接切过去，避免建出重复助手。
                    if (existing) {
                      onSelectPal?.(existing.id);
                      close();
                      return;
                    }
                    // 创建成功才关闭；失败提示由 onCreate 内部负责（会 Alert），
                    // 这里吞掉 rejection，避免产生未处理的 Promise 异常。
                    onCreate({
                      name: tpl.name,
                      systemPrompt: tpl.systemPrompt,
                    })
                      .then(close)
                      .catch(() => {});
                  }}
                  // onPress 卡玻璃模式下内容外层是 TouchableOpacity(flex:1)，
                  // 横排要在这一层补，否则图标/文字/箭头会被竖着排
                  contentStyle={styles.cardInner}
                  style={[styles.card, {backgroundColor: cardBg(theme)}]}
                  tint={theme.dark ? undefined : '#FFFFFF'}
                  tintOpacity={theme.dark ? 0.3 : 0.55}
                  rimWidth={1.6}>
                  {/* 两行结构：第一行 图标+大标题；第二行 小字+箭头 */}
                  <View style={styles.iconWrap}>
                    <AppIcon
                      name={tpl.icon}
                      size={20}
                      color={theme.colors.primary}
                    />
                  </View>
                  <View style={styles.body}>
                    <View style={styles.titleLine}>
                      <Text
                        style={[styles.name, {color: theme.colors.onSurface}]}>
                        {tpl.name}
                      </Text>
                      {inUse ? (
                        <View style={styles.badge}>
                          <AppIcon
                            name="check"
                            size={14}
                            color="#059669"
                            strokeWidth={2.4}
                          />
                          <Text style={styles.badgeText}>使用中</Text>
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.descRow}>
                      <Text
                        style={[
                          styles.descInline,
                          {color: theme.colors.onSurfaceVariant},
                        ]}
                        numberOfLines={1}>
                        {tpl.description}
                      </Text>
                      {/* 只做指示；描述 flex:1 把箭头推去最右 */}
                      <AppIcon
                        name="chevronRight"
                        size={18}
                        color={theme.colors.onSurfaceVariant}
                      />
                    </View>
                  </View>
                </SurfaceCard>
              );
            })}
          </ScrollView>
        ) : (
          <KeyboardAwareScrollView
            contentContainerStyle={styles.editWrap}
            // 键盘避让只由 AnimatedSheet 的面板上浮（marginBottom）负责：
            // 编辑态内容很短，整块面板被顶到键盘上方后已完整可见，
            // 内层若再做一次键盘避让滚动 = 双重上移，用户体感「弹过头」。
            // 故禁用内层的键盘感知滚动，退化为普通 ScrollView。
            enabled={false}
            keyboardShouldPersistTaps="handled">
            {/* 说明小字浮在玻璃面板上 → 垫胶囊 */}
            <PillLabel style={styles.hintPill} radius={15} rimWidth={1.4}>
              <Text
                style={[
                  styles.editHint,
                  {color: theme.colors.onSurfaceVariant},
                ]}>
                助手是预设角色与规则的系统提示词。填好名称和提示词创建后，
                每次对话都会按它回复。
              </Text>
            </PillLabel>

            <GlassTextField
              label="助手名称"
              value={name}
              onChangeText={setName}
              tint={dialogGlassTint(theme)}
              style={[styles.inputGlass, {backgroundColor: cardBg(theme)}]}
              inputStyle={styles.inputText}
              placeholder="例如：我的翻译官"
            />

            <GlassTextField
              label="系统提示词"
              value={systemPrompt}
              onChangeText={setSystemPrompt}
              multiline
              numberOfLines={8}
              tint={dialogGlassTint(theme)}
              style={[
                styles.inputGlass,
                styles.promptGlass,
                {backgroundColor: cardBg(theme)},
              ]}
              inputStyle={[styles.inputText, styles.promptText]}
              placeholder="你是一个……"
            />

            <View style={styles.editActions}>
              <Button
                mode="outlined"
                onPress={() => setMode('list')}
                style={glassBtnOutlined}>
                返回
              </Button>
              <Button
                mode="contained"
                disabled={!systemPrompt.trim() || saving}
                loading={saving}
                onPress={submit}
                style={glassBtnFilled}
                textColor={theme.colors.primary}>
                创建
              </Button>
            </View>
          </KeyboardAwareScrollView>
        )}
      </SheetGlass>
    </AnimatedSheet>
  );
};

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    // 底部离屏 5%：弹窗整体上移，玻璃板四角皆圆浮在底边上方
    bottom: '5%',
    // 原 gorhom Sheet 的 snapPoints=['75%']
    maxHeight: '75%',
    paddingTop: 14,
    paddingBottom: 20,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 4,
  },
  introPill: {
    alignSelf: 'stretch',
    marginBottom: 12,
  },
  introText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  list: {
    paddingBottom: 8,
    gap: 10,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 6,
    marginBottom: 2,
    paddingHorizontal: 2,
  },
  deleteBtn: {
    padding: 4,
    marginRight: -4,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    // 单行布局，再压扁：上下 8→7（整卡 ≈44 高）
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  // 玻璃模式下 onPress 卡的内容外层是 TouchableOpacity(flex:1)，横排在这层补
  cardInner: {
    flexDirection: 'row',
    // 顶部对齐：图标与第一行大标题齐平（不再垂直居中于两行文字）
    alignItems: 'flex-start',
    gap: 10,
  },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(59,130,246,0.10)',
  },
  body: {
    // flex:1 占满「图标 → 箭头」之间的剩余空间，内部 titleLine/descInline
    // 的 flex:1 + numberOfLines=1 才能正确截断（不挤走箭头）
    flex: 1,
    minWidth: 0,
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  // 第二行：小字（占满、超出省略）+ 箭头（贴右）
  descRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  name: {
    fontSize: 14,
    fontWeight: '700',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    // 放大：图标 11→14、文字 10→12、内边距 6/2→8/3
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: 'rgba(16,185,129,0.14)',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#059669',
  },
  descInline: {
    fontSize: 11,
    flex: 1,
    minWidth: 0,
  },
  // （chevronWrap 已删除：箭头直接放 descRow 里，由描述 flex:1 推右）
  editWrap: {
    paddingBottom: 8,
    flexGrow: 1,
  },
  hintPill: {
    alignSelf: 'stretch',
    marginBottom: 14,
  },
  editHint: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  inputGlass: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 8,
    marginBottom: 12,
  },
  inputText: {
    fontSize: 14,
    backgroundColor: 'transparent',
  },
  promptGlass: {
    minHeight: 150,
  },
  promptText: {
    minHeight: 120,
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
});

export default AddAssistantSheet;
