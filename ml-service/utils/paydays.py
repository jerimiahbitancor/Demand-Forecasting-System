"""
Payday calendar for the is_payday feature (owner-approved rule, Oct 17 2026).

THE RULE, in plain words:
  1. Every month has two paydays: the 15th, and the end of the month.
  2. The end-of-month payday is the 30th. In a 31-day month it stays on
     the 30th (not the 31st). February has no 30th, so its end-of-month
     payday is its last day (the 28th, or the 29th in a leap year).
  3. A payday that falls on a SATURDAY moves to the Friday before it.
     A payday that falls on a SUNDAY moves to the Monday after it.

Why a separate module: the old code was `1 if d.day in (15, 30) else 0`,
which never flagged February's end-of-month payday and ignored weekends.
Keeping the rule here, as pure functions of the date, means training and
forecasting still share it through calendar_features(), and the edge
cases can be unit-tested on their own (tests/test_paydays.py).

Note on rule 3: a Sunday payday moved to Monday can land in the NEXT
month (Sunday Nov 30 -> Monday Dec 1). That is why is_payday() also
checks the previous month's paydays.
"""
import calendar
from datetime import date, timedelta


def scheduled_paydays(year: int, month: int) -> list:
    """The two paydays of a month BEFORE the weekend rule is applied."""
    last_day = calendar.monthrange(year, month)[1]
    end_of_month = 30 if last_day >= 30 else last_day   # February -> 28 or 29
    return [date(year, month, 15), date(year, month, end_of_month)]


def adjust_for_weekend(d: date) -> date:
    """Saturday -> the Friday before; Sunday -> the Monday after."""
    if d.weekday() == 5:   # Saturday
        return d - timedelta(days=1)
    if d.weekday() == 6:   # Sunday
        return d + timedelta(days=1)
    return d


def actual_paydays(year: int, month: int) -> list:
    """The two paydays of a month AFTER the weekend rule (may spill into the next month)."""
    return [adjust_for_weekend(d) for d in scheduled_paydays(year, month)]


def is_payday(d: date) -> int:
    """Return 1 if customers are paid on date d under the rule above, else 0."""
    previous_year, previous_month = (d.year, d.month - 1) if d.month > 1 else (d.year - 1, 12)
    for year, month in ((d.year, d.month), (previous_year, previous_month)):
        if d in actual_paydays(year, month):
            return 1
    return 0
