"""
Business dates are Asia/Manila dates, not the container's UTC date.

Before: date.today() on a UTC container, so a manual forecast between 00:00
and 07:59 Manila time started from YESTERDAY. utils.dates.manila_today()
uses a fixed UTC+8 offset (no daylight saving in the Philippines, no tzdata
needed).

Run:  cd ml-service && python tests/test_manila_today.py
No network, no Supabase.
"""
import os
import re
import sys
from datetime import date, datetime, timedelta, timezone

ML_SERVICE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ML_SERVICE_DIR not in sys.path:
    sys.path.insert(0, ML_SERVICE_DIR)

from utils.dates import manila_today, MANILA_TZ  # noqa: E402

_failures = []


def check(label, condition, detail=""):
    if condition:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label}  {detail}")
        _failures.append(label)


UTC = timezone.utc

# --- F3: 2026-10-13 01:30 Manila (= 2026-10-12 17:30 UTC) is the 13th ---
manila_0130 = datetime(2026, 10, 13, 1, 30, tzinfo=MANILA_TZ)
utc_1730 = datetime(2026, 10, 12, 17, 30, tzinfo=UTC)
check("same instant: 01:30 UTC+8 == 17:30 UTC the day before", manila_0130 == utc_1730)
check("01:30 Manila -> 2026-10-13", manila_today(manila_0130) == date(2026, 10, 13), str(manila_today(manila_0130)))
check("17:30 UTC -> 2026-10-13 (the UTC date would say the 12th)",
      manila_today(utc_1730) == date(2026, 10, 13), str(manila_today(utc_1730)))
check("a naive datetime is read as UTC (the container clock)",
      manila_today(datetime(2026, 10, 12, 17, 30)) == date(2026, 10, 13))

# --- the day turns over at 16:00 UTC = 00:00 Manila ---
check("15:59:59 UTC -> still the 12th", manila_today(datetime(2026, 10, 12, 15, 59, 59, tzinfo=UTC)) == date(2026, 10, 12))
check("16:00:00 UTC -> the 13th", manila_today(datetime(2026, 10, 12, 16, 0, 0, tzinfo=UTC)) == date(2026, 10, 13))
check("23:59 Manila -> same day", manila_today(datetime(2026, 10, 13, 23, 59, tzinfo=MANILA_TZ)) == date(2026, 10, 13))

# --- month and year ends; fixed offset, no daylight saving ---
check("Dec 31 16:30 UTC -> Jan 1", manila_today(datetime(2026, 12, 31, 16, 30, tzinfo=UTC)) == date(2027, 1, 1))
check("offset is exactly +08:00 in January and in July",
      MANILA_TZ.utcoffset(datetime(2026, 1, 15)) == timedelta(hours=8)
      and MANILA_TZ.utcoffset(datetime(2026, 7, 15)) == timedelta(hours=8))

# --- no argument -> now, in Manila ---
expected = (datetime.now(UTC) + timedelta(hours=8)).date()
got = manila_today()
check("no argument uses the current time", got in (expected, expected - timedelta(days=1), expected + timedelta(days=1)), str(got))

# --- guard: no business-date code still calls date.today() ---
pattern = re.compile(r"\bdate\.today\(\)")
offenders = []
for folder in ("services", "utils"):
    for name in os.listdir(os.path.join(ML_SERVICE_DIR, folder)):
        # utils/dates.py is the helper itself; it only mentions date.today()
        # in its docstring, to explain what it replaces.
        if name.endswith(".py") and not (folder == "utils" and name == "dates.py"):
            path = os.path.join(ML_SERVICE_DIR, folder, name)
            with open(path, encoding="utf-8") as f:
                if pattern.search(f.read()):
                    offenders.append(f"{folder}/{name}")
with open(os.path.join(ML_SERVICE_DIR, "app.py"), encoding="utf-8") as f:
    if pattern.search(f.read()):
        offenders.append("app.py")
check("no date.today() left in app.py, services/ or utils/", offenders == [], str(offenders))

print()
if _failures:
    print(f"FAILED: {len(_failures)} check(s): {_failures}")
    sys.exit(1)
print("All Manila-date checks passed.")
