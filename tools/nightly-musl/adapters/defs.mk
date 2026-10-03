# Native Linux/Wasm link adapter: ELF runtime paths/shared-library modes do not apply.
# The compile flags and generated backend inputs remain unchanged.
ifeq ($(OS_ARCH)_$(TARGET_CPU),Linux_wasm32)
NIGHTLY_WASM_COMMA := ,
override LDFLAGS = $(MOZ_LTO_LDFLAGS) $(filter-out -Wl$(NIGHTLY_WASM_COMMA)-rpath-link$(NIGHTLY_WASM_COMMA)%,$(COMPUTED_LDFLAGS)) $(PGO_LDFLAGS)
OS_LIBS := $(filter-out -Wl$(NIGHTLY_WASM_COMMA)--as-needed -Wl$(NIGHTLY_WASM_COMMA)--no-as-needed,$(OS_LIBS))
OS_LIBS += /mnt/p6/build/firefox-nightly-musl-recovery-20261002/native-mapping-link/libnightly-native-mapping.a
ifneq ($(filter firefox plugin-container xpcshell,$(notdir $(PROGRAM))),)
# Prebuilt native dependencies may contain DWARF even with no-symbol configure.
# Strip it at the final link before the driver's unchanged Binaryen -O2 pass.
override LDFLAGS += -Wl$(NIGHTLY_WASM_COMMA)--strip-debug
override LDFLAGS += -Wl$(NIGHTLY_WASM_COMMA)--wrap=XShmQueryExtension
# Retain the mapping adapter while musl also owns its shm symbols.
OS_LIBS := $(filter-out /mnt/p6/build/firefox-nightly-musl-recovery-20261002/native-mapping-link/libnightly-native-mapping.a,$(OS_LIBS))
OS_LIBS += /mnt/p6/build/firefox-nightly-musl-recovery-20261002/native-mapping-wrapped-shm/libnightly-native-mapping.a
override LDFLAGS += -Wl$(NIGHTLY_WASM_COMMA)--wrap=shm_open -Wl$(NIGHTLY_WASM_COMMA)--wrap=shm_unlink
# Real static TLS destructor lifecycle, without replacing LLVM Wasm exceptions.
OS_LIBS += /mnt/p6/build/firefox-nightly-musl-recovery-20261002/native-runtime-accepted-run1/libnightly-native-runtime.a
override LDFLAGS += -Wl$(NIGHTLY_WASM_COMMA)--wrap=exit -Wl$(NIGHTLY_WASM_COMMA)--wrap=__pthread_tsd_run_dtors
# Match the native Rust target's shared process memory and 8 MiB stack.
# Export the table for guest callbacks/JIT and keep its static indices growable.
override LDFLAGS += -Wl$(NIGHTLY_WASM_COMMA)--import-memory -Wl$(NIGHTLY_WASM_COMMA)--max-memory=4294967296 -Wl$(NIGHTLY_WASM_COMMA)--shared-memory
override LDFLAGS += -Wl$(NIGHTLY_WASM_COMMA)--export-table -Wl$(NIGHTLY_WASM_COMMA)--growable-table -Wl$(NIGHTLY_WASM_COMMA)--export=__stack_pointer
override LDFLAGS += -Wl$(NIGHTLY_WASM_COMMA)-z$(NIGHTLY_WASM_COMMA)stack-size=8388608
endif
endif
