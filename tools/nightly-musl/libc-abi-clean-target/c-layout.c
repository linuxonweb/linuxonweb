#define _GNU_SOURCE 1
#include <stddef.h>
#include <stdint.h>
#include <sys/stat.h>
#include <time.h>
#include <pthread.h>
#include <signal.h>
#include <semaphore.h>
unsigned c_char_size(void) { return sizeof(long); }
unsigned c_char_align(void) { return _Alignof(long); }
unsigned c_pointer_size(void) { return sizeof(void*); }
unsigned c_pointer_align(void) { return _Alignof(void*); }
unsigned c_time_size(void) { return sizeof(time_t); }
unsigned c_time_align(void) { return _Alignof(time_t); }
unsigned c_off_size(void) { return sizeof(off_t); }
unsigned c_off_align(void) { return _Alignof(off_t); }
unsigned c_pthread_size(void) { return sizeof(pthread_t); }
unsigned c_pthread_align(void) { return _Alignof(pthread_t); }
unsigned c_timespec_size(void) { return sizeof(struct timespec); }
unsigned c_timespec_align(void) { return _Alignof(struct timespec); }
unsigned c_stat_size(void) { return sizeof(struct stat); }
unsigned c_stat_align(void) { return _Alignof(struct stat); }
unsigned c_pthread_attr_size(void) { return sizeof(pthread_attr_t); }
unsigned c_pthread_attr_align(void) { return _Alignof(pthread_attr_t); }
unsigned c_pthread_mutex_size(void) { return sizeof(pthread_mutex_t); }
unsigned c_pthread_mutex_align(void) { return _Alignof(pthread_mutex_t); }
unsigned c_pthread_cond_size(void) { return sizeof(pthread_cond_t); }
unsigned c_pthread_cond_align(void) { return _Alignof(pthread_cond_t); }
unsigned c_pthread_rwlock_size(void) { return sizeof(pthread_rwlock_t); }
unsigned c_pthread_rwlock_align(void) { return _Alignof(pthread_rwlock_t); }
unsigned c_sigset_size(void) { return sizeof(sigset_t); }
unsigned c_sigset_align(void) { return _Alignof(sigset_t); }
unsigned c_stack_size(void) { return sizeof(stack_t); }
unsigned c_stack_align(void) { return _Alignof(stack_t); }
unsigned c_sem_size(void) { return sizeof(sem_t); }
unsigned c_sem_align(void) { return _Alignof(sem_t); }
unsigned c_timespec_tv_nsec(void) { return offsetof(struct timespec, tv_nsec); }
unsigned c_stat_st_size(void) { return offsetof(struct stat, st_size); }
unsigned c_stat_st_atime(void) { return offsetof(struct stat, st_atime); }
unsigned c_stat_st_atime_nsec(void) { return offsetof(struct stat, st_atim.tv_nsec); }
unsigned c_stat_st_ctime_nsec(void) { return offsetof(struct stat, st_ctim.tv_nsec); }
