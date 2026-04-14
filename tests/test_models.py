from datetime import datetime, timedelta

from app.models import Drop, MapRun, Session

BASE = datetime(2026, 1, 1, 12, 0, 0)


def _drop(item_id="2001", quantity=1, value=10.0, ts=None) -> Drop:
    return Drop(
        item_id=item_id,
        quantity=quantity,
        timestamp=ts or BASE,
        value=value,
    )


def _finished_map(
    value=0.0,
    investment=0.0,
    items=0,
    is_league_zone=False,
    duration_minutes=5,
    start=BASE,
) -> MapRun:
    drops = [_drop(quantity=items, value=value, ts=start)] if (items or value) else []
    return MapRun(
        started_at=start,
        ended_at=start + timedelta(minutes=duration_minutes),
        drops=drops,
        is_league_zone=is_league_zone,
        investment=investment,
    )


# ===== MapRun =====


def test_map_run_duration_uses_ended_at_when_set() -> None:
    run = MapRun(started_at=BASE, ended_at=BASE + timedelta(minutes=7))
    assert run.duration_seconds == 420.0


def test_map_run_duration_live_when_not_ended() -> None:
    run = MapRun(started_at=datetime.now() - timedelta(seconds=30))
    assert 29 <= run.duration_seconds < 35


def test_map_run_total_value_sums_drop_values() -> None:
    run = MapRun(
        started_at=BASE,
        drops=[_drop(value=10.0), _drop(value=25.0), _drop(value=5.5)],
    )
    assert run.total_value == 40.5


def test_map_run_total_value_treats_none_as_zero() -> None:
    run = MapRun(
        started_at=BASE,
        drops=[_drop(value=10.0), _drop(value=None), _drop(value=5.0)],
    )
    assert run.total_value == 15.0


def test_map_run_total_items_counts_only_positive_quantities() -> None:
    run = MapRun(
        started_at=BASE,
        drops=[
            _drop(quantity=3),
            _drop(quantity=-2),
            _drop(quantity=5),
        ],
    )
    assert run.total_items == 8


def test_map_run_net_value_subtracts_investment() -> None:
    run = MapRun(
        started_at=BASE,
        drops=[_drop(value=100.0)],
        investment=30.0,
    )
    assert run.net_value == 70.0


def test_map_run_to_dict_round_trips_core_fields() -> None:
    ended = BASE + timedelta(minutes=5)
    run = MapRun(
        started_at=BASE,
        ended_at=ended,
        drops=[_drop(item_id="2001", quantity=2, value=20.0)],
        is_league_zone=True,
        investment=5.0,
    )
    d = run.to_dict()
    assert d["started_at"] == BASE.isoformat()
    assert d["ended_at"] == ended.isoformat()
    assert d["total_value"] == 20.0
    assert d["investment"] == 5.0
    assert d["net_value"] == 15.0
    assert d["is_league_zone"] is True
    assert len(d["drops"]) == 1
    assert d["drops"][0]["item_id"] == "2001"


# ===== Session =====


def test_session_aggregates_sum_across_maps() -> None:
    session = Session(
        id="s1",
        started_at=BASE,
        maps=[
            _finished_map(value=100.0, investment=10.0, items=5),
            _finished_map(value=50.0, investment=5.0, items=3),
        ],
    )
    assert session.total_value == 150.0
    assert session.total_investment == 15.0
    assert session.net_value == 135.0
    assert session.total_items == 8


def test_session_map_count_excludes_league_zones() -> None:
    session = Session(
        id="s1",
        started_at=BASE,
        maps=[
            _finished_map(),
            _finished_map(is_league_zone=True),
            _finished_map(),
        ],
    )
    assert session.map_count == 2


def test_session_map_count_excludes_in_progress_maps() -> None:
    in_progress = MapRun(started_at=BASE)
    session = Session(
        id="s1",
        started_at=BASE,
        maps=[_finished_map(), in_progress],
    )
    assert session.map_count == 1


def test_session_value_per_hour_handles_zero_duration() -> None:
    session = Session(id="s1", started_at=BASE, ended_at=BASE)
    assert session.value_per_hour == 0


def test_session_maps_per_hour_handles_zero_duration() -> None:
    session = Session(id="s1", started_at=BASE, ended_at=BASE)
    assert session.maps_per_hour == 0


def test_session_value_per_hour_uses_net_value() -> None:
    session = Session(
        id="s1",
        started_at=BASE,
        ended_at=BASE + timedelta(hours=1),
        maps=[_finished_map(value=120.0, investment=20.0)],
    )
    assert session.value_per_hour == 100.0


def test_session_maps_per_hour_counts_completed_only() -> None:
    session = Session(
        id="s1",
        started_at=BASE,
        ended_at=BASE + timedelta(hours=1),
        maps=[
            _finished_map(),
            _finished_map(is_league_zone=True),
            MapRun(started_at=BASE),
        ],
    )
    assert session.maps_per_hour == 1.0


def test_session_duration_uses_ended_at_when_set() -> None:
    session = Session(
        id="s1",
        started_at=BASE,
        ended_at=BASE + timedelta(minutes=30),
    )
    assert session.session_duration == 1800.0


def test_session_duration_live_when_not_ended() -> None:
    session = Session(id="s1", started_at=datetime.now() - timedelta(seconds=10))
    assert 9 <= session.session_duration < 15


def test_session_total_duration_sums_map_durations() -> None:
    session = Session(
        id="s1",
        started_at=BASE,
        maps=[
            _finished_map(duration_minutes=5),
            _finished_map(duration_minutes=3),
        ],
    )
    assert session.total_duration == 480.0


def test_session_all_drops_collects_from_all_maps() -> None:
    session = Session(
        id="s1",
        started_at=BASE,
        maps=[
            MapRun(
                started_at=BASE,
                drops=[_drop(item_id="2001"), _drop(item_id="3001")],
            ),
            MapRun(
                started_at=BASE,
                drops=[_drop(item_id="100300")],
            ),
        ],
    )
    assert len(session.all_drops) == 3
    assert {d.item_id for d in session.all_drops} == {"2001", "3001", "100300"}


def test_session_to_dict_includes_maps() -> None:
    session = Session(
        id="s1",
        started_at=BASE,
        ended_at=BASE + timedelta(hours=1),
        maps=[_finished_map(value=50.0)],
    )
    d = session.to_dict()
    assert d["id"] == "s1"
    assert "maps" in d
    assert len(d["maps"]) == 1
    assert d["total_value"] == 50.0


def test_session_to_summary_dict_excludes_maps() -> None:
    session = Session(
        id="s1",
        started_at=BASE,
        ended_at=BASE + timedelta(hours=1),
        maps=[_finished_map(value=50.0)],
    )
    d = session.to_summary_dict()
    assert "maps" not in d
    assert d["total_value"] == 50.0


# ===== Pause / Resume =====


def test_map_run_duration_excludes_completed_pause_window() -> None:
    run = MapRun(started_at=BASE, ended_at=BASE + timedelta(minutes=10))
    run.pause(BASE + timedelta(minutes=2))
    run.resume(BASE + timedelta(minutes=5))
    # 10 minutes total - 3 minutes paused = 7 minutes
    assert run.duration_seconds == 420.0


def test_session_duration_excludes_completed_pause_window() -> None:
    session = Session(
        id="s1",
        started_at=BASE,
        ended_at=BASE + timedelta(minutes=30),
    )
    session.pause(BASE + timedelta(minutes=10))
    session.resume(BASE + timedelta(minutes=15))
    # 30 minutes total - 5 minutes paused = 25 minutes
    assert session.session_duration == 1500.0
