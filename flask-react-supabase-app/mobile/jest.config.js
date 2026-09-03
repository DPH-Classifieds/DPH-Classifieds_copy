module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['./src/__tests__/setup.js'],
  transformIgnorePatterns: [
    // SDK 57: expo-router replaced its react-navigation dependency with its
    // own standard-navigation package, which ships untranspiled ESM.
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|standard-navigation)',
  ],
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: ['src/utils/**/*.js', 'src/hooks/**/*.js'],
};
