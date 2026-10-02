#!/usr/bin/env python3
import os,pathlib
S=pathlib.Path(os.environ['SRC']);A=S/'sysdeps/unix/sysv/linux/wasm32'
(A/'internaltypes.h').write_text('/* Owned dependency forwarding; GNU definitions unchanged. */\n#include <bits/types/struct_sched_param.h>\n#include <sched.h>\n#include_next <internaltypes.h>\n')
(A/'bits').mkdir(exist_ok=True)
(A/'bits/sched.h').write_text('/* Load actual GNU type before Linux compatibility masking. */\n#include <bits/types/struct_sched_param.h>\n#include_next <bits/sched.h>\n')
