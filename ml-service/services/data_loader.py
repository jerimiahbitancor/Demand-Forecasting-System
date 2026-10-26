"""
All reads from Supabase live here, and only here.

Keeping every SELECT in one module means: if a table or column name
changes, you fix it in exactly one place. It also enforces the
separation we agreed on — this service only ever reads products,
daily_sales, product_ingredients/ingredients, and forecast_config.
It never writes to any of them (see supabase_writer.py for the tables
this service IS allowed to write to).
"""
import math
import re
import json
from datetime import date
from pathlib import Path
import pandas as pd
from config import supabase

# Unit conversion for recipe quantities uses the shared JSON table.
# A product's recipe can use a different unit than the ingredient's stock
# unit; every quantity is normalised to the ingredient's unit before use.
#
_UNIT_DATA_PATH = Path(__file__).resolve().parents[2] / "shared" / "ingredientUnits.json"
with _UNIT_DATA_PATH.open(encoding="utf-8") as unit_file:
    _UNIT_DATA = json.load(unit_file)

_UNIT_BY_ALIAS = {}
for _definition in _UNIT_DATA["units"]:
    for _key in [_definition["name"], *_definition["aliases"]]:
        _UNIT_BY_ALIAS[str(_key).strip().lower()] = _definition

_RECIPE_UNIT_BASE_FACTOR = {
    key: (None if unit["family"] == "count" else float(unit["baseFactor"]))
    for key, unit in _UNIT_BY_ALIAS.items()
}
_MASS_UNITS = {key for key, unit in _UNIT_BY_ALIAS.items() if unit["family"] == "mass"}
_VOLUME_UNITS = {key for key, unit in _UNIT_BY_ALIAS.items() if unit["family"] == "volume"}
_COUNT_UNITS = {key for key, unit in _UNIT_BY_ALIAS.items() if unit["family"] == "count"}
# Lowercased supported unit names and aliases loaded from the shared definition.
_UNIT_METADATA = {}


def set_unit_metadata(rows):
    """Refresh supported unit aliases without allowing database factors to drift."""
    _UNIT_METADATA.clear()
    for row in rows or []:
        if row.get("is_active") is False:
            continue
        name = str(row.get("name") or "").strip()
        definition = _UNIT_BY_ALIAS.get(name.lower())
        if not name or not definition:
            continue
        for key in [definition["name"], *definition["aliases"]]:
            clean = str(key or "").strip().lower()
            if clean:
                _UNIT_METADATA[clean] = definition


def load_unit_metadata():
    """Read ingredient_units and refresh the unit map. If the table or its
    conversion columns can't be read, the map is left as it was (static tables
    still work) instead of failing a forecast run over a lookup."""
    try:
        response = (
            supabase.table("ingredient_units")
            .select("name, family, base_factor, is_piece, piece_weight_grams, aliases, is_active")
            .eq("is_active", True)
            .execute()
        )
    except Exception as exc:
        print(f"WARNING: could not load ingredient_units, using built-in unit tables: {exc}")
        return False
    set_unit_metadata(response.data or [])
    return True


def _unit_kind(unit):
    """'mass' | 'volume' | 'count' | None (unknown)."""
    key = (unit or "").strip().lower()
    definition = _UNIT_BY_ALIAS.get(key)
    return definition["family"] if definition else None


def _unit_factor(unit):
    """Grams (mass) or mL (volume) in one `unit`; None for counts / unknown."""
    key = (unit or "").strip().lower()
    return _RECIPE_UNIT_BASE_FACTOR.get(key)


def _parse_recipe_quantity(value):
    """Parse a recipe-style quantity into a float: "1/2" -> 0.5,
    "1 1/2" -> 1.5, "0.75" -> 0.75. quantity_per_serving is a free-text
    column, so stored values may be fractions, mixed numbers, or decimals.
    Returns NaN for unparseable input."""
    if value is None:
        return float("nan")
    text = str(value).strip()
    if not text:
        return float("nan")

    mixed = re.match(r"^(-?\d+(?:\.\d+)?)\s+([+-]?\d+)\s*/\s*(\d+)$", text)
    if mixed:
        den = int(mixed.group(3))
        if den == 0:
            return float("nan")
        return float(mixed.group(1)) + int(mixed.group(2)) / den

    fraction = re.match(r"^(-?\d+)\s*/\s*(\d+)$", text)
    if fraction:
        den = int(fraction.group(2))
        if den == 0:
            return float("nan")
        return int(fraction.group(1)) / den

    try:
        return float(text)
    except ValueError:
        return float("nan")


def _normalize_recipe_quantity(quantity, from_unit, to_unit, material_type="dry"):
    """Convert a recipe quantity into the ingredient's stock unit.

    material_type ('wet' | 'dry') is accepted to match the backend's
    convertRecipeQuantity(quantity, fromUnit, toUnit, { materialType }).
    Like the backend's unitService.resolve, it does NOT change the result:
    only same-family conversions (mass<->mass, volume<->volume) and identical
    count units are allowed; mass<->volume is rejected. Keep the two in sync —
    tests/fixtures/recipe_unit_cases.json is the shared contract.
    """
    del material_type  # accepted for call-site parity; see docstring
    qty = _parse_recipe_quantity(quantity)
    if not math.isfinite(qty):
        return 0.0
    from_key = str(from_unit or "").strip().lower()
    to_key = str(to_unit or "").strip().lower()
    if from_key not in _UNIT_BY_ALIAS or to_key not in _UNIT_BY_ALIAS:
        raise ValueError(f"Unsupported ingredient unit: {from_unit!r} -> {to_unit!r}")
    from_kind = _unit_kind(from_unit)
    to_kind = _unit_kind(to_unit)
    from_factor = _unit_factor(from_unit)
    to_factor = _unit_factor(to_unit)

    if from_kind == to_kind == "count":
        return qty if qty > 0 else 0.0
    if from_kind == to_kind and from_kind in ("mass", "volume"):
        if qty <= 0:
            return 0.0
        return round((qty * from_factor) / to_factor, 4)
    raise ValueError(f"Unsupported ingredient unit conversion: {from_unit!r} -> {to_unit!r}")


def _fetch_all_rows(build_query) -> list:
    """
    PAGING: reads every matching row, one page at a time.

    Supabase returns at most 1,000 rows per request (the project's
    "Max rows" setting — kept on purpose as a safety limit). Without
    paging, a query for more rows than that silently returns only the
    first 1,000. This asks for rows 0-999, then 1000-1999, and so on,
    until a page comes back EMPTY.

    Stopping on an empty page (not on "page smaller than 1,000") keeps
    this correct even if someone later lowers Max rows to, say, 500:
    a 500-row page is then just the next page, not the last one.

    `build_query` must return a fresh, fully-ordered query each call
    (a stable ORDER BY is what keeps pages from overlapping).
    """
    page_size = 1000
    rows = []
    start = 0
    while True:
        batch = build_query().range(start, start + page_size - 1).execute().data or []
        if not batch:
            break
        rows.extend(batch)
        start += len(batch)
    return rows


def get_active_products():
    """
    Products whose STATUS is active — a pure activity/lifecycle check,
    with no data-sufficiency logic mixed in. Deliberately separate from
    get_training_eligible_products() below: "is this product active"
    and "does this product have enough observations to train on" are
    two different questions per the eligibility clarification, and
    conflating them was the bug in the previous version of this file.

    Reads the generated `is_active` column (kept for compatibility with
    the rest of the codebase), which is always in sync with the new
    `status` enum — see migrations/001_add_product_status.sql.
    """
    response = (
        supabase.table("products")
        .select("id, name, price, is_active, status, first_sold_date")
        .eq("is_active", True)
        .order("id")  # stable order; the DB gives no order guarantee otherwise
        .execute()
    )
    # Explicit columns so an empty result (zero active products) still
    # yields a DataFrame with an "id" column instead of one with no
    # columns at all — callers doing get_active_products()["id"] would
    # otherwise crash with an unhandled KeyError instead of just getting
    # an empty list of ids.
    columns = ["id", "name", "price", "is_active", "status", "first_sold_date"]
    return pd.DataFrame(response.data, columns=columns)


def get_training_eligible_products(min_observations: int) -> list:
    """
    Returns the list of product_ids with at least `min_observations`
    valid daily sales observations — per the corrected eligibility
    rule: this counts ACTUAL ROWS in daily_sales (each row already
    represents one aggregated, valid daily observation — see
    get_daily_sales' docstring on why closed/missing days never
    produce a row at all), never calendar days since first_sold_date.

    A product can satisfy this and still not be "active" (e.g. it's
    INACTIVE_DISCONTINUED but retains historical data), and a product
    can be "active" and still fail this (freshly added, real sales,
    just not 28 of them yet). Callers that need BOTH — active AND
    enough data — should intersect this function's result with
    get_active_products()'s ids, not rely on either alone.
    """
    active_ids = set(get_active_products()["id"].astype(int).tolist())
    if not active_ids:
        return []

    rows = _fetch_all_rows(
        lambda: supabase.table("daily_sales")
        .select("product_id, sale_date")
        .in_("product_id", list(active_ids))
        .order("product_id")
        .order("sale_date")
    )
    df = pd.DataFrame(rows)
    if df.empty:
        return []

    # Defensive dedup: count UNIQUE observation dates per product, not
    # raw row count — guards against any duplicate (product_id, date)
    # rows slipping through before clean_sales_data() has run on them.
    observation_counts = df.groupby("product_id")["sale_date"].nunique()
    eligible = observation_counts[observation_counts >= min_observations]
    return eligible.index.astype(int).tolist()


def get_daily_sales(product_id: int = None) -> pd.DataFrame:
    """
    Raw sales history. If product_id is given, filter to that product;
    otherwise return all products' history (used for bulk training runs).

    NOTE: this returns ONLY rows that exist in daily_sales — days the
    store was closed will simply be absent, not present with a 0.
    That absence is exactly what preprocessing.py expects and relies on.
    """
    def build_query():
        query = supabase.table("daily_sales").select(
            "product_id, sale_date, quantity_sold"
        )
        if product_id is not None:
            query = query.eq("product_id", product_id)
        # Two sort keys so every row has one fixed position. Paging needs
        # this: if the order could shift between pages, a row could be
        # skipped or read twice.
        return query.order("sale_date").order("product_id")

    df = pd.DataFrame(
        _fetch_all_rows(build_query),
        columns=["product_id", "sale_date", "quantity_sold"],
    )
    if not df.empty:
        df["sale_date"] = pd.to_datetime(df["sale_date"])
    return df


def get_confirmed_open_dates() -> list:
    """
    Every date the owner confirmed the store was OPEN, oldest first, as
    datetime.date objects.

    This is the calendar the zero-fill rule runs on: a date in this list
    with no daily_sales row for a product means that product sold 0 there
    (see services/zero_fill.py). Confirmed-CLOSED and UNCONFIRMED dates
    are deliberately absent, so they can never be filled.

    Paged — a full year of operation is ~336 rows today, but this table
    grows one row per day forever and the 1,000-row cap would start
    silently truncating the OLDEST history in under three years, which
    would quietly un-fill the earliest gaps.
    """
    rows = _fetch_all_rows(
        lambda: supabase.table("business_days")
        .select("business_date")
        .eq("status", "confirmed_open")
        .order("business_date")
    )
    dates = {r["business_date"] for r in rows if r.get("business_date")}
    return sorted(date.fromisoformat(d) if isinstance(d, str) else d for d in dates)


MODIFIER_SHARE_WINDOW_OPEN_DAYS = 28


def _is_missing_table_error(exc) -> bool:
    msg = str(exc).lower()
    return (
        "pgrst205" in msg
        or "42p01" in msg
        or "could not find the table" in msg
        or ("relation" in msg and "does not exist" in msg)
    )


def get_modifier_share_inputs(window_open_days: int = MODIFIER_SHARE_WINDOW_OPEN_DAYS,
                              open_dates=None) -> dict:
    """
    Raw inputs for the POS-modifier share used in ingredient demand
    (business_logic.compute_modifier_shares does the arithmetic).

    Window = the store's last `window_open_days` CONFIRMED-OPEN days.
    Returns {"sales": [...], "modifiers": [...], "rules": [...],
    "window_dates": [...]}; every list is empty when there is nothing to
    share out — no open days, or migration 010 not run yet (the tables are
    missing), in which case ingredient demand keeps using full recipes.

    Every read is paged (Max rows stays 1,000): 28 days x ~100 products is
    already ~2,800 daily_sales rows.

    `open_dates`: the sorted confirmed-open dates, when the caller already
    has them (/forecast loads them once per run); fetched here otherwise.
    """
    empty = {"sales": [], "modifiers": [], "rules": [], "window_dates": []}
    if open_dates is None:
        open_dates = get_confirmed_open_dates()
    window_dates = open_dates[-window_open_days:] if window_open_days > 0 else []
    if not window_dates:
        return empty
    start, end = window_dates[0].isoformat(), window_dates[-1].isoformat()

    try:
        rules = _fetch_all_rows(
            lambda: supabase.table("modifier_rules")
            .select("keyword, ingredient_id")
            .order("keyword")
        )
        modifiers = _fetch_all_rows(
            lambda: supabase.table("daily_sales_modifiers")
            .select("product_id, sale_date, keyword, quantity")
            .gte("sale_date", start)
            .lte("sale_date", end)
            .order("sale_date")
            .order("product_id")
            .order("keyword")
        )
    except Exception as exc:
        if _is_missing_table_error(exc):
            print("[MODIFIERS] modifier tables not found (migration 010 not run) "
                  "- ingredient demand uses full recipes.")
            return empty
        raise

    if not rules or not modifiers:
        return {**empty, "rules": rules, "window_dates": window_dates}

    sales = _fetch_all_rows(
        lambda: supabase.table("daily_sales")
        .select("product_id, sale_date, quantity_sold")
        .gte("sale_date", start)
        .lte("sale_date", end)
        .order("sale_date")
        .order("product_id")
    )
    return {"sales": sales, "modifiers": modifiers, "rules": rules, "window_dates": window_dates}


def get_recipe_and_stock() -> pd.DataFrame:
    """
    Recipe mapping joined to current inventory, for ingredient demand
    and COGS calculations.

    UPDATED: the schema was consolidated — inventory_items was merged
    into ingredients (quantity, category, min_stock, is_archived and
    the audit columns all moved there), and product_ingredients.
    ingredient_id / inventory_transactions.ingredient_id now both FK
    to ingredients directly. There is no separate inventory_items
    table anymore. This query was updated to match; if you see a
    "relation does not exist" error mentioning inventory_items
    anywhere else in this service, it's this same stale reference.
    """
    # Pick up units added / edited in Settings since the last run.
    load_unit_metadata()

    def _fetch(with_unit, with_material_type=True):
        ingredient_cols = (
            "id, name, unit, price, quantity, material_type"
            if with_material_type else
            "id, name, unit, price, quantity"
        )
        columns = (
            f"product_id, quantity_per_serving, unit, ingredients!inner({ingredient_cols})"
            if with_unit else
            f"product_id, quantity_per_serving, ingredients!inner({ingredient_cols})"
        )
        return supabase.table("product_ingredients").select(columns).execute()

    # A missing optional column falls back to the prior schema; other errors
    # are surfaced so forecast inputs cannot silently become incomplete.
    response = None
    recipe_unit_from_row = True
    last_error = None
    has_material_type = True
    for with_unit, with_material in ((True, True), (True, False), (False, True), (False, False)):
        try:
            response = _fetch(with_unit, with_material)
        except Exception as exc:  # noqa: BLE001 - inspected below
            last_error = exc
            msg = str(exc).lower()
            # Postgres 42703 (".* does not exist") and PostgREST PGRST204
            # ("Could not find the 'x' column ... in the schema cache") both
            # mean that column is absent.
            if (
                "does not exist" in msg
                or "could not find the" in msg
                or "schema cache" in msg
            ):
                continue
            raise
        recipe_unit_from_row = with_unit
        has_material_type = with_material
        break
    if response is None:
        raise last_error if last_error else RuntimeError(
            "Could not read product_ingredients"
        )

    rows = []
    for r in response.data:
        item = r["ingredients"]
        recipe_unit = r.get("unit") if recipe_unit_from_row else item["unit"]
        material_type = item.get("material_type") if has_material_type else "dry"
        rows.append({
            "product_id": r["product_id"],
            "qty_per_serving": _normalize_recipe_quantity(
                r["quantity_per_serving"],
                recipe_unit,
                item["unit"],
                material_type,
            ),
            "ingredient_id": item["id"],
            "ingredient_name": item["name"],
            "unit": item["unit"],
            "unit_cost": item["price"],
            "current_stock": item["quantity"],
        })
    return pd.DataFrame(rows)


DEFAULT_OPERATING_DAYS = {0, 1, 2, 3, 4}  # Mon-Fri — current confirmed schedule


def get_operating_days() -> set:
    """
    The owner-configured set of weekdays the business operates on
    (0=Monday..6=Sunday, matching date.weekday()), from
    business_profile.operating_days. Falls back to the current
    confirmed Mon-Fri schedule if the row or column is missing (e.g.
    before migration 004 has been run), rather than crashing a forecast
    run over a config lookup.
    """
    response = (
        supabase.table("business_profile")
        .select("operating_days")
        .limit(1)
        .execute()
    )
    if not response.data or response.data[0].get("operating_days") is None:
        return set(DEFAULT_OPERATING_DAYS)
    return set(response.data[0]["operating_days"])


def get_history_gate_inputs():
    """
    The two date lists the first-use history rule needs (see
    services/history_gate.py): every date that has daily_sales rows, and
    every date the owner confirmed closed.

    Reads ALL of daily_sales, not per user or per upload, exactly like the
    backend's businessDayService.getHistoryCoverage() — both sides must see
    the same data or the dashboard and /train could disagree.

    Paged: daily_sales holds far more than 1,000 rows. Only sale_date is
    selected, but a full year is still ~15 pages at ~40 products/day. This
    runs once per first-training attempt, so that's acceptable.
    """
    sale_rows = _fetch_all_rows(
        lambda: supabase.table("daily_sales")
        .select("sale_date")
        .order("sale_date")
        .order("product_id")
    )
    closed_rows = _fetch_all_rows(
        lambda: supabase.table("business_days")
        .select("business_date")
        .eq("status", "confirmed_closed")
        .order("business_date")
    )
    sale_dates = sorted({r["sale_date"] for r in sale_rows if r.get("sale_date")})
    closed_dates = sorted({r["business_date"] for r in closed_rows if r.get("business_date")})
    return sale_dates, closed_dates


def has_trained_model():
    """
    True once any training run has finished and written model_metrics.

    This decides whether the first-use history rule applies. It reads the
    model_metrics TABLE on purpose, not Supabase Storage: the backend
    dashboard decides "has a model been trained?" from model_metrics
    (uploadService.getLatestModelMetrics), and the two must agree.
    Storage can hold old model files after the database is reset (it did,
    Sep 29 2026: 9 files, 0 model_metrics rows), and those should not let a
    fresh dataset skip the history check.
    """
    response = supabase.table("model_metrics").select("id").limit(1).execute()
    return bool(response.data)


def get_latest_confirmed_open_date():
    """
    The most recent business_date with status='confirmed_open' in
    business_days — used to compute forecast staleness (how many days
    of sales uploads are still pending vs. what the forecast actually
    used as its freshest lag input). Returns None if no date has ever
    been confirmed open yet (e.g. before the first upload).

    NOTE: this is the one place this service reads business_days —
    Express owns writing to that table (on upload / manual closure),
    this service only ever reads it, same as every other table here.
    """
    response = (
        supabase.table("business_days")
        .select("business_date")
        .eq("status", "confirmed_open")
        .order("business_date", desc=True)
        .limit(1)
        .execute()
    )
    if not response.data:
        return None
    return response.data[0]["business_date"]


def get_confirmed_closed_dates_after(after_date) -> list:
    """
    Dates the owner confirmed CLOSED after `after_date` ("YYYY-MM-DD"), as
    datetime.date objects. Used only by a forecast with a chosen start date
    (Oct 26 2026): a closed day right after the latest sales is not a gap.
    A handful of rows at most, so no paging.
    """
    response = (
        supabase.table("business_days")
        .select("business_date")
        .eq("status", "confirmed_closed")
        .gt("business_date", str(after_date))
        .order("business_date")
        .limit(400)
        .execute()
    )
    return [date.fromisoformat(str(r["business_date"])[:10]) for r in (response.data or []) if r.get("business_date")]


def get_safety_buffer_percentage() -> float:
    """
    Single configurable safety buffer (default 15%), owner-set in
    Settings. Falls back to 15.0 if the config row is somehow missing,
    rather than crashing the whole forecast run over a config lookup.
    """
    response = supabase.table("forecast_config").select(
        "safety_buffer_percentage"
    ).limit(1).execute()
    if response.data:
        return float(response.data[0]["safety_buffer_percentage"])
    return 15.0


def get_forecast_runs_history(limit: int = 90) -> pd.DataFrame:
    """
    Most recent forecast_runs rows, newest first, for correlating
    forecast staleness against realized accuracy over time. Read-only —
    this service never writes to forecast_runs itself outside of
    supabase_writer.write_forecast_run().
    """
    response = (
        supabase.table("forecast_runs")
        .select("run_at, run_type, model_version, last_confirmed_date, stale_days")
        .order("run_at", desc=True)
        .limit(limit)
        .execute()
    )
    columns = ["run_at", "run_type", "model_version", "last_confirmed_date", "stale_days"]
    return pd.DataFrame(response.data, columns=columns)


def get_model_metrics_history(limit: int = 20) -> pd.DataFrame:
    """
    Most recent model_metrics rows, newest first, for comparing
    the current model's aggregate metrics against prior training runs
    over time.
    """
    response = (
        supabase.table("model_metrics")
        .select("model_version, evaluation_date, mape, mae, rmse, notes, feature_importance")
        .order("evaluation_date", desc=True)
        .limit(limit)
        .execute()
    )
    columns = ["model_version", "evaluation_date", "mape", "mae", "rmse", "notes", "feature_importance"]
    return pd.DataFrame(response.data, columns=columns)
