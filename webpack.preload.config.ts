import { BannerPlugin, type Configuration } from 'webpack';
import { rules } from './webpack.rules';
import { webpackDevtool, webpackMode } from './webpack.shared';

export const preloadConfig: Configuration = {
  mode: webpackMode,
  devtool: webpackDevtool,
  module: {
    rules,
  },
  plugins: [
    new BannerPlugin({
      raw: true,
      banner: 'var __dirname = ".";',
    }),
  ],
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.json'],
  },
};