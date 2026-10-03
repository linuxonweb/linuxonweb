#include "UniquePtrExtensions.h"
#include <fcntl.h>
#include <unistd.h>
#include <cerrno>
#include <cstdio>
int main(int argc,char** argv) {
  if(argc!=2)return 1;
  int fd=open(argv[1],O_CREAT|O_TRUNC|O_RDWR,0600);
  if(fd<0 || write(fd,"abc",3)!=3 || lseek(fd,0,SEEK_SET)!=0)return 2;
  mozilla::UniqueFileHandle original(fd);
  auto copy=mozilla::DuplicateFileHandle(original);
  if(!copy || int(copy.get())==fd || (fcntl(copy.get(),F_GETFD)&FD_CLOEXEC)==0)return 3;
  char ch=0;
  if(read(fd,&ch,1)!=1 || ch!='a' || read(copy.get(),&ch,1)!=1 || ch!='b')return 4;
  original.reset();
  if(read(copy.get(),&ch,1)!=1 || ch!='c')return 5;
  auto second=mozilla::DuplicateFileHandle(copy.get());
  if(!second || second.get()==copy.get() || (fcntl(second.get(),F_GETFD)&FD_CLOEXEC)==0)return 6;
  int closed=copy.get();copy.reset();
  errno=0;auto bad=mozilla::DuplicateFileHandle(closed);
  if(bad || errno!=EBADF)return 7;
  if(mozilla::DuplicateFileHandle(-1))return 8;
  puts("PASS actual copied MFBT body: duplicate identity, CLOEXEC, shared offset, independent closure, raw/owned overloads, EBADF, invalid handle");
}
