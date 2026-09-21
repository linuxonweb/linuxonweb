CLANG ?= clang
TARGET ?= wasm32-unknown-unknown
OUT ?= wasm32-kernel-smoke.wasm

CFLAGS := --target=$(TARGET) -ffreestanding -fno-builtin -fno-stack-protector -O2 -I../adapter
LDFLAGS := -nostdlib -Wl,--no-entry -Wl,--export=kernel_entry -Wl,--export-memory

.PHONY: all clean

all: $(OUT)

$(OUT): wasm32-kernel-smoke.c
	$(CLANG) $(CFLAGS) $< $(LDFLAGS) -o $@

clean:
	$(RM) $(OUT)
