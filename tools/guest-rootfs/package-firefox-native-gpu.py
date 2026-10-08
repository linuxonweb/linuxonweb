#!/usr/bin/env python3
"""Stream an isolated current159 native GPU diagnostic; preserve ordinary init."""
import argparse
import copy
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess

ROOT = Path(__file__).resolve().parents[2]
BASE_SHA = 'c0eaffe22a66bb97f94ff53dcb645e402eb50dea98b0976b66000ea615d4ac9f'
OLD_FIREFOX = '815b3813d1ce3b7706973f93df2d2f147962d673bd0d3e35903919963e0c090b'
OLD_PLUGIN = 'b33500667491fa70b56505285f36109b59f66e82e6880e5ae772c053da315a93'
OLD_GFXTEST = '69f865a3561695e0fe1892b425271c803d78bafc8abf9effb1ea1c96e52edef9'
GFXTEST_FINAL = 'f178f071b85d6029847d842ebd00e085ddb9f78b086fbb0da4e864c9fb5e0205'
GFXTEST_VERIFICATION = '6214c186b34dc376bdac60298b439e0521580f10a3140737a0fd0531e674c236'
PAGE_NAME = 'opt/firefox/native-service-probe.html'
WRAPPER_NAME = 'opt/firefox/firefox-gpu-diagnostic'
# Existing pages replaced by the current repo copies (metadata kept, size updated).
PAGES = {'opt/firefox/gpu-check/gpu-check.html': ROOT/'tools/guest-rootfs/firefox-gpu-check/gpu-check.html'}
# Default prefs appended to the existing Wasm pref file (defaults only; saved user prefs win).
PREF_FILE = 'opt/firefox/defaults/pref/wasm.js'
# glremote keeps the current context per thread, so WebGL may run on its own
# CanvasRenderer thread instead of sharing WebRender's Renderer thread.
GPU_PREFS = {'webgl.threadsafe-gl.force-enabled': 'true'}
# Every guest home write is a browser storage transaction, so background
# writers cost host CPU. Defaults only: a saved user choice wins.
# - Telemetry upload on makes Glean rewrite datareporting/glean/db constantly.
# - Intermediate CA preloading downloads ~1,900 certificates one by one into
#   the remote-settings IndexedDB after the first sync: ~120 writes/s for 8-9
#   minutes on a 2-CPU guest. Without it, a server that sends an incomplete
#   chain can fail with an unknown-issuer error; revocation data still syncs.
PERF_PREFS = {'datareporting.healthreport.uploadEnabled': 'false',
              'datareporting.policy.dataSubmissionEnabled': 'false',
              'security.remote_settings.intermediates.enabled': 'false'}
# Browser prefs load after PREF_FILE, so defaults Firefox's own firefox.js sets
# are appended there instead.
APP_PREF_FILE = 'opt/firefox/browser/defaults/preferences/firefox.js'
# Closing the page ends Firefox abruptly; start normally instead of showing
# the crashed-session page on every boot. The guest has no other browser.
APP_PREFS = {'browser.sessionstore.resume_from_crash': 'false',
             'browser.shell.checkDefaultBrowser': 'false'}
WRAPPER = b'''#!/bin/busybox sh
export MOZ_WEBGL_FORCE_EGL=1
export GUEST_GPU_TRANSPORT=hostcall GUEST_GPU_BACKEND=auto GUEST_GL_BACKEND=auto
# pblic=N on the kernel command line sets the IC compiler switch (A/B tests);
# pblbc=N sets the method compiler switch (PBLBC; needs PBLIC);
# pblops=1 turns on the opcode histogram of diagnostic builds.
for arg in $(cat /proc/cmdline); do
  case "$arg" in
    pblic=[0-9]) export PBLIC="${arg#pblic=}";;
    pblbc=[0-9]) export PBLBC="${arg#pblbc=}";;
    pblops=1) export PBLOPS=1;;
  esac
done
exec /opt/firefox/firefox "$@"
'''
GFXTEST_PROBE = b'''# Explicit standalone diagnostic; this subshell cannot change Firefox limits.
(
  umask 077
  read -r probe_nonce < /home/admin/.gpu-native-gfxtest-permit || exit 91
  [ "${#probe_nonce}" = 32 ] || exit 92
  case "$probe_nonce" in *[!0-9a-f]*) exit 93;; esac
  probe_root=/home/admin/.gpu-native-gfxtest
  /bin/busybox mkdir -p "$probe_root" || exit 94
  probe_work="$probe_root/$probe_nonce"
  /bin/busybox mkdir "$probe_work" || exit 95
  # BusyBox file-limit units are platform-dependent: 64 is at most 64KiB.
  ulimit -c 0 && ulimit -f 64 && ulimit -t 24 && ulimit -v 8388608 || exit 96
  /bin/busybox sh -n /opt/firefox/firefox-gpu-diagnostic || exit 97
  [ "$DISPLAY" = :0 ] && [ -S /tmp/.X11-unix/X0 ] || exit 98
  read -r control_start unused < /proc/uptime || exit 99
  /bin/busybox timeout -s KILL 1 /bin/busybox sleep 5 >"$probe_work/timeout-control.stdout" 2>"$probe_work/timeout-control.stderr"
  control_status=$?
  read -r control_end unused < /proc/uptime || exit 100
  [ "$control_status" = 137 ] || exit 101
  [ $((${control_end%.*}-${control_start%.*})) -le 2 ] || exit 106
  read -r probe_start unused < /proc/uptime || exit 102
  /bin/busybox timeout -s KILL 4 /bin/busybox sh -c '
    probe_work=$1
    printf "%s\\n" "$$" > "$probe_work/pre-exec.pid"
    read -r probe_stat < /proc/$$/stat || exit 103
    printf "%s\\n" "$probe_stat" > "$probe_work/pre-exec.stat"
    /bin/busybox readlink /proc/$$/fd/3 > "$probe_work/pre-exec.fd3" || exit 104
    exec /opt/firefox/gfxtest glx -f 3
  ' owned-gfxtest "$probe_work" 3>"$probe_work/protocol.raw" >"$probe_work/stdout.raw" 2>"$probe_work/stderr.raw"
  probe_status=$?
  read -r probe_end unused < /proc/uptime || exit 105
  [ $((${probe_end%.*}-${probe_start%.*})) -le 5 ] || exit 107
  set -- $(/bin/busybox wc -c < "$probe_work/protocol.raw"); protocol_bytes=$1
  set -- $(/bin/busybox wc -c < "$probe_work/stdout.raw"); stdout_bytes=$1
  set -- $(/bin/busybox wc -c < "$probe_work/stderr.raw"); stderr_bytes=$1
  printf '{"schema":1,"kind":"standalone-gfxtest","nonce":"%s","command":"/opt/firefox/gfxtest glx -f 3","deadlineMs":4000,"exitStatus":%s,"protocolBytes":%s,"stdoutBytes":%s,"stderrBytes":%s,"startUptime":%s,"endUptime":%s,"timeoutControl":{"exitStatus":%s,"startUptime":%s,"endUptime":%s},"syntaxControl":true,"displaySocketControl":true,"postExecIdentity":"Unknown","firefoxParentAcceptance":false,"gpuAcceptance":false}\\n' "$probe_nonce" "$probe_status" "$protocol_bytes" "$stdout_bytes" "$stderr_bytes" "$probe_start" "$probe_end" "$control_status" "$control_start" "$control_end" > "$probe_work/receipt.json"
  printf 'FIREFOX_GFXTEST_STANDALONE_V1 '
  /bin/busybox cat "$probe_work/receipt.json"
) || { probe_gate_status=$?; printf 'FIREFOX_GFXTEST_STANDALONE_GATE_FAILED status=%s\\n' "$probe_gate_status" >&2; exit "$probe_gate_status"; }
'''

def diagnostic_wrapper(vk_trace=False, gfxtest_probe=False):
    wrapper = WRAPPER.replace(b'exec /opt/firefox/firefox',
                             b'export GUEST_VK_TRACE=1\nexec /opt/firefox/firefox') if vk_trace else WRAPPER
    if gfxtest_probe:
        wrapper = wrapper.replace(b'exec /opt/firefox/firefox', GFXTEST_PROBE+b'exec /opt/firefox/firefox')
    return wrapper

def digest(p):
    with Path(p).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

def pin(p):
    p = Path(p).resolve(strict=True)
    return {'path':str(p), 'bytes':p.stat().st_size, 'sha256':digest(p)}

def validated_gfxtest(build_path, verification_path):
    """Admit only the independently reviewed candidate, never probe results."""
    verification_pin = pin(verification_path)
    if verification_pin['sha256'] != GFXTEST_VERIFICATION:
        raise ValueError('exact reviewed gfxtest verification required')
    verification = json.loads(Path(verification_path).read_text())
    checks = verification.get('checks', {})
    if (verification.get('passVerification') is not True or len(checks) != 17 or
            any(value is not True for value in checks.values()) or
            verification.get('guestAcceptance') is not False or
            verification.get('gpuAcceptance') is not False):
        raise ValueError('17 actual gfxtest checks required; runtime remains unaccepted')
    build_pin = pin(build_path)
    if build_pin != verification.get('buildReport'):
        raise ValueError('gfxtest build report identity')
    build = json.loads(Path(build_path).read_text())
    if (build.get('passBuild') is not True or build.get('candidateOnly') is not True or
            build.get('guestAcceptance') is not False or build.get('gpuAcceptance') is not False):
        raise ValueError('passing candidate gfxtest build required')
    final = pin(build['artifacts']['final']['path'])
    if (final != build['artifacts']['final'] or final != verification.get('final') or
            final['sha256'] != GFXTEST_FINAL):
        raise ValueError('actual gfxtest candidate bytes changed')
    return final, {'build':build_pin, 'verification':verification_pin,
                   'checksPassed':17, 'final':final, 'guestAcceptance':False,
                   'gpuAcceptance':False}

def fields(header):
    if len(header) != 110 or header[:6] not in (b'070701', b'070702'):
        raise ValueError('invalid newc header')
    return [int(header[6+i*8:14+i*8], 16) for i in range(13)]

def exact(f, size):
    value = f.read(size)
    if len(value) != size:
        raise ValueError('short archive field')
    return value

def copy_body(src, dst, size, encoded=None):
    h = hashlib.sha256()
    while size:
        value = exact(src, min(size, 1024**2))
        size -= len(value)
        h.update(value)
        if encoded is not None: encoded.update(value)
        if dst is not None: dst.write(value)
    return h.hexdigest()

def added_record(dst, name, body, mode, inode):
    name_bytes = name.encode() + b'\0'
    values = [inode, mode, 0, 0, 1, 0, len(body), 0, 0, 0, 0, len(name_bytes), 0]
    dst.write(b'070701' + b''.join(f'{v:08x}'.encode() for v in values))
    dst.write(name_bytes);dst.write(b'\0' * (-(110+len(name_bytes)) % 4))
    dst.write(body);dst.write(b'\0' * (-len(body) % 4))

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--source', type=Path, required=True)
    ap.add_argument('--manifest', type=Path, required=True)
    ap.add_argument('--build', type=Path, required=True)
    ap.add_argument('--output', type=Path, required=True)
    ap.add_argument('--no-publish', action='store_true',
                    help='do not copy the package into the web/desktop dev server (latest-build)')
    ap.add_argument('--vk-trace', action='store_true',
                    help='enable existing native Vulkan diagnostics in the test-only wrapper')
    ap.add_argument('--env', action='append', default=[], metavar='NAME=VALUE',
                    help='test-only extra environment for Firefox in the wrapper (e.g. MOZ_LOG=...)')
    ap.add_argument('--gpu-check-page', type=Path,
                    help='test-only replacement for the built-in gpu-check page')
    ap.add_argument('--pref', action='append', default=[], metavar='NAME=VALUE',
                    help='test-only extra default pref (JS literal value); repeatable')
    ap.add_argument('--gfxtest-build', type=Path,
                    help='explicitly replace only the genuine existing gfxtest with the reviewed candidate build')
    ap.add_argument('--gfxtest-verification', type=Path,
                    help='exact independently reviewed17-check candidate receipt; required with --gfxtest-build')
    ap.add_argument('--gfxtest-test-wasm', type=Path,
                    help='test-only unreviewed gfxtest helper (e.g. linked on glremote) replacing the genuine one')
    ap.add_argument('--gfxtest-probe', action='store_true',
                    help='explicit test-only standalone helper probe before unchanged Firefox exec; requires both helper flags')
    a = ap.parse_args()
    if bool(a.gfxtest_build) != bool(a.gfxtest_verification):
        ap.error('--gfxtest-build and --gfxtest-verification must be selected together')
    if a.gfxtest_test_wasm and a.gfxtest_build:
        ap.error('--gfxtest-test-wasm and --gfxtest-build are exclusive')
    if a.gfxtest_probe and not a.gfxtest_build:
        ap.error('--gfxtest-probe requires the authenticated helper build and verification')
    wrapper = diagnostic_wrapper(a.vk_trace, a.gfxtest_probe)
    extra_env = dict(item.split('=', 1) for item in a.env)
    if any(not k.replace('_', '').isalnum() or "'" in v for k, v in extra_env.items()):
        ap.error('--env needs NAME=VALUE without quotes')
    if extra_env:
        wrapper = wrapper.replace(b'exec /opt/firefox/firefox', ''.join(f"export {k}='{v}'\n" for k, v in extra_env.items()).encode()+b'exec /opt/firefox/firefox')
    out = a.output.absolute()
    parent = out.parent.resolve(strict=True)
    if out.exists() or out.is_symlink() or parent != out.parent or not str(parent).startswith('/mnt/p3/codex-build/'):
        ap.error('fresh output under canonical persistent p3 task required')
    for key in ('TMPDIR','TMP','TEMP'):
        scratch = Path(os.environ.get(key, '/tmp')).resolve(strict=True)
        if not str(scratch).startswith('/mnt/p3/codex-build/'):
            ap.error('task-owned disk scratch required')
    if shutil.disk_usage(parent).free < 20*1024**3:
        ap.error('20GiB reserve required')
    build = json.loads(a.build.read_text())
    if build.get('passBuild') is not True or build.get('gpuAcceptance') is not False:
        ap.error('passing diagnostic build required')
    native = {}
    for name in ('firefox','plugin-container'):
        row = build['artifacts'][name]['final']
        native[name] = pin(row['path'])
        if native[name] != row:
            ap.error('built native artifact changed')
    gfxtest = None
    if a.gfxtest_build:
        native['gfxtest'], gfxtest = validated_gfxtest(a.gfxtest_build, a.gfxtest_verification)
    elif a.gfxtest_test_wasm:
        native['gfxtest'] = pin(a.gfxtest_test_wasm)
        gfxtest = {'final':native['gfxtest'], 'testOnly':True, 'reviewed':False, 'gpuAcceptance':False}
    base_pin = pin(a.source)
    if base_pin['sha256'] != BASE_SHA:
        ap.error('current reviewed159 source required')
    manifest = json.loads(a.manifest.read_text())
    if manifest['assets']['firefox']['sha256'] != BASE_SHA or manifest['assets']['firefox']['bytes'] != base_pin['bytes']:
        ap.error('manifest does not bind actual current archive')
    out.mkdir(); archive = out/'initramfs-firefox.cpio.gz'
    page = (ROOT/'tools/guest-rootfs/firefox-gpu-check/native-service-probe.html').read_bytes()
    replacement = {'opt/firefox/firefox':('firefox',OLD_FIREFOX),
                   'opt/firefox/firefox-bin':('firefox',OLD_FIREFOX),
                   'opt/firefox/plugin-container':('plugin-container',OLD_PLUGIN)}
    if gfxtest:
        replacement['opt/firefox/gfxtest'] = ('gfxtest', OLD_GFXTEST)
    pages = {name:path.read_bytes() for name,path in PAGES.items()}
    if a.gpu_check_page:
        pages['opt/firefox/gpu-check/gpu-check.html'] = a.gpu_check_page.read_bytes()
    prefs = {**GPU_PREFS, **dict(item.split('=', 1) for item in a.pref)}
    if any(not k.replace('.', '').replace('-', '').replace('_', '').isalnum() or '\n' in v or ')' in v for k, v in prefs.items()):
        ap.error('--pref needs NAME=VALUE with a plain JS literal')
    pref_block = ('// BEGIN Linux on Web GPU defaults\n' + ''.join(f'pref("{k}", {v});\n' for k, v in prefs.items())
                  + '// END Linux on Web GPU defaults\n'
                  + '// BEGIN Linux on Web performance defaults\n' + ''.join(f'pref("{k}", {v});\n' for k, v in PERF_PREFS.items())
                  + '// END Linux on Web performance defaults\n').encode()
    app_pref_block = ('// BEGIN Linux on Web browser defaults\n' + ''.join(f'pref("{k}", {v});\n' for k, v in APP_PREFS.items())
                      + '// END Linux on Web browser defaults\n').encode()
    original = {}; changes = {}; max_inode = 0
    with gzip.open(a.source,'rb') as src, archive.open('xb') as target, gzip.GzipFile(filename='',fileobj=target,mode='wb',mtime=0,compresslevel=6) as dst:
        while True:
            header = exact(src,110); values = fields(header)
            name_raw = exact(src,values[11]); name = name_raw.rstrip(b'\0').decode()
            padding = exact(src,-(110+values[11])%4)
            if name in original: raise ValueError('duplicate archive path')
            if name in (PAGE_NAME,WRAPPER_NAME): raise ValueError('diagnostic entry already present')
            max_inode = max(max_inode,values[0])
            encoded = hashlib.sha256(header+name_raw+padding)
            if name == 'TRAILER!!!':
                if values[6] != 0: raise ValueError('nonempty archive trailer')
                added_record(dst,WRAPPER_NAME,wrapper,stat.S_IFREG|0o755,max_inode+1)
                added_record(dst,PAGE_NAME,page,stat.S_IFREG|0o644,max_inode+2)
            if name in replacement:
                if name == 'opt/firefox/gfxtest' and values[1] != (stat.S_IFREG|0o755):
                    raise ValueError('expected genuine executable gfxtest record')
                binary, expected = replacement[name]
                old_sha = copy_body(src,None,values[6],encoded)
                if old_sha != expected: raise ValueError('old executable identity: '+name)
                new = native[binary];new_header=header[:54]+f"{new['bytes']:08x}".encode()+header[62:]
                dst.write(new_header+name_raw+padding)
                with Path(new['path']).open('rb') as f:
                    if copy_body(f,dst,new['bytes']) != new['sha256']:raise ValueError('native module changed while copying')
                dst.write(b'\0'*(-new['bytes']%4))
                changes[name]={'beforeSha256':old_sha,'after':new,'metadataPreservedExceptSize':True}
            elif name in pages:
                if stat.S_IFMT(values[1]) != stat.S_IFREG: raise ValueError('expected regular page record: '+name)
                old_sha = copy_body(src,None,values[6],encoded); body = pages[name]
                dst.write(header[:54]+f'{len(body):08x}'.encode()+header[62:]+name_raw+padding+body+b'\0'*(-len(body)%4))
                changes[name]={'beforeSha256':old_sha,'afterSha256':hashlib.sha256(body).hexdigest(),'metadataPreservedExceptSize':True}
            elif name in (PREF_FILE, APP_PREF_FILE):
                if stat.S_IFMT(values[1]) != stat.S_IFREG: raise ValueError('expected regular pref record')
                old = exact(src,values[6]); encoded.update(old)
                if b'Linux on Web GPU defaults' in old or b'Linux on Web browser defaults' in old: raise ValueError('pref block already present')
                body = old + (b'' if old.endswith(b'\n') else b'\n') + (pref_block if name == PREF_FILE else app_pref_block)
                dst.write(header[:54]+f'{len(body):08x}'.encode()+header[62:]+name_raw+padding+body+b'\0'*(-len(body)%4))
                changes[name]={'beforeSha256':hashlib.sha256(old).hexdigest(),'afterSha256':hashlib.sha256(body).hexdigest(),'metadataPreservedExceptSize':True}
            elif name == 'bin/firefox':
                old = exact(src,values[6]);encoded.update(old)
                if old != b'/opt/firefox/firefox' or stat.S_IFMT(values[1]) != stat.S_IFLNK:
                    raise ValueError('expected launcher symlink')
                body=b'/'+WRAPPER_NAME.encode()
                dst.write(header[:54]+f'{len(body):08x}'.encode()+header[62:]+name_raw+padding+body+b'\0'*(-len(body)%4))
                changes[name]={'beforeSha256':hashlib.sha256(old).hexdigest(),'afterSha256':hashlib.sha256(body).hexdigest(),'metadataPreservedExceptSize':True}
            else:
                dst.write(header+name_raw+padding)
                old_sha=copy_body(src,dst,values[6],encoded)
            body_padding=exact(src,-values[6]%4);encoded.update(body_padding)
            if name not in changes:dst.write(body_padding)
            original[name]={'encodedSha256':encoded.hexdigest(),'bodyBytes':values[6],'fields':values}
            if name == 'TRAILER!!!':
                tail=src.read();dst.write(tail);break
    if set(changes) != set(replacement)|set(pages)|{'bin/firefox',PREF_FILE,APP_PREF_FILE}:raise ValueError('missing expected native/launcher changes')
    if 'opt/firefox' not in original or stat.S_IFMT(original['opt/firefox']['fields'][1]) != stat.S_IFDIR:
        raise ValueError('diagnostic parent directory missing')
    # Independently stream the completed archive; preserve every untouched encoded record.
    seen=set();verified=0
    with gzip.open(archive,'rb') as src:
        while True:
            header=exact(src,110);v=fields(header);nraw=exact(src,v[11]);name=nraw.rstrip(b'\0').decode();pad=exact(src,-(110+v[11])%4)
            if name in seen:raise ValueError('duplicate output path')
            seen.add(name);encoded=hashlib.sha256(header+nraw+pad);body_sha=copy_body(src,None,v[6],encoded);encoded.update(exact(src,-v[6]%4))
            if name in original and name not in changes:
                if encoded.hexdigest()!=original[name]['encodedSha256']:raise ValueError('untouched record changed: '+name)
                verified+=1
            elif name in replacement:
                old_fields=original[name]['fields'];new_fields=list(v);new_fields[6]=old_fields[6]
                if new_fields != old_fields or body_sha != native[replacement[name][0]]['sha256']:raise ValueError('native replacement verification')
            elif name=='bin/firefox' or name in pages or name in (PREF_FILE,APP_PREF_FILE):
                old_fields=original[name]['fields'];new_fields=list(v);new_fields[6]=old_fields[6]
                if new_fields!=old_fields or body_sha!=changes[name]['afterSha256']:raise ValueError('launcher/page metadata verification')
            elif name in (PAGE_NAME,WRAPPER_NAME):
                expected=page if name==PAGE_NAME else wrapper
                if body_sha!=hashlib.sha256(expected).hexdigest():raise ValueError('added asset changed')
            else:raise ValueError('unexpected output record')
            if name=='TRAILER!!!':
                if src.read()!=tail:raise ValueError('archive tail changed')
                break
    if seen != set(original)|{PAGE_NAME,WRAPPER_NAME}:raise ValueError('archive inventory mismatch')
    artifact=pin(archive);new_manifest=copy.deepcopy(manifest);new_manifest['version']=artifact['sha256'][:12]
    new_manifest['assets']['firefox'].update(sha256=artifact['sha256'],bytes=artifact['bytes'])
    new_manifest['assets']['firefox']['label']='Firefox Nightly159 native GPU diagnostic testing'
    (out/'boot-manifest.json').write_text(json.dumps(new_manifest,indent=2)+'\n')
    report={'passPackage':True,'candidateOnly':True,'testOnly':True,'gpuAcceptance':False,
      'firefoxGpuAcceptance':False,'releaseAcceptance':False,'source':base_pin,'build':pin(a.build),
      'recipe':pin(Path(__file__)),'sourceManifest':pin(a.manifest),
      'page':pin(ROOT/'tools/guest-rootfs/firefox-gpu-check/native-service-probe.html'),
      'archive':artifact,'changes':changes,'added':[WRAPPER_NAME,PAGE_NAME],
      'untouchedEncodedRecordsVerified':verified,'ordinaryInitPreserved':True,'homeAndProfileRecordsPreserved':True,
      'tailPreserved':True,'otherSystemAssetsUnchanged':{k:v for k,v in manifest['assets'].items() if k!='firefox'},
      'environment':{'MOZ_WEBGL_FORCE_EGL':'1','GUEST_GPU_TRANSPORT':'hostcall','GUEST_GPU_BACKEND':'auto','GUEST_GL_BACKEND':'auto',
                     **({'GUEST_VK_TRACE':'1'} if a.vk_trace else {}),**extra_env},
      'prefs':prefs,'appPrefs':APP_PREFS,'vkTrace':a.vk_trace,
      'version':new_manifest['version'],'pageUrl':'file:///'+PAGE_NAME}
    if gfxtest:
        report['gfxtestCandidate'] = gfxtest
    if a.gfxtest_probe:
        report['gfxtestProbe'] = {'enabled':True,'command':['/opt/firefox/gfxtest','glx','-f','3'],
          'deadlineMs':4000,'permitPath':'/home/admin/.gpu-native-gfxtest-permit',
          'receiptRoot':'/home/admin/.gpu-native-gfxtest','fileLimitUnits':64,
          'outputFileUpperBoundBytes':65536,'cpuSeconds':24,'virtualMemoryKiB':8388608,
          'limitsScope':'probe subshell only','runtimeControlsRequired':['timeout','syntax','displaySocket'],
          'postExecIdentity':'Unknown','firefoxParentAcceptance':False,'gpuAcceptance':False}
    (out/'package.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'passPackage':True,'output':str(out),'untouchedEncodedRecordsVerified':verified,'gpuAcceptance':False}))
    if not a.no_publish:
        # The web/desktop dev server serves the newest package and restarts on it.
        subprocess.run(['node',str(ROOT/'web/desktop/publish-build.mjs'),str(out)],check=True)

if __name__=='__main__': main()
