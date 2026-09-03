jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success' },
}));
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: React.forwardRef((props, ref) => React.createElement(View, { ...props, ref })),
  };
});
jest.mock('react-native-reanimated', () => {
  const View = require('react-native').View;
  return {
    __esModule: true,
    default: { ScrollView: View, View },
    useSharedValue: (v) => ({ value: v }),
    useAnimatedScrollHandler: () => ({}),
    useAnimatedStyle: () => ({}),
    interpolate: (v) => v,
    Extrapolation: { CLAMP: 'clamp' },
  };
});

jest.mock('../../components/ui/PressableScale', () => 'PressableScale');
jest.mock('../../components/ImageLightbox', () => 'ImageLightbox');
jest.mock('../../components/RedditSourcePanel', () => ({
  __esModule: true,
  default: () => null,
  isRedditSourced: () => false,
}));
jest.mock('../../components/ui/LoanCalculator', () => 'LoanCalculator');
jest.mock('../../components/ui/PriceHistory', () => 'PriceHistory');
jest.mock('../../components/ui/ReportButton', () => 'ReportButton');
jest.mock('../../components/ui/Button', () => 'Button');
jest.mock('../../components/RecommendedListings', () => 'RecommendedListings');
jest.mock('../../components/ui/ListingMap', () => 'ListingMap');

let mockColors;
let mockTheme;
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));
jest.mock('../../context/SavedListingsContext', () => ({
  useSavedListings: () => ({ toggleSaveListing: jest.fn(), isSaved: () => false }),
}));
jest.mock('../../utils/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
  },
}));
jest.mock('../../utils/listingCache', () => ({
  getCachedListing: jest.fn(() => null),
}));
jest.mock('../../components/ui/RequireAuth', () => ({
  useAuthPrompt: () => ({ requireAuth: (fn) => fn, AuthPromptModal: () => null }),
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../constants/theme');
const BikeDetailScreen = require('../listing/BikeDetailScreen').default;

const route = { params: { listingId: 'test-bike-1', listing: { id: 'test-bike-1', make_year: 2023, bike_brand: 'Honda', bike_model: 'CBR', expected_selling_price: 12000, seller_name: 'Test Seller', city: 'Dubai' } } };
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

test('BikeDetailScreen renders LIGHT_COLORS values when theme is light', async () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(<BikeDetailScreen route={route} navigation={navigation} />);
  await findByText('2023 Honda CBR');
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('FAFAFA');
  expect(tree).toContain('0B6B4C');
  expect(tree).not.toContain('07110b');
  expect(tree).not.toContain('8BD6B4');
});

test('BikeDetailScreen renders DARK_COLORS values when theme is dark', async () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(<BikeDetailScreen route={route} navigation={navigation} />);
  await findByText('2023 Honda CBR');
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('07110b');
  expect(tree).toContain('8BD6B4');
  expect(tree).not.toContain('FAFAFA');
  expect(tree).not.toContain('0B6B4C');
});