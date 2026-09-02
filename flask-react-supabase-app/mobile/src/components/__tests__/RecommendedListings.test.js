jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('../../utils/apiClient', () => ({
  __esModule: true,
  default: {
    post: jest.fn().mockResolvedValue({
      recommendations: [
        { id: 'r-1', images: ['http://example.com/x.jpg'], expected_selling_price: 50000, listing_title: 'Test Car' },
      ],
    }),
  },
}));
jest.mock('../../utils/formatters', () => ({ formatPrice: (v) => `AED ${v}` }));
jest.mock('../../utils/media', () => ({ resolveMediaUrl: (u) => u }));
jest.mock('../../utils/listingCache', () => ({ prefetchListing: jest.fn() }));
jest.mock('../../components/ui/UAEPlate', () => ({ __esModule: true, default: 'UAEPlate' }));

let mockColors;
let mockTheme;
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../constants/theme');
const RecommendedListings = require('../../components/RecommendedListings').default;

const navigation = { push: jest.fn() };

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

test('RecommendedListings renders LIGHT_COLORS values when theme is light', async () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(
    <RecommendedListings listingType="car" listingId="l-1" navigation={navigation} />
  );
  await findByText('Similar Listings');
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('FFFFFF');
  expect(tree).toContain('0B6B4C');
  expect(tree).toContain('5B655F');
  expect(tree).not.toContain('0C1C13');
  expect(tree).not.toContain('8BD6B4');
});

test('RecommendedListings renders DARK_COLORS values when theme is dark', async () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(
    <RecommendedListings listingType="car" listingId="l-1" navigation={navigation} />
  );
  await findByText('Similar Listings');
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('0C1C13');
  expect(tree).toContain('8BD6B4');
  expect(tree).toContain('A8B4AC');
  expect(tree).toContain('323535');
});
