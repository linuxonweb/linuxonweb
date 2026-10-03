#!/usr/bin/env python3
"""Fail-closed privileged raw-evidence gate. No full JIT/release acceptance."""
import argparse
import hashlib
import json
import re
from pathlib import Path

LIMIT = 2 * 1024 * 1024
ACTIVE = {'Prepare', 'MarkRoots', 'Mark', 'Sweep', 'Finalize', 'Compact', 'Decommit', 'Finish'}
FIELDS = {'event', 'file', 'line', 'off', 'tid', 'pthread', 'tls', 'epoch', 'fn', 'kind', 'sp', 'pcDelta', 'ic'}
EVENTS = {'install', 'run', 'bail', 'noentry', 'interrupt', 'gc-evict', 'reject', 'skip-incremental', 'skip-debuggee', 'skip-coverage', 'policy-catch', 'policy-finally', 'policy-throw', 'policy-throw-stack', 'interrupt-callback-continue', 'interrupt-callback-abort'}
ENTRY = {'install', 'run', 'bail', 'noentry', 'interrupt'}
SEQUENCES = {
    'gc-debug-coverage': ['identity', 'gc-start', 'gc-cleanup', 'gc-done', 'debug-start', 'debug-cleanup', 'debug-done', 'debug-start', 'debug-cleanup', 'debug-done', 'coverage-start', 'coverage-cleanup', 'coverage-done', 'driver-done'],
    'incremental': ['identity', 'incremental-start', 'incremental-loop-done', 'incremental-cleanup', 'incremental-done', 'driver-done'],
    'slice-gc': ['identity', 'slice-start', 'slice-state', 'slice-cleanup', 'slice-done', 'driver-done'],
    'interrupt': ['identity', 'interrupt-start', 'interrupt-cleanup', 'interrupt-done', 'driver-done'],
}
FATAL = re.compile(r'Assertion failure|MOZ_CRASH|\bpanic(?:ked)?\b|unreachable (?:executed|instruction)|RuntimeError|Segmentation fault|(?:^|[ \t])ABORT(?:ED)?(?:[ \t:!]|$)|out of memory', re.I | re.M)
SYNTHETIC = re.compile(r'synthetic|mocked|host-fixture', re.I)

class Rejected(ValueError):
    pass

def require(condition, reason):
    if not condition:
        raise Rejected(reason)

def integer(value, lo=0, hi=2**32-1):
    return type(value) is int and lo <= value <= hi

def decimal(value, lo=0, hi=2**32-1):
    return isinstance(value, str) and bool(re.fullmatch(r'0|[1-9][0-9]*', value)) and lo <= int(value) <= hi

def object_pairs(pairs):
    out = {}
    for key, value in pairs:
        require(key not in out, 'duplicate JSON field: '+key)
        out[key] = value
    return out

def load_json(raw):
    return json.loads(raw, object_pairs_hook=object_pairs)

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def identity(o):
    return tuple(o[k] for k in ('tid', 'pthread', 'tls'))

def same(a, b):
    return all(a[k] == b[k] for k in ('file', 'line', 'off', 'tid', 'pthread', 'tls', 'epoch', 'fn'))

def parse_observer(raw):
    require(len(raw) <= LIMIT, 'raw observer exceeds 2MiB')
    text = raw.decode('utf-8', errors='strict')
    require(not FATAL.search(text), 'fatal observer trace')
    out, offset = [], 0
    for encoded in raw.splitlines(keepends=True):
        line = encoded.decode('utf-8').rstrip('\r\n')
        if 'PBLJIT_OBS' in line:
            require(line.startswith('PBLJIT_OBS '), 'observer record must be direct raw stderr')
            pairs = [token.split('=', 1) for token in line[len('PBLJIT_OBS '):].split()]
            require(all(len(p) == 2 for p in pairs), 'malformed observer tokens')
            o = object_pairs(pairs)
            require(set(o) == FIELDS and o['event'] in EVENTS, 'unknown/missing observer fields/event')
            require(decimal(o['tid'], 1) and decimal(o['pthread'], 1), 'invalid real thread handles')
            require(re.fullmatch(r'0x[0-9a-fA-F]+', o['tls']) and 0 < int(o['tls'], 16) < 2**32, 'invalid native TLS pointer')
            require(decimal(o['epoch'], 0, 2**64-1) and decimal(o['off']) and decimal(o['line'], 1), 'invalid epoch/source position')
            require(decimal(o['fn']) and decimal(o['sp']) and decimal(o['ic']), 'invalid native output values')
            require(re.fullmatch(r'-?(0|[1-9][0-9]*)', o['pcDelta']) and -2**31 <= int(o['pcDelta']) < 2**31, 'invalid output PC delta')
            if o['event'] in {'run', 'bail', 'interrupt'}:
                require(o['kind'] == {'run':'1', 'bail':'2', 'interrupt':'3'}[o['event']] and int(o['fn']) > 0 and int(o['sp']) > 0, 'invalid native specializer exit')
            elif o['event'] == 'noentry':
                require(o['kind'] == '0' and int(o['fn']) > 0 and o['sp'] == o['pcDelta'] == o['ic'] == '0', 'invalid NoEntry output')
            else:
                require(o['kind'] == '-1' and o['sp'] == o['pcDelta'] == o['ic'] == '0', 'invalid observation sentinel')
                require((int(o['fn']) > 0) if o['event'] in {'install', 'gc-evict'} else o['fn'] == '0', 'invalid observation function identity')
            out.append({**o, '_begin': offset, '_end': offset+len(encoded)})
        offset += len(encoded)
    require(len(out) < 4096, 'observer budget reached; completeness cannot be established')
    return out

def parse_console(raw):
    require(len(raw) <= LIMIT, 'console transcript exceeds 2MiB')
    text = raw.decode('utf-8', errors='strict')
    require(not FATAL.search(text), 'fatal console trace')
    out = []
    for line in text.splitlines():
        if 'NJS_PRIV' not in line:
            continue
        if line.startswith('console.log: '):
            line = load_json(line[len('console.log: '):])
        require(isinstance(line, str) and line.startswith('NJS_PRIV '), 'malformed privileged console record')
        row = load_json(line[len('NJS_PRIV '):])
        require(isinstance(row, dict), 'privileged record is not object')
        out.append(row)
    return out

def check_records(expected, console, observer):
    """Pure predicates. Does not authenticate acquisition or claim guest execution."""
    errors, rows = [], []
    try:
        events = parse_console(console)
        obs = parse_observer(observer)
        scope = expected['scope']
        require(scope in SEQUENCES, 'unknown operation scope')
        require([e.get('event') for e in events] == SEQUENCES[scope], 'incomplete/duplicate/out-of-order operations')
        label, run_id, window_id = expected['label'], expected['runId'], expected['windowId']
        require(re.fullmatch(r'[A-Za-z0-9_-]{1,64}', label), 'invalid expected label')
        require(re.fullmatch(r'\{[0-9a-fA-F-]{36}\}', run_id), 'invalid run nonce')
        require(decimal(window_id, 1, 2**53-1), 'invalid actual inner window ID')
        require(all(e.get('label') == label and e.get('runId') == run_id and e.get('windowId') == window_id for e in events), 'label/run/content-window drift')
        first = events[0]
        require(first.get('scope') == scope and first.get('initialState') == 'NotActive', 'missing scope/inactive initial state')
        require(all(first.get(k) == expected[k] for k in ('version', 'applicationBuildID', 'platformBuildID', 'observerLogPath')), 'compiled identity or raw guest log path mismatch')
        require(expected['version'] == '159.0a1' and re.fullmatch(r'\d{14}', expected['applicationBuildID']) and re.fullmatch(r'\d{14}', expected['platformBuildID']), 'invalid Nightly compiled identity')
        prefix = 'file:///home/admin/nightly-jit-safety/'+label+'/'
        source = lambda name: prefix+label+'-main-'+name+'.js'
        guest_path = expected['observerLogPath']
        require(guest_path.startswith(prefix[len('file://'):]) and not any(p in {'.', '..', ''} for p in guest_path.split('/')[1:]), 'unowned/noncanonical guest observer path')
        require(events[-1].get('scope') == scope and events[-1].get('ok') is True, 'missing driver completion')
        relevant = [o for o in obs if o['file'].startswith(prefix)]
        allowed_sources = {prefix+label+'-'+context+'-'+name+'.js' for context in ('main','worker') for name in expected['fixtureNames']}
        require(all(o['file'] in allowed_sources and o['line'] == '1' for o in relevant), 'unbound fixture source or source line')
        prior_end = 0
        def window(start, done, name):
            nonlocal prior_end
            lo, hi = start.get('beforeBytes'), done.get('afterBytes')
            require(integer(lo, 0, LIMIT) and integer(hi, 0, LIMIT) and prior_end <= lo < hi <= len(observer), 'invalid/overlapping raw byte window')
            require(done.get('beforeBytes') == lo and done.get('observerLogPath') == guest_path, 'raw snapshot binding mismatch')
            require(start.get('source') == done.get('source') == source(name), 'operation source mismatch')
            require((lo == 0 or observer[lo-1:lo] == b'\n') and observer[hi-1:hi] == b'\n', 'snapshot truncates raw record')
            require(not any(o['_begin'] < lo < o['_end'] or o['_begin'] < hi < o['_end'] for o in obs), 'split observer record')
            own = [o for o in relevant if lo <= o['_begin'] and o['_end'] <= hi and o['file'] == source(name)]
            baseline = [o for o in relevant if o['_end'] <= lo and o['file'] == source('sum')]
            pairs = [(i,r) for i in baseline for r in baseline if i['event'] == 'install' and r['event'] == 'run' and i['_end'] <= r['_begin'] and same(i,r)]
            require(pairs, 'no actual pre-operation same-source install/run baseline')
            base = max(pairs, key=lambda p:p[1]['_begin'])[1]
            require(all(identity(o) == identity(base) for o in own), 'operation native thread/pthread/TLS mismatch')
            epochs = [int(o['epoch']) for o in relevant if identity(o) == identity(base) and o['_end'] <= hi]
            require(epochs == sorted(epochs), 'real major epoch goes backwards')
            prior_end = hi
            return own, base
        def forbidden(start, done):
            return any(start['beforeBytes'] <= o['_begin'] and o['_end'] <= done['afterBytes'] and o['file'].startswith(prefix+label+'-main-') and o['event'] in ENTRY for o in relevant)
        def gc(start, cleanup, done, name='sum'):
            own, base = window(start, done, name)
            require(cleanup.get('state') == 'NotActive', 'missing owned GC cleanup')
            require(done.get('results') == [8386560]*16 and all(type(v) is int for v in done['results']), 'post-GC semantics')
            require(not any(o['event'] in {'bail','noentry','interrupt'} for o in own), 'unexpected post-GC specializer failure')
            evicts = [o for o in own if o['event'] == 'gc-evict' and o['off'] == base['off'] and o['fn'] == base['fn'] and int(o['epoch']) > int(base['epoch'])]
            proved = [(e,i,r) for e in evicts for i in own for r in own if i['event'] == 'install' and r['event'] == 'run' and e['_end'] <= i['_begin'] < r['_begin'] and e['epoch'] == i['epoch'] and same(i,r) and i['off'] == e['off']]
            require(proved, 'missing same-source old-function eviction/new install/run at changed major epoch')
            require(all(int(o['epoch']) > int(base['epoch']) for o in own if o['event'] in ENTRY), 'stale compiled entry after GC')
            rows.append({'operation':start['event'], 'rawEvictionInstallRun':True, 'pass':True})
        if scope == 'gc-debug-coverage':
            require(events[1].get('api') == 'Components.utils.forceGC', 'whole GC API')
            gc(events[1],events[2],events[3])
            for begin,name in [(4,'sum'),(7,'debugFresh')]:
                start,cleanup,done = events[begin:begin+3]
                require(all(e.get('name') == name for e in (start,cleanup,done)), 'debugger operation/name order')
                own,base = window(start,done,name)
                require(any(o['event'] == 'skip-debuggee' for o in own) and not forbidden(start,done), 'debuggee raw skip missing or forbidden specializer entry')
                require(integer(start.get('offset')) and integer(done.get('breaks'),1) and integer(done.get('steps'),1) and done.get('result') == 8386560 and type(done.get('result')) is int, 'actual pause/step/result missing')
                locals_ = done.get('locals')
                require(isinstance(locals_,list) and 0 < len(locals_) <= 32 and all(isinstance(v,dict) and integer(v.get('i'),0,4096) and integer(v.get('s'),0,8386560) for v in locals_), 'actual integer locals missing/invalid')
                require(all(v['s'] in {v['i']*(v['i']-1)//2,v['i']*(v['i']+1)//2} for v in locals_), 'debugger locals violate loop semantics')
                require(type(cleanup.get('breakpointCount')) is int and cleanup['breakpointCount'] == 0 and type(cleanup.get('debuggeeCount')) is int and cleanup['debuggeeCount'] == 0, 'debugger cleanup incomplete')
                rows.append({'operation':'debug-'+name,'rawSkip':True,'pass':True})
            start,cleanup,done = events[10:13]
            own,base = window(start,done,'coverage')
            require(start.get('collectCoverageInfo') is True and cleanup.get('collectCoverageInfo') is False and type(cleanup.get('debuggeeCount')) is int and cleanup['debuggeeCount'] == 0, 'coverage enable/cleanup missing')
            require(any(o['event'] == 'skip-coverage' for o in own) and not forbidden(start,done), 'coverage raw skip missing or forbidden entry')
            counts = done.get('offsets')
            require(done.get('result') == 8386560 and type(done['result']) is int and isinstance(counts,list) and counts, 'coverage result/counts missing')
            require(all(isinstance(o,dict) and integer(o.get('offset')) and integer(o.get('count'),0,2**53-1) and integer(o.get('lineNumber'),1) and integer(o.get('columnNumber')) for o in counts) and len({o['offset'] for o in counts}) == len(counts) and all(o['lineNumber'] == 1 for o in counts) and any(o['count'] > 0 for o in counts), 'coverage offsets malformed/duplicate/zero')
            rows.append({'operation':'coverage','rawSkip':True,'pass':True})
        elif scope == 'incremental':
            start,loop,cleanup,done = events[1:5]
            own,base = window(start,done,'sum')
            require(start.get('api') == 'Cu.getJSTestingFunctions().startgc' and type(start.get('workBudget')) is int and start['workBudget'] == 1 and start.get('initialState') == 'NotActive', 'bounded incremental API/initial state')
            require(loop.get('beforeState') in ACTIVE and loop.get('afterState') in ACTIVE and all(loop.get(k) == done.get(k) for k in ('beforeState','afterState','result')) and type(loop.get('result')) is int and loop['result'] == 8386560, 'active-before/after incremental semantics missing')
            require(cleanup.get('state') == 'NotActive' and cleanup.get('ownedGCcleanup') is True, 'owned incremental cleanup missing')
            require(any(o['event'] == 'skip-incremental' and o['off'] == base['off'] for o in own) and not forbidden(start,done), 'new source-specific incremental skip missing or forbidden entry')
            rows.append({'operation':'incremental','activeBeforeAfter':True,'rawSkip':True,'pass':True})
        elif scope == 'slice-gc':
            start,state,cleanup,done = events[1:5]
            require(start.get('api') == 'Cu.getJSTestingFunctions().startgc/gcslice/finishgc' and type(start.get('workBudget')) is int and start['workBudget'] == 1 and start.get('initialState') == 'NotActive' and type(state.get('sliceWorkBudget')) is int and state['sliceWorkBudget'] == 1 and state.get('state') in ACTIVE|{'NotActive'}, 'bounded slice-GC API/state')
            require(cleanup.get('ownedGCcleanup') is True, 'owned slice GC cleanup')
            gc(start,cleanup,done)
        else:
            start,cleanup,done = events[1:4]
            own,base = window(start,done,'infinite')
            require(start.get('timeoutSeconds') == 1 and type(start.get('timeoutSeconds')) is int and start.get('globalStopScript') is False and cleanup.get('prefsRestored') is True, 'interrupt bounds/preference cleanup')
            require(done.get('recoveryWindowId') == window_id and type(done.get('result')) is int and done['result'] == 8386560 and integer(done.get('elapsedMs'),1,15000), 'same-window bounded recovery missing')
            proved = [(i,x,a) for i in own for x in own for a in own if i['event'] == 'install' and x['event'] == 'interrupt' and a['event'] == 'interrupt-callback-abort' and i['_end'] <= x['_begin'] < a['_begin'] and same(i,x) and identity(a) == identity(x) and all(a[k] == x[k] for k in ('file','line','off','epoch'))]
            require(proved, 'actual native specializer Interrupt and subsequent InterruptCheck false/abort evidence missing; recovery is insufficient')
            recovery = [o for o in relevant if start['beforeBytes'] <= o['_begin'] and o['_end'] <= done['afterBytes'] and o['file'] == source('sum') and o['event'] == 'run' and identity(o) == identity(base)]
            require(recovery and recovery[-1]['_begin'] > proved[-1][2]['_begin'], 'actual same-thread post-abort recovery run missing')
            rows.append({'operation':'interrupt','actualSpecializerInterrupt':True,'callbackAbort':True,'pass':True})
    except (Rejected, ValueError, KeyError, TypeError, UnicodeError) as error:
        errors.append(str(error))
    return {'kind':'privileged-raw-contract-evaluation','pass':not errors,'rows':rows,'errors':errors,'guestAcceptance':False,'fullJITAcceptance':False}

def check_production(acquisition_path, review_sha256):
    raw = acquisition_path.read_bytes()
    require(re.fullmatch(r'[0-9a-f]{64}', review_sha256 or '') and sha(raw) == review_sha256, 'caller-reviewed acquisition pin mismatch')
    require(not SYNTHETIC.search(raw.decode('utf-8')), 'synthetic/mock provenance refused in production')
    a = load_json(raw)
    require(a.get('kind') == 'actual-guest-privileged-acquisition-v1', 'actual guest acquisition required')
    require(a.get('capture') == {'producer':'guest-firefox','observer':'direct-unrotated-stderr','console':'direct-browser-console','orderedSnapshots':True}, 'unreviewed acquisition method')
    artifacts = a['artifacts']
    require(set(artifacts) == {'console','observer','contract','driver','observerPbl','observerInterpreter','compiledIdentity','captureReview'}, 'missing exact retained acquisition artifacts')
    blobs = {}
    for role, record in artifacts.items():
        p = Path(record['path'])
        require(p.is_absolute() and p.is_file() and re.fullmatch(r'[0-9a-f]{64}', record['sha256']), 'invalid retained artifact: '+role)
        blobs[role] = p.read_bytes()
        require(sha(blobs[role]) == record['sha256'], 'retained artifact drift: '+role)
    require(blobs['driver'] == Path(__file__).with_name('privileged-driver.js').read_bytes(), 'driver differs from reviewed checker companion')
    require(not any(SYNTHETIC.search(blobs[k].decode('utf-8')) for k in ('console','observer','captureReview')), 'synthetic provenance in retained raw acquisition')
    contract = load_json(blobs['contract'])
    expected = a['expected']
    require(contract['label'] == expected['label'], 'fixture contract label mismatch')
    fixture_dir = Path(artifacts['contract']['path']).parent
    require(all(isinstance(name,str) and Path(name).name == name and name not in {'.','..'} and re.fullmatch(r'[0-9a-f]{64}', digest) for name,digest in contract['files'].items()), 'unsafe fixture file inventory')
    require(all(sha((fixture_dir/name).read_bytes()) == digest for name,digest in contract['files'].items()), 'fixture source hash drift')
    require(set(expected['fixtureNames']) == {c['id'] for c in contract['cases'] if c['context'] == 'main'}|{'debugFresh','coverage','infinite'}, 'exact fixture source inventory mismatch')
    compiled = load_json(blobs['compiledIdentity'])
    review = load_json(blobs['captureReview'])
    require(compiled.get('pass') is True and all(compiled.get(k) == a['compiledIdentity'][k] for k in a['compiledIdentity']), 'compiled identity report does not bind manifest')
    require(review.get('kind') == 'caller-reviewed-actual-guest-capture' and review.get('pass') is True and all(review.get(k) == expected[k] for k in ('label','runId','windowId','observerLogPath')), 'capture review does not bind actual run/window')
    require(review.get('artifacts') == {k:v['sha256'] for k,v in artifacts.items() if k != 'captureReview'}, 'capture review does not pin retained sources/build/raw logs')
    require(all(expected[k] == a['compiledIdentity'][k] for k in ('version','applicationBuildID','platformBuildID')), 'caller reviewed compiled identity mismatch')
    require(a['compiledIdentity']['target'] == 'wasm32-linux-musl' and a['compiledIdentity']['observerPblSha256'] == artifacts['observerPbl']['sha256'] and a['compiledIdentity']['observerInterpreterSha256'] == artifacts['observerInterpreter']['sha256'], 'coherent native observer build binding missing')
    result = check_records(expected, blobs['console'], blobs['observer'])
    result.update(kind='guest-privileged-evidence-check',guestEvidencePass=result['pass'],inputs={'acquisitionSha256':sha(raw),'artifacts':{k:v['sha256'] for k,v in artifacts.items()}},trustBoundary='Caller reviewed capture/build record authenticity; hashes prove retention, not execution. Separate compiled build, CPU, native callback stack/TLS, performance and release gates remain mandatory.')
    return result

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--acquisition', type=Path, required=True)
    p.add_argument('--review-sha256', required=True, help='Independent caller-reviewed acquisition manifest digest')
    p.add_argument('--out', type=Path, required=True)
    args = p.parse_args()
    if not args.out.resolve().is_relative_to('/mnt/p6/build'):
        p.error('disk-backed retained output required')
    try:
        result = check_production(args.acquisition, args.review_sha256)
    except (Rejected, ValueError, KeyError, TypeError, OSError, UnicodeError) as error:
        result = {'kind':'guest-privileged-evidence-check','pass':False,'guestEvidencePass':False,'guestAcceptance':False,'fullJITAcceptance':False,'errors':[str(error)]}
    args.out.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result))
    raise SystemExit(0 if result['pass'] else 1)

if __name__ == '__main__':
    main()
