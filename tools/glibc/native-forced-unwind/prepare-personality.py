#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
from common import T,S,R,pin
import difflib,json
src=S/'libcxxabi/src/cxa_personality.cpp'
before=src.read_text()
old='''#ifdef __WASM_EXCEPTIONS__
            // Wasm only uses a single phase (_UA_SEARCH_PHASE), so save the
            // results here.
            set_registers(unwind_exception, context, results);
#endif
        }
        return _URC_HANDLER_FOUND;'''
new='''        }
#ifdef __WASM_EXCEPTIONS__
        // Native Wasm dispatch is single-phase for foreign exceptions too.
        // Preserve native-only header caching above; publish every found selector.
        set_registers(unwind_exception, context, results);
#endif
        return _URC_HANDLER_FOUND;'''
assert before.count(old)==1
after=before.replace(old,new)
out=T/'source/libcxxabi/src/cxa_personality.cpp';out.parent.mkdir(parents=True,exist_ok=True)
assert not out.exists(), 'preserve attempt; use a new versioned output'
out.write_text(after)
p=T/'logs/personality-attempt1.patch'
p.write_text(''.join(difflib.unified_diff(before.splitlines(True),after.splitlines(True),fromfile='a/libcxxabi/src/cxa_personality.cpp',tofile='b/libcxxabi/src/cxa_personality.cpp')))
(T/'logs/personality-attempt1-inputs.json').write_text(json.dumps({'original':str(src),'originalPin':pin(src),'owned':str(out),'ownedPin':pin(out),'patch':str(p),'patchPin':pin(p),'compiled':False,'runtimeAccepted':False},indent=2)+'\n')
print(pin(p))
