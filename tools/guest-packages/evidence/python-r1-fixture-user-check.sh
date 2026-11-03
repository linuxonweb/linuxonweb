#!/bin/busybox sh
[ -z "${PYTHONHOME-}" ] || exit 1
python3 -c 'import sys,json,zlib,ssl; assert sys.prefix=="/usr" and sys.exec_prefix=="/usr"; assert json.loads(json.dumps([1,2]))==[1,2]; assert zlib.decompress(zlib.compress(b"ok"))==b"ok"; assert ssl.create_default_context().cert_store_stats()["x509_ca"]>0; print("PYTHON_ADMIN_R1_OK",sys.executable,sys.version.split()[0])' || exit 2
python3 -m json.tool --help || exit 3
python3 /tests/python-check.py || exit 4
/bin/busybox echo PYTHON_ADMIN_MODULE_EXIT=0
