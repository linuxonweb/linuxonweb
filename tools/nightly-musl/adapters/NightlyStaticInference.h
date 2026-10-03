/* Native Linux/Wasm keeps the inference implementations in the browser.
 * Use NSPR's static-library API with the same typed functions as the loader.
 * Include after LlamaRuntimeLinker.h and prlink.h. */
#if defined(__linux__) && defined(__wasm__) && !defined(__wasi__)
static PRLibrary* NightlyLoadStaticInference() {
#  define NIGHTLY_INFERENCE_SYMBOL(ret, name, params) \
    {#name, reinterpret_cast<PRFuncPtr>(::name)},
  static const PRStaticLinkTable symbols[] = {
      MOZINFERENCE_FUNCTION_LIST(NIGHTLY_INFERENCE_SYMBOL)
      {nullptr, nullptr}};
#  undef NIGHTLY_INFERENCE_SYMBOL
  return PR_LoadStaticLibrary("libmozinference.so", symbols);
}
#endif
