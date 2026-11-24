// f64ops: double arithmetic in the method tier (PBLBC_VSF64). Identical stdout
// expected with PBLBC=0 PBLIC=0 PBLJIT=0, defaults, PBLBC_HITS=2 and
// PBLBC_VSF64=1 (opt-in candidate).
function fmt(v) {
  if (v === 0 && 1 / v < 0) return "-0";
  return typeof v + ":" + String(v);
}
var vals = [0, -0, 1, -1, 0.5, -0.5, 3, 2147483647, -2147483648, 1073741824,
            65536, 1e300, -1e300, 1.5e-310, NaN, Infinity, -Infinity, 2.25,
            4294967296, 0.1, 0.2, "7", true, null, undefined, {valueOf() { return 2.5; }}];
function add(a, b) { return a + b; }
function sub(a, b) { return a - b; }
function mul(a, b) { return a * b; }
function chain(a, b, c) { return (a * b + c) * (a - c) + b * 0.5 - 1.25; }
function cmp(a, b) {
  var r = 0;
  if (a < b) r |= 1;
  if (a <= b) r |= 2;
  if (a > b) r |= 4;
  if (a >= b) r |= 8;
  if (a * 1.5 < b + 0.25) r |= 16;
  if (!(a - b > 0.5)) r |= 32;
  return r;
}
var out = [];
for (var rep = 0; rep < 60; rep++) {
  var line = [];
  for (var i = 0; i < vals.length; i++) {
    for (var j = 0; j < vals.length; j++) {
      var a = vals[i], b = vals[j];
      var s = fmt(add(a, b)) + "|" + fmt(sub(a, b)) + "|" + fmt(mul(a, b)) +
              "|" + fmt(chain(a, b, 3)) + "|" + cmp(a, b);
      if (rep === 59) line.push(s);
    }
  }
  if (rep === 59) out.push(line.join("\n"));
}
print(out.join("\n"));

// Hot loops: int32 overflow into doubles, exact-int doubles, -0 results.
function hot(n) {
  var acc = 0, x = 0.5, p = 1, z = 0;
  for (var i = 0; i < n; i++) {
    acc = acc + i * 1.5;
    x = x * 1.0001 + 0.25 - i * 0.125;
    p = p * 3;
    if (p > 1e15) p = p - 1e15 + 7;
    z = (i % 7) * -0;
  }
  return [acc, x, p, fmt(z), fmt(0 * -1), fmt(-1 * 0), fmt(2147483647 + 1),
          fmt(-2147483648 - 1), fmt(65536 * 65536), fmt(46341 * 46341)];
}
for (var k = 0; k < 40; k++) var hr = hot(1000 + k);
print("hot " + hr.join(","));

// Values flowing into property stores, element stores, calls and returns.
function Pt(x, y) { this.x = x; this.y = y; }
function len2(p) { return p.x * p.x + p.y * p.y; }
function flow(n) {
  var arr = new Array(8).fill(0);
  var o = new Pt(0, 0), s = 0;
  for (var i = 0; i < n; i++) {
    o.x = i * 0.5 - 3;
    o.y = (i + 0.25) * 2 - 1;
    arr[i & 7] = o.x * o.y + 0.75;
    s = s + len2(o) - arr[(i + 3) & 7];
    var t = new Pt(o.x - o.x, o.y * 0 - 0);
    if (i === n - 1) print("flow t " + fmt(t.x) + " " + fmt(t.y));
  }
  return s + arr.reduce(add, 0);
}
var fr;
for (var k = 0; k < 40; k++) fr = flow(500 + k);
print("flow " + fr);

// NaN through chains and comparisons in a hot loop.
function nanloop(n) {
  var c = 0, v = NaN, w = 0;
  for (var i = 0; i < n; i++) {
    var q = v * 2 + i;
    if (q < 1) c++;
    if (q >= 1) c += 2;
    if (!(q === q)) c += 4;
    w = w + (i - 0.5) * (i + 0.5);
  }
  return c + " " + w + " " + fmt(v - v) + " " + fmt(Infinity - Infinity) +
         " " + fmt(Infinity * 0);
}
for (var k = 0; k < 40; k++) var nr = nanloop(300 + k);
print("nan " + nr);
