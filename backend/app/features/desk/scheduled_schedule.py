"""Wall-calendar schedules: skip DST gaps and use the first fold once."""

from datetime import UTC, date, datetime, time, timedelta
from math import floor
from zoneinfo import ZoneInfo

from .scheduled_schemas import ScheduledTask


def utc_text(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def wall_instant(day: date, clock: time, zone: ZoneInfo) -> datetime | None:
    local = datetime.combine(day, clock).replace(tzinfo=zone, fold=0)
    instant = local.astimezone(UTC)
    return instant if instant.astimezone(zone).replace(tzinfo=None) == local.replace(tzinfo=None) else None


def next_occurrence(task: ScheduledTask, after: datetime) -> str | None:
    """Return a strictly later slot; missed occurrences are not replayed."""
    if task.status != "active":
        return None
    zone = ZoneInfo(task.timeZone)
    start = date.fromisoformat(task.startDate)
    clock = time.fromisoformat(task.time)
    end = date.fromisoformat(task.endDate) if task.endDate else date.max
    initial = wall_instant(start, clock, zone)
    if task.repeat == "once":
        return utc_text(initial) if initial is not None and initial > after and start <= end else None
    seconds = elapsed_seconds(task)
    if seconds is not None:
        return elapsed_occurrence(initial, seconds, end, zone, after)
    if task.repeat == "custom" and task.unit == "months":
        return monthly_interval(task, start, end, clock, zone, after)
    return calendar_occurrence(task, start, end, clock, zone, after)


def elapsed_seconds(task: ScheduledTask) -> int | None:
    if task.repeat == "hourly":
        return 3600
    if task.repeat == "custom" and task.unit in ("minutes", "hours"):
        return task.interval * (60 if task.unit == "minutes" else 3600)
    return None


def elapsed_occurrence(initial: datetime | None, seconds: int, end: date,
                       zone: ZoneInfo, after: datetime) -> str | None:
    if initial is None:
        return None
    steps = max(0, floor((after - initial).total_seconds() / seconds) + 1)
    try:
        candidate = initial + timedelta(seconds=steps * seconds)
    except OverflowError:
        return None
    return utc_text(candidate) if candidate.astimezone(zone).date() <= end else None


def calendar_occurrence(task: ScheduledTask, start: date, end: date, clock: time,
                        zone: ZoneInfo, after: datetime) -> str | None:
    first = max(start, after.astimezone(zone).date())
    # At most one complete Gregorian cycle is needed for every supported calendar rule.
    for offset in range(146097):
        try:
            day = first + timedelta(days=offset)
        except OverflowError:
            return None
        if day > end:
            return None
        if not matches(task, start, day):
            continue
        instant = wall_instant(day, clock, zone)
        if instant is not None and instant > after:
            return utc_text(instant)
    return None


def monthly_interval(task: ScheduledTask, start: date, end: date, clock: time,
                     zone: ZoneInfo, after: datetime) -> str | None:
    local = after.astimezone(zone)
    elapsed = (local.year - start.year) * 12 + local.month - start.month
    first_step = max(0, elapsed // task.interval)
    origin = start.year * 12 + start.month - 1
    # A Gregorian cycle bounds invalid dates such as 29 February across interval phases.
    for step in range(first_step, first_step + 4800):
        year, month = divmod(origin + step * task.interval, 12)
        if year > 9999:
            return None
        try:
            day = date(year, month + 1, start.day)
        except ValueError:
            continue
        if day > end:
            return None
        instant = wall_instant(day, clock, zone)
        if instant is not None and instant > after:
            return utc_text(instant)
    return None


def matches(task: ScheduledTask, start: date, day: date) -> bool:
    days = (day - start).days
    if task.repeat == "daily":
        return True
    if task.repeat == "weekdays":
        return (day.weekday() + 1) % 7 in task.days
    if task.repeat == "weekly":
        return (day.weekday() + 1) % 7 == task.days[0]
    if task.repeat == "monthly":
        return day.day == task.monthDay
    if task.unit == "days":
        return days % task.interval == 0
    if task.unit == "weeks":
        return days % (7 * task.interval) == 0
    months = (day.year - start.year) * 12 + day.month - start.month
    return day.day == start.day and months % task.interval == 0
