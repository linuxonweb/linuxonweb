// c53 targeted tier stress test. Prints `ST <section> <checksum>` (deterministic)
// and `TM <section> <ms>` (informational). Shell-only helpers are guarded.
var __now = typeof dateNow === 'function' ? dateNow : Date.now;
var HAS_GC = typeof gc === 'function', HAS_MINOR = typeof minorgc === 'function';
function GC() { if (HAS_GC) gc(); return 1; }
function MINOR() { if (HAS_MINOR) minorgc(); else if (HAS_GC) gc(); return 1; }
function mix(h, v) { return (Math.imul(h, 31) + (v | 0)) | 0; }
function mixs(h, s) {
  s = String(s);
  for (var k = 0; k < s.length; k++) h = (Math.imul(h, 31) + s.charCodeAt(k)) | 0;
  return h;
}
function errSig(e) {
  if (e === null || typeof e !== 'object') return 'P:' + String(e);
  return (e.name || '?') + ':' + (e.message || '');
}
function section(name, fn) {
  var t0 = __now(), v;
  try { v = fn(); } catch (e) { v = 'UNCAUGHT ' + errSig(e); }
  print('ST ' + name + ' ' + v);
  print('TM ' + name + ' ' + Math.round(__now() - t0));
}

// ---- a. natives that throw (caught locally and in an outer frame) ----
function a_call(kind, i) {
  switch (kind) {
    case 0: return JSON.parse(i % 2 ? '{"a":' + i + '}' : '{').a;
    case 1: return new Array(i % 2 ? i % 13 : -1).length;
    case 2: return 'x'.repeat(i % 2 ? i % 5 : -1).length;
    case 3: return decodeURIComponent(i % 2 ? '%41' + i : '%').length;
    case 4: return String.prototype.trim.call(i % 2 ? ' s' + i + ' ' : null).length;
    case 5: return Array.prototype.push.call(i % 2 ? [1, 2] : null, i);
    default: return Math.max(i, 3);
  }
}
function a_inner2(kind, i) { return a_call(kind, i) + 1; }
function a_inner1(kind, i) { var r = a_inner2(kind, i); return r * 2; }
function secA() {
  var h = 0, kinds = 7;
  for (var i = 0; i < 6000; i++) {
    var k = i % kinds;
    try { h = mix(h, a_call(k, (i / kinds) | 0)); }
    catch (e) { h = mixs(h, errSig(e)); }
    // same native site, valid most of the time
    try { h = mix(h, JSON.parse(i % 5 ? '[' + i + ']' : '[')[0]); }
    catch (e) { h = mixs(h, e.name); }
  }
  // uncaught until an outer frame (two scripted frames in between)
  for (var j = 0; j < 5000; j++) {
    try { h = mix(h, a_inner1(j % kinds, (j / kinds) | 0)); }
    catch (e) { h = mixs(h, errSig(e)); h = mix(h, j); }
  }
  return h;
}

// ---- b. GC during natives from hot code ----
function secB() {
  var h = 0, keep = [], m = null;
  for (var i = 0; i < 6000; i++) {
    var a = { x: i, s: 'p' + i }, b = { y: i * 2, s: 'q' + (i % 97) };
    var v = a.x + (i % 400 === 0 ? (GC(), b.y) : i % 30 === 0 ? (MINOR(), b.y) : b.y);
    var str = a.s + '|' + b.s;
    h = mix(h, v); h = mixs(h, str.length + str.charAt(1));
    keep.push({ k: i, t: str });
    if (keep.length > 64) keep = keep.slice(32);
    var parts = (str + ',z,' + i).split(',');
    var cat = parts.concat(keep.length, [a.x]);
    var keys = Object.keys(a).concat(Object.keys(b));
    m = new Map([[a.x, b.y], ['s', str]]);
    var d = new Date(i * 86400000);
    h = mix(h, parts.length + cat.length * 3 + keys.length * 7 + m.size + m.get(a.x));
    h = mix(h, d.getUTCDay() + d.getUTCMonth());
    h = mixs(h, keep[keep.length >> 1].t.slice(1, 3));
    if (i % 250 === 0) h = mix(h, a.x + (GC(), keep[0].k) + b.y);
  }
  return h;
}

// ---- c. constructing natives, Reflect.construct, other globals ----
function NT() {}
NT.prototype = { tag: 7 };
function secC() {
  var h = 0, ctors = [Map, Date, Array, String];
  var g = typeof newGlobal === 'function' ? newGlobal() : this;
  var gs = this;
  if (typeof newGlobal === 'function') { try { gs = newGlobal({ sameCompartmentAs: this }); } catch (e) { gs = g; } }
  var gParse = g.JSON.parse, gMax = g.Math.max, gArr = g.Array, gFrom = gs.String.fromCharCode;
  var gFn = gs.eval('(function (x) { return [x, x + 1].length + x; })');
  for (var i = 0; i < 6000; i++) {
    var C = ctors[i % 4], o;
    if (C === Map) o = new C([[i, 1]]).size;
    else if (C === Date) o = new C(0).getUTCFullYear();
    else if (C === Array) o = new C(i % 17).length;
    else o = new C('a').length + (typeof new C('a'));
    h = mixs(h, o);
    h = mix(h, new Map().size + new Date(0).getTime() + new Array(3).length + new String('ab').length);
    var r = Reflect.construct(i % 2 ? Map : Array, [], NT);
    h = mix(h, (Object.getPrototypeOf(r) === NT.prototype) + r.tag);
    h = mix(h, i % 2 ? Map.prototype.has.call(r, 1) : Array.isArray(r));
    h = mix(h, gMax(i, 5) + gParse('[' + (i & 7) + ']')[0] + new gArr(i % 5).length);
    h = mixs(h, gFrom(65 + i % 26));
    h = mix(h, gFn(i));
    try { h = mix(h, gParse(i % 9 ? '1' : '{')); } catch (e) { h = mixs(h, e.name); }
  }
  return h;
}

// ---- d. over-recursion ----
function d_helper(n) { return (n & 3) + Math.max(n & 1, 0); }
function d_rec(n, lim) {
  if (n === lim) return 0;
  var s = String.fromCharCode(65 + n % 26);
  return d_helper(n) + d_rec(n + 1, lim) + s.length;
}
var d_fin = 0, d_depth = 0;
function d_recf(n) {
  d_depth = n > d_depth ? n : d_depth;
  try { return d_helper(n) + d_recf(n + 1) + JSON.stringify(n).length; }
  finally { d_fin++; }
}
function secD() {
  var h = 0;
  for (var i = 0; i < 300; i++) h = mix(h, d_rec(0, 25 + (i & 7)));
  for (var k = 0; k < 6; k++) {
    try { h = mix(h, d_rec(0, -1)); h = mixs(h, 'noexc'); }
    catch (e) { h = mixs(h, e.name); }
    d_fin = 0; d_depth = 0;
    try { d_recf(0); h = mixs(h, 'noexc'); }
    catch (e) { h = mixs(h, e.name); h = mix(h, d_fin === d_depth + 1 ? 1 : d_fin >= d_depth ? 2 : 3); }
    for (var j = 0; j < 500; j++) h = mix(h, d_rec(0, 10));
  }
  return h;
}

// ---- e. strings and array stores ----
function e_strict_push(a, v) { 'use strict'; return a.push(v); }
function e_strict_store(a, i, v) { 'use strict'; a[i] = v; return a.length; }
function secE() {
  var h = 0;
  var lat = 'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(2);
  var two = 'ĀāĂαβγ一丁xyzw'.repeat(4);
  var big = lat + lat;
  var idx = [[0, 0], [0, 1e9], [3, 7], [-5, 4], [7, 3], [200, 300], [5, undefined], [NaN, 4], [2, 2], [1, -1]];
  for (var i = 0; i < 5000; i++) {
    var rope = lat.slice(0, 20 + (i % 9)) + (i % 10) + two.slice(i % 7, 30);
    var lrope = lat + i;
    var dep = big.substring(3 + (i % 5), 60 + (i % 11));
    var strs = [lat, two, rope, lrope, dep];
    var s = strs[i % 5], p = idx[i % 10];
    h = mixs(h, s.substring(p[0], p[1]));
    h = mixs(h, s.substr(p[0], p[1]));
    h = mixs(h, s.slice(p[0], p[1]));
    h = mix(h, s.substring(0).length + s.slice(-3).length + s.substr(-4, 2).length);
    var r2 = two.slice(0, 15) + lat.slice(i % 13, 40);
    h = mix(h, r2.charCodeAt(i % 50) | 0); h = mix(h, (lat + i + two).charCodeAt(70 + (i % 3)));
    h = mix(h, isNaN(rope.charCodeAt(1000)) ? 5 : 6);
  }
  var proto = Object.create(Array.prototype), log = 0;
  Object.defineProperty(proto, '5', { set: function (v) { log = (log + v) | 0; }, get: function () { return 99; }, configurable: true });
  for (var j = 0; j < 5000; j++) {
    var a = [];
    for (var q = 0; q < 12 + (j % 9); q++) a.push(q * j);
    h = mix(h, a.length + a[a.length - 1]);
    var fr = j % 3 === 0 ? Object.freeze([1, 2]) : j % 3 === 1 ? Object.preventExtensions([1, 2]) : [1, 2];
    try { h = mix(h, e_strict_push(fr, j)); } catch (e) { h = mixs(h, e.name); }
    try { h = mix(h, e_strict_store(fr, 2, j)); } catch (e) { h = mixs(h, e.name + 'S'); }
    try { h = mix(h, e_strict_store(fr, 0, j)); } catch (e) { h = mixs(h, e.name + 'Z'); }
    var b = [1, 2, 3];
    b[b.length + 1] = j;
    h = mix(h, b.length * 10 + (3 in b ? 1 : 0) + (4 in b ? 2 : 0));
    var c = [0, 1, 2];
    Object.setPrototypeOf(c, proto);
    c[5] = j;
    h = mix(h, c.length + c[5] + (Object.prototype.hasOwnProperty.call(c, '5') ? 1000 : 0));
    var c2 = [0, 1, 2, 3, 4];
    Object.setPrototypeOf(c2, proto);
    h = mix(h, c2.push(j & 15) + c2[5] + c2.length);
  }
  h = mix(h, log);
  return h;
}

// ---- f. megamorphic property loads ----
function F_cls() { this.q = 1; this.a = 4; }
function secF() {
  var h = 0, nullp = Object.create(null), nullp2 = Object.create(null);
  nullp.a = 11;
  var fn = function () {}; fn.a = 12;
  var px = new Proxy({}, { get: function (t, k) { return typeof k === 'string' ? k.length * 3 : 0; } });
  var objs = [
    { a: 1 }, { b: 2, a: 3 }, { c: 1, d: 2, a: 5 }, { get a() { return 6; } }, px,
    new Int32Array(4), nullp, nullp2, new F_cls(), [1, 2, 3], fn, Object.create({ a: 13 }),
    { z: 1 }, { y: 1, x: 2, w: 3, v: 4, a: 14 }, new Float64Array(2), Object.create({ get a() { return 15; } })
  ];
  var keys = ['a', 'length', 'missing', 'b', '0'];
  for (var i = 0; i < 12000; i++) {
    var o = objs[i % objs.length];
    var v = o.a;
    h = mixs(h, v === undefined ? 'u' : v);
    h = mixs(h, o.length === undefined ? 'U' : o.length);
    h = mix(h, o.missing === undefined ? 1 : 2);
    var w = o[keys[i % 5]];
    h = mixs(h, w === undefined ? 'k' : typeof w === 'function' ? 'f' : w);
    if (i % 1000 === 0) objs[3] = { get a() { return i & 7; } };
  }
  return h;
}

// ---- g. call-site cache ----
function g_site(f, x) { return f(x); }
function g_site0(f) { return f(); }
function g_site3(f, a, b, c) { return f(a, b, c); }
function g_new(F, x) { return new F(x); }
function makeAdder(k) { return function (x) { return x + k; }; }
class GBase { constructor(x) { this.x = x | 0; } get gx() { return this.x * 2; } set sx(v) { this.x = v | 0; } }
class GDer extends GBase { constructor(x) { super(x + 1); this.y = 2; } }
function g_dp(a, b = 7) { return (a | 0) + b; }
function g_rest(...r) { return r.length * 100 + (r[0] | 0); }
function g_args() { return arguments.length * 1000 + (arguments[0] | 0); }
function g_walk(f, n) { return n > 0 ? g_site3(f, f, n - 1, 0) + 1 : 0; }
function g_walk3(f, n, z) { return n > 0 ? g_site3(f, f, n - 1, z) + 1 : z; }
var g_finCount = 0;
function g_t3(i) { try { if (i % 7 === 0) throw new RangeError('t3 ' + (i % 5)); return i; } finally { g_finCount++; } }
function g_t2(i) { try { return g_site(g_t3, i) + 1; } finally { g_finCount += 2; } }
function g_t1(i) { try { return g_site(g_t2, i) + 1; } finally { g_finCount += 4; } }
function secG() {
  var h = 0, i;
  var two = [makeAdder(1), makeAdder(2)];
  for (i = 0; i < 6000; i++) h = mix(h, g_site(two[i & 1], i));
  var twenty = [];
  for (i = 0; i < 10; i++) twenty.push(makeAdder(i * 3));
  for (i = 0; i < 10; i++) twenty.push(new Function('x', 'return x * ' + (i + 2) + ' - ' + i + ';'));
  for (i = 0; i < 8000; i++) h = mix(h, g_site(twenty[i % 20], i));
  var bound = [g_dp.bind(null, 3), Math.max.bind(null, 9), makeAdder(5).bind(null), g_rest.bind(null, 1, 2)];
  for (i = 0; i < 6000; i++) h = mix(h, g_site(bound[i & 3], i));
  for (i = 0; i < 6000; i++) {
    var F = i & 1 ? GBase : GDer, o = g_new(F, i);
    h = mix(h, o.x + (o.y | 0) + o.gx);
    o.sx = i * 3; h = mix(h, o.x);
    if (i % 50 === 0) { try { g_site(F, i); h = mixs(h, 'nonew'); } catch (e) { h = mixs(h, errSig(e)); } }
  }
  var shapes = [g_dp, g_rest, g_args, makeAdder(1), function (a, b, c, d, e) { return [a, b, c, d, e].join('').length; }];
  for (i = 0; i < 8000; i++) {
    var f = shapes[i % 5];
    h = mixs(h, g_site0(f)); h = mixs(h, g_site(f, i)); h = mixs(h, g_site3(f, i, i + 1, i + 2));
  }
  var cur = makeAdder(7);
  for (i = 0; i < 6000; i++) {
    if (i % 1000 === 500) {
      if (typeof relazifyFunctions === 'function') relazifyFunctions();
      GC();
      cur = (i / 1000) & 1 ? makeAdder(i) : new Function('x', 'return x ^ ' + i + ';');
    }
    h = mix(h, g_site(cur, i)); h = mix(h, g_site(makeAdder, i)(1));
  }
  for (i = 0; i < 3000; i++) { h = mix(h, g_walk(g_walk, i % 12)); h = mix(h, g_walk3(g_walk3, i % 9, i & 3)); }
  g_finCount = 0;
  for (i = 0; i < 7000; i++) {
    try { h = mix(h, g_t1(i)); } catch (e) { h = mixs(h, errSig(e)); }
  }
  h = mix(h, g_finCount);
  return h;
}

var T0 = __now();
section('a', secA);
section('b', secB);
section('c', secC);
section('d', secD);
section('e', secE);
section('f', secF);
section('g', secG);
print('ST end ' + (HAS_GC ? 1 : 0) + (HAS_MINOR ? 1 : 0) + (typeof newGlobal === 'function' ? 1 : 0) + (typeof relazifyFunctions === 'function' ? 1 : 0));
print('TM total ' + Math.round(__now() - T0));
