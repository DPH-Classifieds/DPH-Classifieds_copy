jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../components/ui/LoadingSpinner', () => {
  const React = require('react');
  const { View } = require('react-native');
  const LoadingSpinner = () => React.createElement(View, null);
  return { __esModule: true, default: LoadingSpinner };
});

let mockColors;
let mockTheme;
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));
jest.mock('../../utils/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockImplementation((url) => {
      if (url.includes('documents')) return Promise.resolve({ documents: [] });
      return Promise.resolve({
        company_name: 'Test Motors',
        user_email: 'test@example.com',
        listing_count: 5,
        dealer_verified: false,
        verification_status: 'pending',
      });
    }),
  },
}));

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../constants/theme');
const AdminDealerDetailScreen = require('../admin/AdminDealerDetailScreen').default;

const route = { params: { dealerId: '123' } };
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

test('AdminDealerDetailScreen renders LIGHT_COLORS values when theme is light', async () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(<AdminDealerDetailScreen route={route} navigation={navigation} />);
  await findByText('Test Motors');
  const tree = flattenStyles(toJSON());
  // LIGHT_COLORS.black = '#0E1512' (container)
  // LIGHT_COLORS.surface = '#FFFFFF' (docCard)
  // LIGHT_COLORS.warning = '#ff9800' (verificationBadge bg)
  expect(tree).toContain('0E1512');
  expect(tree).toContain('FFFFFF');
  expect(tree).not.toContain('05100a');
  expect(tree).not.toContain('0C1C13');
});

test('AdminDealerDetailScreen renders DARK_COLORS values when theme is dark', async () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(<AdminDealerDetailScreen route={route} navigation={navigation} />);
  await findByText('Test Motors');
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('05100a');
  expect(tree).toContain('0C1C13');
  expect(tree).not.toContain('0E1512');
});
