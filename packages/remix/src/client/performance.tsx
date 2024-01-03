import { spanSetMetadata } from '@sentry/core';
import type { ErrorBoundaryProps } from '@sentry/react';
import { WINDOW, withErrorBoundary } from '@sentry/react';
import type { Transaction, TransactionContext } from '@sentry/types';
import { isNodeEnv, logger } from '@sentry/utils';
import * as React from 'react';

import { DEBUG_BUILD } from '../utils/debug-build';
import { getFutureFlagsBrowser, readRemixVersionFromLoader } from '../utils/futureFlags';

const DEFAULT_TAGS = {
  'routing.instrumentation': 'remix-router',
} as const;

type Params<Key extends string = string> = {
  readonly [key in Key]: string | undefined;
};

interface RouteMatch<ParamKey extends string = string> {
  params: Params<ParamKey>;
  pathname: string;
  id: string;
  handle: unknown;
}

type UseEffect = (cb: () => void, deps: unknown[]) => void;
type UseLocation = () => {
  pathname: string;
  search?: string;
  hash?: string;
  state?: unknown;
  key?: unknown;
};
type UseMatches = () => RouteMatch[] | null;

let activeTransaction: Transaction | undefined;

let _useEffect: UseEffect;
let _useLocation: UseLocation;
let _useMatches: UseMatches;

let _customStartTransaction: (context: TransactionContext) => Transaction | undefined;
let _startTransactionOnLocationChange: boolean;

function getInitPathName(): string | undefined {
  if (WINDOW && WINDOW.location) {
    return WINDOW.location.pathname;
  }

  return undefined;
}

function isRemixV2(remixVersion: number | undefined): boolean {
  return remixVersion === 2 || getFutureFlagsBrowser()?.v2_errorBoundary || false;
}

/**
 * Creates a react-router v6 instrumention for Remix applications.
 *
 * This implementation is slightly different (and simpler) from the react-router instrumentation
 * as in Remix, `useMatches` hook is available where in react-router-v6 it's not yet.
 */
export function remixRouterInstrumentation(useEffect: UseEffect, useLocation: UseLocation, useMatches: UseMatches) {
  return (
    customStartTransaction: (context: TransactionContext) => Transaction | undefined,
    startTransactionOnPageLoad = true,
    startTransactionOnLocationChange = true,
  ): void => {
    const initPathName = getInitPathName();
    if (startTransactionOnPageLoad && initPathName) {
      activeTransaction = customStartTransaction({
        name: initPathName,
        op: 'pageload',
        origin: 'auto.pageload.remix',
        tags: DEFAULT_TAGS,
        metadata: {
          source: 'url',
        },
      });
    }

    _useEffect = useEffect;
    _useLocation = useLocation;
    _useMatches = useMatches;

    _customStartTransaction = customStartTransaction;
    _startTransactionOnLocationChange = startTransactionOnLocationChange;
  };
}

/**
 * Wraps a remix `root` (see: https://remix.run/docs/en/v1/guides/migrating-react-router-app#creating-the-root-route)
 * To enable pageload/navigation tracing on every route.
 * Also wraps the application with `ErrorBoundary`.
 *
 * @param OrigApp The Remix root to wrap
 * @param options The options for ErrorBoundary wrapper.
 */
export function withSentry<P extends Record<string, unknown>, R extends React.ComponentType<P>>(
  OrigApp: R,
  options: {
    wrapWithErrorBoundary?: boolean;
    errorBoundaryOptions?: ErrorBoundaryProps;
  } = {
    // We don't want to wrap application with Sentry's ErrorBoundary by default for Remix v2
    wrapWithErrorBoundary: true,
    errorBoundaryOptions: {},
  },
): R {
  const SentryRoot: React.FC<P> = (props: P) => {
    // Early return when any of the required functions is not available.
    if (!_useEffect || !_useLocation || !_useMatches || !_customStartTransaction) {
      DEBUG_BUILD &&
        !isNodeEnv() &&
        logger.warn('Remix SDK was unable to wrap your root because of one or more missing parameters.');

      // @ts-expect-error Setting more specific React Component typing for `R` generic above
      // will break advanced type inference done by react router params
      return <OrigApp {...props} />;
    }

    let isBaseLocation: boolean = false;

    const location = _useLocation();
    const matches = _useMatches();

    _useEffect(() => {
      if (activeTransaction && matches && matches.length) {
        activeTransaction.updateName(matches[matches.length - 1].id);
        spanSetMetadata(activeTransaction, { source: 'route' });
      }

      isBaseLocation = true;
    }, []);

    _useEffect(() => {
      if (isBaseLocation) {
        if (activeTransaction) {
          activeTransaction.end();
        }

        return;
      }

      if (_startTransactionOnLocationChange && matches && matches.length) {
        if (activeTransaction) {
          activeTransaction.end();
        }

        activeTransaction = _customStartTransaction({
          name: matches[matches.length - 1].id,
          op: 'navigation',
          origin: 'auto.navigation.remix',
          tags: DEFAULT_TAGS,
          metadata: {
            source: 'route',
          },
        });
      }
    }, [location]);

    isBaseLocation = false;

    if (!isRemixV2(readRemixVersionFromLoader()) && options.wrapWithErrorBoundary) {
      // @ts-expect-error Setting more specific React Component typing for `R` generic above
      // will break advanced type inference done by react router params
      return withErrorBoundary(OrigApp, options.errorBoundaryOptions)(props);
    }
    // @ts-expect-error Setting more specific React Component typing for `R` generic above
    // will break advanced type inference done by react router params
    return <OrigApp {...props} />;
  };

  // @ts-expect-error Setting more specific React Component typing for `R` generic above
  // will break advanced type inference done by react router params
  return SentryRoot;
}
