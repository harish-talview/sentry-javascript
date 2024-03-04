import { feedbackIntegration } from '@sentry-internal/feedback';
import { browserTracingIntegration } from '@sentry-internal/tracing';
import { addTracingExtensions } from '@sentry/core';
import { replayIntegration } from '@sentry/replay';

// We are patching the global object with our hub extension methods
addTracingExtensions();

export {
  getActiveSpan,
  startSpan,
  startInactiveSpan,
  startSpanManual,
  withActiveSpan,
} from '@sentry/core';

export {
  feedbackIntegration,
  replayIntegration,
  browserTracingIntegration,
  addTracingExtensions,
};

export * from './index.bundle.base';
