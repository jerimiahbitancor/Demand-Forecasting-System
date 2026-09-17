"""
All reads from Supabase live here, and only here.

Keeping every SELECT in one module means: if a table or column name
changes, you fix it in exactly one place. It also enforces the
separation we agreed on — this service only ever reads products,
daily_sales, product_ingredients/ingredients, and forecast_config.
It never writes to any of them (see supabase_writer.py for the tables
this service IS allowed to write to).
"""
import re
import pandas as pd
from config import supabase


# Unit conversion factors for recipe quantities (kept in sync with
# frontend/src/utils/recipeUnits.js and backend/utils/recipeUnits.js).
# A product's recipe can use a different unit than the ingredient's stock
# unit (e.g. "1 cup" of soy sauce vs an ingredient priced per litre); every
# quantity is normalised to the ingredient's unit before use.
_RECIPE_UNIT_BASE_FACTOR = {
    "kg": 1000, "kilogram": 1000, "kilograms": 1000, "kilo": 1000, "kilos": 1000,
    "kg (kg)": 1000, "kilograms (kg)": 1000, "kilogram (kg)": 1000,
    "g": 1, "gram": 1, "grams": 1, "gm": 1, "g (g)": 1, "gram (g)": 1, "grams (g)": 1,
    "mg": 0.001, "milligram": 0.001, "milligrams": 0.001,
    "lb": 454, "lbs": 454, "pound": 454, "pounds": 454,
    "oz": 28.35, "ounce": 28.35, "ounces": 28.35,
    "L": 1000, "l": 1000, "litre": 1000, "liter": 1000, "litres": 1000, "liters": 1000,
    "l (l)": 1000, "liter (l)": 1000, "liters (l)": 1000, "litre (l)": 1000, "litres (l)": 1000,
    "mL": 1, "ml": 1, "millilitre": 1, "milliliter": 1, "millilitres": 1, "milliliters": 1,
    "ml (ml)": 1, "milliliter (ml)": 1, "milliliters (ml)": 1, "millilitre (ml)": 1,
    "cup": 240, "cups": 240,
    "tbsp": 15, "tablespoon": 15, "tablespoons": 15,
    "tsp": 5, "tps": 5, "teaspoon": 5, "teaspoons": 5,
    "fl oz": 30, "floz": 30, "fluid ounce": 30, "fluid ounces": 30,
    "pt": 473, "pint": 473, "pints": 473,
    "qt": 946, "quart": 946, "quarts": 946,
    "gal": 3785, "gallon": 3785, "gallons": 3785,
}

_MASS_UNITS = {
    "kg", "kilogram", "kilograms", "kilo", "kilos", "kg (kg)", "kilograms (kg)", "kilogram (kg)",
    "g", "gram", "grams", "gm", "g (g)", "gram (g)", "grams (g)", "mg", "milligram", "milligrams",
    "lb", "lbs", "pound", "pounds", "oz", "ounce", "ounces",
}

_VOLUME_UNITS = {
    "L", "l", "litre", "liter", "litres", "liters", "l (l)", "liter (l)", "liters (l)", "litre (l)", "litres (l)",
    "mL", "ml", "millilitre", "milliliter", "millilitres", "milliliters",
    "ml (ml)", "milliliter (ml)", "milliliters (ml)", "millilitre (ml)",
    "cup", "cups", "tbsp", "tablespoon", "tablespoons", "tsp", "tps", "teaspoon", "teaspoons",
    "fl oz", "floz", "fluid ounce", "fluid ounces",
    "pt", "pint", "pints", "qt", "quart", "quarts", "gal", "gallon", "gallons",
}

# Count/piece units that can convert to weight via a per-piece estimate.
# Units without a trusted piece weight (packs, bottles, cans, bunches,
# sachets) stay out of this set so their quantities pass through unchanged.
_COUNT_PIECE_UNITS = {
    "pcs", "pc", "piece", "pieces",
    "pcs (pcs)", "pc (pcs)", "piece (pcs)", "pieces (pcs)",
    "slice", "slices", "slice (pcs)", "slices (pcs)",
    "clove", "cloves", "clove (pcs)", "cloves (pcs)",
    "stick", "sticks", "stick (pcs)", "sticks (pcs)",
}

# Default per-piece weights (grams) used when a recipe quantity uses a piece
# unit but the ingredient is priced by weight.
_PIECE_WEIGHT_KEYWORDS = [
    (r"\bpotato(es)?\b", 150),
    (r"\bonions?\b", 110),
    (r"\btomato(es)?\b", 120),
    (r"\bcarrots?\b", 60),
    (r"\beggs?\b", 50),
    (r"\blemon", 100),
    (r"calamansi|kalamansi", 30),
    (r"\bbananas?\b", 120),
    (r"\bapples?\b", 180),
    (r"\bgarlic", 3),
    (r"\bbreads?\b", 30),
]


def _piece_weight_for(ingredient_name, piece_unit=None):
    """Grams per piece for `piece_unit` pieces of `ingredient_name`, or None
    when no trusted estimate exists."""
    unit = (piece_unit or "").strip().lower()
    if re.match(r"^sticks?(\s\(pcs\))?$", unit) and re.search(r"butter", ingredient_name or "", re.IGNORECASE):
        return 113
    name = (ingredient_name or "").lower()
    for pattern, grams in _PIECE_WEIGHT_KEYWORDS:
        if re.search(pattern, name):
            return grams
    return None


def _normalize_recipe_quantity(quantity, from_unit, to_unit, grams_per_cup=None, ingredient_name=None):
    try:
        qty = float(quantity)
    except (TypeError, ValueError):
        return 0.0
    if qty <= 0:
        return qty
    from_key = (from_unit or "").strip().lower()
    to_key = (to_unit or "").strip().lower()
    from_factor = _RECIPE_UNIT_BASE_FACTOR.get(from_key)
    to_factor = _RECIPE_UNIT_BASE_FACTOR.get(to_key)

    # Volume -> mass via the ingredient's density (grams per 240 mL cup).
    # Without a density, cross-family units pass through unchanged.
    if (
        from_key in _VOLUME_UNITS
        and to_key in _MASS_UNITS
        and from_factor is not None
        and to_factor is not None
        and grams_per_cup
        and float(grams_per_cup) > 0
    ):
        grams = (qty * from_factor) * (float(grams_per_cup) / 240)
        return round(grams / to_factor, 4)

    # Pieces -> mass via the per-piece weight estimate. Without an estimate,
    # cross-family units pass through unchanged.
    if from_key in _COUNT_PIECE_UNITS and to_key in _MASS_UNITS and to_factor is not None:
        piece_weight_grams = _piece_weight_for(ingredient_name, from_unit)
        if piece_weight_grams and piece_weight_grams > 0:
            return round((qty * piece_weight_grams) / to_factor, 4)

    same_family = (from_key in _MASS_UNITS and to_key in _MASS_UNITS) or (
        from_key in _VOLUME_UNITS and to_key in _VOLUME_UNITS
    )
    if not same_family or from_factor is None or to_factor is None:
        return qty
    return round((qty * from_factor) / to_factor, 4)


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

    response = (
        supabase.table("daily_sales")
        .select("product_id, sale_date")
        .in_("product_id", list(active_ids))
        .execute()
    )
    df = pd.DataFrame(response.data)
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
    query = supabase.table("daily_sales").select(
        "product_id, sale_date, quantity_sold"
    )
    if product_id is not None:
        query = query.eq("product_id", product_id)

    response = query.order("sale_date").execute()
    df = pd.DataFrame(response.data)
    if not df.empty:
        df["sale_date"] = pd.to_datetime(df["sale_date"])
    return df


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
    def _fetch(with_unit):
        columns = (
            "product_id, quantity_per_serving, unit, "
            "ingredients!inner(id, name, unit, price, quantity, grams_per_cup)"
        ) if with_unit else (
            "product_id, quantity_per_serving, "
            "ingredients!inner(id, name, unit, price, quantity, grams_per_cup)"
        )
        return supabase.table("product_ingredients").select(columns).execute()

    try:
        response = _fetch(True)
    except Exception as exc:
        # Migration 008 not applied yet: product_ingredients.unit is missing.
        # SELECT on a missing column surfaces as Postgres 42703 (".* does not
        # exist"), while the supabase-py client often surfaces PostgREST's
        # PGRST204 ("Could not find the 'unit' column ... in the schema
        # cache"). Both mean the recipe-unit column is absent, so fall back to
        # the previous schema where every quantity is already in the
        # ingredient's own unit.
        msg = str(exc).lower()
        if (
            "does not exist" not in msg
            and "could not find the" not in msg
            and "schema cache" not in msg
        ):
            raise
        response = _fetch(False)
        # The fallback response carries no recipe-unit info; treat every
        # quantity as already in the ingredient's own unit (no-op conversion).
        recipe_unit_from_row = False
    else:
        recipe_unit_from_row = True

    rows = []
    for r in response.data:
        item = r["ingredients"]
        recipe_unit = r.get("unit") if recipe_unit_from_row else item["unit"]
        rows.append({
            "product_id": r["product_id"],
            "qty_per_serving": _normalize_recipe_quantity(
                r["quantity_per_serving"],
                recipe_unit,
                item["unit"],
                item.get("grams_per_cup"),
                item.get("name"),
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


def get_earliest_data_date():
    """
    The earliest date this service has real sales data for — used for
    the one-time "has 12 months of history elapsed yet" gate before the
    very first training run is allowed (see /train in app.py).

    Prefers the earliest confirmed_open business_days date, since that's
    the more reliable open/closed-aware signal; falls back to the
    earliest daily_sales.sale_date when business_days has no rows yet
    (e.g. history uploaded before the business_days table/writes
    existed). Returns None if there's no data at all.
    """
    response = (
        supabase.table("business_days")
        .select("business_date")
        .eq("status", "confirmed_open")
        .order("business_date", desc=False)
        .limit(1)
        .execute()
    )
    if response.data:
        return response.data[0]["business_date"]

    response = (
        supabase.table("daily_sales")
        .select("sale_date")
        .order("sale_date", desc=False)
        .limit(1)
        .execute()
    )
    if response.data:
        return response.data[0]["sale_date"]
    return None


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
