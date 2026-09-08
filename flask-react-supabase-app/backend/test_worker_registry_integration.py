import worker

from worker_registry import result_did_work


def test_worker_scheduler_uses_shared_result_work_contract():
    assert worker._result_did_work is result_did_work


def test_scheduled_worker_registry_is_complete_and_resolves_intervals():
    task_names = worker.scheduled_worker_task_names()
    tasks = {name: (lambda: 0) for name in task_names}
    registry = worker.build_scheduled_workers(
        tasks,
        getenv=lambda key: "17" if key == "WEBHOOK_DELIVERY_INTERVAL_SECONDS" else None,
    )

    assert len(registry) == len(task_names)
    assert tuple(item.name for item in registry) == task_names
    webhook = next(item for item in registry if item.name == "webhook_delivery_worker")
    assert webhook.interval_seconds == 17
