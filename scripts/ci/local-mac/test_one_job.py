import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("worker", Path(__file__).with_name("one-job.py"))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
SHA = "a" * 40


class AdmissionTest(unittest.TestCase):
    def setUp(self):
        self.run = {"event": "workflow_dispatch", "id": 10, "run_attempt": 2, "path": ".github/workflows/ci-tests.yml",
                    "repository": {"full_name": worker.REPO}, "head_repository": {"full_name": worker.REPO}}
        self.job = {"run_id": 10, "status": "queued", "labels": [f"lawoss-{SHA}-10-2-probe"]}

    def test_admits_exact_job(self):
        self.assertEqual(worker.admit(self.job, self.run, SHA), self.job["labels"][0])

    def test_pull_request_requires_current_test_merge_and_own_head(self):
        run = {**self.run, "event": "pull_request", "head_sha": "b" * 40, "pull_requests": [{"number": 1}]}
        job = {**self.job, "labels": [f"lawoss-{SHA}-10-2-tests"]}
        pr = {"state": "open", "head": {"sha": "b" * 40, "repo": {"full_name": worker.REPO}},
              "merge_commit_sha": SHA}
        with patch.object(worker, "api", return_value=pr):
            self.assertEqual(worker.admit(job, run, SHA), job["labels"][0])
        with patch.object(worker, "api", return_value={**pr, "merge_commit_sha": "c" * 40}), self.assertRaises(RuntimeError):
            worker.admit(job, run, SHA)

    def test_rejects_mismatch(self):
        for change in [{"status": "completed"}, {"run_id": 9}, {"labels": ["macos-15"]},
                       {"labels": [f"lawoss-{SHA}-10-1-tests"]}, {"labels": [f"lawoss-{'b' * 40}-10-2-tests"]}]:
            with self.subTest(change=change), self.assertRaises(RuntimeError):
                worker.admit({**self.job, **change}, self.run, SHA)

    def test_rejects_fork_and_unknown_workflow(self):
        for change in [{"head_repository": {"full_name": "fork/lawoss"}}, {"path": ".github/workflows/release.yml"}]:
            with self.subTest(change=change), self.assertRaises(RuntimeError):
                worker.admit(self.job, {**self.run, **change}, SHA)

    def test_group_scope(self):
        group = {"name": worker.GROUP, "id": 3, "visibility": "selected", "restricted_to_workflows": True,
                 "selected_workflows": [f"{worker.REPO}/.github/workflows/macos-local-probe.yml@{SHA}"]}
        repos = {"total_count": 1, "repositories": [{"full_name": worker.REPO}]}
        with patch.object(worker, "api", side_effect=[{"runner_groups": [group]}, repos]):
            self.assertEqual(worker.group_for_job(), 3)
        for change in [{"restricted_to_workflows": False}, {"visibility": "all"},
                       {"selected_workflows": [f"{worker.REPO}/.github/workflows/ci-tests.yml@refs/heads/unreviewed"]}]:
            with self.subTest(change=change), patch.object(worker, "api", return_value={"runner_groups": [{**group, **change}]}), self.assertRaises(RuntimeError):
                worker.group_for_job()
        with patch.object(worker, "api", side_effect=[{"runner_groups": [group]}, {**repos, "total_count": 2}]), self.assertRaises(RuntimeError):
            worker.group_for_job()
