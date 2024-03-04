import type { Span, TimeInput } from '@opentelemetry/api';
import { ROOT_CONTEXT } from '@opentelemetry/api';
import { SpanKind } from '@opentelemetry/api';
import { TraceFlags, context, trace } from '@opentelemetry/api';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { Span as SpanClass } from '@opentelemetry/sdk-trace-base';
import {
  SEMANTIC_ATTRIBUTE_SENTRY_OP,
  SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN,
  SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE,
  SEMANTIC_ATTRIBUTE_SENTRY_SOURCE,
  getClient,
  getCurrentScope,
  withScope,
} from '@sentry/core';
import type { Event, Scope } from '@sentry/types';

import { startInactiveSpan, startSpan, startSpanManual } from '../src/trace';
import type { AbstractSpan } from '../src/types';
import { getActiveSpan, getRootSpan } from '../src/utils/getActiveSpan';
import { getSpanKind } from '../src/utils/getSpanKind';
import { getSpanMetadata } from '../src/utils/spanData';
import { spanHasAttributes, spanHasName } from '../src/utils/spanTypes';
import { cleanupOtel, mockSdkInit } from './helpers/mockSdkInit';

describe('trace', () => {
  beforeEach(() => {
    mockSdkInit({ enableTracing: true });
  });

  afterEach(() => {
    cleanupOtel();
  });

  describe('startSpan', () => {
    it('works with a sync callback', () => {
      const spans: Span[] = [];

      expect(getActiveSpan()).toEqual(undefined);

      const res = startSpan({ name: 'outer' }, outerSpan => {
        expect(outerSpan).toBeDefined();
        spans.push(outerSpan);

        expect(getSpanName(outerSpan)).toEqual('outer');
        expect(getActiveSpan()).toEqual(outerSpan);

        startSpan({ name: 'inner' }, innerSpan => {
          expect(innerSpan).toBeDefined();
          spans.push(innerSpan);

          expect(getSpanName(innerSpan)).toEqual('inner');
          expect(getActiveSpan()).toEqual(innerSpan);
        });

        return 'test value';
      });

      expect(res).toEqual('test value');

      expect(getActiveSpan()).toEqual(undefined);
      expect(spans).toHaveLength(2);
      const [outerSpan, innerSpan] = spans;

      expect(getSpanName(outerSpan)).toEqual('outer');
      expect(getSpanName(innerSpan)).toEqual('inner');

      expect(getSpanEndTime(outerSpan)).not.toEqual([0, 0]);
      expect(getSpanEndTime(innerSpan)).not.toEqual([0, 0]);
    });

    it('works with an async callback', async () => {
      const spans: Span[] = [];

      expect(getActiveSpan()).toEqual(undefined);

      const res = await startSpan({ name: 'outer' }, async outerSpan => {
        expect(outerSpan).toBeDefined();
        spans.push(outerSpan);

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(getSpanName(outerSpan)).toEqual('outer');
        expect(getActiveSpan()).toEqual(outerSpan);

        await startSpan({ name: 'inner' }, async innerSpan => {
          expect(innerSpan).toBeDefined();
          spans.push(innerSpan);

          await new Promise(resolve => setTimeout(resolve, 10));

          expect(getSpanName(innerSpan)).toEqual('inner');
          expect(getActiveSpan()).toEqual(innerSpan);
        });

        return 'test value';
      });

      expect(res).toEqual('test value');

      expect(getActiveSpan()).toEqual(undefined);
      expect(spans).toHaveLength(2);
      const [outerSpan, innerSpan] = spans;

      expect(getSpanName(outerSpan)).toEqual('outer');
      expect(getSpanName(innerSpan)).toEqual('inner');

      expect(getSpanEndTime(outerSpan)).not.toEqual([0, 0]);
      expect(getSpanEndTime(innerSpan)).not.toEqual([0, 0]);
    });

    it('works with multiple parallel calls', () => {
      const spans1: Span[] = [];
      const spans2: Span[] = [];

      expect(getActiveSpan()).toEqual(undefined);

      startSpan({ name: 'outer' }, outerSpan => {
        expect(outerSpan).toBeDefined();
        spans1.push(outerSpan);

        expect(getSpanName(outerSpan)).toEqual('outer');
        expect(getActiveSpan()).toEqual(outerSpan);

        startSpan({ name: 'inner' }, innerSpan => {
          expect(innerSpan).toBeDefined();
          spans1.push(innerSpan);

          expect(getSpanName(innerSpan)).toEqual('inner');
          expect(getActiveSpan()).toEqual(innerSpan);
        });
      });

      startSpan({ name: 'outer2' }, outerSpan => {
        expect(outerSpan).toBeDefined();
        spans2.push(outerSpan);

        expect(getSpanName(outerSpan)).toEqual('outer2');
        expect(getActiveSpan()).toEqual(outerSpan);

        startSpan({ name: 'inner2' }, innerSpan => {
          expect(innerSpan).toBeDefined();
          spans2.push(innerSpan);

          expect(getSpanName(innerSpan)).toEqual('inner2');
          expect(getActiveSpan()).toEqual(innerSpan);
        });
      });

      expect(getActiveSpan()).toEqual(undefined);
      expect(spans1).toHaveLength(2);
      expect(spans2).toHaveLength(2);
    });

    it('works with multiple parallel async calls', async () => {
      const spans1: Span[] = [];
      const spans2: Span[] = [];

      expect(getActiveSpan()).toEqual(undefined);

      const promise1 = startSpan({ name: 'outer' }, async outerSpan => {
        expect(outerSpan).toBeDefined();
        spans1.push(outerSpan);

        expect(getSpanName(outerSpan)).toEqual('outer');
        expect(getActiveSpan()).toEqual(outerSpan);
        expect(getRootSpan(outerSpan)).toEqual(outerSpan);

        await new Promise(resolve => setTimeout(resolve, 10));

        await startSpan({ name: 'inner' }, async innerSpan => {
          expect(innerSpan).toBeDefined();
          spans1.push(innerSpan);

          expect(getSpanName(innerSpan)).toEqual('inner');
          expect(getActiveSpan()).toEqual(innerSpan);
          expect(getRootSpan(innerSpan)).toEqual(outerSpan);
        });
      });

      const promise2 = startSpan({ name: 'outer2' }, async outerSpan => {
        expect(outerSpan).toBeDefined();
        spans2.push(outerSpan);

        expect(getSpanName(outerSpan)).toEqual('outer2');
        expect(getActiveSpan()).toEqual(outerSpan);
        expect(getRootSpan(outerSpan)).toEqual(outerSpan);

        await new Promise(resolve => setTimeout(resolve, 10));

        await startSpan({ name: 'inner2' }, async innerSpan => {
          expect(innerSpan).toBeDefined();
          spans2.push(innerSpan);

          expect(getSpanName(innerSpan)).toEqual('inner2');
          expect(getActiveSpan()).toEqual(innerSpan);
          expect(getRootSpan(innerSpan)).toEqual(outerSpan);
        });
      });

      await Promise.all([promise1, promise2]);

      expect(getActiveSpan()).toEqual(undefined);
      expect(spans1).toHaveLength(2);
      expect(spans2).toHaveLength(2);
    });

    it('allows to pass context arguments', () => {
      startSpan(
        {
          name: 'outer',
        },
        span => {
          expect(span).toBeDefined();
          expect(getSpanAttributes(span)).toEqual({
            [SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE]: 1,
          });

          expect(getSpanMetadata(span)).toEqual(undefined);
        },
      );

      startSpan(
        {
          name: 'outer',
          op: 'my-op',
          origin: 'auto.test.origin',
          metadata: { requestPath: 'test-path' },
          attributes: {
            [SEMANTIC_ATTRIBUTE_SENTRY_SOURCE]: 'task',
          },
        },
        span => {
          expect(span).toBeDefined();
          expect(getSpanAttributes(span)).toEqual({
            [SEMANTIC_ATTRIBUTE_SENTRY_SOURCE]: 'task',
            [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'auto.test.origin',
            [SEMANTIC_ATTRIBUTE_SENTRY_OP]: 'my-op',
            [SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE]: 1,
          });

          expect(getSpanMetadata(span)).toEqual({ requestPath: 'test-path' });
        },
      );
    });

    it('allows to pass base SpanOptions', () => {
      const date = [5000, 0] as TimeInput;

      startSpan(
        {
          name: 'outer',
          kind: SpanKind.CLIENT,
          attributes: {
            test1: 'test 1',
            test2: 2,
          },
          startTime: date,
        },
        span => {
          expect(span).toBeDefined();
          expect(getSpanName(span)).toEqual('outer');
          expect(getSpanStartTime(span)).toEqual(date);
          expect(getSpanAttributes(span)).toEqual({
            [SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE]: 1,
            test1: 'test 1',
            test2: 2,
          });
          expect(getSpanKind(span)).toEqual(SpanKind.CLIENT);
        },
      );
    });

    it('allows to pass a startTime in seconds', () => {
      const startTime = 1708504860.961;
      const start = startSpan({ name: 'outer', startTime: startTime }, span => {
        return getSpanStartTime(span);
      });

      expect(start).toEqual([1708504860, 961000000]);
    });

    it('allows to pass a scope', () => {
      const initialScope = getCurrentScope();

      let manualScope: Scope;
      let parentSpan: Span;

      startSpanManual({ name: 'detached' }, span => {
        parentSpan = span;
        manualScope = getCurrentScope();
        manualScope.setTag('manual', 'tag');
      });

      getCurrentScope().setTag('outer', 'tag');

      startSpan({ name: 'GET users/[id]', scope: manualScope! }, span => {
        expect(getCurrentScope()).not.toBe(initialScope);

        expect(getCurrentScope()).toEqual(manualScope);
        expect(getActiveSpan()).toBe(span);

        expect(getSpanParentSpanId(span)).toBe(parentSpan.spanContext().spanId);
      });

      expect(getCurrentScope()).toBe(initialScope);
      expect(getActiveSpan()).toBe(undefined);
    });

    it('allows to force a transaction with forceTransaction=true', async () => {
      const client = getClient()!;
      const transactionEvents: Event[] = [];

      client.getOptions().beforeSendTransaction = event => {
        transactionEvents.push({
          ...event,
          sdkProcessingMetadata: {
            dynamicSamplingContext: event.sdkProcessingMetadata?.dynamicSamplingContext,
          },
        });
        return event;
      };

      startSpan({ name: 'outer transaction' }, () => {
        startSpan({ name: 'inner span' }, () => {
          startSpan({ name: 'inner transaction', forceTransaction: true }, () => {
            startSpan({ name: 'inner span 2' }, () => {
              // all good
            });
          });
        });
      });

      await client.flush();

      const normalizedTransactionEvents = transactionEvents.map(event => {
        return {
          ...event,
          spans: event.spans?.map(span => ({ name: span.description, id: span.span_id })),
        };
      });

      expect(normalizedTransactionEvents).toHaveLength(2);

      const outerTransaction = normalizedTransactionEvents.find(event => event.transaction === 'outer transaction');
      const innerTransaction = normalizedTransactionEvents.find(event => event.transaction === 'inner transaction');

      const outerTraceId = outerTransaction?.contexts?.trace?.trace_id;
      // The inner transaction should be a child of the last span of the outer transaction
      const innerParentSpanId = outerTransaction?.spans?.[0].id;
      const innerSpanId = innerTransaction?.contexts?.trace?.span_id;

      expect(outerTraceId).toBeDefined();
      expect(innerParentSpanId).toBeDefined();
      expect(innerSpanId).toBeDefined();
      // inner span ID should _not_ be the parent span ID, but the id of the new span
      expect(innerSpanId).not.toEqual(innerParentSpanId);

      expect(outerTransaction?.contexts?.trace).toEqual({
        data: {
          'sentry.source': 'custom',
          'sentry.sample_rate': 1,
          'sentry.origin': 'manual',
          'otel.kind': 'INTERNAL',
        },
        span_id: expect.any(String),
        trace_id: expect.any(String),
        origin: 'manual',
        status: 'ok',
      });
      expect(outerTransaction?.spans).toEqual([{ name: 'inner span', id: expect.any(String) }]);
      expect(outerTransaction?.transaction).toEqual('outer transaction');
      expect(outerTransaction?.sdkProcessingMetadata).toEqual({
        dynamicSamplingContext: {
          environment: 'production',
          public_key: 'username',
          trace_id: outerTraceId,
          sample_rate: '1',
          transaction: 'outer transaction',
          sampled: 'true',
        },
      });

      expect(innerTransaction?.contexts?.trace).toEqual({
        data: {
          'sentry.source': 'custom',
          'sentry.origin': 'manual',
          'otel.kind': 'INTERNAL',
          'sentry.sample_rate': 1,
        },
        parent_span_id: innerParentSpanId,
        span_id: expect.any(String),
        trace_id: outerTraceId,
        origin: 'manual',
        status: 'ok',
      });
      expect(innerTransaction?.spans).toEqual([{ name: 'inner span 2', id: expect.any(String) }]);
      expect(innerTransaction?.transaction).toEqual('inner transaction');
      expect(innerTransaction?.sdkProcessingMetadata).toEqual({
        dynamicSamplingContext: {
          environment: 'production',
          public_key: 'username',
          trace_id: outerTraceId,
          sample_rate: '1',
          transaction: 'outer transaction',
          sampled: 'true',
        },
      });
    });

    // TODO: propagation scope is not picked up by spans...

    describe('onlyIfParent', () => {
      it('does not create a span if there is no parent', () => {
        const span = startSpan({ name: 'test span', onlyIfParent: true }, span => {
          return span;
        });

        expect(span).not.toBeInstanceOf(SpanClass);
      });

      it('creates a span if there is a parent', () => {
        const span = startSpan({ name: 'parent span' }, () => {
          const span = startSpan({ name: 'test span', onlyIfParent: true }, span => {
            return span;
          });

          return span;
        });

        expect(span).toBeInstanceOf(SpanClass);
      });
    });
  });

  describe('startInactiveSpan', () => {
    it('works at the root', () => {
      const span = startInactiveSpan({ name: 'test' });

      expect(span).toBeDefined();
      expect(getSpanName(span)).toEqual('test');
      expect(getSpanEndTime(span)).toEqual([0, 0]);
      expect(getActiveSpan()).toBeUndefined();

      span.end();

      expect(getSpanEndTime(span)).not.toEqual([0, 0]);
      expect(getActiveSpan()).toBeUndefined();
    });

    it('works as a child span', () => {
      startSpan({ name: 'outer' }, outerSpan => {
        expect(outerSpan).toBeDefined();
        expect(getActiveSpan()).toEqual(outerSpan);

        const innerSpan = startInactiveSpan({ name: 'test' });

        expect(innerSpan).toBeDefined();
        expect(getSpanName(innerSpan)).toEqual('test');
        expect(getSpanEndTime(innerSpan)).toEqual([0, 0]);
        expect(getActiveSpan()).toEqual(outerSpan);

        innerSpan.end();

        expect(getSpanEndTime(innerSpan)).not.toEqual([0, 0]);
        expect(getActiveSpan()).toEqual(outerSpan);
      });
    });

    it('allows to pass context arguments', () => {
      const span = startInactiveSpan({
        name: 'outer',
      });

      expect(span).toBeDefined();
      expect(getSpanAttributes(span)).toEqual({
        [SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE]: 1,
      });

      expect(getSpanMetadata(span)).toEqual(undefined);

      const span2 = startInactiveSpan({
        name: 'outer',
        op: 'my-op',
        origin: 'auto.test.origin',
        attributes: {
          [SEMANTIC_ATTRIBUTE_SENTRY_SOURCE]: 'task',
        },
        metadata: { requestPath: 'test-path' },
      });

      expect(span2).toBeDefined();
      expect(getSpanAttributes(span2)).toEqual({
        [SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE]: 1,
        [SEMANTIC_ATTRIBUTE_SENTRY_SOURCE]: 'task',
        [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'auto.test.origin',
        [SEMANTIC_ATTRIBUTE_SENTRY_OP]: 'my-op',
      });

      expect(getSpanMetadata(span2)).toEqual({ requestPath: 'test-path' });
    });

    it('allows to pass base SpanOptions', () => {
      const date = [5000, 0] as TimeInput;

      const span = startInactiveSpan({
        name: 'outer',
        kind: SpanKind.CLIENT,
        attributes: {
          test1: 'test 1',
          test2: 2,
        },
        startTime: date,
      });

      expect(span).toBeDefined();
      expect(getSpanName(span)).toEqual('outer');
      expect(getSpanStartTime(span)).toEqual(date);
      expect(getSpanAttributes(span)).toEqual({
        [SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE]: 1,
        test1: 'test 1',
        test2: 2,
      });
      expect(getSpanKind(span)).toEqual(SpanKind.CLIENT);
    });

    it('allows to pass a startTime in seconds', () => {
      const startTime = 1708504860.961;
      const span = startInactiveSpan({ name: 'outer', startTime: startTime });

      expect(getSpanStartTime(span)).toEqual([1708504860, 961000000]);
    });

    it('allows to pass a scope', () => {
      const initialScope = getCurrentScope();

      let manualScope: Scope;
      let parentSpan: Span;

      startSpanManual({ name: 'detached' }, span => {
        parentSpan = span;
        manualScope = getCurrentScope();
        manualScope.setTag('manual', 'tag');
      });

      getCurrentScope().setTag('outer', 'tag');

      const span = startInactiveSpan({ name: 'GET users/[id]', scope: manualScope! });
      expect(getSpanParentSpanId(span)).toBe(parentSpan!.spanContext().spanId);

      expect(getCurrentScope()).toBe(initialScope);
      expect(getActiveSpan()).toBe(undefined);
    });

    it('allows to force a transaction with forceTransaction=true', async () => {
      const client = getClient()!;
      const transactionEvents: Event[] = [];

      client.getOptions().beforeSendTransaction = event => {
        transactionEvents.push({
          ...event,
          sdkProcessingMetadata: {
            dynamicSamplingContext: event.sdkProcessingMetadata?.dynamicSamplingContext,
          },
        });
        return event;
      };

      startSpan({ name: 'outer transaction' }, () => {
        startSpan({ name: 'inner span' }, () => {
          const innerTransaction = startInactiveSpan({ name: 'inner transaction', forceTransaction: true });
          innerTransaction?.end();
        });
      });

      await client.flush();

      const normalizedTransactionEvents = transactionEvents.map(event => {
        return {
          ...event,
          spans: event.spans?.map(span => ({ name: span.description, id: span.span_id })),
        };
      });

      expect(normalizedTransactionEvents).toHaveLength(2);

      const outerTransaction = normalizedTransactionEvents.find(event => event.transaction === 'outer transaction');
      const innerTransaction = normalizedTransactionEvents.find(event => event.transaction === 'inner transaction');

      const outerTraceId = outerTransaction?.contexts?.trace?.trace_id;
      // The inner transaction should be a child of the last span of the outer transaction
      const innerParentSpanId = outerTransaction?.spans?.[0].id;
      const innerSpanId = innerTransaction?.contexts?.trace?.span_id;

      expect(outerTraceId).toBeDefined();
      expect(innerParentSpanId).toBeDefined();
      expect(innerSpanId).toBeDefined();
      // inner span ID should _not_ be the parent span ID, but the id of the new span
      expect(innerSpanId).not.toEqual(innerParentSpanId);

      expect(outerTransaction?.contexts?.trace).toEqual({
        data: {
          'sentry.source': 'custom',
          'sentry.sample_rate': 1,
          'sentry.origin': 'manual',
          'otel.kind': 'INTERNAL',
        },
        span_id: expect.any(String),
        trace_id: expect.any(String),
        origin: 'manual',
        status: 'ok',
      });
      expect(outerTransaction?.spans).toEqual([{ name: 'inner span', id: expect.any(String) }]);
      expect(outerTransaction?.transaction).toEqual('outer transaction');
      expect(outerTransaction?.sdkProcessingMetadata).toEqual({
        dynamicSamplingContext: {
          environment: 'production',
          public_key: 'username',
          trace_id: outerTraceId,
          sample_rate: '1',
          transaction: 'outer transaction',
          sampled: 'true',
        },
      });

      expect(innerTransaction?.contexts?.trace).toEqual({
        data: {
          'sentry.source': 'custom',
          'sentry.origin': 'manual',
          'otel.kind': 'INTERNAL',
          'sentry.sample_rate': 1,
        },
        parent_span_id: innerParentSpanId,
        span_id: expect.any(String),
        trace_id: outerTraceId,
        origin: 'manual',
        status: 'ok',
      });
      expect(innerTransaction?.spans).toEqual([]);
      expect(innerTransaction?.transaction).toEqual('inner transaction');
      expect(innerTransaction?.sdkProcessingMetadata).toEqual({
        dynamicSamplingContext: {
          environment: 'production',
          public_key: 'username',
          trace_id: outerTraceId,
          sample_rate: '1',
          transaction: 'outer transaction',
          sampled: 'true',
        },
      });
    });

    describe('onlyIfParent', () => {
      it('does not create a span if there is no parent', () => {
        const span = startInactiveSpan({ name: 'test span', onlyIfParent: true });

        expect(span).not.toBeInstanceOf(SpanClass);
      });

      it('creates a span if there is a parent', () => {
        const span = startSpan({ name: 'parent span' }, () => {
          const span = startInactiveSpan({ name: 'test span', onlyIfParent: true });

          return span;
        });

        expect(span).toBeInstanceOf(SpanClass);
      });
    });

    it('includes the scope at the time the span was started when finished', async () => {
      const beforeSendTransaction = jest.fn(event => event);

      const client = getClient()!;

      client.getOptions().beforeSendTransaction = beforeSendTransaction;

      let span: Span | undefined;

      const scope = getCurrentScope();
      scope.setTag('outer', 'foo');

      withScope(scope => {
        scope.setTag('scope', 1);
        span = startInactiveSpan({ name: 'my-span' });
        scope.setTag('scope_after_span', 2);
      });

      withScope(scope => {
        scope.setTag('scope', 2);
        span?.end();
      });

      await client.flush();

      expect(beforeSendTransaction).toHaveBeenCalledTimes(1);
      expect(beforeSendTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: expect.objectContaining({
            outer: 'foo',
            scope: 1,
            scope_after_span: 2,
          }),
        }),
        expect.anything(),
      );
    });
  });

  describe('startSpanManual', () => {
    it('does not automatically finish the span', () => {
      expect(getActiveSpan()).toEqual(undefined);

      let _outerSpan: Span | undefined;
      let _innerSpan: Span | undefined;

      const res = startSpanManual({ name: 'outer' }, outerSpan => {
        expect(outerSpan).toBeDefined();
        _outerSpan = outerSpan;

        expect(getSpanName(outerSpan)).toEqual('outer');
        expect(getActiveSpan()).toEqual(outerSpan);

        startSpanManual({ name: 'inner' }, innerSpan => {
          expect(innerSpan).toBeDefined();
          _innerSpan = innerSpan;

          expect(getSpanName(innerSpan)).toEqual('inner');
          expect(getActiveSpan()).toEqual(innerSpan);
        });

        expect(getSpanEndTime(_innerSpan!)).toEqual([0, 0]);

        _innerSpan!.end();

        expect(getSpanEndTime(_innerSpan!)).not.toEqual([0, 0]);

        return 'test value';
      });

      expect(getSpanEndTime(_outerSpan!)).toEqual([0, 0]);

      _outerSpan!.end();

      expect(getSpanEndTime(_outerSpan!)).not.toEqual([0, 0]);

      expect(res).toEqual('test value');

      expect(getActiveSpan()).toEqual(undefined);
    });

    it('allows to pass base SpanOptions', () => {
      const date = [5000, 0] as TimeInput;

      startSpanManual(
        {
          name: 'outer',
          kind: SpanKind.CLIENT,
          attributes: {
            test1: 'test 1',
            test2: 2,
          },
          startTime: date,
        },
        span => {
          expect(span).toBeDefined();
          expect(getSpanName(span)).toEqual('outer');
          expect(getSpanStartTime(span)).toEqual(date);
          expect(getSpanAttributes(span)).toEqual({
            [SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE]: 1,
            test1: 'test 1',
            test2: 2,
          });
          expect(getSpanKind(span)).toEqual(SpanKind.CLIENT);
        },
      );
    });

    it('allows to pass a startTime in seconds', () => {
      const startTime = 1708504860.961;
      const start = startSpanManual({ name: 'outer', startTime: startTime }, span => {
        const start = getSpanStartTime(span);
        span.end();
        return start;
      });

      expect(start).toEqual([1708504860, 961000000]);
    });

    it('allows to pass a scope', () => {
      const initialScope = getCurrentScope();

      let manualScope: Scope;
      let parentSpan: Span;

      startSpanManual({ name: 'detached' }, span => {
        parentSpan = span;
        manualScope = getCurrentScope();
        manualScope.setTag('manual', 'tag');
      });

      getCurrentScope().setTag('outer', 'tag');

      startSpanManual({ name: 'GET users/[id]', scope: manualScope! }, span => {
        expect(getCurrentScope()).not.toBe(initialScope);

        expect(getCurrentScope()).toEqual(manualScope);
        expect(getActiveSpan()).toBe(span);

        expect(getSpanParentSpanId(span)).toBe(parentSpan.spanContext().spanId);

        span.end();
      });

      expect(getCurrentScope()).toBe(initialScope);
      expect(getActiveSpan()).toBe(undefined);
    });

    it('allows to force a transaction with forceTransaction=true', async () => {
      const client = getClient()!;
      const transactionEvents: Event[] = [];

      client.getOptions().beforeSendTransaction = event => {
        transactionEvents.push({
          ...event,
          sdkProcessingMetadata: {
            dynamicSamplingContext: event.sdkProcessingMetadata?.dynamicSamplingContext,
          },
        });
        return event;
      };

      startSpanManual({ name: 'outer transaction' }, span => {
        startSpanManual({ name: 'inner span' }, span => {
          startSpanManual({ name: 'inner transaction', forceTransaction: true }, span => {
            startSpanManual({ name: 'inner span 2' }, span => {
              // all good
              span?.end();
            });
            span?.end();
          });
          span?.end();
        });
        span?.end();
      });

      await client.flush();

      const normalizedTransactionEvents = transactionEvents.map(event => {
        return {
          ...event,
          spans: event.spans?.map(span => ({ name: span.description, id: span.span_id })),
        };
      });

      expect(normalizedTransactionEvents).toHaveLength(2);

      const outerTransaction = normalizedTransactionEvents.find(event => event.transaction === 'outer transaction');
      const innerTransaction = normalizedTransactionEvents.find(event => event.transaction === 'inner transaction');

      const outerTraceId = outerTransaction?.contexts?.trace?.trace_id;
      // The inner transaction should be a child of the last span of the outer transaction
      const innerParentSpanId = outerTransaction?.spans?.[0].id;
      const innerSpanId = innerTransaction?.contexts?.trace?.span_id;

      expect(outerTraceId).toBeDefined();
      expect(innerParentSpanId).toBeDefined();
      expect(innerSpanId).toBeDefined();
      // inner span ID should _not_ be the parent span ID, but the id of the new span
      expect(innerSpanId).not.toEqual(innerParentSpanId);

      expect(outerTransaction?.contexts?.trace).toEqual({
        data: {
          'sentry.source': 'custom',
          'sentry.sample_rate': 1,
          'sentry.origin': 'manual',
          'otel.kind': 'INTERNAL',
        },
        span_id: expect.any(String),
        trace_id: expect.any(String),
        origin: 'manual',
        status: 'ok',
      });
      expect(outerTransaction?.spans).toEqual([{ name: 'inner span', id: expect.any(String) }]);
      expect(outerTransaction?.transaction).toEqual('outer transaction');
      expect(outerTransaction?.sdkProcessingMetadata).toEqual({
        dynamicSamplingContext: {
          environment: 'production',
          public_key: 'username',
          trace_id: outerTraceId,
          sample_rate: '1',
          transaction: 'outer transaction',
          sampled: 'true',
        },
      });

      expect(innerTransaction?.contexts?.trace).toEqual({
        data: {
          'sentry.source': 'custom',
          'sentry.origin': 'manual',
          'otel.kind': 'INTERNAL',
          'sentry.sample_rate': 1,
        },
        parent_span_id: innerParentSpanId,
        span_id: expect.any(String),
        trace_id: outerTraceId,
        origin: 'manual',
        status: 'ok',
      });
      expect(innerTransaction?.spans).toEqual([{ name: 'inner span 2', id: expect.any(String) }]);
      expect(innerTransaction?.transaction).toEqual('inner transaction');
      expect(innerTransaction?.sdkProcessingMetadata).toEqual({
        dynamicSamplingContext: {
          environment: 'production',
          public_key: 'username',
          trace_id: outerTraceId,
          sample_rate: '1',
          transaction: 'outer transaction',
          sampled: 'true',
        },
      });
    });

    describe('onlyIfParent', () => {
      it('does not create a span if there is no parent', () => {
        const span = startSpanManual({ name: 'test span', onlyIfParent: true }, span => {
          return span;
        });

        expect(span).not.toBeInstanceOf(SpanClass);
      });

      it('creates a span if there is a parent', () => {
        const span = startSpan({ name: 'parent span' }, () => {
          const span = startSpanManual({ name: 'test span', onlyIfParent: true }, span => {
            return span;
          });

          return span;
        });

        expect(span).toBeInstanceOf(SpanClass);
      });
    });
  });
});

describe('trace (tracing disabled)', () => {
  beforeEach(() => {
    mockSdkInit({ enableTracing: false });
  });

  afterEach(() => {
    cleanupOtel();
  });

  it('startSpan calls callback without span', () => {
    const val = startSpan({ name: 'outer' }, outerSpan => {
      expect(outerSpan).toBeDefined();
      expect(outerSpan.isRecording()).toBe(false);

      return 'test value';
    });

    expect(val).toEqual('test value');
  });

  it('startInactiveSpan returns a NonRecordinSpan', () => {
    const span = startInactiveSpan({ name: 'test' });

    expect(span).toBeDefined();
    expect(span.isRecording()).toBe(false);
  });
});

describe('trace (sampling)', () => {
  afterEach(() => {
    cleanupOtel();
    jest.clearAllMocks();
  });

  it('samples with a tracesSampleRate, when Math.random() > tracesSampleRate', () => {
    jest.spyOn(Math, 'random').mockImplementation(() => 0.6);

    mockSdkInit({ tracesSampleRate: 0.5 });

    startSpan({ name: 'outer' }, outerSpan => {
      expect(outerSpan).toBeDefined();
      expect(outerSpan.isRecording()).toBe(false);

      startSpan({ name: 'inner' }, innerSpan => {
        expect(innerSpan).toBeDefined();
        expect(innerSpan.isRecording()).toBe(false);
      });
    });
  });

  it('samples with a tracesSampleRate, when Math.random() < tracesSampleRate', () => {
    jest.spyOn(Math, 'random').mockImplementation(() => 0.4);

    mockSdkInit({ tracesSampleRate: 0.5 });

    startSpan({ name: 'outer' }, outerSpan => {
      expect(outerSpan).toBeDefined();
      expect(outerSpan.isRecording()).toBe(true);
      // All fields are empty for NonRecordingSpan
      expect(getSpanName(outerSpan)).toBe('outer');

      startSpan({ name: 'inner' }, innerSpan => {
        expect(innerSpan).toBeDefined();
        expect(innerSpan.isRecording()).toBe(true);
        expect(getSpanName(innerSpan)).toBe('inner');
      });
    });
  });

  it('positive parent sampling takes precedence over tracesSampleRate', () => {
    jest.spyOn(Math, 'random').mockImplementation(() => 0.6);

    mockSdkInit({ tracesSampleRate: 1 });

    // This will def. be sampled because of the tracesSampleRate
    startSpan({ name: 'outer' }, outerSpan => {
      expect(outerSpan).toBeDefined();
      expect(outerSpan.isRecording()).toBe(true);
      expect(getSpanName(outerSpan)).toBe('outer');

      // Now let's mutate the tracesSampleRate so that the next entry _should_ not be sampled
      // but it will because of parent sampling
      const client = getClient();
      client!.getOptions().tracesSampleRate = 0.5;

      startSpan({ name: 'inner' }, innerSpan => {
        expect(innerSpan).toBeDefined();
        expect(innerSpan.isRecording()).toBe(true);
        expect(getSpanName(innerSpan)).toBe('inner');
      });
    });
  });

  it('negative parent sampling takes precedence over tracesSampleRate', () => {
    jest.spyOn(Math, 'random').mockImplementation(() => 0.6);

    mockSdkInit({ tracesSampleRate: 0.5 });

    // This will def. be unsampled because of the tracesSampleRate
    startSpan({ name: 'outer' }, outerSpan => {
      expect(outerSpan).toBeDefined();
      expect(outerSpan.isRecording()).toBe(false);

      // Now let's mutate the tracesSampleRate so that the next entry _should_ be sampled
      // but it will remain unsampled because of parent sampling
      const client = getClient();
      client!.getOptions().tracesSampleRate = 1;

      startSpan({ name: 'inner' }, innerSpan => {
        expect(innerSpan).toBeDefined();
        expect(innerSpan.isRecording()).toBe(false);
      });
    });
  });

  it('positive remote parent sampling takes precedence over tracesSampleRate', () => {
    jest.spyOn(Math, 'random').mockImplementation(() => 0.6);

    mockSdkInit({ tracesSampleRate: 0.5 });

    const traceId = 'd4cda95b652f4a1592b449d5929fda1b';
    const parentSpanId = '6e0c63257de34c92';

    const spanContext = {
      traceId,
      spanId: parentSpanId,
      sampled: true,
      isRemote: true,
      traceFlags: TraceFlags.SAMPLED,
    };

    // We simulate the correct context we'd normally get from the SentryPropagator
    context.with(trace.setSpanContext(ROOT_CONTEXT, spanContext), () => {
      // This will def. be sampled because of the tracesSampleRate
      startSpan({ name: 'outer' }, outerSpan => {
        expect(outerSpan).toBeDefined();
        expect(outerSpan.isRecording()).toBe(true);
        expect(getSpanName(outerSpan)).toBe('outer');
      });
    });
  });

  it('negative remote parent sampling takes precedence over tracesSampleRate', () => {
    jest.spyOn(Math, 'random').mockImplementation(() => 0.6);

    mockSdkInit({ tracesSampleRate: 0.5 });

    const traceId = 'd4cda95b652f4a1592b449d5929fda1b';
    const parentSpanId = '6e0c63257de34c92';

    const spanContext = {
      traceId,
      spanId: parentSpanId,
      sampled: false,
      isRemote: true,
      traceFlags: TraceFlags.NONE,
    };

    // We simulate the correct context we'd normally get from the SentryPropagator
    context.with(trace.setSpanContext(ROOT_CONTEXT, spanContext), () => {
      // This will def. be sampled because of the tracesSampleRate
      startSpan({ name: 'outer' }, outerSpan => {
        expect(outerSpan).toBeDefined();
        expect(outerSpan.isRecording()).toBe(false);
      });
    });
  });

  it('samples with a tracesSampler returning a boolean', () => {
    let tracesSamplerResponse: boolean = true;

    const tracesSampler = jest.fn(() => {
      return tracesSamplerResponse;
    });

    mockSdkInit({ tracesSampler });

    startSpan({ name: 'outer' }, outerSpan => {
      expect(outerSpan).toBeDefined();
    });

    expect(tracesSampler).toBeCalledTimes(1);
    expect(tracesSampler).toHaveBeenLastCalledWith({
      parentSampled: undefined,
      name: 'outer',
      attributes: {
        [SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE]: 1,
      },
      transactionContext: { name: 'outer', parentSampled: undefined },
    });

    // Now return `false`, it should not sample
    tracesSamplerResponse = false;

    startSpan({ name: 'outer2' }, outerSpan => {
      expect(outerSpan.isRecording()).toBe(false);

      startSpan({ name: 'inner2' }, innerSpan => {
        expect(innerSpan.isRecording()).toBe(false);
      });
    });

    expect(tracesSampler).toHaveBeenCalledTimes(3);
    expect(tracesSampler).toHaveBeenLastCalledWith({
      parentSampled: false,
      name: 'inner2',
      attributes: {},
      transactionContext: { name: 'inner2', parentSampled: false },
    });
  });

  it('samples with a tracesSampler returning a number', () => {
    jest.spyOn(Math, 'random').mockImplementation(() => 0.6);

    let tracesSamplerResponse: number = 1;

    const tracesSampler = jest.fn(() => {
      return tracesSamplerResponse;
    });

    mockSdkInit({ tracesSampler });

    startSpan({ name: 'outer' }, outerSpan => {
      expect(outerSpan).toBeDefined();
    });

    expect(tracesSampler).toBeCalledTimes(1);
    expect(tracesSampler).toHaveBeenLastCalledWith({
      parentSampled: undefined,
      name: 'outer',
      attributes: {
        [SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE]: 1,
      },
      transactionContext: { name: 'outer', parentSampled: undefined },
    });

    // Now return `0`, it should not sample
    tracesSamplerResponse = 0;

    startSpan({ name: 'outer2' }, outerSpan => {
      expect(outerSpan.isRecording()).toBe(false);

      startSpan({ name: 'inner2' }, innerSpan => {
        expect(innerSpan.isRecording()).toBe(false);
      });
    });

    expect(tracesSampler).toHaveBeenCalledTimes(3);
    expect(tracesSampler).toHaveBeenLastCalledWith({
      parentSampled: false,
      name: 'inner2',
      attributes: {},
      transactionContext: { name: 'inner2', parentSampled: false },
    });

    // Now return `0.4`, it should not sample
    tracesSamplerResponse = 0.4;

    startSpan({ name: 'outer3' }, outerSpan => {
      expect(outerSpan.isRecording()).toBe(false);
    });

    expect(tracesSampler).toHaveBeenCalledTimes(4);
    expect(tracesSampler).toHaveBeenLastCalledWith({
      parentSampled: undefined,
      name: 'outer3',
      attributes: {},
      transactionContext: { name: 'outer3', parentSampled: undefined },
    });
  });

  it('samples with a tracesSampler even if parent is remotely sampled', () => {
    const tracesSampler = jest.fn(() => {
      return false;
    });

    mockSdkInit({ tracesSampler });
    const traceId = 'd4cda95b652f4a1592b449d5929fda1b';
    const parentSpanId = '6e0c63257de34c92';

    const spanContext = {
      traceId,
      spanId: parentSpanId,
      sampled: true,
      isRemote: true,
      traceFlags: TraceFlags.SAMPLED,
    };

    // We simulate the correct context we'd normally get from the SentryPropagator
    context.with(trace.setSpanContext(ROOT_CONTEXT, spanContext), () => {
      // This will def. be sampled because of the tracesSampleRate
      startSpan({ name: 'outer' }, outerSpan => {
        expect(outerSpan.isRecording()).toBe(false);
      });
    });

    expect(tracesSampler).toBeCalledTimes(1);
    expect(tracesSampler).toHaveBeenLastCalledWith({
      parentSampled: true,
      name: 'outer',
      attributes: {},
      transactionContext: {
        name: 'outer',
        parentSampled: true,
      },
    });
  });
});

function getSpanName(span: AbstractSpan): string | undefined {
  return spanHasName(span) ? span.name : undefined;
}

function getSpanEndTime(span: AbstractSpan): [number, number] | undefined {
  return (span as ReadableSpan).endTime;
}

function getSpanStartTime(span: AbstractSpan): [number, number] | undefined {
  return (span as ReadableSpan).startTime;
}

function getSpanAttributes(span: AbstractSpan): Record<string, unknown> | undefined {
  return spanHasAttributes(span) ? span.attributes : undefined;
}

function getSpanParentSpanId(span: AbstractSpan): string | undefined {
  return (span as ReadableSpan).parentSpanId;
}
