#!/usr/bin/env python3
"""Regression tests for the observed browser scope-migration monitoring gap."""
import importlib.util
import pathlib
import unittest
import tempfile
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('bounded', pathlib.Path(__file__).with_name('bounded.py'))
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


def item(pid):
    return {'pid': pid, 'parentPid': 11 if pid == 12 else 0, 'startTicks': pid * 100, 'state': 'S'}


def ancestor(path, cpus):
    return {'path': path, 'cpuMax': 'max 100000' if cpus is None else str(int(cpus * 100000)) + ' 100000', 'cpus': cpus}


class SharedQuota(unittest.TestCase):
    def snapshot(self, memberships, ancestors, previous=None, affinity=None):
        with patch.object(b, 'process_stat', side_effect=item), patch.object(b, 'cgroup_membership', side_effect=lambda pid: memberships[pid]), patch.object(b, 'quota_ancestors', side_effect=lambda name: ancestors[name]) as read, patch.object(b.os, 'sched_getaffinity', return_value=set(range(32)) if affinity is None else affinity):
            result = b.owned_quota_snapshot([item(pid) for pid in memberships], previous)
            return result, read.call_count

    def test_common_parent_limits_distinct_owned_groups(self):
        groups = {'/shared/a': [ancestor('/shared/a', None), ancestor('/shared', 3)], '/shared/b': [ancestor('/shared/b', 2), ancestor('/shared', 3)]}
        result, calls = self.snapshot({11: '/shared/a', 12: '/shared/b'}, groups)
        self.assertTrue(result['valid'])
        self.assertEqual(result['commonSharedAncestors'], [{'path': '/shared', 'maximumObservedCpuLimit': 3}])
        self.assertEqual(calls, 2)

    def test_independent_three_cpu_caps_are_not_a_shared_budget(self):
        result, _ = self.snapshot({11: '/a', 12: '/b'}, {'/a': [ancestor('/a', 3), ancestor('/', None)], '/b': [ancestor('/b', 3), ancestor('/', None)]})
        self.assertFalse(result['valid'])
        self.assertIn('no_common_shared_three_cpu_ancestor', [x['reason'] for x in result['violations']])

    def test_unlimited_browser_scope_rejected_despite_capped_parent(self):
        result, _ = self.snapshot({11: '/shared', 12: '/app-browser'}, {'/shared': [ancestor('/shared', 3), ancestor('/', None)], '/app-browser': [ancestor('/app-browser', None), ancestor('/', None)]})
        self.assertFalse(result['valid'])
        self.assertIn('missing_or_excessive_three_cpu_ancestor', [x['reason'] for x in result['violations']])

    def test_affinity_does_not_replace_required_ancestor(self):
        result, _ = self.snapshot({11: '/app-browser'}, {'/app-browser': [ancestor('/app-browser', None)]}, affinity={0})
        self.assertFalse(result['valid'])

    def test_same_group_ancestor_reads_deduplicated(self):
        result, calls = self.snapshot({11: '/shared', 12: '/shared', 13: '/shared'}, {'/shared': [ancestor('/shared', 3)]})
        self.assertTrue(result['valid'])
        self.assertEqual(calls, 1)
        self.assertEqual(len(result['groups'][0]['processes']), 3)

    def test_membership_change_since_previous_sample_rejected(self):
        result, _ = self.snapshot({11: '/shared/new'}, {'/shared/new': [ancestor('/shared/new', 3)]}, {(11, 1100): '/shared/old'})
        self.assertFalse(result['valid'])
        self.assertIn('owned_process_changed_cgroup', [x['reason'] for x in result['violations']])

    def test_membership_change_during_observation_rejected(self):
        with patch.object(b, 'process_stat', side_effect=item), patch.object(b, 'cgroup_membership', side_effect=['/shared', '/app-browser']), patch.object(b, 'quota_ancestors', return_value=[ancestor('/shared', 3)]), patch.object(b.os, 'sched_getaffinity', return_value={0, 1, 2}):
            result = b.owned_quota_snapshot([item(11)])
        self.assertFalse(result['valid'])
        self.assertIn('membership_changed_during_sample', [x['reason'] for x in result['violations']])

    def test_live_unreadable_membership_fails_closed(self):
        with patch.object(b, 'process_stat', side_effect=item), patch.object(b, 'cgroup_membership', side_effect=PermissionError('fixture')):
            result = b.owned_quota_snapshot([item(11)])
        self.assertFalse(result['valid'])
        self.assertIn('owned_process_quota_unreadable', [x['reason'] for x in result['violations']])

    def test_reused_pid_never_adopts_new_process(self):
        with patch.object(b, 'process_stat', return_value={'pid': 11, 'startTicks': 9999, 'state': 'S'}):
            result = b.owned_quota_snapshot([item(11)])
        self.assertFalse(result['valid'])
        self.assertEqual(result['groups'], [])


class ThreadInventory(unittest.TestCase):
    def layout(self, root, pid, tids):
        for tid, children in tids.items():
            directory = root / str(pid) / 'task' / str(tid)
            directory.mkdir(parents=True)
            (directory / 'children').write_text(children)

    def test_fork_from_nonleader_thread_is_discovered(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            self.layout(root, 11, {11: '', 99: '12'})
            self.layout(root, 12, {12: ''})
            with patch.object(b, 'PROC_ROOT', root), patch.object(b, 'process_stat', side_effect=item):
                rows = b.tree(11, 1100)
            self.assertEqual({row['pid'] for row in rows}, {11, 12})

    def test_live_missing_children_inventory_fails_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            self.layout(root, 11, {11: ''})
            (root / '11/task/11/children').unlink()
            with patch.object(b, 'PROC_ROOT', root), patch.object(b, 'process_stat', side_effect=item):
                with self.assertRaises(b.OwnedInventoryError) as caught:
                    b.tree(11, 1100)
            self.assertEqual(caught.exception.items[0]['pid'], 11)
            self.assertEqual(caught.exception.problems[0]['reason'], 'live_thread_inventory_unreadable')

    def test_thread_disappearance_is_not_an_inventory_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            self.layout(root, 11, {11: '', 99: ''})
            original = pathlib.Path.read_text
            def read(path, *args, **kwargs):
                if path == root / '11/task/99/children':
                    path.unlink()
                    path.parent.rmdir()
                    raise FileNotFoundError('exited task fixture')
                return original(path, *args, **kwargs)
            with patch.object(b, 'PROC_ROOT', root), patch.object(b, 'process_stat', side_effect=item), patch.object(pathlib.Path, 'read_text', new=read):
                rows = b.tree(11, 1100)
            self.assertEqual([row['pid'] for row in rows], [11])

    def test_reused_child_pid_with_different_parent_not_adopted(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            self.layout(root, 11, {11: '12'})
            def stat(pid):
                row = item(pid)
                if pid == 12:
                    row['parentPid'] = 999
                return row
            with patch.object(b, 'PROC_ROOT', root), patch.object(b, 'process_stat', side_effect=stat):
                with self.assertRaises(b.OwnedInventoryError) as caught:
                    b.tree(11, 1100)
            self.assertEqual([row['pid'] for row in caught.exception.items], [11])
            self.assertEqual(caught.exception.problems[0]['reason'], 'child_parent_changed_before_identity')

    def test_reused_root_pid_not_adopted(self):
        with patch.object(b, 'process_stat', return_value={'pid': 11, 'parentPid': 0, 'state': 'S', 'startTicks': 9999}):
            self.assertEqual(b.tree(11, 1100), [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
