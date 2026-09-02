jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'light' } }));

let mockColors;
jest.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../../constants/theme');
const Button = require('../Button').default;

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

test('Button renders LIGHT_COLORS values in secondary variant', () => {
  mockColors = LIGHT_COLORS;
  const { toJSON } = render(<Button title="Tap" variant="secondary" onPress={() => {}} />);
  const tree = flattenStyles(toJSON());
  // LIGHT_COLORS.border = 'rgba(15,23,20,0.10)' (dark mint-tinted border)
  // DARK_COLORS.border  = 'rgba(139,214,180,0.12)' (bright mint 12% alpha)
  expect(tree).toContain('15,23,20,0.10');
  expect(tree).not.toContain('139,214,180,0.12');
});

test('Button renders DARK_COLORS values in secondary variant', () => {
  mockColors = DARK_COLORS;
  const { toJSON } = render(<Button title="Tap" variant="secondary" onPress={() => {}} />);
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('139,214,180,0.12');
  expect(tree).not.toContain('15,23,20,0.10');
});
