jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: ({ children, ...rest }) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, rest, children);
  },
  Gesture: { Pan: () => ({ onUpdate: () => ({ onEnd: () => ({}) }) }) },
  GestureDetector: ({ children }) => children,
}));

let mockColors;
let mockTheme;
jest.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../../constants/theme');
const BottomSheet = require('../BottomSheet').default;

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

test('BottomSheet renders LIGHT_COLORS values when theme is light', () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(
    <BottomSheet visible title="Sort options" onClose={jest.fn()}><Text>opts</Text></BottomSheet>
  );
  return findByText('Sort options').then(() => {
    const tree = flattenStyles(toJSON());
    expect(tree).toContain('FFFFFF');
    expect(tree).not.toContain('0C1C13');
  });
});

test('BottomSheet renders DARK_COLORS values when theme is dark', () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(
    <BottomSheet visible title="Sort options" onClose={jest.fn()}><Text>opts</Text></BottomSheet>
  );
  return findByText('Sort options').then(() => {
    const tree = flattenStyles(toJSON());
    expect(tree).toContain('0C1C13');
  });
});

import { Text } from 'react-native';
