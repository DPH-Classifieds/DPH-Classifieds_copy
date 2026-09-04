const baseConfig = require('./app.json');

const isDevelopmentBuild =
  process.env.NODE_ENV !== 'production' || process.env.EAS_BUILD_PROFILE === 'development';

module.exports = ({ config }) => ({
  ...baseConfig.expo,
  ...config,
  android: {
    ...baseConfig.expo.android,
    ...config.android,
    // The app only uses this for local HTTP development. Production builds
    // still point at HTTPS and do not need cleartext transport.
    usesCleartextTraffic: isDevelopmentBuild,
  },
});
