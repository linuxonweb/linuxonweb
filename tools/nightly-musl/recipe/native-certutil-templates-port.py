from pathlib import Path
import difflib,hashlib,json,subprocess,sys,shutil
T=Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002');S=T/'source/firefox-159.0a1';P=T/'certutil-templates-preflight'
groups=set(map(int,subprocess.check_output(['ps','-eo','pgid='],text=True).split()))
for p in (T/'status').glob('*.json'):
 d=json.loads(p.read_text())
 if isinstance(d,dict) and all(k in d for k in ('phase','pgid','state')):assert d['state']=='completed' and d['pgid'] not in groups,p
P.mkdir(exist_ok=True);changes=[];patch=''
for file,symbol,prefix,sha in [
 ('certext.c','CERT_OidSeqTemplate','certutil_WasmOidSeqTemplate','ecc1dc212061703005fd66454c4c764fc8acc319fca5455dd3afd9546c1bab5e'),
 ('keystuff.c','SECKEY_PQGParamsTemplate','certutil_WasmPQGParamsTemplate','01c59698719077b992108bf0d32bdf67248d5244ee1669ca60d79f7d7797d270')]:
 name='security/nss/cmd/certutil/'+file;p=S/name;old=p.read_text();assert hashlib.sha256(old.encode()).hexdigest()==sha
 needle='const SEC_ASN1Template '+symbol+'[] = {';assert old.count(needle)==1 and prefix not in old
 new=old.replace(needle,'#if defined(__linux__) && defined(__wasm__) && !defined(__wasi__)\n#define '+symbol+' '+prefix+'\n#endif\n'+needle)
 original=P/('original-'+file);assert not original.exists();original.write_text(old)
 obj=T/'obj-nightly/security/nss/cmd/certutil/certutil_certutil'/Path(file).with_suffix('.o');backup=P/('original-'+obj.name);assert not backup.exists();shutil.copyfile(obj,backup)
 patch+=''.join(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile='a/'+name,tofile='b/'+name))
 if '--apply' in sys.argv:assert p.read_text()==old;p.write_text(new)
 changes.append(dict(source=str(p),symbol=symbol,native_alias=prefix,original_sha256=sha,updated_sha256=hashlib.sha256(new.encode()).hexdigest(),original_backup=str(original),original_object=str(backup)))
(T/'patches/nightly-native-certutil-templates.patch').write_text(patch)
(T/'status/native-certutil-templates-port.json').write_text(json.dumps(dict(scope='Native Linux/Wasm certutil command copies of two ASN.1 tables get unique names; data, library identities and other targets unchanged',changes=changes,owned_groups_empty_before_apply=True,applied='--apply' in sys.argv),indent=2)+'\n')
print(json.dumps(changes))
