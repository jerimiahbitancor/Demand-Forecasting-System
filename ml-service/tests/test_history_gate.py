"""
Tests the first-use history rule (services/history_gate.py) against the
cases shared with the backend, and checks that the backend's JS version
(backend/utils/historyGate.js) gives exactly the same answer on every case.

No network, no Supabase. The JS cross-check shells out to `node`; if node
isn't installed it's reported as SKIPPED, not passed.

Run from ml-service/:  python tests/test_history_gate.py
"""
import json
import os
import shutil
import subprocess
import sys
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
ML_SERVICE_DIR = os.path.dirname(HERE)
REPO_DIR = os.path.dirname(ML_SERVICE_DIR)
sys.path.insert(0, ML_SERVICE_DIR)

import services.history_gate as history_gate  # noqa: E402
from services.history_gate import evaluate_history_gate, describe_failure  # noqa: E402

with open(os.path.join(HERE, "fixtures", "history_gate_cases.json"), encoding="utf-8") as fh:
    CASES = json.load(fh)["cases"]

failures = []


def check(label, condition, detail=""):
    if condition:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label}  {detail}")
        failures.append(label)


# Must match expandCase() in backend/tests/historyGate.test.js exactly.
def _range(pair):
    start, end = date.fromisoformat(pair[0]), date.fromisoformat(pair[1])
    out = []
    while start <= end:
        out.append(start.isoformat())
        start += timedelta(days=1)
    return out


def _is_sunday(s):
    return date.fromisoformat(s).weekday() == 6  # Python: Monday=0 ... Sunday=6


def expand_case(case):
    sales = set()
    for r in case.get("sales_ranges", []):
        sales.update(_range(r))
    sales.update(case.get("sales_dates", []))
    for d in case.get("sales_exclude", []):
        sales.discard(d)
    for r in case.get("sales_exclude_ranges", []):
        for d in _range(r):
            sales.discard(d)
    if case.get("sales_exclude_sundays"):
        sales = {d for d in sales if not _is_sunday(d)}

    closed = set(case.get("closed_dates", []))
    for r in case.get("closed_ranges", []):
        closed.update(_range(r))
    if case.get("closed_sundays_in"):
        closed.update(d for d in _range(case["closed_sundays_in"]) if _is_sunday(d))
    return list(sales), list(closed)


def run(case):
    sale_dates, closed_dates = expand_case(case)
    return evaluate_history_gate(sale_dates, closed_dates)


print("test_history_gate.py")

# --- 1. The rule, against the shared cases ---
print("\n[rule] shared cases (also run by the JS test)")
python_results = {}
for case in CASES:
    got = run(case)
    python_results[case["name"]] = got
    for key, want in case["expect"].items():
        check(f"{case['name']}: {key} = {json.dumps(want)}", got[key] == want, f"got {got[key]!r}")

# --- 2. Today's date has no effect ---
print("\n[rule] today has no effect")
base = next(c for c in CASES if c["name"] == "span_364_fails")
before = run(base)


class FarFutureDate(date):
    @classmethod
    def today(cls):
        return cls(2099, 12, 31)


real_date = history_gate.date
history_gate.date = FarFutureDate
try:
    after = run(base)
finally:
    history_gate.date = real_date
check("span_364 still fails with today() set to 2099", before == after)

# --- 3. /train's failure message names the real blocker ---
print("\n[message] describe_failure")
msg = describe_failure(python_results["sundays_not_marked_closed_fail"])
check("unconfirmed failure mentions the 52 dates", "52 date(s)" in msg, msg)
msg = describe_failure(python_results["span_364_fails"])
check("span failure mentions 364 days", "364 days" in msg, msg)
check("no-data failure is plain", describe_failure(python_results["no_sales_at_all"]) == "no sales data uploaded yet")

# --- 4. Cross-check: the JS version gives the same answer on every case ---
print("\n[cross-check] backend/utils/historyGate.js vs services/history_gate.py")
node = shutil.which("node")
if not node:
    print("  SKIPPED  node is not installed — the JS/Python cross-check did not run")
else:
    proc = subprocess.run(
        [node, os.path.join("tests", "historyGate.test.js"), "--dump"],
        cwd=os.path.join(REPO_DIR, "backend"),
        capture_output=True, text=True, timeout=60,
    )
    # config/supabase.js may print setup lines before the JSON; take the last line.
    js_line = [ln for ln in proc.stdout.strip().splitlines() if ln.startswith("{")]
    check("node dump ran", proc.returncode == 0 and js_line, proc.stderr[-500:])
    if js_line:
        js_results = json.loads(js_line[-1])
        fields = ["passes", "insufficient_reason", "first_sale_date", "last_sale_date",
                  "span_days", "open_days", "closed_days", "unconfirmed_days", "unconfirmed_dates"]
        for case in CASES:
            name = case["name"]
            py, js = python_results[name], js_results.get(name, {})
            diffs = [f for f in fields if py.get(f) != js.get(f)]
            check(f"{name}: JS == Python on all {len(fields)} fields", not diffs,
                  f"differs on {diffs}")

print(f"\n{len(failures)} check(s) FAILED" if failures else "\nAll history-gate checks passed.")
sys.exit(1 if failures else 0)
