export * from './exports';

import { Integrations as CoreIntegrations } from '@sentry/core';

import { WINDOW } from './helpers';
import * as BrowserIntegrations from './integrations';

let windowIntegrations = {};

// This block is needed to add compatibility with the integrations packages when used with a CDN
if (WINDOW.Sentry && WINDOW.Sentry.Integrations) {
  windowIntegrations = WINDOW.Sentry.Integrations;
}

/** @deprecated Import the integration function directly, e.g. `inboundFiltersIntegration()` instead of `new Integrations.InboundFilter(). */
const INTEGRATIONS = {
  ...windowIntegrations,
  // eslint-disable-next-line deprecation/deprecation
  ...CoreIntegrations,
  ...BrowserIntegrations,
};

// eslint-disable-next-line deprecation/deprecation
export { INTEGRATIONS as Integrations };

export { reportingObserverIntegration } from './integrations/reportingobserver';
export { httpClientIntegration } from './integrations/httpclient';
export { contextLinesIntegration } from './integrations/contextlines';

export {
  captureConsoleIntegration,
  debugIntegration,
  extraErrorDataIntegration,
  rewriteFramesIntegration,
  sessionTimingIntegration,
} from '@sentry/core';

export {
  replayIntegration,
  getReplay,
} from '@sentry/replay';
export type {
  ReplayEventType,
  ReplayEventWithTime,
  ReplayBreadcrumbFrame,
  ReplayBreadcrumbFrameEvent,
  ReplayOptionFrameEvent,
  ReplayFrame,
  ReplayFrameEvent,
  ReplaySpanFrame,
  ReplaySpanFrameEvent,
} from '@sentry/replay';

export { replayCanvasIntegration } from '@sentry-internal/replay-canvas';

export {
  feedbackIntegration,
  sendFeedback,
} from '@sentry-internal/feedback';

export {
  defaultRequestInstrumentationOptions,
  instrumentOutgoingRequests,
  browserTracingIntegration,
  startBrowserTracingNavigationSpan,
  startBrowserTracingPageLoadSpan,
} from '@sentry-internal/tracing';
export type { RequestInstrumentationOptions } from '@sentry-internal/tracing';
export {
  addTracingExtensions,
  setMeasurement,
  // eslint-disable-next-line deprecation/deprecation
  getActiveTransaction,
  getSpanStatusFromHttpCode,
  setHttpStatus,
  makeMultiplexedTransport,
  // eslint-disable-next-line deprecation/deprecation
  ModuleMetadata,
  moduleMetadataIntegration,
} from '@sentry/core';
export type { SpanStatusType } from '@sentry/core';
export type { Span } from '@sentry/types';
export { makeBrowserOfflineTransport } from './transports/offline';
export { browserProfilingIntegration } from './profiling/integration';
