/* Translate a single touch pointer into a mouse-like gesture for the guest. */

export const TOUCH_HOLD_MS = 1000;

/**
 * Build the stateful touch adapter used by the framebuffer host.
 *
 * A touch always moves the guest pointer to its contact point. A short touch
 * becomes a click when it ends; a touch held for one second presses the left
 * button, after which moves and the eventual release form a drag. Only one
 * touch is tracked at a time, matching the single-pointer virtio device.
 */
export function createTouchGestureAdapter({
  move,
  press,
  holdMs = TOUCH_HOLD_MS,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
}) {
  if (typeof move !== "function" || typeof press !== "function") {
    throw new TypeError("touch gesture adapter requires move and press callbacks");
  }
  let active = null;

  const clearHold = (gesture) => {
    if (gesture?.timer != null) clearTimeoutFn(gesture.timer);
    if (gesture) gesture.timer = null;
  };

  const isActive = (pointerId) => active !== null && active.pointerId === pointerId;

  return {
    start(pointerId, x, y) {
      if (active !== null) return false;
      const gesture = { pointerId, timer: null, pressed: false };
      active = gesture;
      move(x, y);
      gesture.timer = setTimeoutFn(() => {
        if (active !== gesture) return;
        gesture.timer = null;
        gesture.pressed = true;
        press(true);
      }, holdMs);
      return true;
    },

    move(pointerId, x, y) {
      if (!isActive(pointerId)) return false;
      move(x, y);
      return true;
    },

    end(pointerId, x, y, cancelled = false) {
      if (!isActive(pointerId)) return false;
      const gesture = active;
      move(x, y);
      clearHold(gesture);
      active = null;
      if (gesture.pressed) {
        press(false);
      } else if (!cancelled) {
        // A quick touch is a complete click. Press and release at contact.
        press(true);
        press(false);
      }
      return true;
    },

    cancel(pointerId) {
      if (!isActive(pointerId)) return false;
      const gesture = active;
      clearHold(gesture);
      active = null;
      if (gesture.pressed) press(false);
      return true;
    },

    get activePointerId() {
      return active?.pointerId ?? null;
    },
  };
}
