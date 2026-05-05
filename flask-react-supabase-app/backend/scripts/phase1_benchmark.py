#!/usr/bin/env python3
import argparse
import statistics
import time
import requests

DEFAULT_ENDPOINTS = [
    "/api/cars?limit=30&order=created_at.desc",
    "/api/bikes?limit=30&order=created_at.desc",
    "/api/parts?limit=30&order=created_at.desc",
    "/api/plates?limit=30&order=created_at.desc",
    "/api/auth/me",
]


def percentile(values, p):
    if not values:
        return 0.0
    if len(values) == 1:
        return float(values[0])
    ordered = sorted(values)
    index = (len(ordered) - 1) * (p / 100.0)
    lower = int(index)
    upper = min(lower + 1, len(ordered) - 1)
    weight = index - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def run_endpoint(session, base_url, endpoint, runs, timeout):
    latencies = []
    payload_sizes = []
    status_counts = {}

    url = f"{base_url.rstrip('/')}{endpoint}"
    for _ in range(runs):
        start = time.perf_counter()
        try:
            resp = session.get(url, timeout=timeout)
            duration_ms = (time.perf_counter() - start) * 1000
            latencies.append(duration_ms)
            payload_sizes.append(len(resp.content or b""))
            status_counts[resp.status_code] = status_counts.get(resp.status_code, 0) + 1
        except Exception:
            duration_ms = (time.perf_counter() - start) * 1000
            latencies.append(duration_ms)
            payload_sizes.append(0)
            status_counts["error"] = status_counts.get("error", 0) + 1

    return {
        "endpoint": endpoint,
        "count": runs,
        "p50_ms": round(percentile(latencies, 50), 2),
        "p95_ms": round(percentile(latencies, 95), 2),
        "p99_ms": round(percentile(latencies, 99), 2),
        "avg_ms": round(statistics.fmean(latencies), 2) if latencies else 0.0,
        "avg_payload_bytes": int(statistics.fmean(payload_sizes)) if payload_sizes else 0,
        "status_counts": status_counts,
    }


def main():
    parser = argparse.ArgumentParser(description="Phase 1 latency and payload benchmark")
    parser.add_argument("--base-url", required=True, help="API base URL, e.g. https://api.dphclassifieds.com")
    parser.add_argument("--runs", type=int, default=15)
    parser.add_argument("--timeout", type=float, default=20)
    parser.add_argument("--endpoint", action="append", dest="endpoints", default=[])
    args = parser.parse_args()

    endpoints = args.endpoints or DEFAULT_ENDPOINTS
    session = requests.Session()

    print(f"Benchmarking {args.base_url} | runs per endpoint={args.runs}")
    for endpoint in endpoints:
        result = run_endpoint(session, args.base_url, endpoint, args.runs, args.timeout)
        print(
            f"{result['endpoint']} | p50={result['p50_ms']}ms p95={result['p95_ms']}ms p99={result['p99_ms']}ms "
            f"avg={result['avg_ms']}ms payload_avg={result['avg_payload_bytes']}B statuses={result['status_counts']}"
        )


if __name__ == "__main__":
    main()
