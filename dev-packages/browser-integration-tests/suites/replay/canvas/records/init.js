import * as Sentry from '@sentry/browser';

window.Sentry = Sentry;
window.Replay = new Sentry.Replay({
  flushMinDelay: 50,
  flushMaxDelay: 50,
  minReplayDuration: 0,
});

Sentry.init({
  dsn: 'https://public@dsn.ingest.sentry.io/1337',
  sampleRate: 0,
  replaysSessionSampleRate: 1.0,
  replaysOnErrorSampleRate: 0.0,
  debug: true,

  integrations: [window.Replay, new Sentry.ReplayCanvas()],
});
