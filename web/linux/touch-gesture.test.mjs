import test from "node:test";
import assert from "node:assert/strict";
import { createTouchGestureAdapter, TOUCH_HOLD_MS } from "./touch-gesture.mjs";

function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
  };
}

test("short touch moves to contact and becomes a click on release", () => {
  const clock = fakeClock();
  const moves = [];
  const presses = [];
  const gesture = createTouchGestureAdapter({
    move: (x, y) => moves.push([x, y]),
    press: (down) => presses.push(down),
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
  });

  assert.equal(gesture.start(7, 12, 34), true);
  assert.deepEqual(moves, [[12, 34]]);
  clock.advance(250);
  assert.equal(gesture.end(7, 12, 34), true);
  assert.deepEqual(presses, [true, false]);
  assert.equal(gesture.activePointerId, null);
});

test("held touch presses after one second and drag releases cleanly", () => {
  const clock = fakeClock();
  const moves = [];
  const presses = [];
  const gesture = createTouchGestureAdapter({
    move: (x, y) => moves.push([x, y]),
    press: (down) => presses.push(down),
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
  });

  gesture.start(3, 1, 2);
  clock.advance(TOUCH_HOLD_MS - 1);
  assert.deepEqual(presses, []);
  gesture.move(3, 5, 8);
  clock.advance(1);
  assert.deepEqual(presses, [true]);
  gesture.move(3, 9, 13);
  gesture.end(3, 9, 13);
  assert.deepEqual(moves, [[1, 2], [5, 8], [9, 13], [9, 13]]);
  assert.deepEqual(presses, [true, false]);
});

test("cancel releases a held touch without synthesizing a click", () => {
  const clock = fakeClock();
  const presses = [];
  const gesture = createTouchGestureAdapter({
    move() {},
    press: (down) => presses.push(down),
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
  });
  gesture.start(1, 0, 0);
  clock.advance(TOUCH_HOLD_MS);
  assert.equal(gesture.cancel(1), true);
  assert.deepEqual(presses, [true, false]);
  assert.equal(gesture.cancel(1), false);
});

test("only the first active touch owns the single pointer", () => {
  const clock = fakeClock();
  const moves = [];
  const presses = [];
  const gesture = createTouchGestureAdapter({
    move: (x, y) => moves.push([x, y]),
    press: (down) => presses.push(down),
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
  });
  assert.equal(gesture.start(1, 1, 1), true);
  assert.equal(gesture.start(2, 2, 2), false);
  assert.equal(gesture.move(2, 3, 3), false);
  assert.deepEqual(moves, [[1, 1]]);
  gesture.end(1, 1, 1);
  assert.deepEqual(presses, [true, false]);
});
