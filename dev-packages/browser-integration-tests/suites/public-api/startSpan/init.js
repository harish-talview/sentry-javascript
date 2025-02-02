import * as Sentry from '@sentry/browser';

window.Sentry = Sentry;

Sentry.addTracingExtensions();

Sentry.init({
  dsn: 'https://public@dsn.ingest.sentry.io/1337',
  tracesSampleRate: 1.0,
  normalizeDepth: 10,
  debug: true,
});
