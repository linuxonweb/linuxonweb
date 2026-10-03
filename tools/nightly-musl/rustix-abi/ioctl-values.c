#include <asm/ioctl.h>
#include <linux/stat.h>
unsigned c0(void) { return _IOC_NONE; }
unsigned c1(void) { return _IOC_READ; }
unsigned c2(void) { return _IOC_WRITE; }
unsigned c3(void) { return _IOC_SIZEBITS; }
unsigned c4(void) { return _IOC_DIRBITS; }
unsigned c5(void) { return _IOC_NRSHIFT; }
unsigned c6(void) { return _IOC_TYPESHIFT; }
unsigned c7(void) { return _IOC_SIZESHIFT; }
unsigned c8(void) { return _IOC_DIRSHIFT; }
unsigned c9(void) { return STATX__RESERVED; }
