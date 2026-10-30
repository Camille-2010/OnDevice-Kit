import {View, TouchableWithoutFeedback, Text} from 'react-native';
import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useContext,
} from 'react';

import {Portal} from 'react-native-paper';
import DeviceInfo from 'react-native-device-info';
import {Svg, Path, Rect, Line} from 'react-native-svg';

import {Surface} from '../ui';
import {useTheme} from '../../hooks';
import {L10nContext} from '../../utils';
import {uiStore} from '../../store';
import {SurfaceCard} from '../GlassSurface';
import {dialogGlassTint} from '../../theme/cards';

import {createStyles} from './styles';

interface MemoryStats {
  totalMemory: number;
  usedMemory: number;
  percentage: number;
}

interface UsageStatsProps {
  width?: number;
  height?: number;
}

export const UsageStats: React.FC<UsageStatsProps> = ({
  width = 40,
  height = 20,
}) => {
  const [memoryHistory, setMemoryHistory] = useState<number[]>([]);
  const [showTooltip, setShowTooltip] = useState(false);
  const [memoryStats, setMemoryStats] = useState<MemoryStats>({
    totalMemory: 0,
    usedMemory: 0,
    percentage: 0,
  });
  const theme = useTheme();
  const l10n = useContext(L10nContext);

  const styles = useMemo(() => createStyles(theme), [theme]);

  const fetchMemoryStats = useCallback(async () => {
    try {
      const total = await DeviceInfo.getTotalMemory();
      const used = await DeviceInfo.getUsedMemory();
      const percentage = (used / total) * 100;
      setMemoryStats({totalMemory: total, usedMemory: used, percentage});
      setMemoryHistory(prev => [...prev.slice(-9), percentage]);
    } catch (error) {
      console.error('Failed to fetch memory stats:', error);
    }
  }, []);

  useEffect(() => {
    fetchMemoryStats();
    const intervalId = setInterval(fetchMemoryStats, 3000);
    return () => clearInterval(intervalId);
  }, [fetchMemoryStats]);

  const generatePath = useCallback(() => {
    if (memoryHistory.length < 2) {
      return '';
    }

    const points = memoryHistory.map((value, index) => {
      const x = (index / (memoryHistory.length - 1)) * width;
      const y = height - (value / 100) * height;
      return `${x},${y}`;
    });

    return `M${points.join(' L')}`;
  }, [memoryHistory, width, height]);

  const formatBytes = useCallback(
    (bytes: number) => {
      if (bytes === 0) {
        return '0 Bytes';
      }
      const k = 1000;
      const sizes = l10n.components.usageStats.byteSizes;
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },
    [l10n.components.usageStats.byteSizes],
  );

  const [menuPosition, setMenuPosition] = useState({x: 0, y: 0});

  const glassTooltip = uiStore.themeStyle === 'liquid-glass';

  const Tooltip = useCallback(() => {
    // 浮窗内容两种风格共用（磨砂玻璃 / 原实底 Surface）。
    // 内容与定位直接在回调内构造，避免每次渲染的新引用污染依赖数组。
    const tooltipBody = (
      <>
        <Text style={styles.tooltipTitle}>
          {l10n.components.usageStats.tooltip.title}
        </Text>
        <Text style={styles.tooltipText}>
          {l10n.components.usageStats.tooltip.used}
          {formatBytes(memoryStats.usedMemory)}
        </Text>
        <Text style={styles.tooltipText}>
          {l10n.components.usageStats.tooltip.total}
          {formatBytes(memoryStats.totalMemory)}
        </Text>
        <Text style={styles.tooltipText}>
          {l10n.components.usageStats.tooltip.usage}
          {memoryStats.percentage.toFixed(1)}%
        </Text>
      </>
    );
    const tooltipPosition = {
      top: menuPosition.y + height,
      left: menuPosition.x - 10,
    };
    return (
      <Portal>
        {glassTooltip ? (
          // 液态玻璃：磨砂玻璃小浮窗（与其他弹窗同一套 tint/blur）。
          // 半透明面板不能带 elevation（阴影会被画进面板内部蒙一层灰）。
          <SurfaceCard
            testID="memory-usage-tooltip"
            style={[styles.tooltip, tooltipPosition, {elevation: 0}]}
            tint={dialogGlassTint(theme)}
            tintOpacity={0.34}
            blur
            blurAmount={50}
            blurRounds={6}
            forceFrosted>
            {tooltipBody}
          </SurfaceCard>
        ) : (
          <Surface
            testID="memory-usage-tooltip"
            style={[styles.tooltip, tooltipPosition]}>
            {tooltipBody}
          </Surface>
        )}
      </Portal>
    );
  }, [
    glassTooltip,
    memoryStats,
    formatBytes,
    styles,
    theme,
    l10n,
    menuPosition,
    height,
  ]);

  const handlePress = useCallback(
    event => {
      event.target.measure(
        (
          x: number,
          y: number,
          w: number,
          h: number,
          pageX: number,
          pageY: number,
        ) => {
          setMenuPosition({x: pageX, y: pageY});
          setShowTooltip(!showTooltip);
        },
      );
    },
    [showTooltip],
  );

  return (
    <View style={styles.container}>
      <TouchableWithoutFeedback
        testID="memory-usage-touchable"
        onPress={handlePress}>
        <View style={{width, height}}>
          <Svg testID="memory-usage-svg" width={width} height={height}>
            <Rect
              x="0"
              y="0"
              width={width}
              height={height}
              fill={theme.colors.backdrop}
              opacity={0.2}
            />

            {[25, 50, 75].map(percent => (
              <Line
                key={percent}
                x1="0"
                y1={height * (1 - percent / 100)}
                x2={width}
                y2={height * (1 - percent / 100)}
                stroke={theme.colors.onSurface}
                strokeWidth="0.5"
                opacity={0.3}
              />
            ))}

            <Path
              d={generatePath()}
              fill="none"
              stroke={theme.colors.error}
              strokeWidth={1.5}
            />
          </Svg>
        </View>
      </TouchableWithoutFeedback>
      {showTooltip && <Tooltip />}
    </View>
  );
};
