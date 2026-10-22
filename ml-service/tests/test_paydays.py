"""
test_paydays.py — the payday rule (utils/paydays.py), owner-approved Oct 17 2026.

    1. Paydays are the 15th and the 30th of every month.
    2. A 31-day month still uses the 30th. February uses its last day.
    3. Saturday -> the Friday before. Sunday -> the Monday after.

Every expected date below was checked against a calendar by hand.
Run from ml-service/:  python tests/test_paydays.py
"""
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.paydays import is_payday, actual_paydays  # noqa: E402

failures = []


def check(label, condition, detail=""):
    print(f"  {'PASS' if condition else 'FAIL'}  {label}" + (f"  {detail}" if detail and not condition else ""))
    if not condition:
        failures.append(label)


print("test_paydays.py")

# (date, expected is_payday, why)
CASES = [
    (date(2026, 10, 15), 1, "Thu Oct 15 — a normal 15th"),
    (date(2026, 10, 30), 1, "Fri Oct 30 — a normal 30th"),
    (date(2026, 10, 31), 0, "Sat Oct 31 — 31-day month keeps the 30th, so the 31st is NOT a payday"),
    (date(2026, 3, 30), 1, "Mon Mar 30 — 31-day month, payday stays on the 30th"),
    (date(2026, 3, 31), 0, "Tue Mar 31 — not a payday"),
    # February: last day of the month
    (date(2026, 2, 28), 0, "Sat Feb 28, 2026 — moves to Friday"),
    (date(2026, 2, 27), 1, "Fri Feb 27, 2026 — the Saturday payday moved here"),
    (date(2028, 2, 29), 1, "Tue Feb 29, 2028 — leap year, last day of February"),
    (date(2028, 2, 28), 0, "Mon Feb 28, 2028 — not the last day in a leap year"),
    (date(2027, 2, 28), 1, "Sun Feb 28, 2027 is moved... see next case"),
    # Saturday -> Friday
    (date(2026, 8, 15), 0, "Sat Aug 15 — moves to Friday"),
    (date(2026, 8, 14), 1, "Fri Aug 14 — the Saturday payday moved here"),
    (date(2026, 5, 30), 0, "Sat May 30 — moves to Friday"),
    (date(2026, 5, 29), 1, "Fri May 29 — the Saturday payday moved here"),
    # Sunday -> Monday
    (date(2026, 11, 15), 0, "Sun Nov 15 — moves to Monday"),
    (date(2026, 11, 16), 1, "Mon Nov 16 — the Sunday payday moved here"),
    (date(2026, 8, 30), 0, "Sun Aug 30 — moves to Monday"),
    (date(2026, 8, 31), 1, "Mon Aug 31 — the Sunday payday moved here (still August)"),
    # Sunday -> Monday across a month boundary
    (date(2025, 11, 30), 0, "Sun Nov 30, 2025 — moves to Monday"),
    (date(2025, 12, 1), 1, "Mon Dec 1, 2025 — November's payday lands in December"),
    (date(2026, 1, 1), 0, "Thu Jan 1 — an ordinary day"),
]

# Feb 28, 2027 is a Sunday, so it moves to Monday Mar 1, 2027.
CASES = [c for c in CASES if c[0] != date(2027, 2, 28)] + [
    (date(2027, 2, 28), 0, "Sun Feb 28, 2027 — moves to Monday"),
    (date(2027, 3, 1), 1, "Mon Mar 1, 2027 — February's payday lands in March"),
]

for d, expected, why in CASES:
    got = is_payday(d)
    check(f"{d.isoformat()} ({d:%a}) -> {expected}: {why}", got == expected, f"got {got}")

# Every month of two full years has exactly two paydays, none on a weekend.
for year in (2025, 2026, 2027, 2028):
    for month in range(1, 13):
        days = actual_paydays(year, month)
        check(f"{year}-{month:02d}: two paydays, both weekdays", len(days) == 2 and all(d.weekday() < 5 for d in days),
              f"got {days}")

print()
if failures:
    print(f"FAILED: {len(failures)} check(s)")
    sys.exit(1)
print("All payday checks passed.")
