import type { Carrier, Hub, RunWithAsyncContextOptions } from '@sentry/core';
import { ensureHubOnCarrier, getHubFromCarrier, setAsyncContextStrategy, setHubOnCarrier } from '@sentry/core';
import * as domain from 'domain';
import { EventEmitter } from 'events';

function getActiveDomain<T>(): T | undefined {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
  return (domain as any).active as T | undefined;
}

function getCurrentHub(): Hub | undefined {
  const activeDomain = getActiveDomain<Carrier>();

  // If there's no active domain, just return undefined and the global hub will be used
  if (!activeDomain) {
    return undefined;
  }

  ensureHubOnCarrier(activeDomain);

  return getHubFromCarrier(activeDomain);
}

function createNewHub(parent: Hub | undefined): Hub {
  const carrier: Carrier = {};
  ensureHubOnCarrier(carrier, parent);
  return getHubFromCarrier(carrier);
}

function runWithAsyncContext<T>(callback: (hub: Hub) => T, options: RunWithAsyncContextOptions): T {
  const activeDomain = getActiveDomain<domain.Domain & Carrier>();

  if (activeDomain && options?.reuseExisting) {
    for (const emitter of options.emitters || []) {
      if (emitter instanceof EventEmitter) {
        activeDomain.add(emitter);
      }
    }

    // We're already in a domain, so we don't need to create a new one, just call the callback with the current hub
    return callback(getHubFromCarrier(activeDomain));
  }

  const local = domain.create() as domain.Domain & Carrier;

  for (const emitter of options.emitters || []) {
    if (emitter instanceof EventEmitter) {
      local.add(emitter);
    }
  }

  const parentHub = activeDomain ? getHubFromCarrier(activeDomain) : undefined;
  const newHub = createNewHub(parentHub);
  setHubOnCarrier(local, newHub);

  return local.bind(() => {
    return callback(newHub);
  })();
}

/**
 * Sets the async context strategy to use Node.js domains.
 */
export function setDomainAsyncContextStrategy(): void {
  setAsyncContextStrategy({ getCurrentHub, runWithAsyncContext });
}