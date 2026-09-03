jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
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
  default: { post: jest.fn().mockResolvedValue({}) },
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../constants/theme');
const ResetPasswordScreen = require('../auth/ResetPasswordScreen').default;

const navigation = { navigate: jest.fn(), goBack: jest.fn() };
const route = { params: { email: 'test@example.com' } };

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

test('ResetPasswordScreen renders LIGHT_COLORS background and textSecondary when theme is light', () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(<ResetPasswordScreen navigation={navigation} route={route} />);
  return findByText('Enter your new password below.').then(() => {
    const tree = flattenStyles(toJSON());
    // LIGHT_COLORS.background    = '#FAFAFA' (page base — unique to LIGHT)
    // LIGHT_COLORS.textSecondary = '#000000' (subtitle color — unique to LIGHT)
    // DARK_COLORS.background     = '#07110b' (page base — unique to DARK)
    // DARK_COLORS.textSecondary  = '#A8B4AC' (subtitle color — unique to DARK)
    expect(tree).toContain('FAFAFA');
    expect(tree).toContain('000000');
    expect(tree).not.toContain('07110b');
    expect(tree).not.toContain('A8B4AC');
  });
});

test('ResetPasswordScreen renders DARK_COLORS background and textSecondary when theme is dark', () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(<ResetPasswordScreen navigation={navigation} route={route} />);
  return findByText('Enter your new password below.').then(() => {
    const tree = flattenStyles(toJSON());
    expect(tree).toContain('07110b');
    expect(tree).toContain('A8B4AC');
    expect(tree).not.toContain('FAFAFA');
    expect(tree).not.toContain('5B655F');
  });
});
