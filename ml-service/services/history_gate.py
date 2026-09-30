"""
The first-use "12 months of sales history" rule. Pure functions only: no
database, no clock. The caller passes in the dates; this decides.

This is a line-for-line twin of backend/utils/historyGate.js. Both are
tested against the SAME cases in tests/fixtures/history_gate_cases.json,
and tests/test_history_gate.py runs the JS version on those cases too and
compares the answers field by field. If you change the rule here, change it
there too, and add a case to that file.

The rule (owner's decision, Sep 30 2026):
  1. Span: last sale date - first sale date + 1 >= 365 calendar days.
     Measured on the uploaded data, NEVER on today's date -- the clock
     moving forward must not count as history.
  2. Every day accounted for: each date from the first to the last sale date
     is either open (has daily_sales rows) or confirmed closed
     (business_days.status = 'confirmed_closed'). Zero unconfirmed dates.

Closed days count toward the span. A date that has sales AND is marked
closed counts as open -- an upload always wins over a closed mark.
"""
import re
from datetime import date, timedelta

MIN_HISTORY_SPAN_DAYS = 365
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _parse(value):
    """'YYYY-MM-DD' -> date, or None if it isn't a real calendar date."""
    if not isinstance(value, str) or not _DATE_RE.match(value):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def evaluate_history_gate(sale_dates, closed_dates):
    """
    sale_dates:   dates that have daily_sales rows (duplicates/unsorted fine)
    closed_dates: dates with business_days.status = 'confirmed_closed'
    Accepts 'YYYY-MM-DD' strings or date objects.
    """
    def normalize(values):
        out = set()
        for v in values or []:
            if isinstance(v, date):
                out.add(v)
            else:
                parsed = _parse(v)
                if parsed is not None:
                    out.add(parsed)
        return out

    sale_set = normalize(sale_dates)
    closed_set = normalize(closed_dates)

    if not sale_set:
        return {
            "first_sale_date": None,
            "last_sale_date": None,
            "span_days": 0,
            "required_span_days": MIN_HISTORY_SPAN_DAYS,
            "open_days": 0,
            "closed_days": 0,
            "unconfirmed_days": 0,
            "unconfirmed_dates": [],
            "span_ok": False,
            "all_accounted": False,
            "passes": False,
            "insufficient_reason": "no_data",
        }

    first = min(sale_set)
    last = max(sale_set)
    span_days = (last - first).days + 1

    open_days = 0
    closed_days = 0
    unconfirmed = []
    current = first
    while current <= last:
        if current in sale_set:
            open_days += 1
        elif current in closed_set:
            closed_days += 1
        else:
            unconfirmed.append(current.isoformat())
        current += timedelta(days=1)

    span_ok = span_days >= MIN_HISTORY_SPAN_DAYS
    all_accounted = len(unconfirmed) == 0
    if not span_ok and not all_accounted:
        reason = "both"
    elif not span_ok:
        reason = "span"
    elif not all_accounted:
        reason = "unconfirmed"
    else:
        reason = None

    return {
        "first_sale_date": first.isoformat(),
        "last_sale_date": last.isoformat(),
        "span_days": span_days,
        "required_span_days": MIN_HISTORY_SPAN_DAYS,
        "open_days": open_days,
        "closed_days": closed_days,
        "unconfirmed_days": len(unconfirmed),
        "unconfirmed_dates": unconfirmed,
        "span_ok": span_ok,
        "all_accounted": all_accounted,
        "passes": span_ok and all_accounted,
        "insufficient_reason": reason,
    }


def describe_failure(result):
    """Plain sentence for /train's 422 response."""
    reason = result["insufficient_reason"]
    if reason == "no_data":
        return "no sales data uploaded yet"
    parts = []
    if not result["span_ok"]:
        parts.append(
            f"sales history covers {result['span_days']} days "
            f"({result['first_sale_date']} to {result['last_sale_date']}); "
            f"the first training run needs at least {MIN_HISTORY_SPAN_DAYS}"
        )
    if not result["all_accounted"]:
        parts.append(
            f"{result['unconfirmed_days']} date(s) inside that history have no sales "
            "and are not marked closed -- upload those days or mark them closed"
        )
    return "; ".join(parts)
