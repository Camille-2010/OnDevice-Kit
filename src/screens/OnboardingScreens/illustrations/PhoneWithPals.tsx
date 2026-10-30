import React from 'react';
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';

import {useTheme} from '../../../hooks';

export type PhoneWithPalsProps = {
  /** Outer width in RN points; height scales to keep aspect 85:143. */
  width?: number;
};

const ORANGE_1 = '#FFE14D';
const ORANGE_2 = '#FFA823';
const CLOUD = '#4F8CFF';

/**
 * Screen 2 illustration — phone outline (theme-aware) holding an
 * on-device AI orb, with a cloud above it connected by a dashed line,
 * plus two on-device "cores". Conveys OnDevice Kit's "local + cloud"
 * story in the app's warm-orange / cool-blue brand palette.
 *
 * Visual contract:
 *   - Aspect 85:143 (matches the scaffold slot).
 *   - Phone frame uses theme tokens so it adapts to light/dark.
 *   - Brand gradient for the on-device orb; blue for the cloud.
 */
export const PhoneWithPals: React.FC<PhoneWithPalsProps> = ({width = 85}) => {
  const theme = useTheme();
  const viewBoxW = 85;
  const viewBoxH = 143;
  const height = (width * viewBoxH) / viewBoxW;
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${viewBoxW} ${viewBoxH}`}>
      <Defs>
        <LinearGradient
          id="odkOrb"
          x1="26"
          y1="64"
          x2="58"
          y2="96"
          gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={ORANGE_1} />
          <Stop offset="1" stopColor={ORANGE_2} />
        </LinearGradient>
      </Defs>

      {/* Phone outline — rounded rect with thick dark border + notch. */}
      <Rect
        x={3.4}
        y={3.4}
        width={viewBoxW - 6.8}
        height={viewBoxH - 6.8}
        rx={16}
        ry={16}
        fill={theme.colors.background}
        stroke={theme.colors.onBackground}
        strokeWidth={6.83}
      />
      <Rect
        x={(viewBoxW - 22) / 2}
        y={5}
        width={22}
        height={6}
        rx={3}
        ry={3}
        fill={theme.colors.onBackground}
      />

      {/* Cloud (cloud capability). */}
      <G fill={CLOUD}>
        <Circle cx={34} cy={40} r={9} />
        <Circle cx={46} cy={34} r={11} />
        <Circle cx={55} cy={41} r={8} />
        <Rect x={30} y={40} width={28} height={11} rx={5.5} />
      </G>

      {/* Connector: cloud -> on-device orb. */}
      <Line
        x1={42}
        y1={53}
        x2={42}
        y2={62}
        stroke={theme.colors.onBackground}
        strokeWidth={1.4}
        strokeDasharray="2 2.4"
      />

      {/* On-device AI orb. */}
      <Circle cx={42} cy={80} r={16} fill="url(#odkOrb)" />
      <Path
        d="M42 70 L44.6 77.4 L52 80 L44.6 82.6 L42 90 L39.4 82.6 L32 80 L39.4 77.4 Z"
        fill="#FFFFFF"
      />

      {/* Two on-device cores. */}
      <Circle cx={21} cy={104} r={7} fill="url(#odkOrb)" />
      <Circle cx={63} cy={104} r={7} fill="url(#odkOrb)" />
    </Svg>
  );
};
