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

let mockColors;
let mockTheme;
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme, colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));
jest.mock('../../utils/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn().mockResolvedValue({ requests: [] }) },
}));
jest.mock('../../utils/toast', () => ({ toastApiError: jest.fn() }));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../constants/theme');
const BuyingRequestsScreen = require('../listing/BuyingRequestsScreen').default;

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

test('BuyingRequestsScreen renders LIGHT_COLORS values when theme is light', () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(<BuyingRequestsScreen navigation={navigation} />);
  return findByText('Buying Requests').then(() => {
    const tree = flattenStyles(toJSON());
    // LIGHT_COLORS.background = '#FAFAFA' (page base — unique to LIGHT)
    // LIGHT_COLORS.accent    = '#0B6B4C' (post button background — unique to LIGHT)
    // DARK_COLORS.background = '#07110b' (page base — unique to DARK)
    expect(tree).toContain('FAFAFA');
    expect(tree).toContain('0B6B4C');
    expect(tree).not.toContain('07110b');
    expect(tree).not.toContain('8BD6B4');
  });
});

test('BuyingRequestsScreen renders DARK_COLORS values when theme is dark', () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(<BuyingRequestsScreen navigation={navigation} />);
  return findByText('Buying Requests').then(() => {
    const tree = flattenStyles(toJSON());
    expect(tree).toContain('07110b');
    expect(tree).toContain('8BD6B4');
    expect(tree).not.toContain('FAFAFA');
    expect(tree).not.toContain('0B6B4C');
  });
});
