;; SPDX-License-Identifier: MIT
;; Guest framebuffer change detection for the host display (framebuffer.js).
;; Memory 0 is the guest's shared memory; memory 1 holds the staging frame
;; (rowBytes * height bytes at offset 0). diff() compares each guest row with its
;; staging row 16 bytes at a time, copies the differing span of each changed row
;; into staging, and reports the changed rectangle: rows [top, bottom) and bytes
;; [left, right) of a row. rowBytes must be a multiple of 16.
;; Build: wat2wasm --enable-multi-memory --enable-threads fbdiff.wat -o fbdiff.wasm
(module
  (memory $guest (import "env" "guest") 1 65536 shared)
  (memory $stage (export "staging") 0)
  (global $top (export "top") (mut i32) (i32.const 0))
  (global $bottom (export "bottom") (mut i32) (i32.const 0))
  (global $left (export "left") (mut i32) (i32.const 0))
  (global $right (export "right") (mut i32) (i32.const 0))
  ;; Returns 1 when any row changed (or fresh != 0: copy every row), else 0.
  (func (export "diff") (param $src i32) (param $stride i32) (param $rb i32)
      (param $h i32) (param $fresh i32) (result i32)
    (local $y i32) (local $s i32) (local $d i32) (local $i i32) (local $j i32)
    (global.set $top (i32.const -1))
    (global.set $bottom (i32.const 0))
    (global.set $left (local.get $rb))
    (global.set $right (i32.const 0))
    (block $rows_done
      (loop $rows
        (br_if $rows_done (i32.ge_u (local.get $y) (local.get $h)))
        (local.set $s (i32.add (local.get $src) (i32.mul (local.get $y) (local.get $stride))))
        (local.set $d (i32.mul (local.get $y) (local.get $rb)))
        (local.set $i (i32.const 0))
        (local.set $j (i32.sub (local.get $rb) (i32.const 16)))
        (block $next_row
          (if (i32.eqz (local.get $fresh))
            (then
              ;; First differing chunk; an unchanged row skips to the next row.
              (block $found
                (loop $scan
                  (br_if $next_row (i32.ge_u (local.get $i) (local.get $rb)))
                  (br_if $found (v128.any_true (v128.xor
                    (v128.load $guest (i32.add (local.get $s) (local.get $i)))
                    (v128.load $stage (i32.add (local.get $d) (local.get $i))))))
                  (local.set $i (i32.add (local.get $i) (i32.const 16)))
                  (br $scan)))
              ;; Last differing chunk (the chunk at $i differs, so this stops there).
              (block $last
                (loop $back
                  (br_if $last (v128.any_true (v128.xor
                    (v128.load $guest (i32.add (local.get $s) (local.get $j)))
                    (v128.load $stage (i32.add (local.get $d) (local.get $j))))))
                  (br_if $last (i32.le_u (local.get $j) (local.get $i)))
                  (local.set $j (i32.sub (local.get $j) (i32.const 16)))
                  (br $back)))))
          (memory.copy $stage $guest
            (i32.add (local.get $d) (local.get $i))
            (i32.add (local.get $s) (local.get $i))
            (i32.sub (i32.add (local.get $j) (i32.const 16)) (local.get $i)))
          (if (i32.lt_s (global.get $top) (i32.const 0))
            (then (global.set $top (local.get $y))))
          (global.set $bottom (i32.add (local.get $y) (i32.const 1)))
          (if (i32.lt_u (local.get $i) (global.get $left))
            (then (global.set $left (local.get $i))))
          (if (i32.gt_u (i32.add (local.get $j) (i32.const 16)) (global.get $right))
            (then (global.set $right (i32.add (local.get $j) (i32.const 16))))))
        (local.set $y (i32.add (local.get $y) (i32.const 1)))
        (br $rows)))
    (i32.ge_s (global.get $top) (i32.const 0))))
