"""
Runs the shared recipe-unit cases (tests/fixtures/recipe_unit_cases.json)
against services/data_loader.py. The same file is checked by the backend
(backend/tests/recipeUnits.test.js) and the frontend
(backend/tests/recipeUnits.crosscheck.test.mjs), so the three copies of the
conversion rules cannot drift apart.

Why it matters: ml-service books the stored forecast COGS and ingredient
demand. If it converted "1 kg" or a unit added in Settings differently from
the backend, the dashboard and the forecast would disagree.

Also checks load_unit_metadata(): it must pick up database units, and if the
table can't be read it must keep working on the built-in tables instead of
failing a forecast run.

Run from ml-service/:  python tests/test_recipe_units.py
No network, no Supabase.
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ML_SERVICE_DIR = os.path.dirname(HERE)
if ML_SERVICE_DIR not in sys.path:
    sys.path.insert(0, ML_SERVICE_DIR)

# config.py needs these to import; nothing here ever makes a network call.
os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault(
    "SUPABASE_SERVICE_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoidGVzdCJ9.not-a-real-signature",
)

import services.data_loader as dl  # noqa: E402

with open(os.path.join(HERE, "fixtures", "recipe_unit_cases.json"), encoding="utf-8") as fh:
    FIXTURE = json.load(fh)

failures = []


def check(label, condition, detail=""):
    if condition:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label}  {detail}")
        failures.append(label)


def run(cases):
    for c in cases:
        got = dl._normalize_recipe_quantity(
            c["quantity"], c["from"], c["to"], c.get("gramsPerCup"), c.get("ingredient", "")
        )
        check(c["label"], math.isclose(got, c["expected"], abs_tol=1e-9), f"expected {c['expected']}, got {got}")


print("with database units")
dl.set_unit_metadata(FIXTURE["units"])
run(FIXTURE["cases"])

print("built-in tables only (no database units)")
dl.set_unit_metadata([])
run(FIXTURE["fallback_cases"])

print("bad rows never turn a known unit into a plain count")
dl.set_unit_metadata([{"name": "Kilograms (kg)", "family": None, "base_factor": None, "aliases": [], "is_active": True}])
check("kg still converts to g", dl._normalize_recipe_quantity(1, "kg", "g") == 1000)
dl.set_unit_metadata([{"name": "Sack", "family": "mass", "base_factor": 50000, "aliases": [], "is_active": False}])
check("an inactive Sack is unknown, so it passes through", dl._normalize_recipe_quantity(2, "Sack", "kg") == 2)


# ---- load_unit_metadata against a fake client -----------------------------
class _Result:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, rows, error):
        self._rows, self._error = rows, error

    def select(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def execute(self):
        if self._error:
            raise self._error
        return _Result(self._rows)


class _FakeClient:
    def __init__(self, rows=None, error=None):
        self._rows, self._error = rows, error

    def table(self, name):
        assert name == "ingredient_units", name
        return _FakeQuery(self._rows, self._error)


print("load_unit_metadata")
real_client = dl.supabase
try:
    dl.set_unit_metadata([])
    dl.supabase = _FakeClient(rows=FIXTURE["units"])
    check("returns True when the table is read", dl.load_unit_metadata() is True)
    check("a unit added in Settings now converts (2 Sack -> 100 kg)", dl._normalize_recipe_quantity(2, "Sack", "kg") == 100)

    dl.supabase = _FakeClient(error=RuntimeError("relation does not exist"))
    check("returns False when the table can't be read", dl.load_unit_metadata() is False)
    check("keeps the last good units after a failed read", dl._normalize_recipe_quantity(2, "Sack", "kg") == 100)
    check("built-in units still convert", dl._normalize_recipe_quantity(1, "kg", "g") == 1000)
finally:
    dl.supabase = real_client
    dl.set_unit_metadata([])

if failures:
    print(f"\n{len(failures)} check(s) FAILED")
    sys.exit(1)
print("\nAll recipe unit checks passed")
