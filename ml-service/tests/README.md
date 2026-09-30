# ml-service tests

Plain-Python tests. No pytest, no extra dependencies — each file runs on its own
and prints PASS/FAIL per check, exiting non-zero on the first failure.

Run them all from the `ml-service/` directory:

```
cd ml-service
python tests/test_paging.py
python tests/test_model_metadata.py
python tests/test_category_order.py     # needs xgboost + pandas installed
python tests/test_history_gate.py       # also runs the JS version via node
python tests/test_recipe_units.py       # shared unit-conversion cases
```

None of these touch Supabase or the network. `test_paging.py` and
`test_model_metadata.py` use a fake client; `test_category_order.py` trains a
tiny in-memory model and never writes to storage.

The matching JS tests live in `backend/tests/`
(`cd backend && node tests/fetchAllRows.test.js && node tests/historyGate.test.js && node tests/recipeUnits.test.js && node tests/recipeUnits.crosscheck.test.mjs && node tests/unitsController.test.js`).

## What each one guards

| File | Guards against |
|---|---|
| `test_paging.py` | Supabase's 1,000-row cap silently truncating a query. Proves `_fetch_all_rows` reads everything, stops on an **empty** page (not a short one), and still works if Max rows is lowered to 500. |
| `test_model_metadata.py` | `load_model_metadata()` swallowing a real error and returning `None`, which would send `/forecast` down the legacy category-guessing path. A missing sidecar must return `None`; anything else must raise. |
| `test_category_order.py` | The product-order bug. Proves on the installed XGBoost that a reordered category list hands one product another product's prediction — this is why the model's exact category list is saved in `{version}_meta.json`. |
| `test_history_gate.py` | The first-use 12-month rule drifting between the dashboard (JS) and `/train` (Python). Runs the shared cases in `fixtures/history_gate_cases.json`, proves today's date has no effect, then runs `backend/utils/historyGate.js` on the same cases and compares every field. |
| `test_recipe_units.py` | The three copies of the recipe unit-conversion rules (backend, frontend, ml-service) drifting apart, so the screen shows one cost and the system books another. All three run the same hand-computed cases in `fixtures/recipe_unit_cases.json` (database units, and built-in-tables-only). Also checks `load_unit_metadata()` picks up units added in Settings and survives an unreadable table. |

`backend/tests/historyGate.test.js` covers the JS side of the same rule plus the real `/api/business-days` endpoints (rejects sales/future/out-of-span/malformed dates, all-or-nothing, idempotent repeat calls, audit entry, late upload reopening a closed date). It mounts the real router with an in-memory fake database — no Supabase writes.
