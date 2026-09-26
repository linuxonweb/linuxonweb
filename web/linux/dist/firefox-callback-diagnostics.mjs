// Opt-in diagnostics for the three reserved Firefox indirect-call slots.
// The normal adapter remains unchanged; this module is inert unless enabled.

const SLOT_COUNT = 3;
const MAX_CALLS_PER_SLOT = 32;
const MAX_STACK_CHARS = 4096;
const MAX_ARGS = 8;
const ABI_PARAMETERS = Array.from({ length: 23 }, () => "i64");

function enabled(options) {
  if (options === true || options?.enabled === true) return true;
  try {
    return globalThis.__LINUX_WEB_FIREFOX_CALLBACK_DIAGNOSTICS__ === true;
  } catch {
    return false;
  }
}

function diagnosticFunction(slot) {
  let calls = 0;
  return new WebAssembly.Function(
    { parameters: ABI_PARAMETERS, results: ["i64"] },
    (...args) => {
      calls += 1;
      if (calls <= MAX_CALLS_PER_SLOT) {
        const stack = new Error().stack;
        console.warn("[firefox-callback]", {
          slot,
          call: calls,
          args: args.slice(0, MAX_ARGS).map((value) => String(value)),
          stack: typeof stack === "string" ? stack.slice(0, MAX_STACK_CHARS) : "",
        });
      }
      return 0n;
    },
  );
}

/**
 * Replace the three reserved null-slot shims with typed host callbacks only
 * when explicitly enabled. Returns the number of slots instrumented.
 */
export function installFirefoxCallbackDiagnostics(instance, options = {}) {
  if (!enabled(options)) return 0;
  const table = instance?.exports?.__indirect_function_table;
  if (!(table instanceof WebAssembly.Table) || table.length < SLOT_COUNT) return 0;
  if (typeof WebAssembly.Function !== "function") {
    console.warn("[firefox-callback] WebAssembly.Function is unavailable");
    return 0;
  }

  let installed = 0;
  for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
    try {
      table.set(slot, diagnosticFunction(slot));
      installed += 1;
    } catch (error) {
      console.warn("[firefox-callback] unable to instrument slot", slot, error);
    }
  }
  console.info("[firefox-callback] diagnostics installed", { slots: installed });
  return installed;
}

