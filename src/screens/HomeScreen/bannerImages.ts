/**
 * 主页顶部轮播小卡（问候/模型/云端）的背景图。
 *
 * 本测试版统一使用桌面「5」文件夹里的 3 张 banner 图。
 * 每次翻到某张卡就给它重新随机抽一张图（与另外两张不重复），
 * 所以连续翻页时每张卡显示的都是随机图片。
 *
 * ⚠️ 后续添加更多图片：把文件丢进 ./assets/banner/ 目录，
 *    然后在下面的数组里追加一行 require(...) 即可。
 */
const HOME_BANNER_IMAGES: number[] = [
  require('./assets/banner/banner-1.jpg'),
  require('./assets/banner/banner-2.jpg'),
  require('./assets/banner/banner-3.jpg'),
];

/** 随机返回一张背景图（require 的资源 id），列表为空时返回 null。 */
export const randomHomeBannerImage = (): number | null =>
  HOME_BANNER_IMAGES.length
    ? HOME_BANNER_IMAGES[Math.floor(Math.random() * HOME_BANNER_IMAGES.length)]
    : null;

/**
 * 从背景图池中不重复地抽取 n 张（池子不够 n 张时循环补充，保证返回 n 个值）。
 * 用于让轮播里的多个卡片各自用不同图片。
 */
export const pickDistinctHomeBannerImages = (n: number): (number | null)[] => {
  const pool = [...HOME_BANNER_IMAGES];
  const out: (number | null)[] = [];
  for (let i = 0; i < n; i++) {
    if (pool.length === 0) {
      out.push(
        HOME_BANNER_IMAGES.length
          ? HOME_BANNER_IMAGES[i % HOME_BANNER_IMAGES.length]
          : null,
      );
    } else {
      const idx = Math.floor(Math.random() * pool.length);
      out.push(pool.splice(idx, 1)[0]);
    }
  }
  return out;
};

export {HOME_BANNER_IMAGES};
