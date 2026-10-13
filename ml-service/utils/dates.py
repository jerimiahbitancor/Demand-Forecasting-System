"""
Business dates for ChefDuo are Asia/Manila calendar dates.

The container runs on UTC, so date.today() there is the UTC date: a manual
forecast between 00:00 and 07:59 Manila time used to start from YESTERDAY.
manila_today() fixes that.

A FIXED UTC+8 offset is used on purpose: the Philippines has no daylight
saving time, so the offset never changes, and a fixed offset needs no tzdata
package (requirements.txt stays as it is).

Only business dates go through here. Model version names
(model_storage.new_model_version) stay in UTC: they are names, not dates.
"""
from datetime import date, datetime, timedelta, timezone

MANILA_TZ = timezone(timedelta(hours=8), name="Asia/Manila")


def manila_today(now: datetime = None) -> date:
    """
    Today's calendar date in Asia/Manila.

    `now` is for tests: any timezone-aware datetime. A naive datetime is
    taken to be UTC (what the container's clock gives). Omitted -> the
    current time.
    """
    if now is None:
        now = datetime.now(timezone.utc)
    elif now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now.astimezone(MANILA_TZ).date()
