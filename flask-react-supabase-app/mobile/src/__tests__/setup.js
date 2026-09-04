import '@testing-library/jest-native/extend-expect';
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn() }));
// SDK 55 bumped reanimated/worklets; the RN jest preset resolves worklets'
// .native.ts by default, which expects a real native module. Force the
// jest-only mock so worklets initializes without one.
// https://github.com/software-mansion/react-native-reanimated/discussions/8806
const WORKLETS_JEST_MOCK = 'react-native-worklets/src/mock';
jest.mock('react-native-worklets', () => require(WORKLETS_JEST_MOCK));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
