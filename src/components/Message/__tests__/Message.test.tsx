import {render, within} from '@testing-library/react-native';
import * as React from 'react';

import {derivedTextMessage} from '../../../../jest/fixtures';
import {Message} from '../Message';

describe('message', () => {
  it('renders undefined in ContentContainer', () => {
    expect.assertions(2);
    const {getByTestId} = render(
      <Message
        message={{...derivedTextMessage, type: 'custom'}}
        messageWidth={440}
        onMessagePress={jest.fn}
        roundBorder
        showAvatar
        showName
        showStatus
      />,
    );
    const ContentContainer = getByTestId('ContentContainer');
    expect(ContentContainer).toBeDefined();
    // MIUIX（rounded）风格下 SurfaceCard 渲染玻璃结构，testID 落在外层
    // 触摸容器上，children 是动画包装层而不是消息内容本身。
    // 这里校验容器内没有任何文本渲染（意图不变：不支持的消息不出内容）。
    expect(within(ContentContainer).queryAllByText(/./)).toHaveLength(0);
  });

  it('renders undefined in ContentContainer with wrong message type', () => {
    expect.assertions(2);
    const {getByTestId} = render(
      <Message
        message={{...derivedTextMessage, type: 'unsupported'}}
        messageWidth={440}
        onMessagePress={jest.fn}
        roundBorder
        showAvatar
        showName
        showStatus
      />,
    );
    const ContentContainer = getByTestId('ContentContainer');
    expect(ContentContainer).toBeDefined();
    expect(within(ContentContainer).queryAllByText(/./)).toHaveLength(0);
  });
});
