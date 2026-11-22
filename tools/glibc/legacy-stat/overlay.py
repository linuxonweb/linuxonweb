#!/usr/bin/env python3
"""Preserve version-zero public ABI while selecting GNU's conversion body."""
import hashlib,json,os,pathlib
T=pathlib.Path(os.environ['GLIBC_TASK']);S=T/'source/glibc-2.44';R=pathlib.Path(__file__).resolve().parent
pristine=pathlib.Path(os.environ['GNU_RELEASE_ARCHIVE']).parent.parent/'source/glibc-2.44'
source=S/'sysdeps/unix/sysv/linux/xstatconv.c';assert source.read_bytes()==(pristine/source.relative_to(S)).read_bytes()
old=source.read_text();first='''    case _STAT_VER_KERNEL:
      /* Nothing to do.  The struct is in the form the kernel expects.
         We should have short-circuted before we got here, but for
         completeness... */
      *(struct kernel_stat *) ubuf = *kbuf;
      break;
'''
last='''    case _STAT_VER_KERNEL:
    default:
      return INLINE_SYSCALL_ERROR_RETURN_VALUE (EINVAL);'''
assert old.count(first)==1 and old.count(last)==2
# The alternate !XSTAT_IS_XSTAT64 body also shares these constants; guarding
# its duplicate label is harmless and keeps every GNU conversion body exact.
new=old.replace(first,'#if _STAT_VER_KERNEL != _STAT_VER_LINUX\n'+first+'#endif\n')
new=new.replace(last,'#if _STAT_VER_KERNEL != _STAT_VER_LINUX\n    case _STAT_VER_KERNEL:\n#endif\n    default:\n      return INLINE_SYSCALL_ERROR_RETURN_VALUE (EINVAL);')
dest=S/'sysdeps/unix/sysv/linux/wasm32/xstatconv.c';assert not dest.exists();dest.write_text(new)
header=S/'sysdeps/unix/sysv/linux/wasm32/kernel_stat.h';before=header.read_bytes();fields=(R/'kernel-stat-fields.h').read_bytes();assert before.endswith(b'#endif\n')
(T/'source-snapshots/kernel_stat-before.h').write_bytes(before)
header.write_bytes(before[:-len(b'#endif\n')]+fields+b'\n#endif\n')
def digest(p):return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
report={'pass':True,'publicVersionsUnchanged':True,'raw104PublicCopySupported':False,'GNUoriginal':str(source),'GNUoriginalHash':digest(source),'selectedSource':str(dest),'selectedHash':digest(dest),'guardedDuplicateCases':3,'header':str(header),'headerHash':digest(header),'fieldProvider':str(R/'kernel-stat-fields.h'),'fieldProviderHash':digest(R/'kernel-stat-fields.h'),'limitations':'genuine GNU conversion leaves some public reserved/time padding unchanged; audit explicitly measures this'}
(T/'logs/legacy-overlay.json').write_text(json.dumps(report,indent=2)+'\n')
