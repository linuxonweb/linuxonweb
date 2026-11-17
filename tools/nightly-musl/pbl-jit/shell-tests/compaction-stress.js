// c60 compacting-GC-while-tier-code-live stress. Prints `ST2 <name> <checksum>`.
var __now = typeof dateNow === 'function' ? dateNow : Date.now;
var HAS_GC = typeof gc === 'function';
var HAS_RELAZ = typeof relazifyFunctions === 'function';
var NGC = 0;
function SGC() { NGC++; if (HAS_GC) { try { gc(null, 'shrinking'); } catch (e) { gc(); } } return 1; }
function RGC() { NGC++; if (HAS_RELAZ) relazifyFunctions(); else SGC(); return 1; }
var GCF = SGC;
function mix(h, v) { return (Math.imul(h, 31) + (v | 0)) | 0; }
function mixs(h, s) { s = String(s); for (var k = 0; k < s.length; k++) h = (Math.imul(h, 31) + s.charCodeAt(k)) | 0; return h; }
function section(name, fn) {
  var t0 = __now(), v;
  try { v = fn(); } catch (e) { v = 'UNCAUGHT ' + (e && e.name) + ':' + (e && e.message); }
  print('ST2 ' + name + ' ' + v);
  print('TM2 ' + name + ' ' + Math.round(__now() - t0) + ' gcs=' + NGC);
}
// fragmentation: many tenured objects, drop every other one
var FRAG = [];
function fragment() {
  var a = [];
  for (var i = 0; i < 20000; i++) a.push({ i: i, s: 'f' + i, o: [i] });
  for (var j = 0; j < a.length; j += 2) a[j] = null;
  FRAG.push(a); if (FRAG.length > 3) FRAG.shift();
}
fragment(); if (HAS_GC) gc();

// ---- 1. globals ----
var gv1 = 0, gv2 = 'x';
let gl1 = 0, gl2 = { k: 1 };
function g1_gc(i) { if (i % 1000 === 999) { fragment(); GCF(); } return i & 7; }
function g1_body(i) {
  gv1 = (gv1 + g1_gc(i) + gl1) | 0;
  gl1 = (gl1 + (gv2.length) + gl2.k) & 0xffff;
  if (i % 500 === 0) { gv2 = 'x' + (i % 10); gl2 = { k: i & 3 }; }
  return gv1 ^ gl1;
}
function sec1() {
  gv1 = 0; gl1 = 0; gv2 = 'x'; gl2 = { k: 1 };
  var h = 0;
  for (var i = 0; i < 12000; i++) h = mix(h, g1_body(i));
  return mix(mix(h, gv1), gl1);
}
// ---- 2. 3-deep chain ----
function c2_3(i, o) { if (i % 800 === 799) { fragment(); GCF(); } return { v: o.a + i, s: o.s + (i & 3) }; }
function c2_2(i, o) { var r = c2_3(i, o); return { w: r.v * 2, t: r.s, o: o }; }
function c2_1(i, o) { var r = c2_2(i, o); return (r.w + r.t.length + r.o.a + gv1) | 0; }
function sec2() {
  var h = 0, objs = [];
  for (var k = 0; k < 16; k++) objs.push({ a: k, s: 's' + k });
  gv1 = 3;
  for (var i = 0; i < 10000; i++) { var o = objs[i & 15]; h = mix(h, c2_1(i, o)); h = mix(h, o.a + o.s.length); }
  return h;
}
// ---- 3. property get/set and methods, mono + poly ----
function P3A(x) { this.x = x; this.y = x + 1; }
P3A.prototype.m = function () { return this.x + this.y; };
function P3B(x) { this.y = x; this.x = x * 2; this.z = 1; }
P3B.prototype.m = function () { return this.x - this.y + this.z; };
var P3C = { m: function () { return this.x * 3; } };
function mk3(k, i) { if (k === 0) return new P3A(i); if (k === 1) return new P3B(i); var o = Object.create(P3C); o.x = i; o.y = 7; return o; }
function use3(o, i) { o.x = (o.x + 1) | 0; var r = o.m() + o.y; if (i % 700 === 699) { fragment(); GCF(); } return (r + o.x + o.y) | 0; }
function sec3() {
  var mono = [], poly = [], h = 0;
  for (var k = 0; k < 30; k++) { mono.push(new P3A(k)); poly.push(mk3(k % 3, k)); }
  for (var i = 0; i < 9000; i++) {
    h = mix(h, use3(mono[i % 30], i));
    h = mix(h, use3(poly[i % 30], i));
  }
  for (var j = 0; j < 30; j++) h = mix(mix(h, mono[j].x), poly[j].x + poly[j].y);
  return h;
}
// ---- 4. constructors ----
class C4 { constructor(a) { this.a = a; this.b = 'b' + (a & 7); this.c = [a]; } sum() { return this.a + this.b.length + this.c[0]; } }
class D4 extends C4 { constructor(a) { super(a); this.d = a * 2; } sum() { return super.sum() + this.d; } }
function F4(a) { this.p = a; this.q = { r: a }; }
function sec4() {
  var h = 0, keep = [];
  for (var i = 0; i < 12000; i++) {
    var c = new C4(i), d = new D4(i), f = new F4(i);
    if (i % 600 === 599) { fragment(); GCF(); }
    h = mix(h, c.sum() + d.sum() + f.p + f.q.r);
    if ((i & 63) === 0) keep.push(c, d, f);
  }
  for (var j = 0; j < keep.length; j++) { var o = keep[j]; h = mix(h, o instanceof C4 ? o.sum() : o.p + o.q.r); }
  return h;
}
// ---- 5. arrays / typed arrays ----
function e5_gc(i) { if (i % 2000 === 1999) { fragment(); GCF(); } return 1; }
function loopArr(a, n) { var s = 0; for (var i = 0; i < n; i++) { a[i % a.length] = (a[i % a.length] + e5_gc(i)) | 0; s = (s + a[(i * 7) % a.length]) | 0; } return s; }
function loopDbl(a, n) { var s = 0; for (var i = 0; i < n; i++) { a[i % a.length] += 0.5 * e5_gc(i); s += a[(i * 3) % a.length]; } return Math.round(s) | 0; }
function plainSum(a) { var s = 0; for (var i = 0; i < a.length; i++) s = (s + a[i] * (i & 3)) | 0; return s; }
function plainSumD(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return Math.round(s) | 0; }
function sec5() {
  var h = 0;
  var arr = []; for (var i = 0; i < 1000; i++) arr.push(i);
  var darr = []; for (var i = 0; i < 1000; i++) darr.push(i + 0.25);
  var ia = new Int32Array(1000); for (var i = 0; i < 1000; i++) ia[i] = i * 3;
  var fa = new Float64Array(1000); for (var i = 0; i < 1000; i++) fa[i] = i * 0.5;
  for (var r = 0; r < 3; r++) {
    h = mix(h, loopArr(arr, 8000)); h = mix(h, loopDbl(darr, 8000));
    h = mix(h, loopArr(ia, 8000)); h = mix(h, loopDbl(fa, 8000));
  }
  for (var r = 0; r < 4; r++) {
    for (var k = 0; k < 200; k++) { h = mix(h, plainSum(arr)); h = mix(h, plainSumD(fa)); }
    fragment(); GCF();
    for (var k = 0; k < 200; k++) { h = mix(h, plainSum(arr)); h = mix(h, plainSumD(fa)); h = mix(h, plainSum(ia)); }
    arr.push(r); arr.pop();
  }
  return h;
}
// ---- 6. for-of, closures, strings, try/catch ----
function mkCounter(s) { var n = 0, tag = s; return function (d) { n = (n + d) | 0; if (n % 900 === 899) { fragment(); GCF(); } return n + tag.length; }; }
function thrower(i) { if (i % 1000 === 999) { fragment(); GCF(); throw new Error('e' + (i % 7)); } return i & 15; }
function sec6() {
  var h = 0, arr = [];
  for (var i = 0; i < 64; i++) arr.push({ v: i, s: 'str' + i });
  var cnt = mkCounter('abcdef'), cnt2 = mkCounter('xy');
  var str = 'start';
  for (var r = 0; r < 120; r++) {
    for (var o of arr) { h = mix(h, o.v + cnt(1) + cnt2(o.v & 1)); }
    str = (str + '-' + r + arr[r & 63].s).substring(str.length > 400 ? 200 : 0);
    h = mixs(h, str.substring(1, 9) + str.length);
  }
  for (var i = 0; i < 8000; i++) {
    try { h = mix(h, thrower(i)); } catch (e) { h = mixs(h, e.message); h = mix(h, i); }
    if ((i & 255) === 0) h = mixs(h, str.charAt(i % str.length));
  }
  return h;
}
var T0 = __now();
section('s1_globals', sec1);
section('s2_chain', sec2);
section('s3_props', sec3);
section('s4_ctor', sec4);
section('s5_arrays', sec5);
section('s6_misc', sec6);
GCF = RGC;
section('s7_relaz_globals', sec1);
section('s7_relaz_chain', sec2);
section('s7_relaz_props', sec3);
GCF = SGC;
print('ST2 end ' + (HAS_GC ? 1 : 0) + '1' + (HAS_RELAZ ? 1 : 0) + '1');
print('TM2 total ' + Math.round(__now() - T0) + ' gcs=' + NGC);
