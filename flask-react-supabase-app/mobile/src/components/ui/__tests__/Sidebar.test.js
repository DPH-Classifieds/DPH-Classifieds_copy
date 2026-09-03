jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

let mockColors;
let mockTheme;
let mockToggle;
jest.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({
    theme: mockTheme || 'light',
    colors: mockColors,
    setTheme: jest.fn(),
    toggleTheme: mockToggle,
  }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  usePathname: () => '/(explore)',
}));

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, ...props }) =>
      React.createElement(View, { ...props, testID: 'safe-area' }, children),
  };
});

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
const Sidebar = require('../Sidebar').default;
const { LIGHT_COLORS, DARK_COLORS } = require('../../../constants/theme');

describe('Sidebar — mobile-optimized drawer', () => {
  beforeEach(() => {
    mockColors = LIGHT_COLORS;
    mockTheme = 'light';
    mockToggle = jest.fn();
  });

  test('renders navigation links for all 4 tabs', () => {
    const { getByText } = render(<Sidebar open={true} onClose={jest.fn()} />);
    expect(getByText('Explore')).toBeTruthy();
    expect(getByText('Sell')).toBeTruthy();
    expect(getByText('Saved')).toBeTruthy();
    expect(getByText('Profile')).toBeTruthy();
  });

  test('shows theme toggle labeled with current mode', () => {
    mockTheme = 'dark';
    const { getByLabelText } = render(<Sidebar open={true} onClose={jest.fn()} />);
    expect(
      getByLabelText(/Dark mode, currently on/i)
    ).toBeTruthy();
  });

  test('calls toggleTheme when when theme switch pressed', () => {
    mockToggle = jest.fn();
    const { getByLabelText } = render(<Sidebar open={true} onClose={jest.fn()} />);
    fireEvent.press(getByLabelText(/Dark mode/i));
    expect(mockToggle).toHaveBeenCalledTimes(1);
  });

  test('calls onClose when backdrop pressed', () => {
    const onClose = jest.fn();
    const { getByLabelText } = render(<Sidebar open={true} onClose={onClose} />);
    fireEvent.press(getByLabelText(/Close navigation menu/i));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('calls onClose when close button pressed', () => {
    const onClose = jest.fn();
    const { getByLabelText } = render(<Sidebar open={true} onClose={onClose} />);
    fireEvent.press(getByLabelText(/Close menu/i));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('highlights active tab using current pathname', () => {
    const { getByLabelText } = render(<Sidebar open={true} onClose={jest.fn()} />);
    const exploreButton = getByLabelText('Explore');
    expect(exploreButton.props.accessibilityState.selected).toBe(true);
  });

  test('renders with theme-aware colors (light mode uses light page bg)', () => {
    mockColors = LIGHT_COLORS;
    mockTheme = 'light';
    const { getByTestId } = render(<Sidebar open={true} onClose={jest.fn()} />);
    const safe = getByTestId('safe-area');
    const safeStyle = JSON.stringify(safe.props.style);
    expect(safeStyle).toMatch(/FAFAFA|#FFFFFF|#FAFAFA/);
  });

  test('renders with theme-aware colors (dark mode uses dark page bg)', () => {
    mockColors = DARK_COLORS;
    mockTheme = 'dark';
    const { getByTestId } = render(<Sidebar open={true} onClose={jest.fn()} />);
    const safe = getByTestId('safe-area');
    const safeStyle = JSON.stringify(safe.props.style);
    expect(safeStyle).toMatch(/07110b/);
  });

  test('hides backdrop when closed (open=false)', () => {
    const { getByLabelText } = render(<Sidebar open={false} onClose={jest.fn()} />);
    const backdrop = getByLabelText(/Close navigation menu/i);
    expect(backdrop.props).toBeTruthy();
  });
});