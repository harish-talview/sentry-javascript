import type { Hub, SpanTimeInput, TransactionContext } from '@sentry/types';
import { logger, timestampInSeconds } from '@sentry/utils';

import { DEBUG_BUILD } from '../debug-build';
import { spanTimeInputToSeconds, spanToJSON } from '../utils/spanUtils';
import type { SentrySpan } from './sentrySpan';
import { SpanRecorder } from './sentrySpan';
import { SPAN_STATUS_ERROR } from './spanstatus';
import { Transaction } from './transaction';

export const TRACING_DEFAULTS = {
  idleTimeout: 1000,
  finalTimeout: 30000,
  heartbeatInterval: 5000,
};

const FINISH_REASON_TAG = 'finishReason';

const IDLE_TRANSACTION_FINISH_REASONS = [
  'heartbeatFailed',
  'idleTimeout',
  'documentHidden',
  'finalTimeout',
  'externalFinish',
  'cancelled',
];

/**
 * @inheritDoc
 */
export class IdleTransactionSpanRecorder extends SpanRecorder {
  public constructor(
    private readonly _pushActivity: (id: string) => void,
    private readonly _popActivity: (id: string) => void,
    public transactionSpanId: string,
    maxlen?: number,
  ) {
    super(maxlen);
  }

  /**
   * @inheritDoc
   */
  public add(span: SentrySpan): void {
    // We should make sure we do not push and pop activities for
    // the transaction that this span recorder belongs to.
    if (span.spanContext().spanId !== this.transactionSpanId) {
      // We patch span.end() to pop an activity after setting an endTimestamp.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const originalEnd = span.end;
      span.end = (...rest: unknown[]) => {
        this._popActivity(span.spanContext().spanId);
        return originalEnd.apply(span, rest);
      };

      // We should only push new activities if the span does not have an end timestamp.
      if (spanToJSON(span).timestamp === undefined) {
        this._pushActivity(span.spanContext().spanId);
      }
    }

    super.add(span);
  }
}

export type BeforeFinishCallback = (transactionSpan: IdleTransaction, endTimestamp: number) => void;

/**
 * An IdleTransaction is a transaction that automatically finishes. It does this by tracking child spans as activities.
 * You can have multiple IdleTransactions active, but if the `onScope` option is specified, the idle transaction will
 * put itself on the scope on creation.
 */
export class IdleTransaction extends Transaction {
  // Activities store a list of active spans
  public activities: Record<string, boolean>;
  // Track state of activities in previous heartbeat
  private _prevHeartbeatString: string | undefined;

  // Amount of times heartbeat has counted. Will cause transaction to finish after 3 beats.
  private _heartbeatCounter: number;

  // We should not use heartbeat if we finished a transaction
  private _finished: boolean;

  // Idle timeout was canceled and we should finish the transaction with the last span end.
  private _idleTimeoutCanceledPermanently: boolean;

  private readonly _beforeFinishCallbacks: BeforeFinishCallback[];

  /**
   * Timer that tracks Transaction idleTimeout
   */
  private _idleTimeoutID: ReturnType<typeof setTimeout> | undefined;

  private _finishReason: (typeof IDLE_TRANSACTION_FINISH_REASONS)[number];

  private _autoFinishAllowed: boolean;

  /**
   * @deprecated Transactions will be removed in v8. Use spans instead.
   */
  public constructor(
    transactionContext: TransactionContext,
    private readonly _idleHub: Hub,
    /**
     * The time to wait in ms until the idle transaction will be finished. This timer is started each time
     * there are no active spans on this transaction.
     */
    private readonly _idleTimeout: number = TRACING_DEFAULTS.idleTimeout,
    /**
     * The final value in ms that a transaction cannot exceed
     */
    private readonly _finalTimeout: number = TRACING_DEFAULTS.finalTimeout,
    private readonly _heartbeatInterval: number = TRACING_DEFAULTS.heartbeatInterval,
    // Whether or not the transaction should put itself on the scope when it starts and pop itself off when it ends
    private readonly _onScope: boolean = false,
    /**
     * When set to `true`, will disable the idle timeout (`_idleTimeout` option) and heartbeat mechanisms (`_heartbeatInterval`
     * option) until the `sendAutoFinishSignal()` method is called. The final timeout mechanism (`_finalTimeout` option)
     * will not be affected by this option, meaning the transaction will definitely be finished when the final timeout is
     * reached, no matter what this option is configured to.
     *
     * Defaults to `false`.
     */
    delayAutoFinishUntilSignal: boolean = false,
  ) {
    super(transactionContext, _idleHub);

    this.activities = {};
    this._heartbeatCounter = 0;
    this._finished = false;
    this._idleTimeoutCanceledPermanently = false;
    this._beforeFinishCallbacks = [];
    this._finishReason = IDLE_TRANSACTION_FINISH_REASONS[4];
    this._autoFinishAllowed = !delayAutoFinishUntilSignal;

    if (_onScope) {
      // We set the transaction here on the scope so error events pick up the trace
      // context and attach it to the error.
      DEBUG_BUILD && logger.log(`Setting idle transaction on scope. Span ID: ${this.spanContext().spanId}`);
      // eslint-disable-next-line deprecation/deprecation
      _idleHub.getScope().setSpan(this);
    }

    if (!delayAutoFinishUntilSignal) {
      this._restartIdleTimeout();
    }

    setTimeout(() => {
      if (!this._finished) {
        this.setStatus({ code: SPAN_STATUS_ERROR, message: 'deadline_exceeded' });
        this._finishReason = IDLE_TRANSACTION_FINISH_REASONS[3];
        this.end();
      }
    }, this._finalTimeout);
  }

  /** {@inheritDoc} */
  public end(endTimestamp?: SpanTimeInput): string | undefined {
    const endTimestampInS = spanTimeInputToSeconds(endTimestamp);

    this._finished = true;
    this.activities = {};

    const op = spanToJSON(this).op;

    if (op === 'ui.action.click') {
      this.setAttribute(FINISH_REASON_TAG, this._finishReason);
    }

    // eslint-disable-next-line deprecation/deprecation
    if (this.spanRecorder) {
      DEBUG_BUILD &&
        logger.log('[Tracing] finishing IdleTransaction', new Date(endTimestampInS * 1000).toISOString(), op);

      for (const callback of this._beforeFinishCallbacks) {
        callback(this, endTimestampInS);
      }

      // eslint-disable-next-line deprecation/deprecation
      this.spanRecorder.spans = this.spanRecorder.spans.filter((span: SentrySpan) => {
        // If we are dealing with the transaction itself, we just return it
        if (span.spanContext().spanId === this.spanContext().spanId) {
          return true;
        }

        // We cancel all pending spans with status "cancelled" to indicate the idle transaction was finished early
        if (!spanToJSON(span).timestamp) {
          span.setStatus({ code: SPAN_STATUS_ERROR, message: 'cancelled' });
          span.end(endTimestampInS);
          DEBUG_BUILD &&
            logger.log('[Tracing] cancelling span since transaction ended early', JSON.stringify(span, undefined, 2));
        }

        const { start_timestamp: startTime, timestamp: endTime } = spanToJSON(span);
        const spanStartedBeforeTransactionFinish = startTime && startTime < endTimestampInS;

        // Add a delta with idle timeout so that we prevent false positives
        const timeoutWithMarginOfError = (this._finalTimeout + this._idleTimeout) / 1000;
        const spanEndedBeforeFinalTimeout = endTime && startTime && endTime - startTime < timeoutWithMarginOfError;

        if (DEBUG_BUILD) {
          const stringifiedSpan = JSON.stringify(span, undefined, 2);
          if (!spanStartedBeforeTransactionFinish) {
            logger.log('[Tracing] discarding Span since it happened after Transaction was finished', stringifiedSpan);
          } else if (!spanEndedBeforeFinalTimeout) {
            logger.log('[Tracing] discarding Span since it finished after Transaction final timeout', stringifiedSpan);
          }
        }

        return spanStartedBeforeTransactionFinish && spanEndedBeforeFinalTimeout;
      });

      DEBUG_BUILD && logger.log('[Tracing] flushing IdleTransaction');
    } else {
      DEBUG_BUILD && logger.log('[Tracing] No active IdleTransaction');
    }

    // if `this._onScope` is `true`, the transaction put itself on the scope when it started
    if (this._onScope) {
      // eslint-disable-next-line deprecation/deprecation
      const scope = this._idleHub.getScope();
      // eslint-disable-next-line deprecation/deprecation
      if (scope.getTransaction() === this) {
        // eslint-disable-next-line deprecation/deprecation
        scope.setSpan(undefined);
      }
    }

    return super.end(endTimestamp);
  }

  /**
   * Register a callback function that gets executed before the transaction finishes.
   * Useful for cleanup or if you want to add any additional spans based on current context.
   *
   * This is exposed because users have no other way of running something before an idle transaction
   * finishes.
   */
  public registerBeforeFinishCallback(callback: BeforeFinishCallback): void {
    this._beforeFinishCallbacks.push(callback);
  }

  /**
   * @inheritDoc
   */
  public initSpanRecorder(maxlen?: number): void {
    // eslint-disable-next-line deprecation/deprecation
    if (!this.spanRecorder) {
      const pushActivity = (id: string): void => {
        if (this._finished) {
          return;
        }
        this._pushActivity(id);
      };
      const popActivity = (id: string): void => {
        if (this._finished) {
          return;
        }
        this._popActivity(id);
      };

      // eslint-disable-next-line deprecation/deprecation
      this.spanRecorder = new IdleTransactionSpanRecorder(pushActivity, popActivity, this.spanContext().spanId, maxlen);

      // Start heartbeat so that transactions do not run forever.
      DEBUG_BUILD && logger.log('Starting heartbeat');
      this._pingHeartbeat();
    }
    // eslint-disable-next-line deprecation/deprecation
    this.spanRecorder.add(this);
  }

  /**
   * Cancels the existing idle timeout, if there is one.
   * @param restartOnChildSpanChange Default is `true`.
   *                                 If set to false the transaction will end
   *                                 with the last child span.
   */
  public cancelIdleTimeout(
    endTimestamp?: Parameters<IdleTransaction['end']>[0],
    {
      restartOnChildSpanChange,
    }: {
      restartOnChildSpanChange?: boolean;
    } = {
      restartOnChildSpanChange: true,
    },
  ): void {
    this._idleTimeoutCanceledPermanently = restartOnChildSpanChange === false;
    if (this._idleTimeoutID) {
      clearTimeout(this._idleTimeoutID);
      this._idleTimeoutID = undefined;

      if (Object.keys(this.activities).length === 0 && this._idleTimeoutCanceledPermanently) {
        this._finishReason = IDLE_TRANSACTION_FINISH_REASONS[5];
        this.end(endTimestamp);
      }
    }
  }

  /**
   * Temporary method used to externally set the transaction's `finishReason`
   *
   * ** WARNING**
   * This is for the purpose of experimentation only and will be removed in the near future, do not use!
   *
   * @internal
   *
   */
  public setFinishReason(reason: string): void {
    this._finishReason = reason;
  }

  /**
   * Permits the IdleTransaction to automatically end itself via the idle timeout and heartbeat mechanisms when the `delayAutoFinishUntilSignal` option was set to `true`.
   */
  public sendAutoFinishSignal(): void {
    if (!this._autoFinishAllowed) {
      DEBUG_BUILD && logger.log('[Tracing] Received finish signal for idle transaction.');
      this._restartIdleTimeout();
      this._autoFinishAllowed = true;
    }
  }

  /**
   * Restarts idle timeout, if there is no running idle timeout it will start one.
   */
  private _restartIdleTimeout(endTimestamp?: Parameters<IdleTransaction['end']>[0]): void {
    this.cancelIdleTimeout();
    this._idleTimeoutID = setTimeout(() => {
      if (!this._finished && Object.keys(this.activities).length === 0) {
        this._finishReason = IDLE_TRANSACTION_FINISH_REASONS[1];
        this.end(endTimestamp);
      }
    }, this._idleTimeout);
  }

  /**
   * Start tracking a specific activity.
   * @param spanId The span id that represents the activity
   */
  private _pushActivity(spanId: string): void {
    this.cancelIdleTimeout(undefined, { restartOnChildSpanChange: !this._idleTimeoutCanceledPermanently });
    DEBUG_BUILD && logger.log(`[Tracing] pushActivity: ${spanId}`);
    this.activities[spanId] = true;
    DEBUG_BUILD && logger.log('[Tracing] new activities count', Object.keys(this.activities).length);
  }

  /**
   * Remove an activity from usage
   * @param spanId The span id that represents the activity
   */
  private _popActivity(spanId: string): void {
    if (this.activities[spanId]) {
      DEBUG_BUILD && logger.log(`[Tracing] popActivity ${spanId}`);
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete this.activities[spanId];
      DEBUG_BUILD && logger.log('[Tracing] new activities count', Object.keys(this.activities).length);
    }

    if (Object.keys(this.activities).length === 0) {
      const endTimestamp = timestampInSeconds();
      if (this._idleTimeoutCanceledPermanently) {
        if (this._autoFinishAllowed) {
          this._finishReason = IDLE_TRANSACTION_FINISH_REASONS[5];
          this.end(endTimestamp);
        }
      } else {
        // We need to add the timeout here to have the real endtimestamp of the transaction
        // Remember timestampInSeconds is in seconds, timeout is in ms
        this._restartIdleTimeout(endTimestamp + this._idleTimeout / 1000);
      }
    }
  }

  /**
   * Checks when entries of this.activities are not changing for 3 beats.
   * If this occurs we finish the transaction.
   */
  private _beat(): void {
    // We should not be running heartbeat if the idle transaction is finished.
    if (this._finished) {
      return;
    }

    const heartbeatString = Object.keys(this.activities).join('');

    if (heartbeatString === this._prevHeartbeatString) {
      this._heartbeatCounter++;
    } else {
      this._heartbeatCounter = 1;
    }

    this._prevHeartbeatString = heartbeatString;

    if (this._heartbeatCounter >= 3) {
      if (this._autoFinishAllowed) {
        DEBUG_BUILD && logger.log('[Tracing] Transaction finished because of no change for 3 heart beats');
        this.setStatus({ code: SPAN_STATUS_ERROR, message: 'deadline_exceeded' });
        this._finishReason = IDLE_TRANSACTION_FINISH_REASONS[0];
        this.end();
      }
    } else {
      this._pingHeartbeat();
    }
  }

  /**
   * Pings the heartbeat
   */
  private _pingHeartbeat(): void {
    DEBUG_BUILD && logger.log(`pinging Heartbeat -> current counter: ${this._heartbeatCounter}`);
    setTimeout(() => {
      this._beat();
    }, this._heartbeatInterval);
  }
}
