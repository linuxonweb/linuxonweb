#!/usr/bin/env python3
"""Retain dependency-only invocations matching the two measured layout inputs."""
import os,pathlib,json,subprocess
T=pathlib.Path(os.environ['GLIBC_TASK']);commands=[]
for name in ['gnu','kernel']:
 matches=[]
 for p in (T/'logs/c-attempts').glob('*/attempt.json'):
  j=json.loads(p.read_text())
  if j['output']==str(T/('objects/layout-'+name+'.o')) and j['pass']:matches.append((p,j))
 assert len(matches)==1;p,j=matches[0];args=j['originalArgs'].copy();args.remove('-c');pos=args.index('-o');del args[pos:pos+2]
 out=T/('objects/layout-'+name+'.d');assert not out.exists()
 command=[str(T/'objects/compiler/clang'),'--target=wasm32-unknown-linux-gnu',*args,'-M','-MF',str(out),'-MT','layout-'+name]
 with (T/('logs/layout-'+name+'-dependencies.log')).open('wb') as log:r=subprocess.run(command,cwd=j['cwd'],stdout=log,stderr=subprocess.STDOUT)
 commands.append({'argv':command,'cwd':j['cwd'],'exit':r.returncode,'originalMeasuredAttempt':str(p),'dependency':str(out)})
 (T/'logs/layout-dependency-commands.json').write_text(json.dumps(commands,indent=2)+'\n');assert r.returncode==0
