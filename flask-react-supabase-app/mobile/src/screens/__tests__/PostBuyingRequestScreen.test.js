// Polyfill window.dispatchEvent so React Native's reportGlobalError doesn't crash
// Node when state updates trigger an act() warning during teardown.
if (typeof global.window !== 'undefined' && !global.window.dispatchEvent) {
  global.window.dispatchEvent = () => true;
}

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success' },
}));
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: React.forwardRef((props, ref) => React.createElement(View, { ...props, ref })),
  };
});

jest.mock('../../components/ui/PressableScale', () => {
  const React = require('react');
  const ReactNative = require('react-native');
  const PressableScale = React.forwardRef((props, ref) =>
    React.createElement(ReactNative.View, { ...props, ref })
  );
  return { __esModule: true, default: PressableScale };
});
jest.mock('../../components/ui/ScreenEntrance', () => {
  const React = require('react');
  const { View } = require('react-native');
  const ScreenEntrance = ({ children }) => React.createElement(View, null, children);
  return { __esModule: true, default: ScreenEntrance };
});

let mockColors;
let mockTheme;
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));
jest.mock('../../utils/apiClient', () => ({
  __esModule: true,
  default: { post: jest.fn().mockResolvedValue({}) },
}));
jest.mock('../../utils/toast', () => ({
  toastApiError: jest.fn(),
  showSuccess: jest.fn(),
  showError: jest.fn(),
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../constants/theme');
const PostBuyingRequestScreen = require('../listing/PostBuyingRequestScreen').default;

const navigation = { navigate: jest.fn(), goBack: jest.fn() };

const flattenStyles = (node) => {
  if (!node) return '';
  let out = '';
  if (node.props && node.props.style) {
    const style = Array.isArray(node.props.style)
      ? Object.assign({}, ...node.props.style.flat().filter(Boolean))
      : node.props.style;
    out += ' ' + JSON.stringify(style);
  }
  if (Array.isArray(node.children)) {
    out += node.children.map(flattenStyles).join('');
  } else if (node.children) {
    out += flattenStyles(node.children);
  }
  return out;
};

test('PostBuyingRequestScreen renders LIGHT_COLORS values when theme is light', () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(<PostBuyingRequestScreen navigation={navigation} />);
  // LIGHT_COLORS.background = '#FAFAFA' (page base — unique to LIGHT)
  // LIGHT_COLORS.surface    = '#FFFFFF' (input fields — note: also matches DARK textPrimary but unique as a surface)
  // LIGHT_COLORS.accent     = '#0B6B4C' (submit button)
  // DARK_COLORS.background  = '#07110b' (UNIQUE to DARK)
  findByText('Post a Buying Request');
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('FAFAFA');
  expect(tree).toContain('FFFFFF');
  expect(tree).toContain('0B6B4C');
  expect(tree).not.toContain('07110b');
  expect(tree).not.toContain('8BD6B4');
});

test('PostBuyingRequestScreen renders DARK_COLORS values when theme is dark', () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(<PostBuyingRequestScreen navigation={navigation} />);
  findByText('Post a Buying Request');
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('07110b');
  expect(tree).toContain('0C1C13');
  expect(tree).toContain('8BD6B4');
  expect(tree).not.toContain('FAFAFA');
  expect(tree).not.toContain('0B6B4C');
});
