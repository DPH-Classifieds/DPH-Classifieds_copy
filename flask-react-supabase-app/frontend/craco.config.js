module.exports = {
  webpack: {
    configure: (webpackConfig) => {
      // ponytail: tfjs/nsfwjs ship UMD bundles with AMD-style define/require([…,…]);
      // parser.amd=false tells webpack to treat them as plain CJS and skip AMD parsing
      webpackConfig.module.rules.push({
        test: /node_modules[\\/](@tensorflow|nsfwjs|@tensorflow-models)[\\/]/,
        parser: { amd: false },
      });
      // ponytail: suppress the dynamic-require "Critical dependency" warnings that
      // CRA promotes to errors under CI=true
      webpackConfig.ignoreWarnings = [
        ...(webpackConfig.ignoreWarnings || []),
        { message: /Critical dependency: require function is used/ },
      ];
      return webpackConfig;
    },
  },
};
