import type { Configuration } from 'webpack';

const lifecycleEvent = process.env.npm_lifecycle_event?.trim();

export const isProductionBuild =
  process.env.NODE_ENV === 'production' || lifecycleEvent === 'package' || lifecycleEvent === 'make';

export const webpackMode: Configuration['mode'] = isProductionBuild ? 'production' : 'development';
export const webpackDevtool: Configuration['devtool'] = isProductionBuild ? false : 'source-map';