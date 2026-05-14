import { BannerPlugin, type Configuration } from 'webpack';
import { plugins } from './webpack.plugins';
import { rules } from './webpack.rules';
import { webpackDevtool, webpackMode } from './webpack.shared';

export const rendererConfig: Configuration = {
  mode: webpackMode,
  devtool: webpackDevtool,
  module: {
    rules: [
      ...rules,
      {
        test: /\.css$/i,
        use: ['style-loader', 'css-loader', 'postcss-loader'],
      },
    ],
  },
  plugins: [
    ...plugins,
    new BannerPlugin({
      raw: true,
      banner: 'var __dirname = ".";',
    }),
  ],
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.css'],
  },
};