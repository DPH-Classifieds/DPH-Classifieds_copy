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
jest.mock('../../utils/pushNotifications', () => ({
  isPushEnabledPref: jest.fn().mockResolvedValue(true),
  setPushEnabledPref: jest.fn().mockResolvedValue(undefined),
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../constants/theme');
const SettingsScreen = require('../profile/SettingsScreen').default;

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

test('SettingsScreen renders LIGHT_COLORS values when theme is light', async () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(<SettingsScreen navigation={navigation} />);
  await findByText('Appearance');
  // LIGHT_COLORS.accent = '#0B6B4C' (Appearance segmented active bg).
  // LIGHT_COLORS.textMuted = '#000000' (description under "Appearance").
  // DARK_COLORS.accent = '#8BD6B4'.
  // DARK_COLORS.textMuted = 'rgba(168,180,172,0.6)'.
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('0B6B4C');
  expect(tree).toContain('000000');
  expect(tree).not.toContain('8BD6B4');
  expect(tree).not.toContain('168,180,172,0.6');
});

test('SettingsScreen renders DARK_COLORS values when theme is dark', async () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(<SettingsScreen navigation={navigation} />);
  await findByText('Appearance');
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('8BD6B4');
  expect(tree).toContain('168,180,172,0.6');
  expect(tree).not.toContain('0B6B4C');
  expect(tree).not.toContain('91,101,95,0.65');
});
