// Polyfill window.dispatchEvent so React Native's reportGlobalError doesn't crash
// Node when state updates trigger an act() warning during teardown.
if (typeof global.window !== 'undefined' && !global.window.dispatchEvent) {
  global.window.dispatchEvent = () => true;
}

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

jest.mock('../../components/ui/PressableScale', () => {
  const React = require('react');
  const ReactNative = require('react-native');
  const PressableScale = React.forwardRef((props, ref) =>
    React.createElement(ReactNative.View, { ...props, ref })
  );
  return { __esModule: true, default: PressableScale };
});
jest.mock('../../components/ui/ScreenEntrance', () => {
  const React = require('react');
  const { View } = require('react-native');
  const ScreenEntrance = ({ children }) => React.createElement(View, null, children);
  return { __esModule: true, default: ScreenEntrance };
});
jest.mock('../../components/ui/Input', () => {
  const React = require('react');
  const { TextInput } = require('react-native');
  const Input = React.forwardRef((props, ref) => React.createElement(TextInput, { ...props, ref }));
  return { __esModule: true, default: Input };
});
jest.mock('../../components/ui/Button', () => {
  const React = require('react');
  const { Pressable, Text } = require('react-native');
  const Button = ({ title, onPress, ...props }) =>
    React.createElement(Pressable, { onPress, ...props }, React.createElement(Text, null, title));
  return { __esModule: true, default: Button };
});
jest.mock('../../components/ui/PhotoEditorModal', () => {
  const React = require('react');
  const { View } = require('react-native');
  const PhotoEditorModal = () => React.createElement(View, null);
  return { __esModule: true, default: PhotoEditorModal };
});
jest.mock('../../utils/mapComponents', () => ({
  __esModule: true,
  default: () => null,
  Marker: () => null,
}));
jest.mock('expo-image-picker', () => ({
  __esModule: true,
  launchImageLibraryAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
}));
jest.mock('expo-location', () => ({
  __esModule: true,
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }),
  getCurrentPositionAsync: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));
jest.mock('../../utils/ocrScanner', () => ({
  scanCarRegistration: jest.fn(),
  scanRegistrationStructured: jest.fn(),
}));
jest.mock('../../utils/analytics', () => ({ trackEvent: jest.fn() }));
jest.mock('../../utils/imageCompressor', () => ({ compressImage: jest.fn().mockResolvedValue('compressed-uri') }));
jest.mock('../../utils/imageModeration', () => ({ moderateImage: jest.fn().mockResolvedValue({}) }));
jest.mock('../../utils/listingConstants', () => ({
  CAR_MAKES: ['Toyota'],
  CAR_MODELS: { Toyota: ['Camry'] },
  FUEL_TYPES: ['Petrol'],
  TRANSMISSION_TYPES: ['Automatic'],
  EXTERIOR_COLOR_OPTIONS: ['White'],
  INTERIOR_COLOR_OPTIONS: ['Black'],
  REGIONAL_SPECS: ['GCC'],
  BODY_TYPES: ['Sedan'],
  VEHICLE_CONDITIONS: ['Used'],
  OWNERSHIP_STATUS: ['Owned'],
  HORSEPOWER_OPTIONS: ['200'],
  ENGINE_CAPACITY_OPTIONS: ['2.5L'],
  SEATING_CAPACITY: ['5'],
  STEERING_SIDES: ['Left'],
  WARRANTY_OPTIONS: ['Yes'],
  SERVICE_HISTORY_OPTIONS: ['Full'],
  DOOR_OPTIONS: ['4'],
  CYLINDER_OPTIONS: ['4'],
  PLATE_CITIES: ['Dubai'],
  PLATE_FORMATS: ['Standard'],
  PART_TYPES: ['Engine'],
  PART_CONDITIONS: ['New'],
  BIKE_BRANDS: ['Honda'],
  BIKE_TYPES: ['Sport'],
  BIKE_FEATURES: ['ABS'],
  CAR_EXTRAS: ['Sunroof'],
  getYearOptions: () => ['2024'],
  UAE_EMIRATES: ['Dubai'],
  getAreasForEmirate: () => ['Downtown'],
}));

let mockColors;
let mockTheme;
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', display_name: 'Test', email: 't@e.com' } }),
}));
jest.mock('../../utils/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockResolvedValue({}),
    post: jest.fn().mockResolvedValue({}),
  },
}));
jest.mock('../../utils/toast', () => ({ toastApiError: jest.fn() }));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../constants/theme');
const PostListingScreen = require('../listing/PostListingScreen').default;

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

test('PostListingScreen renders LIGHT_COLORS values when theme is light', () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(
    <PostListingScreen navigation={navigation} route={route} />
  );
  // The default state shows the category picker.
  // LIGHT_COLORS.background = '#FAFAFA' (page base — unique to LIGHT)
  // LIGHT_COLORS.surface    = '#FFFFFF' (category cards — note: also matches DARK textPrimary)
  // DARK_COLORS.background  = '#07110b' (UNIQUE to DARK)
  findByText('Choose a category');
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('FAFAFA');
  expect(tree).toContain('FFFFFF');
  expect(tree).not.toContain('07110b');
});

test('PostListingScreen renders DARK_COLORS values when theme is dark', () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(
    <PostListingScreen navigation={navigation} route={route} />
  );
  findByText('Choose a category');
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('07110b');
  expect(tree).toContain('0C1C13');
  expect(tree).not.toContain('FAFAFA');
});
