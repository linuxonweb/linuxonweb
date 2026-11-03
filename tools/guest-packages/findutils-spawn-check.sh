#!/bin/busybox sh
# Real GNU find/xargs process, status, cwd and stdin tests inside the Linux guest.
# BusyBox is only test setup/assertion and the deliberately launched child utility.
BB=/bin/busybox
FIND=${FINDUTILS_FIND:-/usr/bin/find}
XARGS=${FINDUTILS_XARGS:-/usr/bin/xargs}
TASK=$($BB mktemp -d /home/admin/.findutils-spawn.XXXXXXXX) || exit 2
export FINDUTILS_TEST_DIR=$TASK
failures=0
checks=0
check() {
  label=$1
  shift
  checks=$((checks+1))
  if "$@"; then $BB echo "FINDUTILS_SPAWN_PASS $label"; else
    failures=$((failures+1)); $BB echo "FINDUTILS_SPAWN_FAIL $label";
  fi
}
finish() {
  rc=$1
  $BB echo "FINDUTILS_SPAWN_DONE checks=$checks failures=$failures status=$rc"
  if [ "$rc" = 0 ] && [ "$failures" = 0 ]; then
    case "$TASK" in /home/admin/.findutils-spawn.*) $BB rm -rf "$TASK";; esac
  else
    $BB echo "FINDUTILS_SPAWN_EVIDENCE $TASK"
  fi
}
$FIND --version | $BB head -n 1
$XARGS --version | $BB head -n 1
$BB mkdir -p "$TASK/tree/sub"
$BB printf 'alpha\n' > "$TASK/tree/a"
$BB printf 'beta\n' > "$TASK/tree/sub/b"
$BB printf '%s\n' "$TASK/tree/a" "$TASK/tree/sub/b" | $BB sort > "$TASK/expected-find"
$FIND "$TASK/tree" -type f -exec /bin/busybox printf '%s\n' '{}' \; | $BB sort > "$TASK/actual-find"
check find-exec-semicolon-argv $BB cmp "$TASK/expected-find" "$TASK/actual-find"
$FIND "$TASK/tree" -type f -exec /bin/busybox printf '%s\n' '{}' + | $BB sort > "$TASK/actual-find-plus"
check find-exec-plus-argv $BB cmp "$TASK/expected-find" "$TASK/actual-find-plus"
initial_pwd=$(pwd)
$FIND "$TASK/tree/sub" -name b -execdir /bin/busybox sh -c 'test "$(pwd)" = "$1" && test "$2" = ./b && test -f "$2" && printf "correct-directory\n"' sh "$TASK/tree/sub" '{}' \; > "$TASK/execdir"
check find-execdir-cwd-result $BB test "$(cat "$TASK/execdir")" = correct-directory
check find-parent-cwd-unchanged $BB test "$(pwd)" = "$initial_pwd"
$FIND "$TASK/tree/a" -exec /bin/busybox sh -c 'exit 7' \; -print > "$TASK/find-false"
semicolon_status=$?
check find-semicolon-failure-predicate $BB test ! -s "$TASK/find-false"
check find-semicolon-failure-exit $BB test "$semicolon_status" = 0
$FIND "$TASK/tree/a" -exec /bin/busybox sh -c 'exit 7' '{}' + > "$TASK/find-plus-fail" 2>&1
check find-plus-failure-exit $BB test "$?" = 1
$FIND "$TASK/tree/a" -exec "$TASK/absent" '{}' + > "$TASK/find-missing" 2>&1
check find-missing-command-plus $BB test "$?" = 1

$BB printf "'a b' \"c d\" e\n" | $XARGS /bin/busybox printf '<%s>\n' > "$TASK/quoted"
$BB printf '<a b>\n<c d>\n<e>\n' > "$TASK/quoted-expected"
check xargs-quoted-argv $BB cmp "$TASK/quoted" "$TASK/quoted-expected"
$BB printf 'a b\0c\nd\0' | $XARGS -0 /bin/busybox printf '<%s>\n' > "$TASK/nul"
$BB printf '<a b>\n<c\nd>\n' > "$TASK/nul-expected"
check xargs-null-argv $BB cmp "$TASK/nul" "$TASK/nul-expected"
$BB printf 'one\n' | $XARGS /bin/busybox sh -c 'if read data; then exit 91; fi; test "$1" = one' sh
check xargs-default-stdin-devnull $BB test "$?" = 0
$BB printf 'one\n' > "$TASK/arguments"
$BB printf 'stdin-payload\n' | $XARGS -a "$TASK/arguments" /bin/busybox sh -c 'read data && test "$data" = stdin-payload && test "$1" = one' sh
check xargs-argfile-preserves-stdin $BB test "$?" = 0
# Closed fd0 with -a keeps child stdin closed, not an unrelated opened file.
($BB sh -c 'exec 0<&-; exec "$1" -a "$2" /bin/busybox sh -c '\''if read data; then exit 92; fi; test "$1" = one'\'' sh' sh "$XARGS" "$TASK/arguments") > "$TASK/closed-stdin" 2>&1
check xargs-argfile-closed-stdin $BB test "$?" = 0

cat > "$TASK/parallel.sh" <<'CHILD'
#!/bin/busybox sh
BB=/bin/busybox
TASK=$FINDUTILS_TEST_DIR
case "${LINUXONWEB_TEST_SLOT:-}" in 0|1) ;; *) exit 93;; esac
$BB mkdir "$TASK/active-$LINUXONWEB_TEST_SLOT" || exit 94
$BB printf '%s %s\n' "$LINUXONWEB_TEST_SLOT" "$$" > "$TASK/parallel-$1"
if [ "$1" = 1 ] || [ "$1" = 2 ]; then
  attempt=0
  while [ ! -f "$TASK/parallel-1" ] || [ ! -f "$TASK/parallel-2" ]; do
    attempt=$((attempt+1)); [ "$attempt" -le 100 ] || exit 95
    $BB sleep 0.05
  done
fi
$BB sleep 0.1
$BB rmdir "$TASK/active-$LINUXONWEB_TEST_SLOT"
CHILD
$BB printf '1\n2\n3\n4\n' | $XARGS -P 2 -n 1 --process-slot-var=LINUXONWEB_TEST_SLOT /bin/busybox sh "$TASK/parallel.sh"
check xargs-parallel-two-slot-reuse $BB test "$?" = 0
slot1=$($BB cut -d ' ' -f1 "$TASK/parallel-1")
slot2=$($BB cut -d ' ' -f1 "$TASK/parallel-2")
check xargs-parallel-first-children-distinct $BB test "$slot1" != "$slot2"
all_reaped=1
for item in "$TASK"/parallel-*; do
  [ -f "$item" ] || continue
  read -r slot child_pid < "$item"
  [ ! -d "/proc/$child_pid" ] || all_reaped=0
done
check xargs-all-recorded-children-reaped $BB test "$all_reaped" = 1
$BB printf 'one\n' | $XARGS /bin/busybox sh -c 'exit 1'
check xargs-client-status-one $BB test "$?" = 123
$BB printf 'one\n' | $XARGS /bin/busybox sh -c 'exit 255' > "$TASK/client-255" 2>&1
check xargs-client-status-255 $BB test "$?" = 124
$BB printf 'one\n' | $XARGS /bin/busybox sh -c 'kill -TERM $$' > "$TASK/client-signal" 2>&1
check xargs-client-fatal-signal $BB test "$?" = 125
# Fatal status must stop new work, wait for existing parallel children, and
# report the documented result without calling exit recursively from atexit.
cat > "$TASK/fatal-parallel.sh" <<'CHILD'
#!/bin/busybox sh
BB=/bin/busybox
DIR=$FINDUTILS_TEST_DIR/fatal-$FINDUTILS_FATAL_KIND
$BB printf '%s\n' "$$" > "$DIR/pid-$1"
case "$1" in
  never) $BB touch "$DIR/never-started"; exit 98 ;;
esac
$BB touch "$DIR/ready-$1"
attempt=0
while [ ! -f "$DIR/ready-late" ] || [ ! -f "$DIR/ready-fatal" ]; do
  attempt=$((attempt+1)); [ "$attempt" -le 100 ] || exit 97
  $BB sleep 0.05
done
if [ "$1" = late ]; then
  # Keep this slot busy until the parent actually reaps the fatal sibling.
  # Fixed sleeps can race and permit a legitimate early slot reuse.
  read -r fatal_pid < "$DIR/pid-fatal" || exit 94
  attempt=0
  while [ -d "/proc/$fatal_pid" ]; do
    attempt=$((attempt+1)); [ "$attempt" -le 100 ] || exit 93
    $BB sleep 0.05
  done
  $BB touch "$DIR/late-done"
  exit 0
fi
case "$FINDUTILS_FATAL_KIND" in
  255) exit 255 ;;
  signal) kill -TERM "$$"; exit 96 ;;
esac
exit 95
CHILD
for fatal_kind in 255 signal; do
  $BB mkdir "$TASK/fatal-$fatal_kind"
  $BB printf 'late\nfatal\nnever\n' | FINDUTILS_FATAL_KIND=$fatal_kind $XARGS -P 2 -n 1 /bin/busybox sh "$TASK/fatal-parallel.sh" > "$TASK/fatal-$fatal_kind/output" 2>&1
  fatal_status=$?
  expected=124; [ "$fatal_kind" != signal ] || expected=125
  check "xargs-parallel-$fatal_kind-status" $BB test "$fatal_status" = "$expected"
  check "xargs-parallel-$fatal_kind-wait-existing" $BB test -f "$TASK/fatal-$fatal_kind/late-done"
  check "xargs-parallel-$fatal_kind-stop-new-work" $BB test ! -f "$TASK/fatal-$fatal_kind/never-started"
  all_reaped=1
  for item in "$TASK/fatal-$fatal_kind"/pid-*; do
    [ -f "$item" ] || continue
    read -r child_pid < "$item"
    [ ! -d "/proc/$child_pid" ] || all_reaped=0
  done
  check "xargs-parallel-$fatal_kind-children-reaped" $BB test "$all_reaped" = 1
done

$BB printf 'one\n' | $XARGS "$TASK/absent" > "$TASK/missing" 2>&1
check xargs-missing-command-127 $BB test "$?" = 127
$BB printf 'not executable\n' > "$TASK/denied"
$BB chmod 600 "$TASK/denied"
$BB printf 'one\n' | $XARGS "$TASK/denied" > "$TASK/denied-output" 2>&1
check xargs-nonexecutable-command-126 $BB test "$?" = 126
$BB printf 'a b c d e f\n' | __GNU_FINDUTILS_EXEC_ARG_COUNT_LIMIT=4 $XARGS /bin/busybox printf '%s\n' > "$TASK/split"
check xargs-e2big-splitting-exit $BB test "$?" = 0
$BB printf 'a\nb\nc\nd\ne\nf\n' > "$TASK/split-expected"
check xargs-e2big-no-loss-duplicate $BB cmp "$TASK/split" "$TASK/split-expected"
# -o must attach /dev/tty if one exists; otherwise it must fail truthfully.
$BB printf 'one\n' | $XARGS -o /bin/busybox sh -c 'test -t 0 && test "$1" = one' sh > "$TASK/tty" 2>&1
tty_status=$?
if [ -c /dev/tty ] && (exec 3</dev/tty) 2>/dev/null; then
  check xargs-tty-stdin $BB test "$tty_status" = 0
else
  check xargs-no-tty-reports-failure $BB test "$tty_status" = 123
fi
finish "$failures"
exit "$failures"
