import {
  SDK_VERSION,
  SPAN_STATUS_ERROR,
  captureException,
  continueTrace,
  convertIntegrationFnToClass,
  defineIntegration,
  getActiveTransaction,
  getCurrentScope,
  getDynamicSamplingContextFromSpan,
  setHttpStatus,
  spanToTraceHeader,
  startTransaction,
} from '@sentry/core';
import type { IntegrationFn } from '@sentry/types';
import { dynamicSamplingContextToSentryBaggageHeader, fill } from '@sentry/utils';

import type { Boom, RequestEvent, ResponseObject, Server } from './types';

function isResponseObject(response: ResponseObject | Boom): response is ResponseObject {
  return response && (response as ResponseObject).statusCode !== undefined;
}

function isBoomObject(response: ResponseObject | Boom): response is Boom {
  return response && (response as Boom).isBoom !== undefined;
}

function isErrorEvent(event: RequestEvent): event is RequestEvent {
  return event && (event as RequestEvent).error !== undefined;
}

function sendErrorToSentry(errorData: object): void {
  captureException(errorData, {
    mechanism: {
      type: 'hapi',
      handled: false,
      data: {
        function: 'hapiErrorPlugin',
      },
    },
  });
}

export const hapiErrorPlugin = {
  name: 'SentryHapiErrorPlugin',
  version: SDK_VERSION,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: async function (serverArg: Record<any, any>) {
    const server = serverArg as unknown as Server;

    server.events.on('request', (request, event) => {
      // eslint-disable-next-line deprecation/deprecation
      const transaction = getActiveTransaction();

      if (request.response && isBoomObject(request.response)) {
        sendErrorToSentry(request.response);
      } else if (isErrorEvent(event)) {
        sendErrorToSentry(event.error);
      }

      if (transaction) {
        transaction.setStatus({ code: SPAN_STATUS_ERROR, message: 'internal_error' });
        transaction.end();
      }
    });
  },
};

export const hapiTracingPlugin = {
  name: 'SentryHapiTracingPlugin',
  version: SDK_VERSION,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: async function (serverArg: Record<any, any>) {
    const server = serverArg as unknown as Server;

    server.ext('onPreHandler', (request, h) => {
      const transaction = continueTrace(
        {
          sentryTrace: request.headers['sentry-trace'] || undefined,
          baggage: request.headers['baggage'] || undefined,
        },
        transactionContext => {
          // eslint-disable-next-line deprecation/deprecation
          return startTransaction({
            ...transactionContext,
            op: 'hapi.request',
            name: `${request.route.method} ${request.path}`,
          });
        },
      );

      // eslint-disable-next-line deprecation/deprecation
      getCurrentScope().setSpan(transaction);

      return h.continue;
    });

    server.ext('onPreResponse', (request, h) => {
      // eslint-disable-next-line deprecation/deprecation
      const transaction = getActiveTransaction();

      if (request.response && isResponseObject(request.response) && transaction) {
        const response = request.response as ResponseObject;
        response.header('sentry-trace', spanToTraceHeader(transaction));

        const dynamicSamplingContext = dynamicSamplingContextToSentryBaggageHeader(
          getDynamicSamplingContextFromSpan(transaction),
        );

        if (dynamicSamplingContext) {
          response.header('baggage', dynamicSamplingContext);
        }
      }

      return h.continue;
    });

    server.ext('onPostHandler', (request, h) => {
      // eslint-disable-next-line deprecation/deprecation
      const transaction = getActiveTransaction();

      if (transaction) {
        if (request.response && isResponseObject(request.response)) {
          setHttpStatus(transaction, request.response.statusCode);
        }

        transaction.end();
      }

      return h.continue;
    });
  },
};

export type HapiOptions = {
  /** Hapi server instance */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server?: Record<any, any>;
};

const INTEGRATION_NAME = 'Hapi';

const _hapiIntegration = ((options: HapiOptions = {}) => {
  const server = options.server as undefined | Server;

  return {
    name: INTEGRATION_NAME,
    setupOnce() {
      if (!server) {
        return;
      }

      fill(server, 'start', (originalStart: () => void) => {
        return async function (this: Server) {
          await this.register(hapiTracingPlugin);
          await this.register(hapiErrorPlugin);
          const result = originalStart.apply(this);
          return result;
        };
      });
    },
  };
}) satisfies IntegrationFn;

export const hapiIntegration = defineIntegration(_hapiIntegration);

/**
 * Hapi Framework Integration.
 * @deprecated Use `hapiIntegration()` instead.
 */
// eslint-disable-next-line deprecation/deprecation
export const Hapi = convertIntegrationFnToClass(INTEGRATION_NAME, hapiIntegration);

// eslint-disable-next-line deprecation/deprecation
export type Hapi = typeof Hapi;
