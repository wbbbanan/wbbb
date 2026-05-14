import type { Configuration } from 'webpack';
import { rules } from './webpack.rules';
import { webpackDevtool, webpackMode } from './webpack.shared';

export const mainConfig: Configuration = {
  mode: webpackMode,
  entry: './src/main.ts',
  devtool: webpackDevtool,
  module: {
    rules,
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.json'],
  },
};