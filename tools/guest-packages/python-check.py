import os,sys,json,hashlib,zlib,pathlib,math,ssl,socket,threading,subprocess
checks=[]
def check(name,value):
 if not value:raise AssertionError(name)
 checks.append(name);print('PYTHON_CHECK_PASS',name,flush=True)
check('version',sys.version_info[:3]==(3,14,6))
check('arithmetic',sum(i*i for i in range(10000))==333283335000 and math.isclose(math.sqrt(2)**2,2))
text='Linux/Wasm — Python: 中文 🌍';check('unicode',text.encode().decode()==text and len('🌍')==1)
p=pathlib.Path('/tmp/python-data.txt');p.write_text(text,encoding='utf-8');check('file-read-write',p.read_text(encoding='utf-8')==text)
q=p.with_name('python-renamed.txt');p.replace(q);check('file-rename-stat',q.stat().st_size==len(text.encode()))
obj={'message':text,'list':[1,None,True,3.5]};check('json',json.loads(json.dumps(obj))==obj)
raw=(text*100).encode();check('compression',zlib.decompress(zlib.compress(raw))==raw)
check('sha256',hashlib.sha256(b'abc').hexdigest()=='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
check('secure-random',len(os.urandom(32))==32)
ctx=ssl.create_default_context();check('ssl-context',len(ctx.get_ciphers())>0)
check('ssl-trust-store',len(ctx.get_ca_certs())>10)
addresses=socket.getaddrinfo('localhost',1234,type=socket.SOCK_STREAM);check('name-resolution',any(a[4][0]=='127.0.0.1' for a in addresses))
server=socket.socket();server.settimeout(5);server.bind(('127.0.0.1',0));server.listen(1);port=server.getsockname()[1];received=[]
def echo():
 c,_=server.accept()
 with c:received.append(c.recv(100));c.sendall(b'guest socket reply')
t=threading.Thread(target=echo);t.start()
with socket.create_connection(('127.0.0.1',port),timeout=5) as c:c.sendall(b'guest socket request');reply=c.recv(100)
t.join(5);server.close();check('threads-and-tcp',reply==b'guest socket reply' and received==[b'guest socket request'] and not t.is_alive())
check('posix-spawn-available',hasattr(os,'posix_spawn'))
pid=os.posix_spawn('/bin/busybox',['busybox','sh','-c','/bin/busybox printf spawn-ok > /tmp/python-spawn.txt; exit 7'],dict(os.environ));waited,status=os.waitpid(pid,0);check('real-spawn-wait-status',waited==pid and os.waitstatus_to_exitcode(status)==7)
check('real-spawn-file',pathlib.Path('/tmp/python-spawn.txt').read_text()=='spawn-ok')
try:pid=os.posix_spawn('/no-such-program',['/no-such-program'],dict(os.environ))
except FileNotFoundError:spawn_missing='ENOENT'
else:spawn_missing='child-exit-'+str(os.waitstatus_to_exitcode(os.waitpid(pid,0)[1]))
print('PYTHON_SMOKE_RESULT',json.dumps({'checks':checks,'version':sys.version,'platform':sys.platform,'spawnMissingBehavior':spawn_missing,'subprocessMode':'not yet adapted; explicit unsupported operation','unavailableExtensions':['mmap','_ctypes','_curses','_curses_panel','_tkinter','readline','_dbm','_gdbm','_remote_debugging','_posixsubprocess'],'sysPath':sys.path}),flush=True)
