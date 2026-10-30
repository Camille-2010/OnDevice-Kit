import * as RNFS from '@dr.pogodin/react-native-fs';

import {persistPickedImage, persistPickedImages} from '../imageStorage';

describe('imageStorage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('copies a content:// uri into the private vision dir', async () => {
    const uri = 'content://media/external/images/media/42';

    const result = await persistPickedImage(uri);

    expect(RNFS.copyFile).toHaveBeenCalledWith(
      uri,
      expect.stringContaining('/path/to/documents/vision/vision_'),
    );
    // 必须返回 file:// 路径：mtmd / llama.rn 只认真实文件路径。
    expect(result).toMatch(
      /^file:\/\/\/path\/to\/documents\/vision\/vision_\d+_\d+\.jpg$/,
    );
  });

  it('keeps the original image extension', async () => {
    const result = await persistPickedImage('content://x/photo.PNG');

    expect(result.endsWith('.png')).toBe(true);
  });

  it('creates the vision directory when it does not exist', async () => {
    (RNFS.exists as jest.Mock).mockResolvedValueOnce(false);

    await persistPickedImage('content://x/a.jpg');

    expect(RNFS.mkdir).toHaveBeenCalledWith('/path/to/documents/vision');
  });

  it('throws a readable error when the copy fails', async () => {
    (RNFS.copyFile as jest.Mock).mockRejectedValueOnce(new Error('EACCES'));

    await expect(persistPickedImage('content://x/a.jpg')).rejects.toThrow(
      /图片转存失败/,
    );
  });

  it('persists multiple images with unique destinations', async () => {
    const results = await persistPickedImages([
      'content://x/1.jpg',
      'content://x/2.png',
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].endsWith('.jpg')).toBe(true);
    expect(results[1].endsWith('.png')).toBe(true);
    expect(new Set(results).size).toBe(2);
  });
});
