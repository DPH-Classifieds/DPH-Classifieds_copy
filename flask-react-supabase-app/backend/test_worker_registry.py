import pytest

from worker_registry import (
    WorkerSpec,
    build_registry,
    result_did_work,
    run_worker_tick,
)


def _spec(
    name="inventory-import",
    lock_key="worker:inventory-import",
    task=lambda: 1,
    interval_env="INVENTORY_IMPORT_INTERVAL_SECONDS",
    default_interval_seconds=10,
    max_backoff_seconds=300,
):
    return WorkerSpec(
        name=name,
        lock_key=lock_key,
        task=task,
        interval_env=interval_env,
        default_interval_seconds=default_interval_seconds,
        max_backoff_seconds=max_backoff_seconds,
    )


def test_registry_rejects_duplicate_worker_names_before_registration():
    with pytest.raises(ValueError, match="duplicate worker name: inventory-import"):
        build_registry(
            (
                _spec(lock_key="worker:inventory-a"),
                _spec(lock_key="worker:inventory-b"),
            ),
            getenv=lambda _key: None,
        )


def test_registry_rejects_duplicate_lock_keys_before_registration():
    with pytest.raises(ValueError, match="duplicate worker lock key: worker:shared"):
        build_registry(
            (
                _spec(name="inventory", lock_key="worker:shared"),
                _spec(name="webhooks", lock_key="worker:shared"),
            ),
            getenv=lambda _key: None,
        )


def test_registry_preserves_declared_order_and_resolves_each_interval_once():
    requested = []
    environment = {"B_INTERVAL": "17"}
    specs = (
        _spec(
            name="second",
            lock_key="worker:second",
            interval_env="B_INTERVAL",
            default_interval_seconds=20,
        ),
        _spec(
            name="first",
            lock_key="worker:first",
            interval_env="A_INTERVAL",
            default_interval_seconds=11,
        ),
    )

    registry = build_registry(
        specs,
        getenv=lambda key: requested.append(key) or environment.get(key),
    )

    assert tuple(worker.name for worker in registry) == ("second", "first")
    assert tuple(worker.interval_seconds for worker in registry) == (17, 11)
    assert requested == ["B_INTERVAL", "A_INTERVAL"]


@pytest.mark.parametrize(
    ("result", "expected"),
    [
        (None, False),
        (0, False),
        (0.0, False),
        (False, False),
        ((), False),
        ((0, "idle"), False),
        ({}, False),
        ({"processed": 0, "sent": 0}, False),
        ({"processed": 2, "sent": 0}, True),
        (1, True),
        ((2, "processed"), True),
        ("processed", True),
    ],
)
def test_result_did_work_handles_zero_work_results(result, expected):
    assert result_did_work(result) is expected


def test_idle_tick_uses_injected_backoff_and_reports_result():
    events = []
    backoff_calls = []
    worker = build_registry((_spec(task=lambda: (0, "idle")),), getenv=lambda _key: None)[0]

    outcome = run_worker_tick(
        worker,
        current_delay_seconds=10,
        backoff=lambda current, base, cap: backoff_calls.append(
            (current, base, cap)
        )
        or 23,
        on_result=lambda registered, result: events.append(
            (registered.name, result)
        ),
    )

    assert outcome.result == (0, "idle")
    assert outcome.error is None
    assert outcome.did_work is False
    assert outcome.next_delay_seconds == 23
    assert backoff_calls == [(10, 10, 300)]
    assert events == [("inventory-import", (0, "idle"))]


def test_work_tick_resets_delay_without_calling_backoff():
    worker = build_registry((_spec(task=lambda: 3),), getenv=lambda _key: "14")[0]

    outcome = run_worker_tick(
        worker,
        current_delay_seconds=112,
        backoff=lambda *_args: pytest.fail("busy workers must not back off"),
    )

    assert outcome.did_work is True
    assert outcome.next_delay_seconds == 14


def test_task_exception_is_isolated_and_sent_to_error_and_backoff_hooks():
    events = []
    failure = RuntimeError("database unavailable")

    def fail():
        raise failure

    worker = build_registry((_spec(task=fail),), getenv=lambda _key: None)[0]

    outcome = run_worker_tick(
        worker,
        current_delay_seconds=40,
        backoff=lambda current, base, cap: events.append(
            ("backoff", current, base, cap)
        )
        or 80,
        on_error=lambda registered, error: events.append(
            ("error", registered.name, error)
        ),
    )

    assert outcome.result is None
    assert outcome.error is failure
    assert outcome.did_work is False
    assert outcome.next_delay_seconds == 80
    assert events == [
        ("error", "inventory-import", failure),
        ("backoff", 40, 10, 300),
    ]


def test_invalid_environment_interval_fails_closed_with_worker_context():
    with pytest.raises(
        ValueError,
        match="inventory-import interval from INVENTORY_IMPORT_INTERVAL_SECONDS must be a positive integer",
    ):
        build_registry((_spec(),), getenv=lambda _key: "0")
