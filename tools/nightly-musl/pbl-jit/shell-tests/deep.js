// c83: deep f.call / f.apply recursion must throw InternalError (over-recursion),
// never lose the thread. Prints only mode-independent facts on stdout; actual
// thresholds go to stderr (T lines).
var E = printErr, P = function (s) { print(s); E("P " + s); };
function rCall(n) { return n === 0 ? 0 : 1 + rCall.call(null, n - 1); }
function rCall0(n) { return n === 0 ? 0 : 1 + rCall0.call({ n: n - 1 }.n === undefined ? null : null, n - 1); }
function rApArr(n) { return n === 0 ? 0 : 1 + rApArr.apply(null, [n - 1]); }
function rApArgs(n) { if (n === 0) return 0; arguments[0] = n - 1; return 1 + rApArgs.apply(null, arguments); }
function rApArgs2(n, m) { return n === 0 ? m : 1 + rApArgs2.apply(this, arguments.length > 5 ? [] : [n - 1, m]); }
var tests = [['call', rCall], ['call0', rCall0], ['apArr', rApArr], ['apArgs', rApArgs]];
for (var w = 0; w < 300; w++) for (var [nm, f] of tests) f(3);
function run(f, d) { try { return String(f(d)); } catch (e) { return e.constructor.name + ':' + e.message; } }
function fact(v, d) {
  if (v === String(d)) return 'ok';
  if (v === 'InternalError:too much recursion') return 'IR';
  return 'BAD(' + v + ')';
}
for (var [nm, f] of tests) {
  for (var d of [10, 1000]) P(nm + ' d=' + d + ' ' + fact(run(f, d), d));
  var v5 = run(f, 5000); E('T ' + nm + ' d=5000 ' + v5);
  P(nm + ' d=5000 ' + (fact(v5, 5000) === 'ok' || fact(v5, 5000) === 'IR' ? 'ok-or-IR' : fact(v5, 5000)));
  P(nm + ' d=100000 ' + fact(run(f, 100000), 100000));
  P(nm + ' after ' + run(f, 7));
}
P('apArgs2 ' + run(function (d) { return rApArgs2(d, 5); }, 100) + ' ' +
  fact(run(function (d) { return rApArgs2(d, 0); }, 100000), 100000));

// Caught inside the recursion: each level catches and returns its depth.
var maxD = 0;
function cCall(n) { maxD = Math.max(maxD, n); try { return cCall.call(null, n + 1); } catch (e) { return (e instanceof InternalError) ? n : -1; } }
function cApply(n) { maxD = Math.max(maxD, n); try { return cApply.apply(null, [n + 1]); } catch (e) { return (e instanceof InternalError) ? n : -1; } }
for (var [nm, f] of [['cCall', cCall], ['cApply', cApply]]) {
  maxD = 0;
  var r = run(f, 0);
  E('T ' + nm + ' caught at ' + r + ' max ' + maxD);
  P(nm + ' caught ' + (+r >= 50 && +r <= maxD ? 'ok' : 'BAD(' + r + ')'));
  var a = run(f, 1e9); E('T ' + nm + ' after ' + a); P(nm + ' after ' + (+a >= 1e9 + 50));
}

// finally blocks run while unwinding.
var fin = 0, depth = 0;
function fCall(n) { depth = n; try { return fCall.call(null, n + 1); } finally { fin++; } }
function fApply(n) { depth = n; try { return fApply.apply(null, [n + 1]); } finally { fin++; } }
for (var [nm, f] of [['fCall', fCall], ['fApply', fApply]]) {
  fin = 0; depth = 0;
  var v = run(f, 0);
  E('T ' + nm + ' ' + v + ' depth=' + depth + ' fin=' + fin);
  P(nm + ' ' + fact(v, -1) + ' fin==depth+1 ' + (fin === depth + 1 || fin === depth) + ' deep ' + (depth > 1000));
}
P('shallow ' + rCall(5) + ' ' + rApArr(5) + ' ' + rApArgs(5));

// (b) probe: fill the PBL stack with plain recursion to near full, then
// native->JS recursion (c80 nest.js patterns). Result must be the depth or
// over-recursion; the thread must survive.
var gN = 0, shapes = [];
for (var i = 0; i < 12; i++) { var o = {}; o['k' + i] = i; Object.defineProperty(o, 'g', { get: function () { return pGet(gN - 1); } }); shapes.push(o); }
function readG(o) { return o.g; }
function pGet(n) { if (n === 0) return 0; var save = gN; gN = n; var r = readG(shapes[n % 12]); gN = save; return 1 + r; }
function pSort(n) { if (n === 0) return 0; var r = 0; [2, 1].sort(function (a, b) { r = pSort(n - 1); return a - b; }); return 1 + r; }
function pApply(n) { return n === 0 ? 0 : 1 + pApply.apply(null, [n - 1]); }
var bf; function bt(n) { return n === 0 ? 0 : 1 + bf(n - 1); } bf = bt.bind(null);
function pBound(n) { return bf(n); }
function pRefl(n) { return n === 0 ? 0 : 1 + Reflect.apply(pRefl, null, [n - 1]); }
var px = new Proxy({}, { get: function (t, k) { var n = +k; return n === 0 ? 0 : 1 + px[n - 1]; } });
function pProxy(n) { return px[n]; }
function mk(n) { return { toJSON: function () { return n === 0 ? 0 : 1 + (+JSON.stringify(mk(n - 1))); } }; }
function pJson(n) { return +JSON.stringify(mk(n)); }
function pRepl(n) { if (n === 0) return 0; var r = 0; 'a'.replace(/a/, function () { r = pRepl(n - 1); return 'b'; }); return 1 + r; }
function chain(k, n) { return k === 0 ? mStep(n) : chain(k - 1, n); }
function mStep(n) { return n === 0 ? 0 : 1 + pMix.apply(null, [n - 1]); }
function pMix(n) { return chain(30, n); }
// (c) generators and eval at depth.
function* gRec(n) { if (n === 0) { yield 0; return; } for (var v of gRec(n - 1)) yield v + 1; }
function pGen(n) { var r; for (var v of gRec(n)) r = v; return r; }
function pGenNext(n) { var g = (function* () { yield n === 0 ? 0 : 1 + pGenNext(n - 1); })(); return g.next().value; }
function pEval(n) { return n === 0 ? 0 : 1 + eval('pEval(n - 1)'); }
function pFunc(n) { return n === 0 ? 0 : 1 + (new Function('f', 'n', 'return f(n);'))(pFunc, n - 1); }
var ntests = [['apply', pApply], ['sort', pSort], ['getter', pGet], ['bound', pBound], ['reflect', pRefl],
              ['proxy', pProxy], ['json', pJson], ['replace', pRepl], ['mixed', pMix],
              ['gen', pGen], ['gennext', pGenNext], ['eval', pEval], ['func', pFunc]];
function fill(n, g, k) { if (n === 0) return g(k); return fill(n - 1, g, k) + 0; }
function zero() { return 0; }
for (var w = 0; w < 300; w++) { fill(5, zero, 0); for (var [nm, f] of ntests) f(3); }
function run1(f) { try { return String(f()); } catch (e) { return e.constructor.name + ':' + e.message; } }
function maxFill(g, k) {
  var lo = 0, hi = 1 << 20;
  while (lo + 1 < hi) { var mid = (lo + hi) >> 1; if (run1(function () { return fill(mid, g, k); }) === String(k)) lo = mid; else hi = mid; }
  return lo;
}
var D0 = maxFill(zero, 0);
E('T plain max depth ' + D0);
P('plain depth > 1000 ' + (D0 > 1000));
for (var [nm, g] of ntests) {
  var bad = 0;
  for (var k of [1, 3, 40, 300, 3000]) {
    for (var m = 0; m <= 24; m += 4) {
      var v = run1(function () { return fill(D0 - m, g, k); });
      var f = fact(v, k);
      if (f === 'BAD(' + v + ')') { bad++; E('T BAD ' + nm + ' k=' + k + ' m=' + m + ' ' + v); }
    }
    var vd = run1(function () { return fill(D0 + 50, g, k); });  // over full: must be IR
    if (fact(vd, -1) !== 'IR') { bad++; E('T BAD over ' + nm + ' k=' + k + ' ' + vd); }
  }
  // depth where k=20 nested levels still succeed (PBL bytes per level).
  var D20 = maxFill(g, 20);
  E('T ' + nm + ' maxfill k=0 ' + D0 + ' k=20 ' + D20 + ' delta ' + (D0 - D20));
  P('near-full ' + nm + ' ' + (bad === 0 ? 'ok' : 'BAD') + ' after ' + run1(function () { return g(7); }));
}
// Deep generator/eval at shallow start: depth or IR.
for (var [nm, g] of [['gen', pGen], ['gennext', pGenNext], ['eval', pEval], ['func', pFunc]]) {
  for (var d of [10, 40, 5000, 100000]) {
    var v = run1(function () { return g(d); });
    if (d === 5000) E('T ' + nm + ' d=5000 ' + v);
    P(nm + ' d=' + d + ' ' + (d <= 10 ? fact(v, d) : (fact(v, d) === 'ok' || fact(v, d) === 'IR' ? 'ok-or-IR' : fact(v, d))));
  }
}
P('END');
