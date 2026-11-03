#!/usr/bin/env python3
import argparse,importlib.util,json,pathlib
p=argparse.ArgumentParser();p.add_argument('--probe',type=pathlib.Path,required=True);p.add_argument('--out',type=pathlib.Path,required=True);a=p.parse_args();a.out.mkdir(parents=True,exist_ok=False)
here=pathlib.Path(__file__).resolve().parent;s=importlib.util.spec_from_file_location('smoke',here/'make-smoke.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
init='''#!/bin/busybox sh
export PATH=/usr/bin:/bin:/sbin:/usr/sbin
/bin/busybox mount -t devtmpfs devtmpfs /dev
/bin/busybox mount -t proc proc /proc
/bin/busybox mount -t sysfs sysfs /sys
/bin/busybox mkdir -p /home /run
/bin/busybox mount -t virtiofs home /home
if /usr/bin/persistence-primitives; then status=0; else status=1; fi
echo PACKAGE_SMOKE_EXIT status=$status
exec /bin/busybox poweroff -f
'''
(a.out/'init').write_text(init)
m.build(pathlib.Path('out/gpt-6-astra-pro_builtin-agents_packages-mobile-20261103/build/immutable-60847f.cpio.gz'),'60847fb853398000566e822884816fdd8a75d6c8e7776189ba3fcab1672859fa',a.out/'init',{'usr/bin/persistence-primitives':a.probe},a.out/'primitives.cpio')
(a.out/'config.json').write_text(json.dumps({'persistHome':True,'exportDatabase':False,'timeoutSeconds':35},indent=2)+'\n')
