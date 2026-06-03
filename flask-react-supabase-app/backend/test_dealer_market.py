from services.dealer_market import compute_stats, percentile_rank


def test_percentile_rank_middle():
    assert 0.45 <= percentile_rank(50, [10, 20, 30, 40, 50, 60, 70, 80, 90]) <= 0.55


def test_percentile_rank_top():
    assert percentile_rank(1000, [10, 20, 30]) == 1.0


def test_compute_stats_basic():
    s = compute_stats([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
    assert s["median"] == 55
    assert 25 <= s["p25"] <= 32
    assert 70 <= s["p75"] <= 80
    assert s["count"] == 10
