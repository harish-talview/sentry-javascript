import { feedbackIntegrationShim } from '@sentry-internal/integration-shims';
import { browserTracingIntegration } from '@sentry-internal/tracing';
import { addTracingExtensions } from '@sentry/core';
import { replayIntegration } from '@sentry/replay';

// We are patching the global object with our hub extension methods
addTracingExtensions();

export {
  replayIntegration,
  feedbackIntegrationShim as feedbackIntegration,
  browserTracingIntegration,
  addTracingExtensions,
};
export * from './index.bundle.base';
