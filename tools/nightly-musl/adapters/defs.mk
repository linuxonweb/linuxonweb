# Native Linux/Wasm link adapter: ELF runtime paths do not apply to wasm-ld.
# The compile flags and generated backend inputs remain unchanged.
ifeq ($(OS_ARCH)_$(TARGET_CPU),Linux_wasm32)
NIGHTLY_WASM_COMMA := ,
override LDFLAGS = $(MOZ_LTO_LDFLAGS) $(filter-out -Wl$(NIGHTLY_WASM_COMMA)-rpath-link$(NIGHTLY_WASM_COMMA)%,$(COMPUTED_LDFLAGS)) $(PGO_LDFLAGS)
OS_LIBS += /mnt/p6/build/firefox-nightly-musl-recovery-20261002/native-mapping-link/libnightly-native-mapping.a
endif
