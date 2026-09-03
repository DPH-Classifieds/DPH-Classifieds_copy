jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

let mockColors;
let mockTheme;
jest.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../../constants/theme');
const ListHeader = require('../ListHeader').default;

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

test('ListHeader renders LIGHT_COLORS values when theme is light', () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(
    <ListHeader title="Cars" onBack={jest.fn()} columns={1} onToggleColumns={jest.fn()} />
  );
  return findByText('Cars').then(() => {
    const tree = flattenStyles(toJSON());
    expect(tree).toContain('15,23,20,0.06');
    expect(tree).not.toContain('139,214,180,0.06');
    expect(tree).not.toContain('0C1C13');
  });
});

test('ListHeader renders DARK_COLORS values when theme is dark', () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(
    <ListHeader title="Cars" onBack={jest.fn()} columns={1} onToggleColumns={jest.fn()} />
  );
  return findByText('Cars').then(() => {
    const tree = flattenStyles(toJSON());
    expect(tree).toContain('139,214,180,0.06');
    expect(tree).toContain('0C1C13');
    expect(tree).not.toContain('15,23,20,0.06');
  });
});
