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

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../constants/theme');
const CheckEmailScreen = require('../auth/CheckEmailScreen').default;

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

test('CheckEmailScreen renders LIGHT_COLORS.accent and textSecondary when theme is light', () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(<CheckEmailScreen navigation={navigation} route={route} />);
  return findByText('Check Your Email').then(() => {
    const tree = flattenStyles(toJSON());
    // LIGHT_COLORS.accent       = '#0B6B4C' (email text + stepNumber bg — unique to LIGHT)
    // LIGHT_COLORS.textSecondary = '#5B655F' (step text — unique to LIGHT)
    // DARK_COLORS.accent        = '#8BD6B4' (bright mint — unique to DARK)
    // DARK_COLORS.textSecondary = '#A8B4AC' (silver — unique to DARK)
    // (safeArea/container backgrounds are hardcoded '#000000' so we don't assert on background)
    expect(tree).toContain('0B6B4C');
    expect(tree).toContain('5B655F');
    expect(tree).not.toContain('8BD6B4');
    expect(tree).not.toContain('A8B4AC');
  });
});

test('CheckEmailScreen renders DARK_COLORS.accent and textSecondary when theme is dark', () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(<CheckEmailScreen navigation={navigation} route={route} />);
  return findByText('Check Your Email').then(() => {
    const tree = flattenStyles(toJSON());
    expect(tree).toContain('8BD6B4');
    expect(tree).toContain('A8B4AC');
    expect(tree).not.toContain('0B6B4C');
    expect(tree).not.toContain('5B655F');
  });
});
