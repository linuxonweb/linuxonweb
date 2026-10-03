# Keep Firefox's private Cairo implementation separate from GTK's static Cairo.
ifeq ($(OS_ARCH)_$(TARGET_CPU),Linux_wasm32)
COMPUTED_CFLAGS += -include $(srcdir)/NightlyCairoStaticNames.h
COMPUTED_CXXFLAGS += -include $(srcdir)/NightlyCairoStaticNames.h
GLOBAL_DEPS += $(srcdir)/NightlyCairoStaticNames.h $(srcdir)/defs.mk
endif
