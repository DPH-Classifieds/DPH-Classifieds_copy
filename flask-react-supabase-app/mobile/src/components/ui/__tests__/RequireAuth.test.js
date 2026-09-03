jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));

let mockColors;
let mockTheme;
jest.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../../constants/theme');
const RequireAuth = require('../RequireAuth').default;

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

test('RequireAuth renders LIGHT_COLORS values when theme is light', () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(
    <RequireAuth><Text>protected</Text></RequireAuth>
  );
  return findByText('Sign in Required').then(() => {
    const tree = flattenStyles(toJSON());
    // LIGHT_COLORS.accent = '#0B6B4C' (login button bg) — UNIQUE to LIGHT
    // LIGHT_COLORS.black = '#0E1512' (container bg) — UNIQUE to LIGHT
    expect(tree).toContain('0B6B4C');
    expect(tree).toContain('0E1512');
    expect(tree).not.toContain('8BD6B4');
    expect(tree).not.toContain('05100a');
  });
});

test('RequireAuth renders DARK_COLORS values when theme is dark', () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(
    <RequireAuth><Text>protected</Text></RequireAuth>
  );
  return findByText('Sign in Required').then(() => {
    const tree = flattenStyles(toJSON());
    expect(tree).toContain('8BD6B4');
    expect(tree).toContain('07110b');
    expect(tree).not.toContain('0B6B4C');
    expect(tree).not.toContain('0E1512');
  });
});

import { Text } from 'react-native';
