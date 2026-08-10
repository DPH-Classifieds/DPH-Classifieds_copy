"""Reddit visibility decision for the cars/normal feeds.

Truth table for _should_hide_reddit(requesting_reddit, exclude_reddit, reddit_on_explore).
"""
import unittest

from app import _should_hide_reddit


class ShouldHideRedditTests(unittest.TestCase):
    def test_reddit_tab_never_hides(self):
        # Explicitly requesting the Reddit tab always shows Reddit rows.
        for excl in (True, False):
            for on_explore in (True, False):
                self.assertFalse(_should_hide_reddit(True, excl, on_explore))

    def test_default_feed_hides_reddit_when_not_on_explore(self):
        self.assertTrue(_should_hide_reddit(False, False, False))

    def test_on_explore_shows_reddit_by_default(self):
        self.assertFalse(_should_hide_reddit(False, False, True))

    def test_exclude_reddit_overrides_on_explore(self):
        # User opt-out wins even when admin mixed Reddit into the feed.
        self.assertTrue(_should_hide_reddit(False, True, True))


if __name__ == "__main__":
    unittest.main()
