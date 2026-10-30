import React from 'react';
import {Alert} from 'react-native';

import * as RNFS from '@dr.pogodin/react-native-fs';
import {pick} from '@react-native-documents/picker';
import {
  fireEvent,
  render as baseRender,
  waitFor,
  act,
} from '../../../../jest/test-utils';

import {ModelsScreen} from '../ModelsScreen';

import {modelStore, uiStore} from '../../../store';
import {
  basicModel,
  downloadedModel,
  hfModel1,
  hfModel2,
} from '../../../../jest/fixtures/models';

const render = (ui: React.ReactElement, options: any = {}) =>
  baseRender(ui, {
    withBottomSheetProvider: true,
    withNavigation: true,
    ...options,
  });

jest.useFakeTimers();

describe('ModelsScreen', () => {
  beforeEach(() => {
    //(useTheme as jest.Mock).mockReturnValue(mockTheme);
    jest.clearAllMocks();
  });

  it('renders correctly', async () => {
    const {getByTestId} = render(<ModelsScreen />);
    expect(getByTestId('flat-list')).toBeTruthy();
    expect(getByTestId('fab-group')).toBeTruthy();
  });

  it('refreshes models on pull-to-refresh', async () => {
    const {getByTestId} = render(<ModelsScreen />);

    const flatList = getByTestId('flat-list');
    const refreshControl = flatList.props.refreshControl;
    await act(async () => {
      refreshControl.props.onRefresh();
    });

    expect(modelStore.refreshDownloadStatuses).toHaveBeenCalled();
  });

  it('adds a local model when the plus FAB is pressed', async () => {
    (pick as jest.Mock).mockResolvedValue([
      {
        uri: '/mock/file/path',
        name: 'mockModelFile.bin',
      },
    ]);

    // Mock RNFS.exists to return false for the destination path so no alert is shown
    (RNFS.exists as jest.Mock).mockImplementation(async (path: string) => {
      if (path.includes('/path/to/documents/models/local/mockModelFile.bin')) {
        return false; // File doesn't exist, so no alert will be shown
      }
      return true; // Other paths exist by default
    });

    const {getByTestId} = render(<ModelsScreen />);

    // Open the FAB group
    fireEvent.press(getByTestId('fab-toggle'));

    // Wait for the FAB group to open and its children to be accessible
    await waitFor(() => {
      const localFab = getByTestId('local-fab', {includeHiddenElements: true});
      expect(localFab).toBeTruthy();
    });
    const addLocalModelButton = getByTestId('local-fab', {
      includeHiddenElements: true,
    });

    await act(async () => {
      if (addLocalModelButton) {
        fireEvent.press(addLocalModelButton);
      }
    });

    // 新流程：点「添加本地模型」后先弹导入方式选择框，这些用例走「复制导入」分支
    const copyChoice = await waitFor(() => getByTestId('import-method-copy'));
    await act(async () => {
      fireEvent.press(copyChoice);
    });

    await waitFor(() => {
      expect(pick).toHaveBeenCalled();
      expect(RNFS.copyFile).toHaveBeenCalledWith(
        '/mock/file/path',
        '/path/to/documents/models/local/mockModelFile.bin',
      );
      expect(modelStore.addLocalModel).toHaveBeenCalledWith(
        '/path/to/documents/models/local/mockModelFile.bin',
      );
    });
  });

  it('shows a confirmation alert if file already exists and replaces it', async () => {
    (RNFS.exists as jest.Mock).mockResolvedValue(true);
    (pick as jest.Mock).mockResolvedValue([
      {
        uri: '/mock/file/path',
        name: 'mockModelFile.bin',
      },
    ]);

    jest.spyOn(Alert, 'alert').mockImplementation((_, __, buttons) => {
      buttons![0].onPress!();
    });

    const {getByTestId} = render(<ModelsScreen />);

    // Open the FAB group
    fireEvent.press(getByTestId('fab-toggle'));

    // Wait for the FAB group to open and its children to be accessible
    await waitFor(() => {
      const localFab = getByTestId('local-fab', {includeHiddenElements: true});
      expect(localFab).toBeTruthy();
    });
    const addLocalModelButton = getByTestId('local-fab', {
      includeHiddenElements: true,
    });

    await act(async () => {
      fireEvent.press(addLocalModelButton);
    });

    // 新流程：点「添加本地模型」后先弹导入方式选择框，这些用例走「复制导入」分支
    const copyChoice = await waitFor(() => getByTestId('import-method-copy'));
    await act(async () => {
      fireEvent.press(copyChoice);
    });

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalled();
      expect(RNFS.unlink).toHaveBeenCalledWith(
        '/path/to/documents/models/local/mockModelFile.bin',
      );
      expect(modelStore.removeModelByFullPath).toHaveBeenCalledWith(
        '/path/to/documents/models/local/mockModelFile.bin',
      );
      expect(RNFS.copyFile).toHaveBeenCalled();
      expect(modelStore.addLocalModel).toHaveBeenCalled();
    });
  });

  it('does not replace or copy the file when user cancels the action', async () => {
    (RNFS.exists as jest.Mock).mockResolvedValue(true);
    (pick as jest.Mock).mockResolvedValue([
      {
        uri: '/mock/file/path',
        name: 'mockModelFile.bin',
      },
    ]);

    jest.spyOn(Alert, 'alert').mockImplementation((_, __, buttons) => {
      // pressing "Cancel"
      buttons![2].onPress!();
    });

    const {getByTestId} = render(<ModelsScreen />);
    // Open the FAB group
    fireEvent.press(getByTestId('fab-toggle'));

    // Wait for the FAB group to open and its children to be accessible
    await waitFor(() => {
      const localFab = getByTestId('local-fab', {includeHiddenElements: true});
      expect(localFab).toBeTruthy();
    });
    const addLocalModelButton = getByTestId('local-fab', {
      includeHiddenElements: true,
    });

    await act(async () => {
      fireEvent.press(addLocalModelButton);
    });

    // 新流程：点「添加本地模型」后先弹导入方式选择框，这些用例走「复制导入」分支
    const copyChoice = await waitFor(() => getByTestId('import-method-copy'));
    await act(async () => {
      fireEvent.press(copyChoice);
    });

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalled();
      expect(RNFS.unlink).not.toHaveBeenCalled(); // File should not be unlinked (deleted)
      expect(RNFS.copyFile).not.toHaveBeenCalled(); // File should not be copied
      expect(modelStore.addLocalModel).not.toHaveBeenCalled(); // Model should not be added
    });
  });

  it('keeps both files when user chooses to keep both', async () => {
    (RNFS.exists as jest.Mock).mockResolvedValueOnce(true); // File already exists
    (pick as jest.Mock).mockResolvedValue([
      {
        uri: '/mock/file/path',
        name: 'mockModelFile.bin',
      },
    ]);

    jest.spyOn(Alert, 'alert').mockImplementation((_, __, buttons) => {
      // pressing "Keep Both"
      buttons![1].onPress!();
    });

    let counter = 1;
    (RNFS.exists as jest.Mock).mockImplementation(async path => {
      if (path.includes(`mockModelFile_${counter}.bin`)) {
        return false; // Ensure new file doesn't exist
      }
      return true; // Original file exists
    });

    const {getByTestId} = render(<ModelsScreen />);

    // Open the FAB group
    fireEvent.press(getByTestId('fab-toggle'));

    // Wait for the FAB group to open and its children to be accessible
    await waitFor(() => {
      const localFab = getByTestId('local-fab', {includeHiddenElements: true});
      expect(localFab).toBeTruthy();
    });
    const addLocalModelButton = getByTestId('local-fab', {
      includeHiddenElements: true,
    });

    await act(async () => {
      fireEvent.press(addLocalModelButton);
    });

    // 新流程：点「添加本地模型」后先弹导入方式选择框，这些用例走「复制导入」分支
    const copyChoice = await waitFor(() => getByTestId('import-method-copy'));
    await act(async () => {
      fireEvent.press(copyChoice);
    });

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalled();
      expect(RNFS.unlink).not.toHaveBeenCalled(); // Original file should not be deleted
      expect(RNFS.copyFile).toHaveBeenCalledWith(
        '/mock/file/path',
        `/path/to/documents/models/local/mockModelFile_${counter}.bin`,
      );
      expect(modelStore.addLocalModel).toHaveBeenCalledWith(
        `/path/to/documents/models/local/mockModelFile_${counter}.bin`,
      );
    });
  });

  it('shows a copying snackbar while file is being copied', async () => {
    let resolveCopy!: () => void;
    (RNFS.copyFile as jest.Mock).mockImplementation(
      () =>
        new Promise<void>(resolve => {
          resolveCopy = resolve;
        }),
    );
    (RNFS.exists as jest.Mock).mockImplementation(async (path: string) => {
      if (path.includes('models/local')) {
        return false;
      }
      return true;
    });
    (pick as jest.Mock).mockResolvedValue([
      {uri: '/mock/file/path', name: 'mockModelFile.bin'},
    ]);

    const {getByTestId} = render(<ModelsScreen />);

    // Open FAB, press local
    fireEvent.press(getByTestId('fab-toggle'));
    await waitFor(() => {
      expect(
        getByTestId('local-fab', {includeHiddenElements: true}),
      ).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByTestId('local-fab', {includeHiddenElements: true}));
    });
    // 新流程：先选导入方式，这些用例走「复制导入」分支
    const copyChoice = await waitFor(() => getByTestId('import-method-copy'));
    await act(async () => {
      fireEvent.press(copyChoice);
    });

    // Snackbar should be visible while copy is pending
    await waitFor(() => {
      expect(getByTestId('copy-model-snackbar')).toBeTruthy();
    });

    // Resolve the copy
    await act(async () => {
      resolveCopy();
    });
  });

  it('shows an error alert when copy fails', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    (RNFS.copyFile as jest.Mock).mockRejectedValue(new Error('Disk full'));
    (RNFS.exists as jest.Mock).mockImplementation(async (path: string) => {
      if (path.includes('models/local')) {
        return false;
      }
      return true;
    });
    (pick as jest.Mock).mockResolvedValue([
      {uri: '/mock/file/path', name: 'mockModelFile.bin'},
    ]);

    const {getByTestId} = render(<ModelsScreen />);

    fireEvent.press(getByTestId('fab-toggle'));
    await waitFor(() => {
      expect(
        getByTestId('local-fab', {includeHiddenElements: true}),
      ).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByTestId('local-fab', {includeHiddenElements: true}));
    });
    // 新流程：先选导入方式，这些用例走「复制导入」分支
    const copyChoice = await waitFor(() => getByTestId('import-method-copy'));
    await act(async () => {
      fireEvent.press(copyChoice);
    });

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(expect.any(String), 'Disk full');
    });
  });

  it('prevents double-tap by ignoring second add while copy is in progress', async () => {
    // First call: copy never resolves so isCopyingModel stays true
    (RNFS.copyFile as jest.Mock).mockImplementation(
      () => new Promise<void>(() => {}),
    );
    (RNFS.exists as jest.Mock).mockImplementation(async (path: string) => {
      if (path.includes('models/local')) {
        return false;
      }
      return true;
    });
    (pick as jest.Mock).mockResolvedValue([
      {uri: '/mock/file/path', name: 'mockModelFile.bin'},
    ]);

    const {getByTestId, queryByTestId} = render(<ModelsScreen />);

    // Open FAB and press local to start the first copy
    fireEvent.press(getByTestId('fab-toggle'));
    await waitFor(() => {
      expect(
        getByTestId('local-fab', {includeHiddenElements: true}),
      ).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByTestId('local-fab', {includeHiddenElements: true}));
    });
    // 新流程：先选导入方式，这些用例走「复制导入」分支
    const copyChoice = await waitFor(() => getByTestId('import-method-copy'));
    await act(async () => {
      fireEvent.press(copyChoice);
    });

    // Verify first copy started
    await waitFor(() => {
      expect(pick).toHaveBeenCalledTimes(1);
    });

    // Reset pick mock to detect if it gets called again
    (pick as jest.Mock).mockClear();

    // Try to press local FAB again while copy is in progress.
    // 菜单在按下动作项后仍然开着（不自动收起），直接再按一次即可。
    await waitFor(() => {
      expect(
        getByTestId('local-fab', {includeHiddenElements: true}),
      ).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByTestId('local-fab', {includeHiddenElements: true}));
    });

    // 第二次按压被 isCopyingModel 守卫拦下：导入方式框不会重新弹出，
    // pick 也不会被第二次调用。
    expect(queryByTestId('import-method-copy')).toBeNull();
    expect(pick).not.toHaveBeenCalled();
  });

  // Add tests for model filtering and grouping
  describe('Model filtering and grouping', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      // Set up mock models
      modelStore.models = [downloadedModel, basicModel, hfModel1, hfModel2];
      // 分组展开状态是共享的 observable mock 状态：前面的用例（如 HF
      // 过滤）会点开「推荐模型」，不重置会污染后面的展开/收起用例。
      uiStore.pageStates.modelsScreen.expandedGroups = {ready_to_use: true};
    });

    it('should filter downloaded models when downloaded filter is active', async () => {
      uiStore.pageStates.modelsScreen.filters = ['downloaded'];

      const {getByText, queryByText} = render(<ModelsScreen />);

      await waitFor(() => {
        expect(getByText('downloaded model')).toBeTruthy();
        expect(queryByText('basic model')).toBeNull();
      });
    });

    it('should filter HF models when HF filter is active', async () => {
      uiStore.pageStates.modelsScreen.filters = ['hf'];

      const {getByText, queryByText, getAllByText} = render(<ModelsScreen />);

      // Open the Recommended Models group, since hf mocked models are not downloaded.
      const button = getByText('Recommended Models');
      fireEvent.press(button);

      await waitFor(() => {
        // Use getAllByText to get all instances and check the first one exists
        const modelNames = getAllByText('hf-model-name-1');
        expect(modelNames.length).toBeGreaterThan(0);
        expect(queryByText('basic model')).toBeNull();
      });
    });

    it('should group models by type when grouped filter is active', async () => {
      uiStore.pageStates.modelsScreen.filters = ['grouped'];

      const {getByText} = render(<ModelsScreen />);

      await waitFor(() => {
        expect(getByText('Test Model Type')).toBeTruthy();
      });
    });

    it('should group models into ready-to-use and available-to-download when not grouped', async () => {
      uiStore.pageStates.modelsScreen.filters = [];

      const {getByText} = render(<ModelsScreen />);

      await waitFor(() => {
        expect(getByText('Ready to Use')).toBeTruthy();
        expect(getByText('Recommended Models')).toBeTruthy();
      });
    });

    it('should handle group expansion and collapse', async () => {
      uiStore.pageStates.modelsScreen.filters = [];

      const {getByText, queryByText} = render(<ModelsScreen />);

      // Not downloaded model should not be visible
      await waitFor(() => {
        expect(queryByText('basic model')).toBeNull();
      });

      const availableGroup = getByText('Recommended Models');
      fireEvent.press(availableGroup);

      // 本文件模块级 useFakeTimers()：waitFor 的重试 interval 在假 timer
      // 下不会自己走，press 后的重渲染要显式推进 timer。
      act(() => {
        jest.advanceTimersByTime(300);
      });

      // Not downloaded model should be visible after expanding the group
      expect(getByText('basic model')).toBeTruthy();
    });
  });
});
