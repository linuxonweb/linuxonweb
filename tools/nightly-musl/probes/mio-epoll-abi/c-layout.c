#include <sys/epoll.h>
#include <stddef.h>
unsigned c_size(void) { return sizeof(struct epoll_event); }
unsigned c_align(void) { return _Alignof(struct epoll_event); }
unsigned c_data(void) { return offsetof(struct epoll_event, data); }
unsigned c_in(void) { return EPOLLIN; }
unsigned c_out(void) { return EPOLLOUT; }
unsigned c_edge(void) { return EPOLLET; }
