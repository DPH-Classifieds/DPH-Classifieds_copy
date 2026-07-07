module.exports = {
  webpack: {
    configure: (webpackConfig) => {
      // ponytail: tfjs uses dynamic require() for backend/kernel loading;
      // unknownContextCritical=false converts the fatal error to a warning
      webpackConfig.module.unknownContextCritical = false;
      return webpackConfig;
    },
  },
};
