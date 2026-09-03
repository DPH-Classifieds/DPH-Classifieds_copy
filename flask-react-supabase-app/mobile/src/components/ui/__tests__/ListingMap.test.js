jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../../utils/mapComponents', () => ({
  __esModule: true,
  default: 'MapView',
  Marker: 'Marker',
}));

let mockColors;
let mockTheme;
jest.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../../constants/theme');
const ListingMap = require('../ListingMap').default;

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

test('ListingMap renders LIGHT_COLORS values when theme is light', () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(
    <ListingMap city="Dubai" emirate="DXB" area="Marina" />
  );
  return findByText('Dubai, Marina, DXB').then(() => {
    const tree = flattenStyles(toJSON());
    expect(tree).toContain('FFFFFF');
    expect(tree).toContain('000000');
    expect(tree).not.toContain('0C1C13');
    expect(tree).not.toContain('A8B4AC');
  });
});

test('ListingMap renders DARK_COLORS values when theme is dark', () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(
    <ListingMap city="Dubai" emirate="DXB" area="Marina" />
  );
  return findByText('Dubai, Marina, DXB').then(() => {
    const tree = flattenStyles(toJSON());
    expect(tree).toContain('0C1C13');
    expect(tree).toContain('A8B4AC');
    expect(tree).not.toContain('FFFFFF');
    expect(tree).not.toContain('5B655F');
  });
});
