"""Pure worker composition contracts.

This module deliberately owns no threads, locks, environment, or logging.  The
process entrypoint supplies those dependencies when it adopts the registry.
"""

from dataclasses import dataclass
from typing import Any, Callable, Iterable, Optional


Task = Callable[[], Any]
Getenv = Callable[[str], Optional[str]]
Backoff = Callable[[int, int, int], int]
ResultHook = Callable[["RegisteredWorker", Any], None]
ErrorHook = Callable[["RegisteredWorker", Exception], None]


@dataclass(frozen=True)
class WorkerSpec:
    name: str
    lock_key: str
    task: Task
    interval_env: str
    default_interval_seconds: int
    max_backoff_seconds: int = 300


@dataclass(frozen=True)
class RegisteredWorker:
    name: str
    lock_key: str
    task: Task
    interval_seconds: int
    max_backoff_seconds: int


@dataclass(frozen=True)
class TickOutcome:
    result: Any
    error: Optional[Exception]
    did_work: bool
    next_delay_seconds: int


def _positive_integer(value: Any, *, description: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{description} must be a positive integer")
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{description} must be a positive integer") from exc
    if parsed <= 0 or str(value).strip() != str(parsed):
        raise ValueError(f"{description} must be a positive integer")
    return parsed


def build_registry(
    specs: Iterable[WorkerSpec], *, getenv: Getenv
) -> tuple[RegisteredWorker, ...]:
    """Validate and resolve worker declarations without creating resources.

    Declared order is retained so callers can create and start workers in a
    predictable sequence. Environment access is injected and happens only
    after the complete declaration set passes identity validation.
    """
    declared = tuple(specs)
    names: set[str] = set()
    lock_keys: set[str] = set()

    for spec in declared:
        if not isinstance(spec.name, str) or not spec.name.strip():
            raise ValueError("worker name must be a non-empty string")
        if spec.name in names:
            raise ValueError(f"duplicate worker name: {spec.name}")
        names.add(spec.name)

        if not isinstance(spec.lock_key, str) or not spec.lock_key.strip():
            raise ValueError(f"worker {spec.name} lock key must be a non-empty string")
        if spec.lock_key in lock_keys:
            raise ValueError(f"duplicate worker lock key: {spec.lock_key}")
        lock_keys.add(spec.lock_key)

        if not callable(spec.task):
            raise ValueError(f"worker {spec.name} task must be callable")
        if not isinstance(spec.interval_env, str) or not spec.interval_env.strip():
            raise ValueError(
                f"worker {spec.name} interval environment key must be a non-empty string"
            )

    registered = []
    for spec in declared:
        configured_interval = getenv(spec.interval_env)
        interval_value = (
            spec.default_interval_seconds
            if configured_interval is None
            else configured_interval
        )
        interval = _positive_integer(
            interval_value,
            description=f"{spec.name} interval from {spec.interval_env}",
        )
        max_backoff = _positive_integer(
            spec.max_backoff_seconds,
            description=f"{spec.name} max backoff",
        )
        registered.append(
            RegisteredWorker(
                name=spec.name,
                lock_key=spec.lock_key,
                task=spec.task,
                interval_seconds=interval,
                max_backoff_seconds=max(interval, max_backoff),
            )
        )

    return tuple(registered)


def result_did_work(result: Any) -> bool:
    """Apply the existing worker result convention to one task result."""
    if result is None:
        return False
    if isinstance(result, tuple) and result:
        head = result[0]
        if isinstance(head, (int, float)):
            return head > 0
        return bool(head)
    if isinstance(result, (int, float)):
        return result > 0
    return bool(result)


def _default_backoff(current: int, base: int, cap: int) -> int:
    return min(max(current, base) * 2, cap)


def _ignore_result(_worker: RegisteredWorker, _result: Any) -> None:
    return None


def _ignore_error(_worker: RegisteredWorker, _error: Exception) -> None:
    return None


def run_worker_tick(
    worker: RegisteredWorker,
    *,
    current_delay_seconds: Optional[int] = None,
    backoff: Backoff = _default_backoff,
    on_result: ResultHook = _ignore_result,
    on_error: ErrorHook = _ignore_error,
) -> TickOutcome:
    """Run one task while converting task failures into an isolated outcome."""
    current_delay = (
        worker.interval_seconds
        if current_delay_seconds is None
        else _positive_integer(
            current_delay_seconds,
            description=f"{worker.name} current delay",
        )
    )

    try:
        result = worker.task()
    except Exception as exc:
        on_error(worker, exc)
        next_delay = backoff(
            current_delay,
            worker.interval_seconds,
            worker.max_backoff_seconds,
        )
        return TickOutcome(
            result=None,
            error=exc,
            did_work=False,
            next_delay_seconds=next_delay,
        )

    on_result(worker, result)
    did_work = result_did_work(result)
    next_delay = worker.interval_seconds
    if not did_work:
        next_delay = backoff(
            current_delay,
            worker.interval_seconds,
            worker.max_backoff_seconds,
        )
    return TickOutcome(
        result=result,
        error=None,
        did_work=did_work,
        next_delay_seconds=next_delay,
    )
