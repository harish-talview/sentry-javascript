import type { Context } from '@opentelemetry/api';
import { ROOT_CONTEXT, trace } from '@opentelemetry/api';
import type { Span, SpanProcessor as SpanProcessorInterface } from '@opentelemetry/sdk-trace-base';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { getCurrentHub } from '@sentry/core';
import { logger } from '@sentry/utils';

import { DEBUG_BUILD } from './debug-build';
import { SentrySpanExporter } from './spanExporter';
import { maybeCaptureExceptionForTimedEvent } from './utils/captureExceptionForTimedEvent';
import { getHubFromContext } from './utils/contextData';
import { setIsSetup } from './utils/setupCheck';
import { getSpanHub, setSpanHub, setSpanParent, setSpanScopes } from './utils/spanData';

function onSpanStart(span: Span, parentContext: Context): void {
  // This is a reliable way to get the parent span - because this is exactly how the parent is identified in the OTEL SDK
  const parentSpan = trace.getSpan(parentContext);
  const hub = getHubFromContext(parentContext);

  // We need access to the parent span in order to be able to move up the span tree for breadcrumbs
  if (parentSpan) {
    setSpanParent(span, parentSpan);
  }

  // The root context does not have a hub stored, so we check for this specifically
  // We do this instead of just falling back to `getCurrentHub` to avoid attaching the wrong hub
  let actualHub = hub;
  if (parentContext === ROOT_CONTEXT) {
    // eslint-disable-next-line deprecation/deprecation
    actualHub = getCurrentHub();
  }

  // We need the scope at time of span creation in order to apply it to the event when the span is finished
  if (actualHub) {
    // eslint-disable-next-line deprecation/deprecation
    const scope = actualHub.getScope();
    // eslint-disable-next-line deprecation/deprecation
    const isolationScope = actualHub.getIsolationScope();
    setSpanHub(span, actualHub);
    setSpanScopes(span, { scope, isolationScope });
  }
}

function onSpanEnd(span: Span): void {
  // Capture exceptions as events
  // eslint-disable-next-line deprecation/deprecation
  const hub = getSpanHub(span) || getCurrentHub();
  span.events.forEach(event => {
    maybeCaptureExceptionForTimedEvent(hub, event, span);
  });
}

/**
 * Converts OpenTelemetry Spans to Sentry Spans and sends them to Sentry via
 * the Sentry SDK.
 */
export class SentrySpanProcessor extends BatchSpanProcessor implements SpanProcessorInterface {
  public constructor() {
    super(new SentrySpanExporter());

    setIsSetup('SentrySpanProcessor');
  }

  /**
   * @inheritDoc
   */
  public onStart(span: Span, parentContext: Context): void {
    onSpanStart(span, parentContext);

    DEBUG_BUILD && logger.log(`[Tracing] Starting span "${span.name}" (${span.spanContext().spanId})`);

    return super.onStart(span, parentContext);
  }

  /** @inheritDoc */
  public onEnd(span: Span): void {
    DEBUG_BUILD && logger.log(`[Tracing] Finishing span "${span.name}" (${span.spanContext().spanId})`);

    if (!this._shouldSendSpanToSentry(span)) {
      // Prevent this being called to super.onEnd(), which would pass this to the span exporter
      return;
    }

    onSpanEnd(span);

    return super.onEnd(span);
  }

  /**
   * You can overwrite this in a sub class to implement custom behavior for dropping spans.
   * If you return `false` here, the span will not be passed to the exporter and thus not be sent.
   */
  protected _shouldSendSpanToSentry(_span: Span): boolean {
    return true;
  }
}
