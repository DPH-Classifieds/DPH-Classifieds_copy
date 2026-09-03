jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success' },
}));
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  launchImageLibraryAsync: jest.fn().mockResolvedValue({ canceled: true }),
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
  useTheme: () => ({
    theme: mockTheme || 'light',
    colors: mockColors,
    setTheme: jest.fn(),
    toggleTheme: jest.fn(),
  }),
}));
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    updateUser: jest.fn(),
    syncWithSupabase: jest.fn(),
  }),
}));
jest.mock('../../utils/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn().mockResolvedValue({}), put: jest.fn().mockResolvedValue({}), post: jest.fn().mockResolvedValue({}) },
}));

import React from 'react';
import { render } from '@testing-library/react-native';
const SettingsScreen = require('../profile/SettingsScreen').default;
const { LIGHT_COLORS, DARK_COLORS } = require('../../constants/theme');

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

test('light mode: page bg is light (FAFAFA from background token), not dark text color', () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON } = render(<SettingsScreen navigation={{}} />);
  const tree = flattenStyles(toJSON());
  expect(tree).toMatch(/backgroundColor[^,}]*FAFAFA/);
  expect(tree).not.toMatch(/backgroundColor[^,}]*#0[Ee]1512/);
});

test('light mode: page text uses dark text (textPrimary), not pure white', () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON } = render(<SettingsScreen navigation={{}} />);
  const tree = flattenStyles(toJSON());
  expect(tree).toMatch(/"color":"#0[Ee]1512"/);
});

test('dark mode: page bg is dark (07110b), preserves dark aesthetic', () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON } = render(<SettingsScreen navigation={{}} />);
  const tree = flattenStyles(toJSON());
  expect(tree).toMatch(/backgroundColor[^,}]*07110b/);
});