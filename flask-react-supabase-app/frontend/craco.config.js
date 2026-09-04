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
      // Keep lazy vendor chunks request-sized. CRA's default cache groups can
      // produce multi-megabyte chunks for TensorFlow, PDF, and map libraries,
      // even when the feature is already route-lazy. maxSize splits those
      // groups without changing module ownership or runtime loading behavior.
      webpackConfig.optimization.splitChunks = {
        ...(webpackConfig.optimization.splitChunks || {}),
        chunks: 'all',
        maxSize: 500 * 1024,
      };
      return webpackConfig;
    },
  },
};
