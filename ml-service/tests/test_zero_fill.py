"""
Tests the zero-fill rule and the two new features.

Run:  cd ml-service && python tests/test_zero_fill.py

Pure functions only — no Supabase, no network, no clock.
"""
import os
import sys
from datetime import date, timedelta

ML_SERVICE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ML_SERVICE_DIR not in sys.path:
    sys.path.insert(0, ML_SERVICE_DIR)

os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault(
    "SUPABASE_SERVICE_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoidGVzdCJ9.not-a-real-signature",
)

from config import OFF_MENU_GAP_OPEN_DAYS  # noqa: E402
from services.zero_fill import build_open_day_series, previous_open_date  # noqa: E402
from services.feature_engineering import build_feature_row  # noqa: E402

_failures = []


def check(label, condition, detail=""):
    if condition:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label}  {detail}")
        _failures.append(label)


def d(day):
    """Shorthand: d(1) -> 2026-06-01. June 1 2026 is a Monday."""
    return date(2026, 6, 1) + timedelta(days=day - 1)


def qtys(series):
    return [s["quantity_sold"] for s in series]


def reals(series):
    return [s["is_real"] for s in series]


print("test_zero_fill.py")
print(f"  (OFF_MENU_GAP_OPEN_DAYS = {OFF_MENU_GAP_OPEN_DAYS})")

# ---------------------------------------------------------------
# 1. The waffle sequence from the owner's spec
#    5, 2, -, -, -, 3, -  ->  5, 2, 0, 0, 0, 3, 0
# ---------------------------------------------------------------
open_week = [d(i) for i in range(1, 8)]
waffle = {d(1): 5, d(2): 2, d(6): 3}
series = build_open_day_series(waffle, open_week)
check("waffle sequence fills the interior gap and the trailing day",
      qtys(series) == [5, 2, 0, 0, 0, 3, 0], f"got {qtys(series)}")
check("waffle: is_real marks only the three genuine sales",
      reals(series) == [True, True, False, False, False, True, False],
      f"got {reals(series)}")

# ---------------------------------------------------------------
# 2. Nothing before the first sale
# ---------------------------------------------------------------
series = build_open_day_series({d(5): 4}, open_week)
check("no fill before the product's first sale",
      [s["sale_date"] for s in series][0] == d(5), f"starts {series[0]['sale_date']}")
check("first sale is the first entry, nothing earlier", len(series) >= 1 and series[0]["quantity_sold"] == 4)

# ---------------------------------------------------------------
# 3. Closed and unconfirmed days are never filled
#    Only d1..d3 and d7 are confirmed open; d4/d5 closed, d6 unconfirmed.
# ---------------------------------------------------------------
partial_open = [d(1), d(2), d(3), d(7)]
series = build_open_day_series({d(1): 5, d(7): 3}, partial_open)
dates = [s["sale_date"] for s in series]
check("closed/unconfirmed dates get no row at all",
      d(4) not in dates and d(5) not in dates and d(6) not in dates,
      f"got {dates}")
check("only the confirmed-open days appear", dates == [d(1), d(2), d(3), d(7)], f"got {dates}")
check("the open no-sale days in between are zeros", qtys(series) == [5, 0, 0, 3], f"got {qtys(series)}")

# ---------------------------------------------------------------
# 4. Gap length: 27 open days filled, 28 not (the off-menu rule)
# ---------------------------------------------------------------
def gap_case(gap_len):
    """A sale, then `gap_len` no-sale open days, then another sale."""
    total = gap_len + 2
    opens = [d(i) for i in range(1, total + 1)]
    sales = {d(1): 10, d(total): 20}
    return build_open_day_series(sales, opens)

s27 = gap_case(27)
check("a 27-open-day gap IS filled with zeros",
      len(s27) == 29 and qtys(s27).count(0) == 27, f"len={len(s27)} zeros={qtys(s27).count(0)}")

s28 = gap_case(28)
check("a 28-open-day gap is NOT filled (off menu)",
      qtys(s28) == [10, 20], f"got {qtys(s28)}")
check("after an off-menu gap the history resumes at the next sale",
      [x["sale_date"] for x in s28] == [d(1), d(30)], f"got {[x['sale_date'] for x in s28]}")

s40 = gap_case(40)
check("a 40-open-day gap is NOT filled either", qtys(s40) == [10, 20], f"got {qtys(s40)}")

# ---------------------------------------------------------------
# 5. Trailing fill stops at the off-menu span
# ---------------------------------------------------------------
long_opens = [d(i) for i in range(1, 60)]
series = build_open_day_series({d(1): 7}, long_opens)
trailing_zeros = sum(1 for s in series if not s["is_real"])
check("trailing fill stops after 27 open days, not forever",
      trailing_zeros == OFF_MENU_GAP_OPEN_DAYS - 1, f"got {trailing_zeros}")
check("trailing fill keeps the real sale as the first entry",
      series[0]["quantity_sold"] == 7 and series[0]["is_real"] is True)

# ---------------------------------------------------------------
# 6. Archived products are never filled
# ---------------------------------------------------------------
series = build_open_day_series(waffle, open_week, is_archived=True)
check("archived product gets its real rows only, no fill",
      qtys(series) == [5, 2, 3] and all(reals(series)), f"got {qtys(series)}")

# ---------------------------------------------------------------
# 7. A real sale on a date business_days never confirmed still counts
#    (an upload always wins over a missing/wrong business_days row)
# ---------------------------------------------------------------
series = build_open_day_series({d(1): 5, d(4): 9}, [d(1), d(2)])
check("a sale outside the confirmed-open list is still kept",
      d(4) in [s["sale_date"] for s in series], f"got {[s['sale_date'] for s in series]}")

# ---------------------------------------------------------------
# 8. No sales at all -> empty series
# ---------------------------------------------------------------
check("a product with no sales yields an empty series",
      build_open_day_series({}, open_week) == [])

# ---------------------------------------------------------------
# 9. previous_open_date: the store-level gap
# ---------------------------------------------------------------
check("previous_open_date picks the latest earlier open day",
      previous_open_date(d(7), [d(1), d(3), d(6)]) == d(6))
check("previous_open_date is None when nothing is earlier",
      previous_open_date(d(1), [d(3), d(6)]) is None)

# ---------------------------------------------------------------
# 10. same_dow_last_open across a closed Sunday and a holiday
#     June 1 2026 = Monday. Open Mon-Sat, Sunday closed.
# ---------------------------------------------------------------
mon1, tue2, sat6 = d(1), d(2), d(6)
mon8 = d(8)          # next Monday; Sunday d(7) is closed
history = [
    {"sale_date": mon1, "quantity_sold": 11, "is_real": True},
    {"sale_date": tue2, "quantity_sold": 22, "is_real": True},
    {"sale_date": sat6, "quantity_sold": 33, "is_real": True},
]
row = build_feature_row(1, mon8, history, prev_open_date=sat6)
check("same_dow_last_open finds last Monday across a closed Sunday",
      row["same_dow_last_open"] == 11, f"got {row['same_dow_last_open']}")
check("days_since_last_open = 2 on a Monday after a closed Sunday",
      row["days_since_last_open"] == 2, f"got {row['days_since_last_open']}")
check("lag_1 is the previous OPEN day, not 'yesterday'",
      row["lag_1"] == 33, f"got {row['lag_1']}")

# a holiday in between behaves the same way: it is simply not an open day
row = build_feature_row(1, d(15), history, prev_open_date=sat6)
check("days_since_last_open = 9 after a longer closure",
      row["days_since_last_open"] == 9, f"got {row['days_since_last_open']}")

# 15 days, like the Sep 14-26 closure
row = build_feature_row(1, d(21), history, prev_open_date=d(6))
check("days_since_last_open = 15 after a two-week closure",
      row["days_since_last_open"] == 15, f"got {row['days_since_last_open']}")

# ordinary consecutive day
row = build_feature_row(1, d(3), history[:2], prev_open_date=tue2)
check("days_since_last_open = 1 on an ordinary next open day",
      row["days_since_last_open"] == 1, f"got {row['days_since_last_open']}")

# ---------------------------------------------------------------
# 11. First occurrence of a weekday -> missing, not zero
# ---------------------------------------------------------------
row = build_feature_row(1, tue2, [history[0]], prev_open_date=mon1)
check("same_dow_last_open is NaN the first time a weekday appears",
      row["same_dow_last_open"] != row["same_dow_last_open"],
      f"got {row['same_dow_last_open']}")
check("NaN, not 0 — a missing value must not read as 'sold nothing'",
      row["same_dow_last_open"] is not None and not isinstance(row["same_dow_last_open"], int))

row = build_feature_row(1, mon1, [], prev_open_date=None)
check("empty history gives NaN lag_1", row["lag_1"] != row["lag_1"])
check("no previous open day gives NaN days_since_last_open",
      row["days_since_last_open"] != row["days_since_last_open"])
check("rolling_7 is NaN below 7 observations", row["rolling_7"] != row["rolling_7"])

# ---------------------------------------------------------------
# 12. rolling windows run over the zero-filled series
# ---------------------------------------------------------------
filled = [{"sale_date": d(i), "quantity_sold": (7 if i == 1 else 0), "is_real": i == 1}
          for i in range(1, 8)]
row = build_feature_row(1, d(8), filled, prev_open_date=d(7))
check("rolling_7 averages the zero-filled window (7/7 = 1.0)",
      abs(row["rolling_7"] - 1.0) < 1e-9, f"got {row['rolling_7']}")

print()
if _failures:
    print(f"FAILED: {len(_failures)} check(s): {_failures}")
    sys.exit(1)
print("All zero-fill and feature checks passed.")
