Sentry.onLoad(function () {
  Sentry.init({
    integrations: [
      // Without this syntax, this will be re-written by the test framework
      new window['Sentry'].replayIntegration({
        useCompression: false,
      }),
    ],
  });
});
