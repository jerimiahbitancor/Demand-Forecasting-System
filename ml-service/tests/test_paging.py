"""
Tests _fetch_all_rows against a FAKE Supabase client that enforces a row
cap, the way the real project does (Max rows = 1,000, kept on purpose).

Run:  cd ml-service && python tests/test_paging.py

No network, no Supabase, no credentials needed beyond importing config.
"""
import os
import sys

ML_SERVICE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ML_SERVICE_DIR not in sys.path:
    sys.path.insert(0, ML_SERVICE_DIR)

# config.py refuses to import without these, and supabase's create_client
# rejects a key that isn't JWT-shaped (three dot-separated segments), so the
# placeholder below has to look like one. No network call is ever made from
# this file — the client object is built and never used. Set before import
# because load_dotenv() does not override variables that already exist, so
# this keeps the test identical with or without a real .env present.
os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault(
    "SUPABASE_SERVICE_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoidGVzdCJ9.not-a-real-signature",
)

from services.data_loader import _fetch_all_rows  # noqa: E402

_failures = []


def check(label, condition, detail=""):
    if condition:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label}  {detail}")
        _failures.append(label)


class FakeResponse:
    def __init__(self, data):
        self.data = data


class FakeQuery:
    """Mimics the bits of a supabase-py query that _fetch_all_rows uses."""

    def __init__(self, rows, max_rows):
        self._rows = rows
        self._max_rows = max_rows
        self._start = 0
        self._end = None
        self.request_count_sink = None

    def range(self, start, end):
        self._start, self._end = start, end
        return self

    def execute(self):
        if self.request_count_sink is not None:
            self.request_count_sink.append((self._start, self._end))
        # PostgREST returns at most max_rows, even if a wider range is asked
        # for. A range past the end returns an empty list, never an error.
        window = self._rows[self._start:self._end + 1]
        return FakeResponse(window[:self._max_rows])


def make_builder(rows, max_rows, calls):
    def build():
        q = FakeQuery(rows, max_rows)
        q.request_count_sink = calls
        return q
    return build


print("test_paging.py")

# --- 1. More rows than the cap: everything must come back, in order ---
rows = [{"i": i} for i in range(2500)]
calls = []
got = _fetch_all_rows(make_builder(rows, 1000, calls))
check("2500 rows with a 1000 cap returns all 2500", len(got) == 2500, f"got {len(got)}")
check("order preserved, no duplicates", [r["i"] for r in got] == list(range(2500)))
check("took 3 full pages + 1 empty page = 4 requests", len(calls) == 4, f"got {len(calls)}: {calls}")

# --- 2. Exactly one full page: must still make a second request ---
# This is the case a "stop on short page" loop gets right by luck and a
# "stop on empty page" loop gets right by design.
calls = []
got = _fetch_all_rows(make_builder([{"i": i} for i in range(1000)], 1000, calls))
check("exactly 1000 rows returns 1000", len(got) == 1000, f"got {len(got)}")
check("exactly 1000 rows needs 2 requests (2nd is empty)", len(calls) == 2, f"got {len(calls)}")

# --- 3. Cap LOWERED to 500: the reason we stop on empty, not short ---
# A short-page loop would stop after the first 500 and lose 2,000 rows.
calls = []
got = _fetch_all_rows(make_builder(rows, 500, calls))
check("2500 rows still all read when cap is 500", len(got) == 2500, f"got {len(got)}")
check("no duplicates with the lower cap", len({r["i"] for r in got}) == 2500)

# --- 4. Empty table ---
calls = []
got = _fetch_all_rows(make_builder([], 1000, calls))
check("empty table returns []", got == [])
check("empty table makes exactly 1 request", len(calls) == 1, f"got {len(calls)}")

# --- 5. Fewer rows than one page ---
got = _fetch_all_rows(make_builder([{"i": 1}, {"i": 2}], 1000, []))
check("short table returns all rows", len(got) == 2, f"got {len(got)}")

print()
if _failures:
    print(f"FAILED: {len(_failures)} check(s): {_failures}")
    sys.exit(1)
print("All paging checks passed.")
