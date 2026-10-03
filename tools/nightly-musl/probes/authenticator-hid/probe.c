#include <sys/ioctl.h>
#include <linux/hidraw.h>
#include <stddef.h>
#include <stdint.h>
unsigned v0(void) { return HIDIOCGRDESCSIZE; }
unsigned v1(void) { return HIDIOCGRDESC; }
unsigned v2(void) { return sizeof(int); }
unsigned v3(void) { return sizeof(struct hidraw_report_descriptor); }
unsigned v4(void) { return _Alignof(struct hidraw_report_descriptor); }
unsigned v5(void) { return offsetof(struct hidraw_report_descriptor, size); }
unsigned v6(void) { return offsetof(struct hidraw_report_descriptor, value); }
unsigned v7(void) { return HID_MAX_DESCRIPTOR_SIZE; }
