import { SpanKind } from '@opentelemetry/api';
import type { ExportResult } from '@opentelemetry/core';
import { ExportResultCode } from '@opentelemetry/core';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { SemanticAttributes } from '@opentelemetry/semantic-conventions';
import type { SentrySpan, Transaction } from '@sentry/core';
import {
  SEMANTIC_ATTRIBUTE_SENTRY_OP,
  SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN,
  SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE,
  SEMANTIC_ATTRIBUTE_SENTRY_SOURCE,
  getCurrentHub,
} from '@sentry/core';
import type { Scope, SpanOrigin, TransactionSource } from '@sentry/types';
import { addNonEnumerableProperty, dropUndefinedKeys, logger } from '@sentry/utils';
import { startTransaction } from './custom/transaction';

import { DEBUG_BUILD } from './debug-build';
import { InternalSentrySemanticAttributes } from './semanticAttributes';
import { convertOtelTimeToSeconds } from './utils/convertOtelTimeToSeconds';
import { getDynamicSamplingContextFromSpan } from './utils/dynamicSamplingContext';
import { getRequestSpanData } from './utils/getRequestSpanData';
import type { SpanNode } from './utils/groupSpansWithParents';
import { groupSpansWithParents } from './utils/groupSpansWithParents';
import { mapStatus } from './utils/mapStatus';
import { parseSpanDescription } from './utils/parseSpanDescription';
import { getSpanHub, getSpanMetadata, getSpanScopes } from './utils/spanData';

type SpanNodeCompleted = SpanNode & { span: ReadableSpan };

/**
 * A Sentry-specific exporter that converts OpenTelemetry Spans to Sentry Spans & Transactions.
 */
export class SentrySpanExporter implements SpanExporter {
  private _finishedSpans: ReadableSpan[];
  private _stopped: boolean;

  public constructor() {
    this._stopped = false;
    this._finishedSpans = [];
  }

  /** @inheritDoc */
  public export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    if (this._stopped) {
      return resultCallback({
        code: ExportResultCode.FAILED,
        error: new Error('Exporter has been stopped'),
      });
    }

    const openSpanCount = this._finishedSpans.length;
    const newSpanCount = spans.length;

    this._finishedSpans.push(...spans);

    const remainingSpans = maybeSend(this._finishedSpans);

    const remainingOpenSpanCount = remainingSpans.length;
    const sentSpanCount = openSpanCount + newSpanCount - remainingOpenSpanCount;

    DEBUG_BUILD &&
      logger.log(`SpanExporter exported ${sentSpanCount} spans, ${remainingOpenSpanCount} unsent spans remaining`);

    this._finishedSpans = remainingSpans.filter(span => {
      const shouldDrop = shouldCleanupSpan(span, 5 * 60);
      DEBUG_BUILD &&
        shouldDrop &&
        logger.log(
          `SpanExporter dropping span ${span.name} (${
            span.spanContext().spanId
          }) because it is pending for more than 5 minutes.`,
        );
      return !shouldDrop;
    });

    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  /** @inheritDoc */
  public shutdown(): Promise<void> {
    const forceFlush = this.forceFlush();
    this._stopped = true;
    this._finishedSpans = [];
    return forceFlush;
  }

  /** @inheritDoc */
  public forceFlush(): Promise<void> {
    return new Promise(resolve => {
      this.export(this._finishedSpans, () => resolve());
    });
  }
}

/**
 * Send the given spans, but only if they are part of a finished transaction.
 *
 * Returns the unsent spans.
 * Spans remain unsent when their parent span is not yet finished.
 * This will happen regularly, as child spans are generally finished before their parents.
 * But it _could_ also happen because, for whatever reason, a parent span was lost.
 * In this case, we'll eventually need to clean this up.
 */
function maybeSend(spans: ReadableSpan[]): ReadableSpan[] {
  const grouped = groupSpansWithParents(spans);
  const remaining = new Set(grouped);

  const rootNodes = getCompletedRootNodes(grouped);

  rootNodes.forEach(root => {
    remaining.delete(root);
    const span = root.span;
    const transaction = createTransactionForOtelSpan(span);

    root.children.forEach(child => {
      createAndFinishSpanForOtelSpan(child, transaction, remaining);
    });

    transaction.end(span.endTime);
  });

  return Array.from(remaining)
    .map(node => node.span)
    .filter((span): span is ReadableSpan => !!span);
}

function getCompletedRootNodes(nodes: SpanNode[]): SpanNodeCompleted[] {
  return nodes.filter((node): node is SpanNodeCompleted => !!node.span && !node.parentNode);
}

function shouldCleanupSpan(span: ReadableSpan, maxStartTimeOffsetSeconds: number): boolean {
  const cutoff = Date.now() / 1000 - maxStartTimeOffsetSeconds;
  return convertOtelTimeToSeconds(span.startTime) < cutoff;
}

function parseSpan(span: ReadableSpan): { op?: string; origin?: SpanOrigin; source?: TransactionSource } {
  const attributes = span.attributes;

  const origin = attributes[SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN] as SpanOrigin | undefined;
  const op = attributes[SEMANTIC_ATTRIBUTE_SENTRY_OP] as string | undefined;
  const source = attributes[SEMANTIC_ATTRIBUTE_SENTRY_SOURCE] as TransactionSource | undefined;

  return { origin, op, source };
}

function createTransactionForOtelSpan(span: ReadableSpan): Transaction {
  // eslint-disable-next-line deprecation/deprecation
  const hub = getSpanHub(span) || getCurrentHub();
  const spanContext = span.spanContext();
  const spanId = spanContext.spanId;
  const traceId = spanContext.traceId;
  const parentSpanId = span.parentSpanId;

  const parentSampled = span.attributes[InternalSentrySemanticAttributes.PARENT_SAMPLED] as boolean | undefined;

  const { op, description, data, origin, source } = getSpanData(span);
  const metadata = getSpanMetadata(span);
  const capturedSpanScopes = getSpanScopes(span);

  const sampleRate = span.attributes[SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE] as number | undefined;

  const attributes = {
    [SEMANTIC_ATTRIBUTE_SENTRY_SOURCE]: source,
    [SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE]: sampleRate,
    ...data,
    ...removeSentryAttributes(span.attributes),
  };

  const dynamicSamplingContext = getDynamicSamplingContextFromSpan(span);

  const transaction = startTransaction(hub, {
    spanId,
    traceId,
    parentSpanId,
    parentSampled,
    name: description,
    op,
    startTimestamp: convertOtelTimeToSeconds(span.startTime),
    metadata: {
      ...dropUndefinedKeys({
        dynamicSamplingContext,
        sampleRate,
      }),
      ...metadata,
    },
    attributes,
    origin,
    sampled: true,
  });

  transaction.setStatus(mapStatus(span));

  // We currently don't want to write this to the scope because it would mutate it.
  // In the future we will likely have some sort of transaction payload factory where we can pass this context in directly
  // eslint-disable-next-line deprecation/deprecation
  transaction.setContext('otel', {
    attributes: removeSentryAttributes(span.attributes),
    resource: span.resource.attributes,
  });

  if (capturedSpanScopes) {
    setCapturedScopesOnTransaction(transaction, capturedSpanScopes.scope, capturedSpanScopes.isolationScope);
  }

  return transaction;
}

function createAndFinishSpanForOtelSpan(node: SpanNode, sentryParentSpan: SentrySpan, remaining: Set<SpanNode>): void {
  remaining.delete(node);
  const span = node.span;

  const shouldDrop = !span;

  // If this span should be dropped, we still want to create spans for the children of this
  if (shouldDrop) {
    node.children.forEach(child => {
      createAndFinishSpanForOtelSpan(child, sentryParentSpan, remaining);
    });
    return;
  }

  const spanId = span.spanContext().spanId;
  const { attributes } = span;

  const { op, description, data, origin } = getSpanData(span);
  const allData = { ...removeSentryAttributes(attributes), ...data };

  // eslint-disable-next-line deprecation/deprecation
  const sentrySpan = sentryParentSpan.startChild({
    name: description,
    op,
    data: allData,
    startTimestamp: convertOtelTimeToSeconds(span.startTime),
    spanId,
    origin,
  }) as SentrySpan;
  sentrySpan.setStatus(mapStatus(span));

  node.children.forEach(child => {
    createAndFinishSpanForOtelSpan(child, sentrySpan, remaining);
  });

  sentrySpan.end(convertOtelTimeToSeconds(span.endTime));
}

function getSpanData(span: ReadableSpan): {
  data: Record<string, unknown>;
  op?: string;
  description: string;
  source?: TransactionSource;
  origin?: SpanOrigin;
} {
  const { op: definedOp, source: definedSource, origin } = parseSpan(span);
  const { op: inferredOp, description, source: inferredSource, data: inferredData } = parseSpanDescription(span);

  const op = definedOp || inferredOp;
  const source = definedSource || inferredSource;

  const data = { ...inferredData, ...getData(span) };

  return {
    op,
    description,
    source,
    origin,
    data,
  };
}

/**
 * Remove custom `sentry.` attribtues we do not need to send.
 * These are more carrier attributes we use inside of the SDK, we do not need to send them to the API.
 */
function removeSentryAttributes(data: Record<string, unknown>): Record<string, unknown> {
  const cleanedData = { ...data };

  /* eslint-disable @typescript-eslint/no-dynamic-delete */
  delete cleanedData[InternalSentrySemanticAttributes.PARENT_SAMPLED];
  delete cleanedData[SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE];
  /* eslint-enable @typescript-eslint/no-dynamic-delete */

  return cleanedData;
}

function getData(span: ReadableSpan): Record<string, unknown> {
  const attributes = span.attributes;
  const data: Record<string, unknown> = {
    'otel.kind': SpanKind[span.kind],
  };

  if (attributes[SemanticAttributes.HTTP_STATUS_CODE]) {
    const statusCode = attributes[SemanticAttributes.HTTP_STATUS_CODE] as string;
    data['http.response.status_code'] = statusCode;
  }

  const requestData = getRequestSpanData(span);

  if (requestData.url) {
    data.url = requestData.url;
  }

  if (requestData['http.query']) {
    data['http.query'] = requestData['http.query'].slice(1);
  }
  if (requestData['http.fragment']) {
    data['http.fragment'] = requestData['http.fragment'].slice(1);
  }

  return data;
}

const SCOPE_ON_START_SPAN_FIELD = '_sentryScope';
const ISOLATION_SCOPE_ON_START_SPAN_FIELD = '_sentryIsolationScope';

/** Sets the scope and isolation scope to be used for when the transaction is finished. */
function setCapturedScopesOnTransaction(span: Transaction, scope: Scope, isolationScope: Scope): void {
  if (span) {
    addNonEnumerableProperty(span, ISOLATION_SCOPE_ON_START_SPAN_FIELD, isolationScope);
    addNonEnumerableProperty(span, SCOPE_ON_START_SPAN_FIELD, scope);
  }
}
