"""Auto-review subsystem for listing approvals.

All modules in this package are pure-logic: every external dependency
(Supabase, vision API, VIN decoder, clock) is injected. The only glue
code that touches I/O lives in ``workers/auto_review_worker.py``.
"""
