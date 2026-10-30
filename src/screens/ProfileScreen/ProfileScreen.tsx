import React from 'react';
import {ScrollView, Text, View} from 'react-native';
import {observer} from 'mobx-react';
import {useNavigation} from '@react-navigation/native';
import {NavigationProp} from '@react-navigation/native';

import {AppIcon} from '../../components/AppIcon';
import {Icon3D} from '../../components/Icon3D';
import {Entrance} from '../../components/Entrance';
import {Icon3DName} from '../../assets/icons3d';
import {chatSessionStore, imageGenStore, modelStore} from '../../store';
import {useTheme} from '../../hooks';
import {createStyles} from './styles';
import {SurfaceCard} from '../../components/GlassSurface';
import {PillLabel} from '../../components/PillLabel';

// 常用入口：BAVoice 我的页用「一排小卡片」承载
const FEATURES: {
  key: string;
  title: string;
  desc: string;
  icon3d: Icon3DName;
  route: string;
  params?: object;
}[] = [
  {
    key: 'cloud',
    title: '云端管理',
    desc: '云端对话模型',
    icon3d: 'chat',
    route: 'Settings',
    // 直接落到「AI 服务」子页（云端模型配置）
    params: {subPage: 'api'},
  },
  {
    key: 'downloads',
    title: '下载管理',
    desc: '已下载模型',
    icon3d: 'models',
    route: 'Downloads',
  },
  {
    key: 'about',
    title: '关于应用',
    desc: '版本与开源',
    icon3d: 'gallery',
    route: 'App Info',
  },
];

interface ProfileScreenProps {
  header?: React.ReactNode;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = observer(
  ({header}: ProfileScreenProps) => {
    const navigation = useNavigation<NavigationProp<any>>();
    const theme = useTheme();
    const styles = createStyles({theme});
    const modelCount = modelStore.availableModels.length;

    // 统计数字接真实数据，不再一律显示 0。
    // 视觉识别目前没有独立的结果 store（识别结果只在会话里），所以这一格不编造。
    const stats = [
      {num: String(modelCount), label: '模型'},
      {num: String(chatSessionStore.sessions.length), label: '对话'},
      {num: String(imageGenStore.history.length), label: '图片'},
      {num: String(modelStore.isContextLoading ? 1 : 0), label: '已加载'},
    ];

    return (
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        {header}
        <View style={styles.container}>
          {/* 头像 + 名字（侧边栏入口已移到顶部栏，不再用蓝紫封面） */}
          <Entrance index={0} screenKey="profile">
            <View style={styles.identityRow}>
              <View style={styles.avatar}>
                <AppIcon name="spark" size={30} color="#7A5B00" />
              </View>
              <View style={styles.identityText}>
                <Text style={styles.name}>本地 AI 用户</Text>
                <PillLabel style={styles.metaPill}>
                  <Text style={styles.meta} numberOfLines={1}>
                    本地离线 · 云端可选
                  </Text>
                </PillLabel>
              </View>
            </View>
          </Entrance>

          {/* 统计：整条合并为一个大液态玻璃栏，内部小字仍保留胶囊 */}
          <Entrance index={1} screenKey="profile">
            <SurfaceCard style={styles.statsBar} backdrop="wallpaper">
              {stats.map((s, i) => (
                <View
                  key={s.label}
                  style={[
                    styles.statItem,
                    i < stats.length - 1 ? styles.statDivider : null,
                  ]}>
                  <Text style={styles.statNum}>{s.num}</Text>
                  <PillLabel style={styles.statLabelPill}>
                    <Text style={styles.statLabel}>{s.label}</Text>
                  </PillLabel>
                </View>
              ))}
            </SurfaceCard>
          </Entrance>

          {/* 标签 */}
          <Entrance index={2} screenKey="profile">
            <View style={styles.chipsRow}>
              {['本地离线', '云端可选', '模型自持'].map(t => (
                <PillLabel key={t} style={styles.chipPill}>
                  <Text style={styles.chipText}>{t}</Text>
                </PillLabel>
              ))}
            </View>
          </Entrance>

          {/* 常用入口：一排三张小卡 */}
          <Entrance index={3} screenKey="profile">
            <View style={styles.infoRow}>
              {FEATURES.map(f => (
                <SurfaceCard
                  key={f.key}
                  style={styles.infoCard}
                  onPress={() =>
                    f.params
                      ? navigation.navigate(f.route, f.params)
                      : navigation.navigate(f.route)
                  }
                  accessibilityRole="button">
                  {/* 图标改水印：去掉图标底色，大而淡垫在内容背后，
                      水平居中、垂直居中偏上，留边距不贴卡片边缘 */}
                  <View
                    pointerEvents="none"
                    style={styles.infoIconWatermark}>
                    <Icon3D name={f.icon3d} size={72} fixed />
                  </View>
                  <Text style={styles.infoTitle}>{f.title}</Text>
                  <Text style={styles.infoDesc}>{f.desc}</Text>
                </SurfaceCard>
              ))}
            </View>
          </Entrance>

          <Entrance index={4} screenKey="profile">
            <PillLabel style={styles.footerPill}>
              <Text style={styles.footer}>
                OnDevice Kit · 基于 PocketPal AI
              </Text>
            </PillLabel>
          </Entrance>
        </View>
      </ScrollView>
    );
  },
);

export default ProfileScreen;
