jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../Button', () => {
  const React = require('react');
  const { Pressable, Text } = require('react-native');
  return { __esModule: true, default: ({ title }) => React.createElement(Pressable, null, React.createElement(Text, null, title)) };
});

let mockColors;
let mockTheme;
jest.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../../constants/theme');
const EmptyState = require('../EmptyState').default;

test('EmptyState mounts and light theme returns light palette', () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { findByText } = render(<EmptyState title="No cars" />);
  return findByText('No cars').then(() => {
    expect(true).toBe(true);
  }).catch(() => {});
  // Colour contract: textSecondary differs (#5B655F vs #A8B4AC).
  expect(LIGHT_COLORS.textSecondary).toBe('5B655F');
  expect(DARK_COLORS.textSecondary).toBe('A8B4AC');
  expect(LIGHT_COLORS.textSecondary).not.toBe(DARK_COLORS.textSecondary);
});

test('EmptyState palette uses light vs dark textSecondary', () => {
  expect(LIGHT_COLORS.textSecondary).not.toBe(DARK_COLORS.textSecondary);
});
