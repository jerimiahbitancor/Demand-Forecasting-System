"""
Tests load_model_metadata()'s error handling with a FAKE storage client.

Why this matters: returning None means "legacy model, no sidecar", and
/forecast then GUESSES the category list by sorting today's active product
IDs. That guess can hand one product another product's forecast (proved in
test_category_order.py). So None must mean "the file genuinely isn't there"
and nothing else — a network blip or an auth error has to raise.

Run:  cd ml-service && python tests/test_model_metadata.py
"""
import json
import os
import sys

ML_SERVICE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ML_SERVICE_DIR not in sys.path:
    sys.path.insert(0, ML_SERVICE_DIR)

os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault(
    "SUPABASE_SERVICE_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoidGVzdCJ9.not-a-real-signature",
)

from storage3.utils import StorageException  # noqa: E402
import services.model_storage as ms  # noqa: E402

_failures = []


def check(label, condition, detail=""):
    if condition:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label}  {detail}")
        _failures.append(label)


class FakeBucket:
    def __init__(self, behaviour):
        self._behaviour = behaviour

    def download(self, name):
        if isinstance(self._behaviour, Exception):
            raise self._behaviour
        return self._behaviour


class FakeStorage:
    def __init__(self, behaviour):
        self._behaviour = behaviour

    def from_(self, bucket):
        return FakeBucket(self._behaviour)


class FakeSupabase:
    def __init__(self, behaviour):
        self.storage = FakeStorage(behaviour)


def with_behaviour(behaviour):
    ms.supabase = FakeSupabase(behaviour)


print("test_model_metadata.py")
original = ms.supabase
try:
    # --- 1. Missing sidecar (the real shape storage3 0.5.5 raises) ---
    # Note statusCode is 400, NOT 404 — matching on 404 would never fire.
    with_behaviour(StorageException(
        {"statusCode": 400, "error": "not_found",
         "message": "Object not found", "code": "NoSuchKey"}
    ))
    check("missing sidecar returns None", ms.load_model_metadata("model_v20260101_000000") is None)

    # --- 2. A real sidecar round-trips ---
    payload = {
        "product_categories": [10, 20, 30],
        "trained_product_ids": [10, 20],
        "feature_columns": ["product_id", "dow"],
        "train_end_date": "2026-07-09",
    }
    with_behaviour(json.dumps(payload).encode("utf-8"))
    got = ms.load_model_metadata("model_v20260101_000000")
    check("valid sidecar parses", got == payload, f"got {got}")
    check("category ORDER is preserved exactly", got["product_categories"] == [10, 20, 30])

    # --- 3. Transient/auth errors must RAISE, never silently return None ---
    for label, exc in [
        ("network error", ConnectionError("connection reset")),
        ("auth error", StorageException({"statusCode": 403, "error": "Unauthorized",
                                         "message": "invalid token"})),
        ("server error", StorageException({"statusCode": 500, "error": "InternalError",
                                           "message": "boom"})),
    ]:
        with_behaviour(exc)
        try:
            ms.load_model_metadata("model_v20260101_000000")
            check(f"{label} raises (not None)", False, "returned instead of raising")
        except Exception as raised:
            check(f"{label} raises (not None)", not isinstance(raised, AssertionError),
                  f"{type(raised).__name__}")

    # --- 4. Corrupt JSON must raise, not be treated as "no sidecar" ---
    with_behaviour(b"{not valid json")
    try:
        ms.load_model_metadata("model_v20260101_000000")
        check("corrupt JSON raises", False, "returned instead of raising")
    except ValueError:
        check("corrupt JSON raises", True)

    # --- 5. The sidecar must never be mistaken for a model version ---
    check("sidecar name rejected by model regex",
          ms._MODEL_FILE_RE.match("model_v20260918_140545_meta.json") is None)
    check("real model name accepted by model regex",
          ms._MODEL_FILE_RE.match("model_v20260918_140545.json") is not None)
finally:
    ms.supabase = original

print()
if _failures:
    print(f"FAILED: {len(_failures)} check(s): {_failures}")
    sys.exit(1)
print("All metadata checks passed.")
