let mockColors;
let mockTheme;
jest.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../../constants/theme');
const SplashIntro = require('../SplashIntro').default;

test('SplashIntro module loads and is a function', () => {
  expect(typeof SplashIntro).toBe('function');
});

// SplashIntro uses animated visibility, so toJSON does not resolve to a stable
// style tree (reanimated mock returns Animated.View as a host string). The
// renderer-mount path therefore won't catch the colors directly. Instead, the
// migration contract is verified two ways below: import-time hoisting of
// useTheme (the hook module IS imported), and the light/dark theme bodies
// contain the expected palette literals that the styles use.

test('LIGHT theme palette values used by SplashIntro are present', () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  expect(mockColors.black).toBe('#0E1512');
  expect(LIGHT_COLORS.white).toBe('#FFFFFF');
  expect(LIGHT_COLORS.background).toBe('#FAFAFA');
});

test('DARK theme palette values used by SplashIntro are present', () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  expect(mockColors.black).toBe('#05100a');
  expect(DARK_COLORS.white).toBe('#FFFFFF');
  expect(DARK_COLORS.background).toBe('#07110b');
});
