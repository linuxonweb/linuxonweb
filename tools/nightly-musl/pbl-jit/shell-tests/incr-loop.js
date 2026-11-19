// c118: hot loops (loop tier) running between incremental GC slices, with
// allocation, shape changes and global lexical shadowing between slices.
// Normal incremental GCs let the loop tier run (PBLJIT_INCRGC); "shrinking"
// (compacting) incremental GCs must still refuse it. Prints `ST3 <name> <sum>`;
// stdout must not depend on the tier mode or on how many slices a GC takes.
var HAS = {};
['startgc', 'gcslice', 'gcstate', 'finishgc', 'gczeal', 'evaluate', 'gc'].forEach(function (n) {
  HAS[n] = typeof globalThis[n] === 'function';
});
print('ST3 has ' + Object.keys(HAS).map(function (k) { return k + '=' + (HAS[k] ? 1 : 0); }).join(','));
var INCR = HAS.startgc && HAS.gcslice && HAS.gcstate;
var MODE = 'normal';
var ROUNDS = 48;
var GARB = [];
function mix(h, v) { return (Math.imul(h, 31) + (v | 0)) | 0; }
function garbage(r) {
  // Short-lived objects so swept cells (and shapes) get reused.
  var a = [];
  for (var i = 0; i < 1500; i++) {
    var o = { a: i, b: r };
    o['k' + (i & 15)] = i;
    a.push(o, [i, r], 's' + i + r);
  }
  GARB[r & 3] = a;
}
// Advance the incremental GC by one slice, starting a new one when idle.
function step(r) {
  if (!INCR) { if (r % 8 === 0 && HAS.gc) gc(); return; }
  if (gcstate() === 'NotActive') {
    if (MODE === 'shrinking') startgc(1, 'shrinking'); else startgc(1);
  } else {
    gcslice(1);
  }
}
function finish() { if (INCR && gcstate() !== 'NotActive' && HAS.finishgc) finishgc(); }
function section(name, fn) {
  var v;
  try { v = fn(); } catch (e) { v = 'UNCAUGHT ' + (e && e.name) + ':' + (e && e.message); }
  finish();
  print('ST3 ' + MODE + ' ' + name + ' ' + v);
}

// ---- a. array SetElem and rows ----
function aLoop(a, rows, n, k) {
  var s = 0;
  for (var i = 0; i < n; i++) {
    a[i] = (a[i] + i * k) | 0;
    var row = rows[i & 15];
    s = (s + row[i & 7] + a[i]) | 0;
    row[(i + 1) & 7] = (row[(i + 1) & 7] + 1) | 0;
  }
  return s;
}
function secA() {
  var n = 3000, a = [], rows = [], h = 0;
  for (var i = 0; i < n; i++) a.push(i & 255);
  for (var j = 0; j < 16; j++) rows.push([j, 1, 2, 3, 4, 5, 6, 7]);
  for (var r = 0; r < ROUNDS; r++) {
    step(r);
    h = mix(h, aLoop(a, rows, n, r + 1));
    garbage(r);
    var q = r & 15;  // replace a row: the old one becomes garbage
    rows[q] = [r, q, r + q, 3, 4, 5, 6, 7];
    if (r % 7 === 3) a = a.slice();  // fresh elements
  }
  return h;
}

// ---- b. plain-object number stores, shape changes between slices ----
function bLoop(o, n) {
  var s = 0;
  for (var i = 0; i < n; i++) {
    o.x = (o.x + i) | 0;
    o.y = (o.y + (o.x & 3)) | 0;
    s = (s + o.x + o.y) | 0;
  }
  return s;
}
function secB() {
  var o = { x: 1, y: 2 }, h = 0;
  for (var r = 0; r < ROUNDS; r++) {
    step(r);
    h = mix(h, bLoop(o, 3000));
    garbage(r);
    var m = r % 4;
    if (m === 0) o['p' + r] = r;                               // new shape
    else if (m === 1) o = { y: o.y, x: o.x };                  // other order
    else if (m === 2) o = { x: o.x, y: o.y, z: r };            // other shape
    else { var t = { x: 0, y: 0 }; t.x = o.x; t.y = o.y; o = t; }
    h = mix(h, o.x ^ o.y);
  }
  return h;
}

// ---- c. global gets, lexical shadowing added mid-GC ----
globalThis.gShadowA = 3;
globalThis.gShadowB = 5;
var gPlain = 11;
function cLoop(n) {
  var s = 0;
  for (var i = 0; i < n; i++) s = (s + gShadowA * i + gShadowB + gPlain) | 0;
  return s;
}
function secC() {
  var h = 0;
  for (var r = 0; r < ROUNDS; r++) {
    step(r);
    h = mix(h, cLoop(3000));
    garbage(r);
    if (r === 17) {
      if (HAS.evaluate) evaluate('let gShadowA = 100;');
      else globalThis.gShadowA = 100;
    }
    if (r === 29) {
      if (HAS.evaluate) evaluate('const gShadowB = -7;');
      else globalThis.gShadowB = -7;
    }
    if (r % 5 === 2) gPlain = gPlain + r;
    if (r === 40) globalThis.gShadowA = 1;  // property, still shadowed if lexical
  }
  return mix(h, gShadowA + gShadowB);
}

// ---- d. Math constants ----
function dLoop(n, f) {
  var s = 0;
  for (var i = 0; i < n; i++) {
    var v = Math.floor(i * Math.PI * f) + Math.max(i & 7, 3) - Math.abs(-i & 15) +
            Math.round(Math.sqrt(i) * Math.E);
    s = (s + v) | 0;
  }
  return s;
}
function secD() {
  var h = 0;
  for (var r = 0; r < ROUNDS; r++) {
    step(r);
    h = mix(h, dLoop(3000, (r & 3) + 1));
    garbage(r);
  }
  return h;
}

// ---- e. typed arrays ----
function eLoop(ia, fa, n) {
  var s = 0;
  for (var i = 0; i < n; i++) {
    ia[i] = (ia[i] + i) | 0;
    fa[i] = fa[i] * 0.5 + i;
    s = (s + ia[i] + (fa[i] | 0)) | 0;
  }
  return s;
}
function secE() {
  var n = 3000, ia = new Int32Array(n), fa = new Float64Array(n), h = 0;
  for (var r = 0; r < ROUNDS; r++) {
    step(r);
    h = mix(h, eLoop(ia, fa, n));
    garbage(r);
    if (r % 6 === 5) {  // fresh buffers: the old ones become garbage
      var ia2 = new Int32Array(n), fa2 = new Float64Array(n);
      ia2.set(ia); fa2.set(fa); ia = ia2; fa = fa2;
    }
  }
  return h;
}

function all() {
  section('a-array-rows', secA);
  section('b-object-shapes', secB);
  if (MODE === 'normal') section('c-global-shadow', secC);
  section('d-math', secD);
  section('e-typed', secE);
}
MODE = 'normal'; all();
MODE = 'shrinking'; all();
print('ST3 end 1111');
