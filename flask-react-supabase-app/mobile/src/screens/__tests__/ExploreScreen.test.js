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
jest.mock('@shopify/flash-list', () => {
  const React = require('react');
  const { View } = require('react-native');
  const FlatList = ({ data, renderItem, ListEmptyComponent, ListHeaderComponent, ListFooterComponent, refreshControl, ...rest }) =>
    React.createElement(View, rest,
      React.createElement(React.Fragment, { key: 'header' }, ListHeaderComponent && ListHeaderComponent()),
      ...(data || []).map((item, idx) => React.createElement(React.Fragment, { key: `item-${idx}` }, renderItem({ item, index: idx }))),
      React.createElement(React.Fragment, { key: 'empty' }, ListEmptyComponent),
      React.createElement(React.Fragment, { key: 'footer' }, ListFooterComponent),
    );
  return { FlashList: FlatList };
});
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));

jest.mock('../../components/ui/ScreenEntrance', () => {
  const React = require('react');
  const { View } = require('react-native');
  const ScreenEntrance = ({ children }) => React.createElement(View, null, children);
  return { __esModule: true, default: ScreenEntrance };
});
jest.mock('../../components/ui/PressableScale', () => {
  const React = require('react');
  const { View } = require('react-native');
  const PressableScale = ({ children }) => React.createElement(View, null, children);
  return { __esModule: true, default: PressableScale };
});
jest.mock('../../components/ui/ListingSkeleton', () => 'ListingSkeleton');
jest.mock('../../components/ui/AnimatedCard', () => 'AnimatedCard');
jest.mock('../../components/ui/FadeInView', () => {
  const React = require('react');
  const { View } = require('react-native');
  const FadeInView = ({ children }) => React.createElement(View, null, children);
  return { __esModule: true, default: FadeInView };
});
jest.mock('../../components/ui/FadeInImage', () => {
  const React = require('react');
  const { View } = require('react-native');
  const FadeInImage = () => React.createElement(View, null);
  return { __esModule: true, default: FadeInImage };
});
jest.mock('../../components/ui/UAEPlate', () => {
  const React = require('react');
  const { View } = require('react-native');
  const UAEPlate = () => React.createElement(View, null);
  return { __esModule: true, default: UAEPlate };
});
jest.mock('../../components/ui/BottomSheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  const BottomSheet = ({ children }) => React.createElement(View, null, children);
  return { __esModule: true, default: BottomSheet };
});
jest.mock('../../components/ui/CoachMarks', () => {
  const React = require('react');
  const { View } = require('react-native');
  const CoachMarks = () => React.createElement(View, null);
  return { __esModule: true, default: CoachMarks };
});
jest.mock('../../components/ui/ListHeader', () => ({
  LayoutToggleButton: () => null,
}));
jest.mock('../../hooks/useListingCounts', () => ({
  __esModule: true,
  default: () => ({ cars: 1, bikes: 0, plates: 0, parts: 0, all: 1 }),
}));
jest.mock('../../hooks/useFeaturedPattern', () => ({
  __esModule: true,
  default: () => 'rotate-every-3',
}));
jest.mock('../../hooks/useGridColumns', () => ({
  useGridColumns: () => ({ columns: 1, toggleColumns: jest.fn() }),
}));

let mockColors;
let mockTheme;
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));
jest.mock('../../context/SavedListingsContext', () => ({
  useSavedListings: () => ({ isSaved: () => false, toggleSaveListing: jest.fn() }),
}));
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));
jest.mock('../../components/ui/RequireAuth', () => ({
  useAuthPrompt: () => ({ requireAuth: (fn) => fn, AuthPromptModal: () => null }),
}));
jest.mock('../../utils/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockImplementation((url) => {
      if (typeof url === 'string' && url.startsWith('/api/listings/counts')) {
        return Promise.resolve({ cars: 1, bikes: 0, plates: 0, parts: 0, all: 1 });
      }
      if (typeof url === 'string' && url.startsWith('/api/cars')) {
        return Promise.resolve([]);
      }
      if (typeof url === 'string' && url.startsWith('/api/featured-listings')) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    }),
    post: jest.fn().mockResolvedValue({}),
  },
}));
jest.mock('../../utils/swrCache', () => ({
  swrGet: jest.fn().mockResolvedValue(null),
  swrSet: jest.fn(),
}));
jest.mock('../../utils/listingCache', () => ({
  prefetchListing: jest.fn(),
}));
jest.mock('../../utils/media', () => ({
  resolveMediaUrl: (u) => u,
}));
jest.mock('../../utils/featuredPlacement', () => ({
  applyFeaturedPlacement: (items) => items,
}));
jest.mock('../../utils/toast', () => ({
  toastApiError: jest.fn(),
  showSuccess: jest.fn(),
  showInfo: jest.fn(),
}));

import React from 'react';
import { render, act } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../constants/theme');
const ExploreScreen = require('../explore/ExploreScreen').default;

const navigation = { navigate: jest.fn(), goBack: jest.fn() };
const route = { params: {} };

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

test('ExploreScreen renders LIGHT_COLORS values when theme is light', async () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(<ExploreScreen navigation={navigation} route={route} />);
  // Pump microtasks + a tick so the initial async fetches resolve and the
  // loading state flips off, allowing the real hero header to render.
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 50));
  });
  await findByText('Find Your Next Ride');
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('FAFAFA');
  expect(tree).toContain('FFFFFF');
  expect(tree).toContain('0B6B4C');
  expect(tree).not.toContain('07110b');
  expect(tree).not.toContain('0C1C13');
  expect(tree).not.toContain('8BD6B4');
});

test('ExploreScreen renders DARK_COLORS values when theme is dark', async () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(<ExploreScreen navigation={navigation} route={route} />);
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 50));
  });
  await findByText('Find Your Next Ride');
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('07110b');
  expect(tree).toContain('0C1C13');
  expect(tree).toContain('8BD6B4');
  expect(tree).not.toContain('FAFAFA');
  expect(tree).not.toContain('0B6B4C');
});
