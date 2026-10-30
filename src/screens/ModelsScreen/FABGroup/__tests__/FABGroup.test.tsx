import React from 'react';

import {fireEvent} from '@testing-library/react-native';

import {render} from '../../../../../jest/test-utils';
import {FABGroup} from '../FABGroup';

// 自定义玻璃 FAB 菜单：收起时动作项不挂载，点 fab-toggle 展开后才可查询。
// 「从 Hugging Face 添加」入口已移除（HF 搜索改从模型页空态的「推荐模型 →」
// 路由进入），这里只覆盖 本地 / 远端 / 管理服务器 三个动作。

describe('FABGroup', () => {
  const mockOnAddLocalModel = jest.fn();
  const mockOnAddRemoteModel = jest.fn();
  const mockOnManageServers = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const renderGroup = (
    props: Partial<React.ComponentProps<typeof FABGroup>> = {},
  ) =>
    render(
      <FABGroup
        onAddLocalModel={mockOnAddLocalModel}
        onAddRemoteModel={mockOnAddRemoteModel}
        {...props}
      />,
      {withNavigation: true},
    );

  const openMenu = (getByTestId: (id: string) => any) => {
    fireEvent.press(getByTestId('fab-toggle'));
  };

  it('renders the FAB group', () => {
    const {getByTestId} = renderGroup();
    expect(getByTestId('fab-group')).toBeTruthy();
  });

  it('keeps actions unmounted until the menu is opened', () => {
    const {getByTestId, queryByTestId} = renderGroup();
    // 收起状态：菜单项不挂载
    expect(queryByTestId('local-fab')).toBeNull();
    expect(queryByTestId('remote-fab')).toBeNull();

    openMenu(getByTestId);
    expect(getByTestId('local-fab')).toBeTruthy();
    expect(getByTestId('remote-fab')).toBeTruthy();
  });

  it('renders accessibility labels for local + remote actions', () => {
    const {getByTestId, getByLabelText} = renderGroup();
    openMenu(getByTestId);

    expect(getByLabelText('Add Local Model')).toBeTruthy();
    expect(getByLabelText('Add Remote Model')).toBeTruthy();
  });

  it('calls the handlers when actions are pressed', () => {
    const {getByTestId} = renderGroup();
    openMenu(getByTestId);

    fireEvent.press(getByTestId('local-fab'));
    expect(mockOnAddLocalModel).toHaveBeenCalledTimes(1);

    fireEvent.press(getByTestId('remote-fab'));
    expect(mockOnAddRemoteModel).toHaveBeenCalledTimes(1);
  });

  it('shows the manage-servers action only when servers exist', () => {
    const {getByTestId, queryByTestId} = renderGroup();
    openMenu(getByTestId);
    expect(queryByTestId('manage-servers-fab')).toBeNull();

    const {getByTestId: get2, queryByTestId: query2} = renderGroup({
      hasServers: true,
      onManageServers: mockOnManageServers,
    });
    openMenu(get2);
    expect(query2('manage-servers-fab')).toBeTruthy();

    fireEvent.press(get2('manage-servers-fab'));
    expect(mockOnManageServers).toHaveBeenCalledTimes(1);
  });
});
