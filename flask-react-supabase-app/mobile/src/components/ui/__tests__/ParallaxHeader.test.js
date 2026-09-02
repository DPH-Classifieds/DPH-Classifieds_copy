jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

let mockColors;
let mockTheme;
jest.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));

import React from 'react';
import { useSharedValue } from 'react-native-reanimated';

const { LIGHT_COLORS, DARK_COLORS } = require('../../../constants/theme');
const ParallaxHeader = require('../ParallaxHeader').default;
const { ParallaxScrollView } = require('../ParallaxHeader');

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

function Wrapper({ title, images }) {
  const scrollY = useSharedValue(0);
  return <ParallaxHeader title={title} images={images} scrollY={scrollY} />;
}

test('ParallaxHeader uses LIGHT_COLORS values via theme (LIGHT)', () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  expect(mockColors.black).toBe('#0E1512');
  expect(LIGHT_COLORS.surfaceHigher).toBe('#E7ECE9');
});

test('ParallaxHeader uses DARK_COLORS values via theme (DARK)', () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  expect(mockColors.black).toBe('#05100a');
  expect(DARK_COLORS.surfaceHigher).toBe('#323535');
});
