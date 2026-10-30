import React, {useContext, useEffect, useState} from 'react';

/**
 * 「我所在的这一页现在是不是前台页」。
 *
 * 背景：为了消灭切 Tab 时的 mount 抖动，MainTabs 会把访问过的页面全部
 * 常驻挂载（隐藏但活着）。于是同一时刻存在多个页面实例，而入场动画
 * （Entrance）是靠 uiStore.screenEpochByKey 广播重播的 —— 不加区分的话，
 * 切一次 Tab 会让所有页面的所有区块同时建动画、同时跑，其中后台页面
 * 用户根本看不见，纯属浪费，而且正是「卡一下」的来源之一。
 *
 * 有了这个 Context，Entrance 只在自己这一页处于前台时才播动画；
 * 后台页直接停在完成态（progress = 1），等它切换到前台再重新播放。
 */
const ScreenActiveContext = React.createContext(true);

export const ScreenActiveProvider: React.FC<{
  active: boolean;
  children: React.ReactNode;
}> = ({active, children}) => (
  <ScreenActiveContext.Provider value={active}>
    {children}
  </ScreenActiveContext.Provider>
);

/** 当前所在的页面是否在前台。未包裹 Provider 时默认 true（普通页面不受影响）。 */
export const useScreenActive = () => useContext(ScreenActiveContext);

/**
 * 二级页进场专用：比 ScreenActiveProvider 多等一帧。
 *
 * 场景：二级页（音色转换 / GPT-SoVITS / 语音克隆…）是**动态挂载**的，
 * 切过去那一刻要同时做完：整棵组件树 mount + FlatList 首屏布局 +
 * 几十个 Entrance 建动画节点并 start。低端机上这一帧直接爆掉，
 * 表现就是「进二级页卡一下，甚至点好几次才进得去」。
 *
 * 做法：active 变 true 后不立刻下发，而是等**两帧**（requestAnimationFrame
 * 套一层）再置 true。这两帧里 Entrance 全部停在完成态（progress = 1），
 * 页面以「静态成品」的形式先画出来；等首屏布局稳了，再统一播入场动画。
 * 用户看到的是「页面先出来，内容再轻轻浮上来」，不再卡。
 *
 * 代价：入场动画晚约 32ms 才开始 —— 肉眼几乎察觉不到，远比卡一下划算。
 */
export const ScreenActiveProviderDeferred: React.FC<{
  active: boolean;
  children: React.ReactNode;
}> = ({active, children}) => {
  const [deferred, setDeferred] = useState(active);

  useEffect(() => {
    if (!active) {
      setDeferred(false);
      return;
    }
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      // 再套一层：第一帧给 React 提交 + 原生布局，第二帧才放行动画
      raf2 = requestAnimationFrame(() => setDeferred(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [active]);

  return (
    <ScreenActiveContext.Provider value={deferred}>
      {children}
    </ScreenActiveContext.Provider>
  );
};
