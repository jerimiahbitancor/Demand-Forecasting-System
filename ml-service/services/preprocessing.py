"""
Data validation and cleaning — runs BEFORE feature engineering, always.

This is the step your original draft pipeline skipped. It exists so
that a malformed upload fails loudly here, instead of silently
producing a bad model three steps later.
"""
import pandas as pd


class DataValidationError(Exception):
    """Raised when uploaded/loaded sales data fails basic sanity checks."""
    pass


def validate_sales_data(df: pd.DataFrame) -> None:
    """
    Raises DataValidationError with a clear message if anything is
    structurally wrong. Does not fix anything — validation and cleaning
    are separate responsibilities on purpose, so a validation failure
    can be surfaced to the owner/dashboard as-is.
    """
    required_columns = {"product_id", "sale_date", "quantity_sold"}
    missing = required_columns - set(df.columns)
    if missing:
        raise DataValidationError(f"Missing required columns: {missing}")

    if df.empty:
        raise DataValidationError("No sales rows found.")

    if df["quantity_sold"].lt(0).any():
        raise DataValidationError("Negative quantity_sold values found.")

    if df["sale_date"].isna().any():
        raise DataValidationError("Unparseable sale_date values found.")

    min_date, max_date = df["sale_date"].min(), df["sale_date"].max()
    if min_date.year < 2020 or max_date > pd.Timestamp.now() + pd.Timedelta(days=1):
        raise DataValidationError(
            f"sale_date range looks wrong: {min_date.date()} to {max_date.date()}"
        )


def clean_sales_data(df: pd.DataFrame) -> pd.DataFrame:
    """
    Cleaning, AFTER validation has already passed. Handles the two
    documented cases from the paper's preprocessing step:
      a) duplicate rows removed
      b) closed days are simply absent — we do NOT fill them with 0,
         because a closed day is missing data, not zero demand.
    Feature engineering (which computes lags/rolling averages) is
    responsible for skipping over the resulting gaps correctly.
    """
    df = df.drop_duplicates(subset=["product_id", "sale_date"])
    df = df.sort_values(["product_id", "sale_date"]).reset_index(drop=True)
    return df
