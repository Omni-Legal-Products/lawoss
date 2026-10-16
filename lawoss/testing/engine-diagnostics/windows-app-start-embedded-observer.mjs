// One diagnostic import edge only. No production imports or effects at import time.
export const BRIDGE = Symbol.for('lawoss.windows-app-start.embedded-observer');
const refused = () => Object.assign(new Error('REFUSED'), {
  diagnosticCode: 'REFUSED'
});
export function exactResolver({
  parent,
  target,
  observer
}) {
  let redirected = 0;
  return (specifier, context, next) => {
    const result = next(specifier, context);
    if (context.parentURL !== parent) return result;
    // Runtime's other imports must be unchanged; packaged fallback is forbidden.
    if (result.url !== target) {
      if (/\/embedded\.js$/.test(result.url)) throw refused();
      return result;
    }
    if (++redirected !== 1) throw refused();
    return {
      url: observer,
      shortCircuit: true
    };
  };
}
export function createObservation(start) {
  const state = {
    starts: 0,
    startRejected: 0,
    stops: 0,
    fulfilled: 0,
    rejected: 0,
    pending: 0
  };
  let handle;
  return {
    state,
    get handle() {
      return handle;
    },
    async start(options) {
      if (++state.starts !== 1) throw refused();
      try {
        handle = await start(options);
      } catch (error) {
        state.startRejected++;
        throw error;
      }
      const stop = handle.stop;
      handle.stop = function (...args) {
        state.stops++;
        state.pending++;
        let promise;
        try {
          promise = Reflect.apply(stop, this, args);
        } catch (error) {
          state.pending--;
          state.rejected++;
          throw error;
        }
        // Preserve the original value/error identity and receiver. No callback can throw.
        return Promise.resolve(promise).then(value => {
          state.pending--;
          state.fulfilled++;
          return value;
        }, error => {
          state.pending--;
          state.rejected++;
          throw error;
        });
      };
      return handle;
    }
  };
}
export async function startEmbeddedServer(options) {
  const bridge = globalThis[BRIDGE];
  if (!bridge?.target || !bridge.observation) throw refused();
  return bridge.observation.start(options);
}
