import hashlib,json,os,pathlib,shutil,subprocess,sys,tarfile
root=pathlib.Path.cwd()
archive=root/'downloads/mesa-26.2.3.tar.xz'
cache=pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else None
if cache is not None:
    shutil.copyfile(cache/archive.name,archive)
else:
    env=os.environ.copy();env.pop('LD_LIBRARY_PATH',None)
    subprocess.run(['curl','--fail','--location','--connect-timeout','10','--max-time','60','--retry','0','--output',str(archive),'https://archive.mesa3d.org/mesa-26.2.3.tar.xz'],env=env,check=True,timeout=65)
expected='1628058a8d2c0615975de5a15ab7bbb9638c50000b5bed9456ff423ea034a81f'
actual=hashlib.sha256(archive.read_bytes()).hexdigest()
assert actual==expected,(actual,expected)
target=root/'mesa-26.2.3'
assert not target.exists(),str(target)
with tarfile.open(archive) as f:
    f.extractall(root,filter='data')
print(json.dumps({'source':str(target),'archive_sha256':actual,'wrap':(target/'subprojects/libdrm.wrap').read_text()}))
