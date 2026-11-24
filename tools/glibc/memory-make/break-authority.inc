/* Native logical break is separate from mapping placement. Once a mapping
   occupies the extension interval, report ENOMEM rather than overlap it. */
int __wasm_memory_brk(uintptr_t address, uintptr_t *actual) {
 lock();
 if(!initialized){unlock();__set_errno(EINVAL);return -1;}
 *actual=break_cursor;
 if(address) {
  if(address<heap_begin){unlock();__set_errno(ENOMEM);return -1;}
  if(address>break_cursor && (cursor!=break_cursor || !ensure(address))) {
   unlock();__set_errno(ENOMEM);return -1;
  }
  if(cursor==break_cursor)cursor=address;
  break_cursor=address;*actual=break_cursor;
 }
 unlock();return 0;
}
