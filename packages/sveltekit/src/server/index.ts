// Node SDK exports
// Unfortunately, we cannot `export * from '@sentry/node-experimental'` because in prod builds,
// Vite puts these exports into a `default` property (Sentry.default) rather than
// on the top - level namespace.
// Hence, we export everything from the Node SDK explicitly:
export {
  // eslint-disable-next-line deprecation/deprecation
  addGlobalEventProcessor,
  addEventProcessor,
  addBreadcrumb,
  addIntegration,
  captureException,
  captureEvent,
  captureMessage,
  captureCheckIn,
  withMonitor,
  createTransport,
  // eslint-disable-next-line deprecation/deprecation
  getActiveTransaction,
  // eslint-disable-next-line deprecation/deprecation
  getCurrentHub,
  getClient,
  isInitialized,
  getCurrentScope,
  getGlobalScope,
  getIsolationScope,
  Hub,
  NodeClient,
  // eslint-disable-next-line deprecation/deprecation
  makeMain,
  setCurrentClient,
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
  startInactiveSpan,
  startSpanManual,
  withActiveSpan,
  continueTrace,
  cron,
  parameterize,
  createGetModuleFromFilename,
  hapiErrorPlugin,
  metrics,
  SEMANTIC_ATTRIBUTE_SENTRY_OP,
  SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN,
  SEMANTIC_ATTRIBUTE_SENTRY_SOURCE,
  SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE,
} from '@sentry/node-experimental';

// We can still leave this for the carrier init and type exports
export * from '@sentry/node-experimental';

// -------------------------
// SvelteKit SDK exports:
export { init } from './sdk';
export { handleErrorWithSentry } from './handleError';
export { wrapLoadWithSentry, wrapServerLoadWithSentry } from './load';
export { sentryHandle } from './handle';
