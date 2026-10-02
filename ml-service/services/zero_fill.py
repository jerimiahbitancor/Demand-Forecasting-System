"""
Turns a product's real sales rows into the OPEN-DAY SERIES the features
are built from.

THE PROBLEM THIS SOLVES: a Loyverse export only lists items that sold
that day. It never contains a row with 0. So for a slow item, "no row on
Tuesday" is indistinguishable in the raw data from "the store was closed
on Tuesday" — even though the first means "sold zero" and the second
means "didn't happen." Feeding the raw rows straight into lag/rolling
features made "14 observations" stretch across a month, and the model
almost never saw a real 0.

THE RULE (owner's decision, Oct 1 2026):
  If the store was CONFIRMED OPEN on a date, and the product is in
  Product Management and not archived, then a date with no daily_sales
  row for that product means it sold 0.

  5, 2, -, -, -, 3, -   on consecutive open days
  becomes
  5, 2, 0, 0, 0, 3, 0

WHAT IS NEVER FILLED:
  - Confirmed-CLOSED dates. The store didn't operate; there is no demand
    to record. Filling these would recreate the exact "closed day read as
    zero demand" mistake the paper calls out.
  - UNCONFIRMED dates. Not closed, not zero — simply unknown. They are
    skipped entirely, and forecasting falls back to the latest confirmed
    observation (see System Logic v1.01.10.26, "Unconfirmed past day").
  - Anything before the product's FIRST SALE. Product rows are created at
    upload time, not when the dish joined the menu, so an earlier date
    tells us nothing about whether it was for sale then.
  - ARCHIVED products. They are excluded from training and forecasting
    altogether, so filling them would be wasted work at best.
  - A run of OFF_MENU_GAP_OPEN_DAYS or more consecutive no-sale open
    days. See below.

THE OFF-MENU RULE: one run length decides both cases. A run of
consecutive no-sale open days shorter than OFF_MENU_GAP_OPEN_DAYS (28) is
filled with zeros — the dish was on the menu and simply didn't sell. A
run of 28 or more means the dish was off the menu for that stretch, so
nothing is filled and the product's history just resumes at its next
sale. Interior runs are bounded by the next sale; a trailing run (after
the last sale) has no next sale, so at most 27 open days are filled and
the series stops there.

28 is the same span the product-status badges use for
INACTIVE (DISCONTINUED), which is deliberate: a product with no sales for
28 open days is exactly the one the dashboard already stops treating as
active. The two rules are NOT wired together in code, though — the badges
count CALENDAR days in backend/services/productStatusService.js (a locked
decision), while this counts CONFIRMED-OPEN days. Same number, different
denominator, on purpose.

GAPS ARE COUNTED IN CONFIRMED-OPEN DAYS, NOT CALENDAR DAYS (owner
decision). A two-week holiday closure in the middle of a gap does not
push a product toward "off menu," because the store was shut and nobody
could have bought it.

Everything here is a pure function: no database, no clock. The caller
supplies the dates. That is what lets training and /forecast run the very
same code — see feature_engineering.build_feature_row().
"""
from datetime import date

from config import OFF_MENU_GAP_OPEN_DAYS


def build_open_day_series(sales_by_date: dict, open_dates, is_archived: bool = False) -> list:
    """
    Returns the product's observation series as a list of dicts, oldest
    first, one entry per CONFIRMED-OPEN day that belongs in its history:

        {"sale_date": date, "quantity_sold": float, "is_real": bool}

    `is_real` is False for a filled zero. It matters: training eligibility
    counts REAL observations only (42 of them, per the owner's spec), so a
    product must not qualify on the strength of invented zeros. See
    model_service.filter_training_eligible().

    Args:
        sales_by_date: {date: quantity} for this product's real rows only.
        open_dates:    every confirmed-open date for the STORE, any order.
        is_archived:   archived products get their real rows back with no
                       fill at all.

    Closed and unconfirmed dates are simply not in `open_dates`, so this
    function cannot fill them even by accident — the caller decides what
    "open" means, and there is exactly one such caller per side
    (data_loader.get_confirmed_open_dates for training, the operating-days
    rule for future dates in forecasting).
    """
    if not sales_by_date:
        return []

    real_dates = sorted(sales_by_date)
    first_sale = real_dates[0]
    last_sale = real_dates[-1]

    if is_archived:
        return [
            {"sale_date": d, "quantity_sold": float(sales_by_date[d]), "is_real": True}
            for d in real_dates
        ]

    # Only open days from the first sale onward can be part of this
    # product's history — anything earlier predates the dish. A real sale
    # on a date the store was never confirmed open is still included: an
    # upload always wins over a missing or wrong business_days row, the
    # same precedence the first-use history gate uses.
    candidates = sorted({d for d in open_dates if d >= first_sale} | set(real_dates))

    series = []
    run = []  # consecutive no-sale open days still awaiting a verdict

    def flush_interior_run():
        """
        Decide one run of no-sale open days that a later sale has just
        closed off. Shorter than the off-menu span means the dish was on
        the menu and simply didn't sell, so fill zeros. Otherwise it was
        off the menu: emit nothing and let the history resume at the sale.
        """
        if run and len(run) < OFF_MENU_GAP_OPEN_DAYS:
            for gap_date in run:
                series.append({"sale_date": gap_date, "quantity_sold": 0.0, "is_real": False})
        run.clear()

    for current in candidates:
        if current in sales_by_date:
            flush_interior_run()
            series.append({
                "sale_date": current,
                "quantity_sold": float(sales_by_date[current]),
                "is_real": True,
            })
            continue

        if current < last_sale:
            # Interior gap: a later sale will close this run off, and
            # flush_interior_run() will then decide the whole run at once.
            run.append(current)
            continue

        # Trailing run: no later sale is coming, so nothing will ever
        # close it. Fill while the run stays shorter than the off-menu
        # span (so at most 27 days), then end the series here.
        if len(run) >= OFF_MENU_GAP_OPEN_DAYS - 1:
            break
        run.append(current)
        series.append({"sale_date": current, "quantity_sold": 0.0, "is_real": False})

    return series


def previous_open_date(target_date: date, open_dates) -> date:
    """
    The latest confirmed-open date strictly before `target_date`, or None.

    This drives the `days_since_last_open` feature, which is a STORE-level
    fact, not a per-product one: 1 on an ordinary day, 2 on a Monday after
    a closed Sunday, 15 after the Sep 14-26 closure. It must not be read
    off a single product's series, because a product that was off the menu
    would then report a gap the store never had.
    """
    earlier = [d for d in open_dates if d < target_date]
    return max(earlier) if earlier else None
