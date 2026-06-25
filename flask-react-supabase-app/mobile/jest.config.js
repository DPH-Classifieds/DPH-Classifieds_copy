module.exports = {
  preset: 'jest-expo',
  setupFilesAfterFramework: ['./src/__tests__/setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
  ],
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: ['src/utils/**/*.js', 'src/hooks/**/*.js'],
};
