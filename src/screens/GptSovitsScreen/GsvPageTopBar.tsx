import React from 'react';

import {SubHeader} from '../../components/SubHeader';

/**
 * GPT-SoVITS 内部二级页（原生 PyTorch / Mini ONNX / 角色包商城）的顶部栏。
 *
 * 直接复用全 App 统一的 `SubHeader`（SurfaceCard 真玻璃 + 同款几何 + 流光光效），
 * 保证和主页顶栏、其它二级页顶栏是完全同一块玻璃，不再各写一套半透明实底。
 *
 * 仍放在页面 ScrollView 内作为第一个子元素，向上翻页时跟着内容一起滚走。
 */
export const GsvPageTopBar: React.FC<{title: string; onBack: () => void}> = ({
  title,
  onBack,
}) => <SubHeader title={title} onBack={onBack} />;

export default GsvPageTopBar;
