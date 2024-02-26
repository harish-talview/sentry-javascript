/* eslint-disable max-lines */
import type { AfterViewInit, OnDestroy, OnInit } from '@angular/core';
import { Directive, Injectable, Input, NgModule } from '@angular/core';
import type { ActivatedRouteSnapshot, Event, RouterState } from '@angular/router';
// Duplicated import to work around a TypeScript bug where it'd complain that `Router` isn't imported as a type.
// We need to import it as a value to satisfy Angular dependency injection. So:
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { NavigationCancel, NavigationError, Router } from '@angular/router';
import { NavigationEnd, NavigationStart, ResolveEnd } from '@angular/router';
import {
  SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN,
  SEMANTIC_ATTRIBUTE_SENTRY_SOURCE,
  WINDOW,
  browserTracingIntegration as originalBrowserTracingIntegration,
  getCurrentScope,
  startBrowserTracingNavigationSpan,
} from '@sentry/browser';
import { getActiveSpan, getClient, getRootSpan, spanToJSON, startInactiveSpan } from '@sentry/core';
import type { Integration, Span, Transaction, TransactionContext } from '@sentry/types';
import { logger, stripUrlQueryAndFragment, timestampInSeconds } from '@sentry/utils';
import type { Observable } from 'rxjs';
import { Subscription } from 'rxjs';
import { filter, tap } from 'rxjs/operators';

import { ANGULAR_INIT_OP, ANGULAR_OP, ANGULAR_ROUTING_OP } from './constants';
import { IS_DEBUG_BUILD } from './flags';
import { runOutsideAngular } from './zone';

let instrumentationInitialized: boolean;
let stashedStartTransaction: (context: TransactionContext) => Transaction | undefined;
let stashedStartTransactionOnLocationChange: boolean;

let hooksBasedInstrumentation = false;

/**
 * Creates routing instrumentation for Angular Router.
 *
 * @deprecated Use `browserTracingIntegration()` instead, which includes Angular-specific instrumentation out of the box.
 */
export function routingInstrumentation(
  customStartTransaction: (context: TransactionContext) => Transaction | undefined,
  startTransactionOnPageLoad: boolean = true,
  startTransactionOnLocationChange: boolean = true,
): void {
  instrumentationInitialized = true;
  stashedStartTransaction = customStartTransaction;
  stashedStartTransactionOnLocationChange = startTransactionOnLocationChange;

  if (startTransactionOnPageLoad && WINDOW && WINDOW.location) {
    customStartTransaction({
      name: WINDOW.location.pathname,
      op: 'pageload',
      origin: 'auto.pageload.angular',
      attributes: {
        [SEMANTIC_ATTRIBUTE_SENTRY_SOURCE]: 'url',
      },
    });
  }
}

/**
 * Creates routing instrumentation for Angular Router.
 *
 * @deprecated Use `browserTracingIntegration()` instead, which includes Angular-specific instrumentation out of the box.
 */
// eslint-disable-next-line deprecation/deprecation
export const instrumentAngularRouting = routingInstrumentation;

/**
 * A custom browser tracing integration for Angular.
 *
 * Use this integration in combination with `TraceService`
 */
export function browserTracingIntegration(
  options: Parameters<typeof originalBrowserTracingIntegration>[0] = {},
): Integration {
  // If the user opts out to set this up, we just don't initialize this.
  // That way, the TraceService will not actually do anything, functionally disabling this.
  if (options.instrumentNavigation !== false) {
    instrumentationInitialized = true;
    hooksBasedInstrumentation = true;
  }

  return originalBrowserTracingIntegration({
    ...options,
    instrumentNavigation: false,
  });
}

/**
 * Grabs active transaction off scope.
 *
 * @deprecated You should not rely on the transaction, but just use `startSpan()` APIs instead.
 */
export function getActiveTransaction(): Transaction | undefined {
  // eslint-disable-next-line deprecation/deprecation
  return getCurrentScope().getTransaction();
}

/**
 * Angular's Service responsible for hooking into Angular Router and tracking current navigation process.
 * Creates a new transaction for every route change and measures a duration of routing process.
 */
@Injectable({ providedIn: 'root' })
export class TraceService implements OnDestroy {
  public navStart$: Observable<Event> = this._router.events.pipe(
    filter((event): event is NavigationStart => event instanceof NavigationStart),
    tap(navigationEvent => {
      if (!instrumentationInitialized) {
        IS_DEBUG_BUILD &&
          logger.error('Angular integration has tracing enabled, but Tracing integration is not configured');
        return;
      }

      if (this._routingSpan) {
        this._routingSpan.end();
        this._routingSpan = null;
      }

      const client = getClient();
      const strippedUrl = stripUrlQueryAndFragment(navigationEvent.url);

      if (client && hooksBasedInstrumentation) {
        // see comment in `_isPageloadOngoing` for rationale
        if (!this._isPageloadOngoing()) {
          startBrowserTracingNavigationSpan(client, {
            name: strippedUrl,
            attributes: {
              [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'auto.navigation.angular',
              [SEMANTIC_ATTRIBUTE_SENTRY_SOURCE]: 'url',
            },
          });
        } else {
          // The first time we end up here, we set the pageload flag to false
          // Subsequent navigations are going to get their own navigation root span
          // even if the pageload root span is still ongoing.
          this._pageloadOngoing = false;
        }

        this._routingSpan =
          startInactiveSpan({
            name: `${navigationEvent.url}`,
            op: ANGULAR_ROUTING_OP,
            attributes: {
              [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'auto.ui.angular',
              [SEMANTIC_ATTRIBUTE_SENTRY_SOURCE]: 'url',
              url: strippedUrl,
              ...(navigationEvent.navigationTrigger && {
                navigationTrigger: navigationEvent.navigationTrigger,
              }),
            },
          }) || null;

        return;
      }

      // eslint-disable-next-line deprecation/deprecation
      let activeTransaction = getActiveTransaction();

      if (!activeTransaction && stashedStartTransactionOnLocationChange) {
        activeTransaction = stashedStartTransaction({
          name: strippedUrl,
          op: 'navigation',
          origin: 'auto.navigation.angular',
          attributes: {
            [SEMANTIC_ATTRIBUTE_SENTRY_SOURCE]: 'url',
          },
        });
      }

      if (activeTransaction) {
        // eslint-disable-next-line deprecation/deprecation
        this._routingSpan = activeTransaction.startChild({
          name: `${navigationEvent.url}`,
          op: ANGULAR_ROUTING_OP,
          origin: 'auto.ui.angular',
          attributes: {
            url: strippedUrl,
            ...(navigationEvent.navigationTrigger && {
              navigationTrigger: navigationEvent.navigationTrigger,
            }),
          },
        });
      }
    }),
  );

  // The ResolveEnd event is fired when the Angular router has resolved the URL and
  // the parameter<->value mapping. It holds the new resolved router state with
  // the mapping and the new URL.
  // Only After this event, the route is activated, meaning that the transaction
  // can be updated with the parameterized route name before e.g. the route's root
  // component is initialized. This should be early enough before outgoing requests
  // are made from the new route, with the exceptions of requests being made during
  // a navigation.
  public resEnd$: Observable<Event> = this._router.events.pipe(
    filter((event): event is ResolveEnd => event instanceof ResolveEnd),
    tap(event => {
      const route = getParameterizedRouteFromSnapshot(
        (event.state as unknown as RouterState & { root: ActivatedRouteSnapshot }).root,
      );

      // eslint-disable-next-line deprecation/deprecation
      const transaction = getActiveTransaction();
      // TODO (v8 / #5416): revisit the source condition. Do we want to make the parameterized route the default?
      const attributes = (transaction && spanToJSON(transaction).data) || {};
      if (transaction && attributes[SEMANTIC_ATTRIBUTE_SENTRY_SOURCE] === 'url') {
        transaction.updateName(route);
        transaction.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_SOURCE, 'route');
        transaction.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN, `auto.${spanToJSON(transaction).op}.angular`);
      }
    }),
  );

  public navEnd$: Observable<Event> = this._router.events.pipe(
    filter(
      event => event instanceof NavigationEnd || event instanceof NavigationCancel || event instanceof NavigationError,
    ),
    tap(() => {
      if (this._routingSpan) {
        runOutsideAngular(() => {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          this._routingSpan!.end();
        });
        this._routingSpan = null;
      }
    }),
  );

  private _routingSpan: Span | null;

  private _subscription: Subscription;

  /**
   * @see _isPageloadOngoing()
   */
  private _pageloadOngoing: boolean;

  public constructor(private readonly _router: Router) {
    this._routingSpan = null;
    this._pageloadOngoing = true;

    this._subscription = new Subscription();

    this._subscription.add(this.navStart$.subscribe());
    this._subscription.add(this.resEnd$.subscribe());
    this._subscription.add(this.navEnd$.subscribe());
  }

  /**
   * This is used to prevent memory leaks when the root view is created and destroyed multiple times,
   * since `subscribe` callbacks capture `this` and prevent many resources from being GC'd.
   */
  public ngOnDestroy(): void {
    this._subscription.unsubscribe();
  }

  /**
   * We only _avoid_ creating a navigation root span in one case:
   *
   * There is an ongoing pageload span AND the router didn't yet emit the first navigation start event
   *
   * The first navigation start event will create the child routing span
   * and update the pageload root span name on ResolveEnd.
   *
   * There's an edge case we need to avoid here: If the router fires the first navigation start event
   * _after_ the pageload root span finished. This is why we check for the pageload root span.
   * Possible real-world scenario: Angular application and/or router is bootstrapped after the pageload
   * idle root span finished
   *
   * The overall rationale is:
   * - if we already avoided creating a navigation root span once, we don't avoid it again
   *   (i.e. set `_pageloadOngoing` to `false`)
   * - if `_pageloadOngoing` is already `false`, create a navigation root span
   * - if there's no active/pageload root span, create a navigation root span
   * - only if there's an ongoing pageload root span AND `_pageloadOngoing` is still `true,
   *   con't create a navigation root span
   */
  private _isPageloadOngoing(): boolean {
    if (!this._pageloadOngoing) {
      // pageload is already finished, no need to update
      return false;
    }

    const activeSpan = getActiveSpan();
    if (!activeSpan) {
      this._pageloadOngoing = false;
      return false;
    }

    const rootSpan = getRootSpan(activeSpan);
    if (!rootSpan) {
      this._pageloadOngoing = false;
      return false;
    }

    this._pageloadOngoing = spanToJSON(rootSpan).op === 'pageload';
    return this._pageloadOngoing;
  }
}

const UNKNOWN_COMPONENT = 'unknown';

/**
 * A directive that can be used to capture initialization lifecycle of the whole component.
 */
@Directive({ selector: '[trace]' })
export class TraceDirective implements OnInit, AfterViewInit {
  @Input('trace') public componentName?: string;

  private _tracingSpan?: Span;

  /**
   * Implementation of OnInit lifecycle method
   * @inheritdoc
   */
  public ngOnInit(): void {
    if (!this.componentName) {
      this.componentName = UNKNOWN_COMPONENT;
    }

    // eslint-disable-next-line deprecation/deprecation
    const activeTransaction = getActiveTransaction();
    if (activeTransaction) {
      // eslint-disable-next-line deprecation/deprecation
      this._tracingSpan = activeTransaction.startChild({
        name: `<${this.componentName}>`,
        op: ANGULAR_INIT_OP,
        origin: 'auto.ui.angular.trace_directive',
      });
    }
  }

  /**
   * Implementation of AfterViewInit lifecycle method
   * @inheritdoc
   */
  public ngAfterViewInit(): void {
    if (this._tracingSpan) {
      this._tracingSpan.end();
    }
  }
}

/**
 * A module serves as a single compilation unit for the `TraceDirective` and can be re-used by any other module.
 */
@NgModule({
  declarations: [TraceDirective],
  exports: [TraceDirective],
})
export class TraceModule {}

/**
 * Decorator function that can be used to capture initialization lifecycle of the whole component.
 */
export function TraceClassDecorator(): ClassDecorator {
  let tracingSpan: Span;

  /* eslint-disable @typescript-eslint/no-unsafe-member-access */
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  return target => {
    const originalOnInit = target.prototype.ngOnInit;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    target.prototype.ngOnInit = function (...args: any[]): ReturnType<typeof originalOnInit> {
      // eslint-disable-next-line deprecation/deprecation
      const activeTransaction = getActiveTransaction();
      if (activeTransaction) {
        // eslint-disable-next-line deprecation/deprecation
        tracingSpan = activeTransaction.startChild({
          name: `<${target.name}>`,
          op: ANGULAR_INIT_OP,
          origin: 'auto.ui.angular.trace_class_decorator',
        });
      }
      if (originalOnInit) {
        return originalOnInit.apply(this, args);
      }
    };

    const originalAfterViewInit = target.prototype.ngAfterViewInit;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    target.prototype.ngAfterViewInit = function (...args: any[]): ReturnType<typeof originalAfterViewInit> {
      if (tracingSpan) {
        tracingSpan.end();
      }
      if (originalAfterViewInit) {
        return originalAfterViewInit.apply(this, args);
      }
    };
  };
  /* eslint-enable @typescript-eslint/no-unsafe-member-access */
}

/**
 * Decorator function that can be used to capture a single lifecycle methods of the component.
 */
export function TraceMethodDecorator(): MethodDecorator {
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type, @typescript-eslint/ban-types
  return (target: Object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    descriptor.value = function (...args: any[]): ReturnType<typeof originalMethod> {
      const now = timestampInSeconds();
      // eslint-disable-next-line deprecation/deprecation
      const activeTransaction = getActiveTransaction();
      if (activeTransaction) {
        // eslint-disable-next-line deprecation/deprecation
        activeTransaction.startChild({
          name: `<${target.constructor.name}>`,
          endTimestamp: now,
          op: `${ANGULAR_OP}.${String(propertyKey)}`,
          origin: 'auto.ui.angular.trace_method_decorator',
          startTimestamp: now,
        });
      }
      if (originalMethod) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        return originalMethod.apply(this, args);
      }
    };
    return descriptor;
  };
}

/**
 * Takes the parameterized route from a given ActivatedRouteSnapshot and concatenates the snapshot's
 * child route with its parent to produce the complete parameterized URL of the activated route.
 * This happens recursively until the last child (i.e. the end of the URL) is reached.
 *
 * @param route the ActivatedRouteSnapshot of which its path and its child's path is concatenated
 *
 * @returns the concatenated parameterized route string
 */
export function getParameterizedRouteFromSnapshot(route?: ActivatedRouteSnapshot | null): string {
  const parts: string[] = [];

  let currentRoute = route && route.firstChild;
  while (currentRoute) {
    const path = currentRoute && currentRoute.routeConfig && currentRoute.routeConfig.path;
    if (path === null || path === undefined) {
      break;
    }

    parts.push(path);
    currentRoute = currentRoute.firstChild;
  }

  const fullPath = parts.filter(part => part).join('/');
  return fullPath ? `/${fullPath}/` : '/';
}
