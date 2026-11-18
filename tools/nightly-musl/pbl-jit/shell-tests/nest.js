// Native-recursion nesting test (c80). NESTCAL=1: interleaved ramp for calibration
// (lost thread = first V8 overflow; last "ok" line per pattern = safe depth).
var P = print, E = typeof printErr === 'function' ? printErr : print;
function pApply(n) { return n === 0 ? 0 : 1 + pApply.apply(null, [n - 1]); }
function pSort(n) { if (n === 0) return 0; var r = 0; [2, 1].sort(function (a, b) { r = pSort(n - 1); return a - b; }); return 1 + r; }
var gN = 0, shapes = [];
for (var i = 0; i < 12; i++) { var o = {}; o['k' + i] = i; Object.defineProperty(o, 'g', { get: function () { return pGet(gN - 1); } }); shapes.push(o); }
function readG(o) { return o.g; }
function pGet(n) { if (n === 0) return 0; var save = gN; gN = n; var r = readG(shapes[n % 12]); gN = save; return 1 + r; }
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
var tests = [['apply', pApply], ['sort', pSort], ['getter', pGet], ['bound', pBound], ['reflect', pRefl],
             ['proxy', pProxy], ['json', pJson], ['replace', pRepl], ['mixed', pMix]];
for (var w = 0; w < 300; w++) for (var [nm, f] of tests) f(3);  // warm tiers / megamorphic site
function run(f, d) { try { return String(f(d)); } catch (e) { return e.constructor.name + ':' + e.message; } }
if (os.getenv('NESTCAL') === '1') {
  var lo = +(os.getenv('NLO') || 20), hi = +(os.getenv('NHI') || 2000), st = +(os.getenv('NST') || 10);
  for (var d = lo; d <= hi; d += st) for (var [nm, f] of tests) {
    E('begin ' + nm + ' d=' + d);
    var v = run(f, d);
    E('ok ' + nm + ' d=' + d + ' v=' + v);
    if (v !== String(d)) { E('mismatch'); }
  }
  P('END');
} else {
  for (var d of [1, 10, 40]) for (var [nm, f] of tests) P(nm + ' d=' + d + ' ' + run(f, d));
  for (var d of [5000, 100000]) for (var [nm, f] of tests) { P(nm + ' d=' + d + ' ' + run(f, d)); P(nm + ' after ' + run(f, 7)); }
  P('END');
}
