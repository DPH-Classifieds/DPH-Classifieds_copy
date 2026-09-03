jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

let mockColors;
let mockTheme;
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));
jest.mock('../../utils/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockResolvedValue({
      listing: { id: '1', car_manufacturer: 'Toyota', car_model: 'Camry', status: 'active', seller_name: 'Ahmed', price: 50000 },
      verification_status: {},
    }),
  },
}));

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../constants/theme');
const AdminListingDetailScreen = require('../admin/AdminListingDetailScreen').default;

const route = { params: { itemType: 'cars', itemId: '1' } };
const navigation = { navigate: jest.fn(), goBack: jest.fn() };

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

test('AdminListingDetailScreen renders LIGHT_COLORS values when theme is light', async () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(<AdminListingDetailScreen route={route} navigation={navigation} />);
  await findByText('Toyota Camry');
  const tree = flattenStyles(toJSON());
  // LIGHT_COLORS.black = '#0E1512' (container)
  // LIGHT_COLORS.surface = '#FFFFFF' (scanCard)
  // LIGHT_COLORS.accent = '#0B6B4C' (price, approveBtnText)
  expect(tree).toContain('0E1512');
  expect(tree).toContain('FFFFFF');
  expect(tree).toContain('0B6B4C');
  expect(tree).not.toContain('05100a');
  expect(tree).not.toContain('0C1C13');
  expect(tree).not.toContain('8BD6B4');
});

test('AdminListingDetailScreen renders DARK_COLORS values when theme is dark', async () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(<AdminListingDetailScreen route={route} navigation={navigation} />);
  await findByText('Toyota Camry');
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('05100a');
  expect(tree).toContain('0C1C13');
  expect(tree).toContain('8BD6B4');
  expect(tree).not.toContain('0E1512');
  expect(tree).not.toContain('0B6B4C');
});
