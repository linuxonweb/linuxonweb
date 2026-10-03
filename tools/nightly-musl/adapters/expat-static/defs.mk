# Namespace only the bundled Expat compilation units.
ifeq ($(OS_ARCH)_$(TARGET_CPU),Linux_wasm32)
COMPUTED_CFLAGS += -include $(srcdir)/NightlyExpatStaticNames.h
GLOBAL_DEPS += $(srcdir)/NightlyExpatStaticNames.h $(srcdir)/defs.mk
endif
