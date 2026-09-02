// FadeInImage has no styles of its own — its only styled element appears on
// the error-fallback View. The mock below keeps onError synchronous so the
// fallback View is rendered without an async setState.
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-image', () => ({
  Image: ({ onError, ...rest }) => {
    const React = require('react');
    const { View } = require('react-native');
    if (rest.source && rest.source.uri === 'bad://x') {
      return React.createElement(View, {
        onLayout: () => {
          if (onError) onError();
        },
      });
    }
    return React.createElement(View, { testID: 'FadeInImage', style: rest.style }, rest.children);
  },
}));

let mockColors;
let mockTheme;
jest.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../../constants/theme');
const FadeInImage = require('../FadeInImage').default;

test('FadeInImage hook module loads and LIGHT palette resolves', () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  expect(typeof FadeInImage).toBe('function');
  expect(mockColors.surface).toBe('#FFFFFF');
  expect(DARK_COLORS.surface).toBe('#0C1C13');
});

test('FadeInImage renders without crashing on bad URL', () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON } = render(<FadeInImage source={{ uri: 'bad://x' }} style={{ width: 50, height: 50 }} />);
  expect(toJSON()).toBeTruthy();
});
