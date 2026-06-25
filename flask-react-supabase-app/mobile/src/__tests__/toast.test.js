import { showError, showSuccess, showInfo, showToast } from '../utils/toast';
import Toast from 'react-native-toast-message';

jest.mock('react-native-toast-message', () => ({ show: jest.fn() }));

afterEach(() => jest.clearAllMocks());

test('showError calls Toast.show with type error', () => {
  showError('Title', 'Message');
  expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', text1: 'Title', text2: 'Message' }));
});

test('showSuccess calls Toast.show with type success', () => {
  showSuccess('Done');
  expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'success', text1: 'Done' }));
});

test('showInfo calls Toast.show with type info', () => {
  showInfo('Info');
  expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }));
});

test('showToast with null type uses info', () => {
  showToast(null, 'Hi');
  expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }));
});
