import { addOriginToSpan } from './utils/addOriginToSpan';
import { maybeCaptureExceptionForTimedEvent } from './utils/captureExceptionForTimedEvent';
import { getRequestSpanData } from './utils/getRequestSpanData';

export type { OpenTelemetryClient } from './types';
export { wrapClientClass } from './custom/client';

export { getSpanKind } from './utils/getSpanKind';
export {
  getSpanHub,
  getSpanMetadata,
  getSpanParent,
  setSpanMetadata,
  getSpanScopes,
} from './utils/spanData';

export { getScopesFromContext } from './utils/contextData';

export {
  spanHasAttributes,
  spanHasEvents,
  spanHasKind,
  spanHasName,
  spanHasParentId,
  spanHasStatus,
} from './utils/spanTypes';

export { isSentryRequestSpan } from './utils/isSentryRequest';

export { getActiveSpan, getRootSpan } from './utils/getActiveSpan';
export { startSpan, startSpanManual, startInactiveSpan, withActiveSpan } from './trace';

// eslint-disable-next-line deprecation/deprecation
export { setupGlobalHub } from './custom/hub';
// eslint-disable-next-line deprecation/deprecation
export { getCurrentHub } from './custom/getCurrentHub';
export { addTracingExtensions } from './custom/hubextensions';
export { setupEventContextTrace } from './setupEventContextTrace';

export { setOpenTelemetryContextAsyncContextStrategy } from './asyncContextStrategy';
export { wrapContextManagerClass } from './contextManager';
export { SentryPropagator } from './propagator';
export { SentrySpanProcessor } from './spanProcessor';
export { SentrySampler } from './sampler';

export { openTelemetrySetupCheck } from './utils/setupCheck';

// Legacy
export { getClient } from '@sentry/core';

/**
 * The following internal utils are not considered public API and are subject to change.
 * @hidden
 */
const _INTERNAL = {
  addOriginToSpan,
  maybeCaptureExceptionForTimedEvent,
  getRequestSpanData,
} as const;

export { _INTERNAL };
