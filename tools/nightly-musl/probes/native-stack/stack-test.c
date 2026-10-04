#define _GNU_SOURCE
#include <pthread.h>
#include <semaphore.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include <stdlib.h>
extern unsigned char __stack_low[], __stack_high[];
extern int __real_pthread_getattr_np(pthread_t,pthread_attr_t*);
static atomic_int passes,failures,cleanup_count,key_count;
static pthread_t main_thread;
static sem_t ready,release;
static pthread_key_t key;
#define CHECK(expr,name) do{int ok=!!(expr);atomic_fetch_add(ok?&passes:&failures,1);printf("GUEST_STACK %s %s\n",ok?"PASS":"FAIL",name);}while(0)
static void cleanup(void *unused){(void)unused;atomic_fetch_add(&cleanup_count,1);}
static void key_dtor(void *unused){(void)unused;atomic_fetch_add(&key_count,1);}
static void *worker(void *unused){
 (void)unused;char frame;pthread_attr_t attr,real,main_attr;void *base=0;size_t size=0;
 CHECK(pthread_getattr_np(pthread_self(),&attr)==0,"worker self query");
 CHECK(__real_pthread_getattr_np(pthread_self(),&real)==0 && memcmp(&attr,&real,sizeof attr)==0,"worker attrs equal real libc bytes");
 CHECK(pthread_attr_getstack(&attr,&base,&size)==0 && size>0,"worker actual stack range");
 CHECK((uintptr_t)&frame>=(uintptr_t)base && (uintptr_t)&frame<(uintptr_t)base+size,"worker live frame inside range");
 CHECK((uintptr_t)base>=(uintptr_t)__stack_high || (uintptr_t)base+size<=(uintptr_t)__stack_low,"worker stack distinct from main");
 CHECK(pthread_getattr_np(main_thread,&main_attr)==0,"worker query main");
 CHECK(pthread_attr_getstack(&main_attr,&base,&size)==0 && (uintptr_t)base==(uintptr_t)__stack_low && size==(uintptr_t)__stack_high-(uintptr_t)__stack_low,"worker sees exact main linker bounds");
 pthread_attr_destroy(&attr);pthread_attr_destroy(&real);pthread_attr_destroy(&main_attr);
 CHECK(pthread_setspecific(key,(void*)1)==0,"worker key registration");
 pthread_cleanup_push(cleanup,0);
 sem_post(&ready);while(sem_wait(&release)!=0){}
 CHECK(pthread_cancel(pthread_self())==0,"worker deferred self cancel");
 pthread_testcancel();
 pthread_cleanup_pop(1);
 return (void*)2;
}
int main(int argc,char **argv){
 (void)argv;main_thread=pthread_self();char frame;pthread_attr_t attr,worker_attr,real;void *base=0;size_t size=0,guard=1;int detach=-1;
 if(argc>1){pthread_attr_init(&attr);puts("GUEST_STACK_ORIGINAL query main now");fflush(stdout);return __real_pthread_getattr_np(main_thread,&attr);}
 CHECK(pthread_getattr_np(main_thread,&attr)==0,"main query");
 CHECK(pthread_attr_getstack(&attr,&base,&size)==0,"main stack accessor");
 CHECK((uintptr_t)base==(uintptr_t)__stack_low,"main exact linker low");
 CHECK((uintptr_t)base+size==(uintptr_t)__stack_high,"main exact linker high");
 CHECK(size==(uintptr_t)__stack_high-(uintptr_t)__stack_low && size>0,"main actual linker size");
 CHECK((uintptr_t)&frame>=(uintptr_t)base && (uintptr_t)&frame<(uintptr_t)base+size,"main live frame inside range");
 CHECK(pthread_attr_getguardsize(&attr,&guard)==0 && guard==0,"main real guard size");
 CHECK(pthread_attr_getdetachstate(&attr,&detach)==0 && detach==PTHREAD_CREATE_JOINABLE,"main real joinable state");
 CHECK(pthread_attr_destroy(&attr)==0,"main attr lifecycle");
 CHECK(sem_init(&ready,0,0)==0 && sem_init(&release,0,0)==0,"semaphore setup");
 CHECK(pthread_key_create(&key,key_dtor)==0,"key creation");
 pthread_t t;int cr=pthread_create(&t,0,worker,0);CHECK(cr==0,"worker creation");if(cr)return 1;
 while(sem_wait(&ready)!=0){}
 CHECK(pthread_getattr_np(t,&worker_attr)==0,"main query live worker");
 CHECK(__real_pthread_getattr_np(t,&real)==0 && memcmp(&worker_attr,&real,sizeof real)==0,"main sees unchanged libc worker attrs");
 CHECK(pthread_attr_destroy(&worker_attr)==0 && pthread_attr_destroy(&real)==0,"worker query attr lifecycle");
 sem_post(&release);void *result=0;CHECK(pthread_join(t,&result)==0 && result==PTHREAD_CANCELED,"canceled worker joined");
 CHECK(atomic_load(&cleanup_count)==1 && atomic_load(&key_count)==1,"cancel cleanup and key lifecycle exactly once");
 CHECK(pthread_key_delete(key)==0 && sem_destroy(&ready)==0 && sem_destroy(&release)==0,"resource cleanup");
 printf("GUEST_STACK_RESULT pass=%d fail=%d low=%lu high=%lu size=%lu\n",atomic_load(&passes),atomic_load(&failures),(unsigned long)__stack_low,(unsigned long)__stack_high,(unsigned long)size);
 return atomic_load(&failures)!=0;
}
