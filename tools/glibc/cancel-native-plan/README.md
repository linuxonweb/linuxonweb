# Native GNU cancellation source plan

Read `docs/glibc-cancel-native-plan-20261002.md` before implementation.
`evidence.py` snapshots exact source/binary predecessors and compiles only the
proposed record layout and two cleanup-scope controls. It does not supply a
cancellation symbol, compiler pass, kernel hook or runtime acceptance.

```sh
python3 -B tools/glibc/cancel-native-plan/evidence.py
```

Outputs are retained by attempt beneath
`/mnt/p6/build/glibc-cancel-native-plan-20261002`; TMP/TMPDIR/TEMP/cache are owned
there. Two supervised compile commands each have a60-second deadline, separate
process group, exact argv/source pin and group-empty check. The initial reserve
is8GiB, task cap2GiB and hard-stop free space5GiB. No browser or service is run.
Root review is required before cancellation implementation.
