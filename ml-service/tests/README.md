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
python tests/test_zero_fill.py          # zero-fill rule + the two new features
python tests/test_feature_parity.py     # training vs forecast feature parity
python tests/test_forecast_guard.py     # /forecast feature-set guard (real Flask route)
python tests/test_modifier_demand.py    # POS modifier share in ingredient demand
python tests/test_report_saved_categories.py  # report scores with the saved category list
```

None of these touch Supabase or the network. `test_paging.py` and
`test_model_metadata.py` use a fake client; `test_category_order.py` trains a
tiny in-memory model and never writes to storage.

The matching JS tests live in `backend/tests/`
(`cd backend && node tests/fetchAllRows.test.js && node tests/historyGate.test.js && node tests/recipeUnits.test.js && node tests/recipeUnits.crosscheck.test.mjs && node tests/unitsController.test.js && node tests/accuracy.test.js && node tests/productSalesSummary.test.js && node tests/salesModifiers.test.js`).
`salesModifiers.test.js` covers POS modifiers (`backend/utils/salesModifiers.js`): "Marinated Porksilog NO EGG" parsed as the base dish (trailing whole words only, never mid-name), modifier plates counted in the dish total and stored per keyword, and stock deduction (10 plain + 3 NO EGG + 2 NO RICE -> egg 12, rice 13).
`productSalesSummary.test.js` covers `backend/utils/productSalesSummary.js` (the first/last-sale lookup behind product status): that it takes ~2 requests instead of a whole-table scan, that the not-yet-migrated fallback returns the SAME answer as the view, and that it only falls back when the view is genuinely missing, never on a real error.
`accuracy.test.js` covers the WMAPE accuracy rule and the "Data Needs Attention" decision in `backend/utils/accuracy.js` — in particular that a model with no recorded baseline reads as *unknown*, never as *bad*.

## What each one guards

| File | Guards against |
|---|---|
| `test_paging.py` | Supabase's 1,000-row cap silently truncating a query. Proves `_fetch_all_rows` reads everything, stops on an **empty** page (not a short one), and still works if Max rows is lowered to 500. |
| `test_model_metadata.py` | `load_model_metadata()` swallowing a real error and returning `None`, which would send `/forecast` down the legacy category-guessing path. A missing sidecar must return `None`; anything else must raise. |
| `test_category_order.py` | The product-order bug. Proves on the installed XGBoost that a reordered category list hands one product another product's prediction — this is why the model's exact category list is saved in `{version}_meta.json`. |
| `test_history_gate.py` | The first-use 12-month rule drifting between the dashboard (JS) and `/train` (Python). Runs the shared cases in `fixtures/history_gate_cases.json`, proves today's date has no effect, then runs `backend/utils/historyGate.js` on the same cases and compares every field. |
| `test_zero_fill.py` | The zero-fill rule going wrong in either direction — filling a closed or unconfirmed day (which would recreate "closed day read as zero demand"), filling before a product's first sale, filling across an off-menu gap, or filling an archived product. Also covers `same_dow_last_open` across a closed Sunday and `days_since_last_open` = 1 / 2 / 15. |
| `test_feature_parity.py` | Training/serving skew. Proves the training path and the forecast path produce identical feature rows from the same history, so nobody can "optimise" one side back into a separate implementation. Also covers eligibility counting REAL observations only, and the WMAPE maths. |
| `test_forecast_guard.py` | `/forecast` predicting with a model trained on a different feature set. Drives the real Flask route and proves it refuses an 11-feature model, a model with no metadata sidecar, and the same 12 columns in a different ORDER — without ever calling `predict()`. |
| `test_modifier_demand.py` | Ingredient demand ignoring POS modifiers, or applying them wrongly. Worked example: forecast 20, NO EGG share 20%, NO RICE 13.3% -> egg 16, rice 17.33 before the buffer, buffer applied after; a dish without the modifier keeps its full recipe; no rules (migration 010 not run) -> the old formula. |
| `test_report_saved_categories.py` | The training report scoring a saved model with today's product order. Shuffles the category list and proves the raw model swaps products while the report's `SavedModel` wrapper does not; also refuses a model with no `_meta.json`, a different feature list or order, and an unknown product. |
| `test_recipe_units.py` | The three copies of the recipe unit-conversion rules (backend, frontend, ml-service) drifting apart, so the screen shows one cost and the system books another. All three run the same hand-computed cases in `fixtures/recipe_unit_cases.json` (database units, and built-in-tables-only). Also checks `load_unit_metadata()` picks up units added in Settings and survives an unreadable table. |

`backend/tests/historyGate.test.js` covers the JS side of the same rule plus the real `/api/business-days` endpoints (rejects sales/future/out-of-span/malformed dates, all-or-nothing, idempotent repeat calls, audit entry, late upload reopening a closed date). It mounts the real router with an in-memory fake database — no Supabase writes.

The upload screen's state helpers have their own plain-Node test at `frontend/tests/uploadRunState.test.mjs` (`cd frontend && node tests/uploadRunState.test.mjs`). It reproduces the "screen rebuilt mid-upload" bug ("Uploading 0 at once — 0/288 done") against the real module with a fake sessionStorage.
