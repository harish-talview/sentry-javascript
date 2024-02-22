import { applySdkMetadata } from '@sentry/core';
import type { NodeOptions } from '@sentry/node-experimental';
import { getClient, init as nodeInit, setTag } from '@sentry/node-experimental';
import { logger } from '@sentry/utils';

import { DEBUG_BUILD } from './utils/debug-build';
import { instrumentServer } from './utils/instrumentServer';
import type { RemixOptions } from './utils/remixOptions';

// We need to explicitly export @sentry/node as they end up under `default` in ESM builds
// See: https://github.com/getsentry/sentry-javascript/issues/8474
export {
  // eslint-disable-next-line deprecation/deprecation
  addGlobalEventProcessor,
  addEventProcessor,
  addBreadcrumb,
  addIntegration,
  captureCheckIn,
  withMonitor,
  captureException,
  captureEvent,
  captureMessage,
  createTransport,
  // eslint-disable-next-line deprecation/deprecation
  getActiveTransaction,
  // eslint-disable-next-line deprecation/deprecation
  getCurrentHub,
  getClient,
  getCurrentScope,
  getGlobalScope,
  getIsolationScope,
  Hub,
  // eslint-disable-next-line deprecation/deprecation
  makeMain,
  setCurrentClient,
  NodeClient,
  Scope,
  // eslint-disable-next-line deprecation/deprecation
  startTransaction,
  SDK_VERSION,
  setContext,
  setExtra,
  setExtras,
  setTag,
  setTags,
  setUser,
  getSpanStatusFromHttpCode,
  setHttpStatus,
  withScope,
  withIsolationScope,
  autoDiscoverNodePerformanceMonitoringIntegrations,
  makeNodeTransport,
  getDefaultIntegrations,
  defaultStackParser,
  flush,
  close,
  getSentryRelease,
  addRequestDataToEvent,
  DEFAULT_USER_INCLUDES,
  extractRequestData,
  Integrations,
  consoleIntegration,
  onUncaughtExceptionIntegration,
  onUnhandledRejectionIntegration,
  modulesIntegration,
  contextLinesIntegration,
  nodeContextIntegration,
  localVariablesIntegration,
  requestDataIntegration,
  functionToStringIntegration,
  inboundFiltersIntegration,
  linkedErrorsIntegration,
  Handlers,
  setMeasurement,
  getActiveSpan,
  startSpan,
  startSpanManual,
  startInactiveSpan,
  continueTrace,
  isInitialized,
  cron,
  parameterize,
  metrics,
  createGetModuleFromFilename,
  hapiErrorPlugin,
  // eslint-disable-next-line deprecation/deprecation
  runWithAsyncContext,
  SEMANTIC_ATTRIBUTE_SENTRY_OP,
  SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN,
  SEMANTIC_ATTRIBUTE_SENTRY_SOURCE,
  SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE,
} from '@sentry/node-experimental';

// Keeping the `*` exports for backwards compatibility and types
export * from '@sentry/node-experimental';

export {
  captureRemixServerException,
  // eslint-disable-next-line deprecation/deprecation
  wrapRemixHandleError,
  sentryHandleError,
  wrapHandleErrorWithSentry,
} from './utils/instrumentServer';
export { ErrorBoundary, withErrorBoundary } from '@sentry/react';
// eslint-disable-next-line deprecation/deprecation
export { remixRouterInstrumentation, withSentry } from './client/performance';
export { captureRemixErrorBoundaryError } from './client/errors';
export { browserTracingIntegration } from './client/browserTracingIntegration';
export { wrapExpressCreateRequestHandler } from './utils/serverAdapters/express';

export type { SentryMetaArgs } from './utils/types';

function sdkAlreadyInitialized(): boolean {
  return !!getClient();
}

/** Initializes Sentry Remix SDK on Node. */
export function init(options: RemixOptions): void {
  applySdkMetadata(options, 'remix', ['remix', 'node']);

  if (sdkAlreadyInitialized()) {
    DEBUG_BUILD && logger.log('SDK already initialized');

    return;
  }

  instrumentServer();

  nodeInit(options as NodeOptions);

  setTag('runtime', 'node');
}
