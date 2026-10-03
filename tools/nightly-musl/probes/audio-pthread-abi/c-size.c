#include <pthread.h>
#include <stdint.h>
unsigned c_pthread_size(void) { return sizeof(pthread_t); }
unsigned c_pointer_size(void) { return sizeof(uintptr_t); }
