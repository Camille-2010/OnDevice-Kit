import React from 'react';
import {
  Alert,
  BackHandler,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {Button, Text} from 'react-native-paper';
import {SafeAreaView} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import {useTheme} from '../hooks';
import {Theme} from '../utils/types';

interface DisclaimerGateProps {
  /** 用户勾选并点击「同意并继续」时调用（由外层持久化） */
  onAccept: () => void;
}

const INTRO =
  '欢迎使用 OnDevice Kit（桌面名称「OnDev Kit」，以下简称「本应用」）。' +
  '本应用是一个以本地运行为主的 AI 工具箱。开始使用前，请仔细阅读以下全部内容。' +
  '点击「同意并继续」即表示您已阅读、理解并同意本协议的所有条款。';

const SECTIONS: {title: string; body: string}[] = [
  {
    title: '本地优先与数据处理',
    body:
      '本应用默认在您的设备本地运行 AI 模型，AI 对话、图像识别、语音合成等核心能力均可离线完成，不需要账号。' +
      '您主动下载的模型、聊天记录、生成内容与各项设置均保存在本机；卸载应用或清除应用数据会一并删除，且无法由我们恢复。',
  },
  {
    title: '云端服务（可选）',
    body:
      '您可以在「设置 → AI 服务」中自行决定是否开启云端能力。开启后，相关请求会发送到您填写的第三方服务地址' +
      '（例如 OpenAI 兼容对话接口、Stable Diffusion WebUI、语音合成服务等），并受该服务商的条款与隐私政策约束。' +
      '可能离开设备的数据包括：对话文本、上传的图片、语音内容、搜索关键词等。是否开启、使用哪家服务完全由您决定。' +
      '本应用不运营服务器，也不会上传您的对话内容到我们的服务器。',
  },
  {
    title: '联网搜索',
    body:
      '开启联网搜索后，您的搜索关键词会发送给所选的搜索服务商（内置 DuckDuckGo 免费源，或您自行配置的 Tavily / Brave / Exa）。' +
      '当助手读取网页时，网址与页面内容可能被发送给默认阅读服务（r.jina.ai）。',
  },
  {
    title: '模型下载与许可',
    body:
      '从 Hugging Face 等来源下载模型前，请核实该模型的具体许可协议（如 GPL、Apache、仅限非商业用途等）。' +
      '商用或再分发务必遵守其条款。部分模型为受限（Gated）模型，需先在 huggingface.co 网页端阅读并同意其协议，' +
      '您的访问令牌才会获得下载权限；本应用不会自动绕过该限制。',
  },
  {
    title: '密钥与账户安全',
    body:
      '您填写的 API Key、Hugging Face 访问令牌等保存在本机安全存储（iOS Keychain / Android Keystore）。' +
      '令牌只会发送给它对应的服务商（例如 huggingface.co），不会上传给本应用或任何第三方。请妥善保管，不要分享给他人。',
  },
  {
    title: 'AI 生成内容与准确性',
    body:
      'AI 输出可能不准确、过时或包含错误，尤其是联网与云端生成的内容。请自行核实重要信息，' +
      '不要将 AI 输出直接作为医疗、法律、财务等专业决策的唯一依据。',
  },
  {
    title: '版权、肖像权与合法使用',
    body:
      '使用图像生成、图像增强/超分、语音合成、语音克隆、音色转换等功能时，您必须确保拥有所用素材的合法权利，' +
      '并取得必要授权（尤其是他人肖像、声音以及受版权保护的作品）。不得用于伪造、诈骗、侵犯他人权益或其他违法用途。' +
      '由生成内容引起的责任由您自行承担。',
  },
  {
    title: '开源范围与禁止逆向',
    body:
      '本项目的核心技术与实现已在 GitHub 开源，具体开源范围以仓库中实际公布的代码与许可为准；' +
      '应用界面（UI）、美术与图标资源、品牌标识及其他未公开内容并未开源，仍受版权保护。' +
      '禁止使用任何反编译、反汇编、脱壳、注入、Hook、内存/二进制修改或其他逆向工程工具与技术，' +
      '对本应用（尤其是未开源的界面与资源）进行破解、提取、复制、二次打包或再分发。',
  },
  {
    title: '应用内购买',
    body: '部分 Pal 或功能可能通过应用内购买提供（App Store / Google Play）。购买、续费与退款受相应平台的条款约束。',
  },
  {
    title: '未成年人',
    body: '若您未满 18 周岁，请在监护人陪同下阅读本协议，并在取得监护人同意后使用本应用。',
  },
  {
    title: '责任限制与免责',
    body:
      '本应用按「现状」提供，不对因使用或无法使用本应用所造成的任何直接或间接损失承担责任；' +
      '第三方服务的可用性、准确性、合规性由其提供方负责。您应自行评估并承担使用风险。',
  },
  {
    title: '条款更新',
    body: '本协议可能随功能更新而调整。更新后您继续使用本应用，即视为接受新的条款。',
  },
];

export const DisclaimerGate: React.FC<DisclaimerGateProps> = ({onAccept}) => {
  const theme = useTheme();
  const styles = createStyles(theme);
  const [agreed, setAgreed] = React.useState(false);

  const handleDecline = () => {
    Alert.alert(
      '需要同意才能使用',
      '您需要阅读并同意《用户协议》后才能使用本应用。',
      [
        {text: '返回阅读', style: 'cancel'},
        {
          text: '退出应用',
          style: 'destructive',
          onPress: () => {
            if (Platform.OS === 'android') {
              BackHandler.exitApp();
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <Icon
            name="shield-check-outline"
            size={26}
            color={theme.colors.primary}
          />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>用户协议</Text>
          <Text style={styles.subtitle}>
            请阅读并同意《用户协议》后继续使用 OnDevice Kit
          </Text>
        </View>
      </View>

      <View style={styles.card}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator>
          <Text style={styles.intro}>{INTRO}</Text>
          {SECTIONS.map((section, index) => (
            <View key={section.title} style={styles.section}>
              <Text style={styles.sectionTitle}>
                {index + 1}. {section.title}
              </Text>
              <Text style={styles.sectionBody}>{section.body}</Text>
            </View>
          ))}
        </ScrollView>
      </View>

      <View style={styles.footer}>
        <Pressable
          onPress={() => setAgreed(value => !value)}
          style={styles.checkRow}
          accessibilityRole="checkbox"
          accessibilityState={{checked: agreed}}
          testID="disclaimer-agree-checkbox">
          <View style={[styles.checkbox, agreed && styles.checkboxOn]}>
            {agreed ? (
              <Icon name="check" size={14} color={theme.colors.onPrimary} />
            ) : null}
          </View>
          <Text style={styles.checkText}>我已阅读并同意《用户协议》</Text>
        </Pressable>

        <Button
          testID="disclaimer-accept-button"
          mode="contained"
          disabled={!agreed}
          onPress={onAccept}
          style={styles.agreeBtn}
          contentStyle={styles.agreeBtnContent}>
          同意并继续
        </Button>
        <Button
          testID="disclaimer-decline-button"
          mode="text"
          onPress={handleDecline}
          textColor={theme.colors.onSurfaceVariant}>
          不同意并退出
        </Button>
        <Text style={styles.footnote}>
          免责声明：本应用按「现状」提供，使用风险由您自行承担；第三方服务的可用性、准确性与合规性由其提供方负责。
        </Text>
      </View>
    </SafeAreaView>
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingTop: 14,
      paddingBottom: 12,
    },
    iconWrap: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.secondaryContainer,
      marginRight: 12,
    },
    headerText: {
      flex: 1,
    },
    title: {
      fontSize: 19,
      fontWeight: '700',
      color: theme.colors.onSurface,
    },
    subtitle: {
      marginTop: 3,
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
    },
    card: {
      flex: 1,
      marginHorizontal: 16,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.outlineVariant,
      backgroundColor: theme.colors.surface,
      overflow: 'hidden',
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      padding: 16,
      paddingBottom: 24,
    },
    intro: {
      fontSize: 13,
      lineHeight: 21,
      color: theme.colors.onSurface,
      marginBottom: 14,
    },
    section: {
      marginBottom: 14,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: theme.colors.onSurface,
      marginBottom: 4,
    },
    sectionBody: {
      fontSize: 13,
      lineHeight: 21,
      color: theme.colors.onSurfaceVariant,
    },
    footer: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 8,
    },
    checkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      marginBottom: 6,
    },
    checkbox: {
      width: 20,
      height: 20,
      borderRadius: 6,
      borderWidth: 1.5,
      borderColor: theme.colors.outline,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 10,
    },
    checkboxOn: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
    },
    checkText: {
      flex: 1,
      fontSize: 13,
      color: theme.colors.onSurface,
    },
    footnote: {
      marginTop: 8,
      fontSize: 11,
      lineHeight: 16,
      color: theme.colors.onSurfaceVariant,
      textAlign: 'center',
    },
    agreeBtn: {
      borderRadius: 14,
    },
    agreeBtnContent: {
      paddingVertical: 6,
    },
  });
