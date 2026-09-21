#ifndef XSERVER_WASM_HOST_ABI_H
#define XSERVER_WASM_HOST_ABI_H

/* Browser boundary for the small real X11 client below. */
int x11_host_send(const unsigned char *bytes, int length)
  __attribute__((import_module("x11_host"), import_name("send")));
int x11_host_log(const unsigned char *bytes, int length)
  __attribute__((import_module("x11_host"), import_name("log")));

#endif
