"""
Report-only metric helpers.

Deliberately NOT added to services/model_service.py —
evaluate_predictions()/evaluate_per_product() there are called by
production's /train route and feed the owner-facing model_metrics
table. These three metrics have no owner-facing use (they exist to help
a developer reading this diagnostic report judge model quality more
precisely than plain MAE/RMSE/MAPE can) and should not touch that path.
"""
import numpy as np


def wmape(actual: np.ndarray, predicted: np.ndarray):
    """
    Weighted MAPE = sum(|actual - predicted|) / sum(actual) * 100.

    Plain MAPE averages every row's percentage error equally, no matter
    how small that row's actual value is — a product that sells 1 unit
    a day and misses by 1 unit registers as a "100% error," exactly as
    loud as a product that sells 100 units a day and misses by 100.
    WMAPE instead sums up all the absolute errors and divides by the
    sum of all the actuals, so a high-volume product's error naturally
    counts for more than a low-volume product's — which usually matches
    what actually matters for inventory/ordering decisions.

    Returns None if sum(actual) == 0 (guard against division by zero,
    same nonzero-guard pattern evaluate_predictions() already uses).
    """
    actual = np.asarray(actual, dtype=float)
    predicted = np.asarray(predicted, dtype=float)

    total_actual = np.sum(actual)
    if total_actual == 0:
        return None
    return float(np.sum(np.abs(actual - predicted)) / total_actual * 100)


def smape(actual: np.ndarray, predicted: np.ndarray):
    """
    Symmetric MAPE = mean(2 * |actual - predicted| / (|actual| + |predicted|)) * 100.

    Plain MAPE divides by the actual value alone, so it explodes toward
    infinity as actual approaches zero even when the prediction itself
    is close (e.g. actual=1, predicted=2 is already a 100% error).
    sMAPE divides by the actual and predicted values added together
    instead, which keeps the result bounded between 0% and 200% and
    softens exactly that near-zero blowup.

    Rows where actual == predicted == 0 make both the numerator and
    denominator 0 (a 0/0 case) — those rows are excluded from the mean
    entirely rather than counted as a perfect (or undefined) score,
    the same masking approach evaluate_predictions() uses for MAPE.
    """
    actual = np.asarray(actual, dtype=float)
    predicted = np.asarray(predicted, dtype=float)

    denominator = np.abs(actual) + np.abs(predicted)
    mask = denominator != 0
    if mask.sum() == 0:
        return None
    return float(np.mean(2 * np.abs(actual[mask] - predicted[mask]) / denominator[mask]) * 100)


def mase(test_actual: np.ndarray, test_predicted: np.ndarray,
         train_actual: np.ndarray, train_lag7: np.ndarray):
    """
    Mean Absolute Scaled Error (Hyndman & Koehler 2006) =
    mean(|test_actual - test_predicted|) / mean(|train_actual - train_lag7|).

    The numerator is this model's average error on the test set, same
    as MAE. The denominator is NOT computed on the test set — it's the
    average error a naive "same day last week" guess would have made
    during TRAINING, for this same product. Dividing by that naive
    baseline's own historical error turns the score into a simple
    comparison: MASE < 1 means this model beats that naive seasonal
    guess on this product; MASE > 1 means the naive guess would have
    done better. This is standard MASE methodology — the scaling
    denominator is always a training-set naive error, never a test-set
    one, so the score isn't contaminated by how easy or hard the
    particular test window happened to be.

    train_actual and train_lag7 should already be warmup-clean (rows
    where lag_7 is NaN dropped) — this naturally happens upstream via
    dropna(subset=FEATURE_COLUMNS) before training, so a caller passing
    in the same train_df used for training already satisfies this.

    Returns None if the denominator is 0 — an edge case where a
    product's own week-over-week sales never varied at all during
    training, extremely rare in practice.
    """
    test_actual = np.asarray(test_actual, dtype=float)
    test_predicted = np.asarray(test_predicted, dtype=float)
    train_actual = np.asarray(train_actual, dtype=float)
    train_lag7 = np.asarray(train_lag7, dtype=float)

    denominator = np.mean(np.abs(train_actual - train_lag7))
    if denominator == 0:
        return None
    numerator = np.mean(np.abs(test_actual - test_predicted))
    return float(numerator / denominator)
