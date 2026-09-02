#!/usr/bin/env python3
"""Regression test for CarList Reddit checkbox semantics.

The frontend URL builder used to omit exclude_reddit when unchecked,
relying on the backend default (_should_hide_reddit(False, False, False)
→ True at app.py:18898-18906) to hide Reddit anyway. The UI label "Hide
Reddit listings" promised the opposite. The fix is in the frontend; this
test pins the backend behavior so future refactors can't silently change
it.
"""

import unittest

import app as backend


class ExcludeRedditBackendDefaultsTests(unittest.TestCase):
    def test_no_param_hides_reddit_by_default(self):
        self.assertTrue(backend._should_hide_reddit(False, False, False))

    def test_exclude_reddit_false_includes_reddit_when_admin_flag_on(self):
        self.assertFalse(backend._should_hide_reddit(False, False, True))

    def test_exclude_reddit_true_always_hides(self):
        self.assertTrue(backend._should_hide_reddit(False, True, True))

    def test_requesting_reddit_tab_never_hides(self):
        self.assertFalse(backend._should_hide_reddit(True, True, False))


if __name__ == "__main__":
    unittest.main()
