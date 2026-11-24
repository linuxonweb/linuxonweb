/* MADV_DONTNEED covers live anonymous mappings and wholly owned break pages.
   Holes stay untouched; live intersections are discarded even on ENOMEM.
   Logical zeroing does not physically decommit Wasm memory. */
static int recognized_advice(int advice){
 switch(advice){
 case MADV_NORMAL: case MADV_RANDOM: case MADV_SEQUENTIAL:
 case MADV_WILLNEED: case MADV_DONTNEED: case MADV_FREE: case MADV_REMOVE:
 case MADV_DONTFORK: case MADV_DOFORK: case MADV_MERGEABLE:
 case MADV_UNMERGEABLE: case MADV_HUGEPAGE: case MADV_NOHUGEPAGE:
 case MADV_DONTDUMP: case MADV_DODUMP: case MADV_WIPEONFORK:
 case MADV_KEEPONFORK: case MADV_COLD: case MADV_PAGEOUT:
 case MADV_POPULATE_READ: case MADV_POPULATE_WRITE:
 case MADV_DONTNEED_LOCKED: case MADV_COLLAPSE: case MADV_HWPOISON:
 case MADV_GUARD_INSTALL: case MADV_GUARD_REMOVE:
 case 101: /* MADV_SOFT_OFFLINE: selected kernel UAPI, no GNU public macro. */
  return 1;
 default:return 0;
 }
}
int __wasm_memory_madvise(void *address,size_t length,int advice){
 lock();
 uintptr_t begin=(uintptr_t)address;
 if(!initialized || !recognized_advice(advice) ||
    (begin&(logical_page-1))){
  unlock();__set_errno(EINVAL);return -1;
 }
 if(advice!=MADV_DONTNEED){unlock();__set_errno(ENOTSUP);return -1;}
 if(!length){unlock();return 0;}
 size_t rounded=round_page(length);
 uint64_t end=(uint64_t)begin+rounded;
 if(!rounded || end>UINT32_MAX){unlock();__set_errno(EINVAL);return -1;}
 uint64_t brk_begin=((uint64_t)heap_begin+logical_page-1)&
                    ~((uint64_t)logical_page-1);
 uint64_t brk_end=(uint64_t)break_cursor&~((uint64_t)logical_page-1);
 uint64_t at=begin;
 int missing=0;
 while(at<end){
  uint64_t covered_end=at,next_begin=end;
  /* Find a containing live interval or the next live interval. Re-scanning
     the bounded registry also treats adjacent mapping intervals as a union. */
  for(int i=-1;i<SLOT_COUNT;i++){
   uint64_t lo,hi;
   if(i<0){lo=brk_begin;hi=brk_end;}
   else{
    if(!ranges[i].used)continue;
    lo=ranges[i].begin;hi=lo+ranges[i].size;
   }
   if(hi<=lo)continue;
   if(lo<=at && at<hi && hi>covered_end)covered_end=hi;
   else if(lo>at && lo<next_begin)next_begin=lo;
  }
  if(covered_end>at){
   if(covered_end>end)covered_end=end;
   memset((void*)(uintptr_t)at,0,(size_t)(covered_end-at));at=covered_end;
  }else{missing=1;at=next_begin;}
 }
 unlock();
 if(missing){__set_errno(ENOMEM);return -1;}
 return 0;
}
