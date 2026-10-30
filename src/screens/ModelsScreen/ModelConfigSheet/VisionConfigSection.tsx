import React, {useCallback, useEffect, useState} from 'react';
import {View, StyleSheet} from 'react-native';
import {Text, Icon} from 'react-native-paper';
import {GlassButton as Button} from '../../../components/GlassButton';
import {observer} from 'mobx-react';

import {useTheme} from '../../../hooks';
import {modelStore} from '../../../store';
import {Model} from '../../../utils/types';
import {
  cardBg,
  buttonRing,
  glassButton,
  dialogGlassTint,
} from '../../../theme/cards';
import {SurfaceCard} from '../../../components/GlassSurface';

/** 每一项内容一张卡片（与另外两个 Tab 一致）。
 *  液态玻璃风格下 SurfaceCard 渲染成真玻璃（玻璃叠玻璃），其他风格仍是浅灰实底卡 */
const rowCard = (theme: ReturnType<typeof useTheme>) => ({
  backgroundColor: cardBg(theme),
  // 14 -> 16：内层卡片也跟着更圆一点，和窗口圆角呼应
  borderRadius: 16,
  // 卡片更紧凑：纵向 12 -> 9，横向 14 -> 12
  paddingHorizontal: 12,
  paddingVertical: 9,
});

/**
 * 「视觉配置」区块。
 *
 * 多模态 LLM 自己不会看图 —— 它需要外接一个 **mmproj 投影模型**把图片
 * 编码成它能读的形式，加载主模型时会一并加载。所以这里是：
 *   · 未配置 → 一句说明 + 一个「导入 MMProj 文件」的主按钮
 *   · 已配置 → 文件名 + 「查看元数据」+「删除 MMProj」
 *
 * 「导入」实际是从本地文件管理器挑一个 mmproj gguf，走和模型页一致的
 * 零拷贝导入（存content://，不占 App 存储）。
 */
export const VisionConfigSection: React.FC<{
  model: Model;
  /** 从「已有模型里选一个 mmproj 绑定」—— 当用户已经导入过时用这个 */
  onPickExisting: () => void;
}> = observer(({model, onPickExisting}) => {
  const theme = useTheme();
  const [importing, setImporting] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();

  // 当前会话的视觉是否真的活着（isMultimodalActive 是加载时的判定）
  const sessionVisionActive = modelStore.activeModelCaps.visionActive;
  // 这个模型是不是当前激活的那个
  const isActiveNow = modelStore.activeModelId === model.id;

  const projId = model.defaultProjectionModel;
  const projection = projId
    ? modelStore.models.find(m => m.id === projId)
    : undefined;

  // 「查看元数据」：读到之后就地展开，不跳页不弹窗
  const [showMeta, setShowMeta] = useState(false);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [metaError, setMetaError] = useState<string | undefined>();

  const toggleMeta = async () => {
    // 已经展开 → 收起
    if (showMeta && !loadingMeta) {
      setShowMeta(false);
      return;
    }
    setShowMeta(true);
    setMetaError(undefined);
    if (!projection) {
      setMetaError('没有找到已绑定的 mmproj 模型');
      return;
    }
    if (projection.ggufMetadata) {
      return; // 已有数据，不用重读
    }
    setLoadingMeta(true);
    try {
      await modelStore.fetchAndPersistGGUFMetadata(projection);
    } catch (e: any) {
      setMetaError(e?.message ?? String(e));
    } finally {
      setLoadingMeta(false);
    }
  };

  const reload = useCallback(async () => {
    setError(undefined);
    try {
      await modelStore.fetchAndPersistGGUFMetadata(model);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, [model]);

  useEffect(() => {
    if (!model.ggufMetadata) {
      reload();
    }
  }, [model.id, model.ggufMetadata, reload]);

  // 元数据表：只展示有值的字段，没读到的就别占地方
  const md = projection?.ggufMetadata;
  const metaRows: [string, string][] = md
    ? (
        [
          ['architecture', md.architecture],
          ['size_label', md.size_label],
          ['file_type', md.file_type],
          ['n_layers', md.n_layers],
          ['n_embd', md.n_embd],
          ['n_head', md.n_head],
          ['n_head_kv', md.n_head_kv],
          ['n_vocab', md.n_vocab],
          ['n_embd_head_k', md.n_embd_head_k],
          ['n_embd_head_v', md.n_embd_head_v],
          ['n_ff', md.n_ff],
          ['context_length', md.context_length],
          ['sliding_window', md.sliding_window],
          ['tensor_count', md.tensor_count],
          ['kv_count', md.kv_count],
          ['gguf_version', md.gguf_version],
          ['rope_freq_base', md.rope_freq_base],
          ['rms_norm_eps', md.rms_norm_eps],
          ['bos_token_id', md.bos_token_id],
          ['eos_token_id', md.eos_token_id],
        ] as [string, unknown][]
      )
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => [
          k,
          typeof v === 'number' && !Number.isInteger(v)
            ? v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
            : String(v),
        ])
    : [];

  /** 「导入 MMProj 文件」：去文件管理器选一个 mmproj，导入并自动绑定 */
  const importMMProj = async () => {
    setImporting(true);
    setError(undefined);
    try {
      const res = await modelStore.importAndAttachProjectionModel(model.id);
      if (res.ok) {
        return;
      }
      if (res.reason === 'cancelled') {
        return;
      }
      setError(
        res.reason === 'noPermission'
          ? '系统没有授予该文件的持久读取权限，或文件已被移动 / 删除。'
          : res.reason === 'notProjection'
            ? '这个文件不是投影模型（mmproj）。它的 GGUF 头里没有 clip / siglip / vit 这类视觉编码器架构。'
            : '导入失败，请换一个文件重试。',
      );
    } finally {
      setImporting(false);
    }
  };

  const detach = () => {
    if (projId) {
      modelStore.detachProjectionModel(model.id);
    }
  };

  return (
    <View>
      <SurfaceCard tint="#3B82F6" tintOpacity={0.14} style={s.tipBox}>
        <Text style={s.tipText}>
          在此配置 mmproj 文件，加载模型时会一并加载。
        </Text>
      </SurfaceCard>

      <SurfaceCard
        glassType="regular"
        tint={dialogGlassTint(theme)}
        tintOpacity={0.5}
        rimWidth={1.6}
        style={[s.statusRow, rowCard(theme)]}>
        <Text
          style={{
            color: theme.colors.onSurface,
            fontSize: 12,
            fontWeight: '700',
          }}>
          视觉状态
        </Text>
        <Text
          style={{
            fontSize: 12,
            color: projection ? '#0F766E' : theme.colors.onSurfaceVariant,
            fontWeight: '700',
          }}>
          {projection ? '已配置 MMProj' : '未配置'}
        </Text>
      </SurfaceCard>

      {/*
        ⚠️ 关键：区分「配了 mmproj」和「当前会话能用图」。
        visionActive 是**加载时**的判定 —— initMultimodal 成功才算。
        用户绑完 mmproj 若不重新加载模型，这里会明确告诉他需要重载，
        而不是让他以为绑了就能用、然后在聊天页点 + 得到一句
        「没有视觉模型」的报错。
      */}
      {projection ? (
        <View
          style={[
            s.sessionHint,
            {
              borderColor:
                sessionVisionActive && isActiveNow
                  ? 'rgba(16,185,129,0.45)'
                  : 'rgba(245,158,11,0.45)',
            },
          ]}>
          <Icon
            source={
              sessionVisionActive && isActiveNow
                ? 'check-circle-outline'
                : 'alert-circle-outline'
            }
            size={16}
            color={sessionVisionActive && isActiveNow ? '#059669' : '#B45309'}
          />
          <Text
            style={{
              flex: 1,
              fontSize: 12,
              lineHeight: 18,
              color: theme.colors.onSurface,
            }}>
            {isActiveNow
              ? sessionVisionActive
                ? '当前会话已启用视觉，聊天页点 + 即可发送图片。'
                : '已绑定但当前会话未生效，需重新加载模型。'
              : '该模型当前未加载，加载后视觉能力才会启用。'}
          </Text>
        </View>
      ) : null}

      {error ? (
        <Text style={{color: theme.colors.error, fontSize: 12, marginTop: 8}}>
          读取模型信息失败：{error}
        </Text>
      ) : null}

      {projection ? (
        <>
          <SurfaceCard
            glassType="regular"
            tint={dialogGlassTint(theme)}
            tintOpacity={0.5}
            rimWidth={1.6}
            style={[s.fileCard, rowCard(theme)]}>
            <Text numberOfLines={2} style={[s.fileName, {fontSize: 13}]}>
              {projection.name || projection.filename}
            </Text>
            <Text style={{color: theme.colors.onSurfaceVariant, fontSize: 12}}>
              {projection.ggufMetadata?.architecture ?? ''}
              {'  '}
              {formatSize(projection.size)}
            </Text>
          </SurfaceCard>

          <Button
            mode="outlined"
            icon={showMeta ? 'chevron-up' : 'information-outline'}
            loading={loadingMeta}
            disabled={loadingMeta}
            onPress={toggleMeta}
            style={[
              s.secondaryBtn,
              glassButton(theme),
              {borderWidth: 1, borderColor: buttonRing(theme)},
            ]}>
            {loadingMeta
              ? '正在读取…'
              : showMeta
                ? '收起元数据'
                : '查看 mmproj 元数据'}
          </Button>

          {/*
            元数据面板。
            ⚠️ 2026-10-19 用户反馈「查看元数据看不了」—— 原来按钮只是
            静默调 fetchAndPersistGGUFMetadata(...).catch(() => {})，
            不 loading、不展示、不报错，用户点了像坏了一样。
            现在：读完就地展开，读不到就明确说为什么。
          */}
          {showMeta ? (
            <SurfaceCard
              glassType="regular"
              tint={dialogGlassTint(theme)}
              tintOpacity={0.5}
              rimWidth={1.6}
              style={[s.metaBox, rowCard(theme)]}>
              {metaError ? (
                <Text style={[s.metaText, {color: theme.colors.error}]}>
                  读取失败：{metaError}
                </Text>
              ) : metaRows.length === 0 ? (
                <Text style={s.metaText}>
                  没能从 GGUF 头里读到字段。可能文件不是
                  GGUF，或是通过外部引用导入的（content://），这类路径 App
                  读不到原始头部。
                </Text>
              ) : (
                metaRows.map(([k, v]) => (
                  <View key={k} style={s.metaRow}>
                    <Text style={s.metaKey}>{k}</Text>
                    <Text style={s.metaVal}>{v}</Text>
                  </View>
                ))
              )}
            </SurfaceCard>
          ) : null}

          <Button
            mode="outlined"
            icon="delete-outline"
            textColor={theme.colors.error}
            onPress={detach}
            style={[
              s.dangerBtn,
              glassButton(theme),
              {borderWidth: 1, borderColor: buttonRing(theme)},
            ]}>
            删除 MMProj
          </Button>
        </>
      ) : (
        <>
          <Button
            mode="contained"
            icon="file-plus-outline"
            loading={importing}
            disabled={importing}
            onPress={importMMProj}
            textColor={theme.colors.primary}
            style={[
              s.primaryBtn,
              glassButton(theme, 'filled'),
              {borderWidth: 1, borderColor: buttonRing(theme)},
            ]}>
            导入 MMProj 文件
          </Button>
          <Button
            mode="text"
            textColor={theme.colors.primary}
            onPress={onPickExisting}
            style={s.pickExistingBtn}>
            从已导入的模型中选择
          </Button>
        </>
      )}
    </View>
  );
});

function formatSize(bytes?: number): string {
  if (!bytes) {
    return '';
  }
  const gb = bytes / 1e9;
  if (gb >= 0.01) {
    return `${gb.toFixed(2)} GB`;
  }
  return `${(bytes / 1e6).toFixed(0)} MB`;
}

const s = StyleSheet.create({
  sessionHint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    // ⚠️ 原来只有 marginTop，警告框**紧贴**下面的 mmproj 卡片，
    // 看起来像两张卡片挤在一起。上下都要留白。
    marginTop: 12,
    marginBottom: 14,
  },
  metaBox: {
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
    gap: 12,
  },
  metaKey: {
    flexShrink: 0,
    fontSize: 11,
    color: '#6b7280',
    fontVariant: ['tabular-nums'],
  },
  metaVal: {
    flex: 1,
    textAlign: 'right',
    fontSize: 11,
    color: '#111827',
    fontVariant: ['tabular-nums'],
  },
  metaText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#6b7280',
  },
  tipBox: {
    // 2026-10-19：蓝色提示框原来上下留白不一致（只有 marginBottom），
    // 和后面的卡片视觉上贴在一起。现在上下各留一段。
    marginTop: 2,
    marginBottom: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(59,130,246,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.22)',
  },
  tipText: {
    opacity: 0.9,
    fontSize: 12,
    lineHeight: 17,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  fileCard: {
    // 底/内边距/圆角由 rowCard 提供，这里只留卡片间距
    marginBottom: 8,
  },
  fileName: {
    marginBottom: 4,
  },
  primaryBtn: {
    borderRadius: 12,
    marginTop: 4,
  },
  pickExistingBtn: {
    marginTop: 4,
    alignSelf: 'center',
  },
  secondaryBtn: {
    borderRadius: 12,
    marginTop: 4,
  },
  dangerBtn: {
    borderRadius: 12,
    marginTop: 10,
  },
});
