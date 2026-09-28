# Accuracy tuning experiment summary

Dataset: 12754 usable rows, 40 eligible products.

## Splits

- fit_df: 8162 rows
- val_df: 2041 rows
- test_df: 2551 rows

## Weekend-row diagnostic

```text
  split  n_rows  n_weekend_rows  weekend_pct   date_min   date_max
 fit_df    8162            1717        21.04 2025-07-28 2026-05-08
 val_df    2041             275        13.47 2026-05-08 2026-07-16
test_df    2551             720        28.22 2026-07-16 2026-09-17
```

## Regularization search (all trials)

```text
              trial  max_depth  min_child_weight  colsample_bytree  subsample  reg_lambda  reg_alpha  best_iteration  val_mae  val_rmse  val_mape  val_wmape  seconds
           trial 11          5                 5               1.0        0.7         5.0        0.0              44 3.368290  5.071763 56.767679  28.530378      0.1
           trial 23          5                10               1.0        0.7         3.0        0.5              44 3.393098  5.105207 57.031031  28.740507      0.1
            trial 6          4                 3               0.8        0.9         3.0        0.0              59 3.394288  5.125153 55.555331  28.750585      0.1
            trial 7          3                10               0.8        0.8         1.0        0.0              76 3.394914  5.142980 55.710113  28.755895      0.1
           trial 13          4                 5               0.8        0.9         3.0        0.0              65 3.395024  5.125130 55.534351  28.756822      0.1
           trial 30          5                 5               0.8        0.7         1.0        0.5              40 3.395073  5.134196 56.993200  28.757234      0.1
           trial 17          3                 5               0.8        0.8         1.0        0.0              69 3.395860  5.145809 55.843036  28.763905      0.1
           trial 15          5                 3               0.6        0.8         3.0        0.5              46 3.398625  5.176359 56.142068  28.787321      0.1
            trial 9          4                 5               0.6        0.9         3.0        1.0              59 3.399166  5.172683 55.278948  28.791911      0.1
           trial 28          5                 5               1.0        0.9         5.0        0.0              48 3.401365  5.128167 57.450772  28.810534      0.1
            trial 4          3                 3               0.6        0.9         5.0        0.0              72 3.402696  5.175632 55.165997  28.821804      0.1
           trial 29          3                 5               0.6        0.9         5.0        0.0              76 3.402915  5.177919 55.237175  28.823659      0.1
           trial 10          3                10               0.6        0.9         3.0        1.0              58 3.404868  5.167869 55.897966  28.840202      0.1
            trial 2          3                 3               1.0        0.7         5.0        1.0              57 3.405133  5.127544 56.696641  28.842451      0.1
            trial 1          5                 1               0.6        0.9         3.0        0.0              57 3.405445  5.210622 55.442272  28.845094      0.1
           trial 12          3                 3               0.8        0.7         1.0        0.0              63 3.405636  5.158008 55.711989  28.846713      0.1
           trial 19          5                10               0.6        0.8         1.0        0.0              45 3.408462  5.198726 56.628161  28.870647      0.1
           trial 27          3                 5               1.0        0.7         5.0        0.0              56 3.408866  5.131512 57.016453  28.874069      0.1
            trial 8          4                 1               0.6        0.8         1.0        0.5              65 3.409305  5.223426 55.348498  28.877789      0.1
           trial 26          4                 1               0.8        0.8         1.0        0.5              45 3.409309  5.138545 57.224837  28.877819      0.1
           trial 18          5                 5               0.6        0.9         3.0        0.5              57 3.410377  5.214690 55.737760  28.886869      0.1
           trial 21          4                 5               0.6        0.7         5.0        0.5              49 3.411191  5.162046 56.171099  28.893764      0.1
           trial 22          3                 1               0.6        0.7         5.0        0.0              51 3.414205  5.154159 56.479434  28.919291      0.1
           trial 24          5                10               1.0        0.8         5.0        0.0              51 3.415538  5.163616 56.938540  28.930584      0.1
           trial 20          5                 5               1.0        0.9         3.0        1.0              46 3.415931  5.156645 57.651823  28.933908      0.1
           trial 16          5                 3               1.0        0.8         1.0        0.0              61 3.417682  5.224800 56.228794  28.948746      0.1
            trial 3          5                 1               1.0        0.8         1.0        0.0              46 3.418721  5.177858 57.412694  28.957543      0.1
            trial 5          5                 3               1.0        0.9         5.0        1.0              44 3.424572  5.150402 58.202916  29.007103      0.1
           trial 25          5                 1               1.0        0.9         3.0        1.0              48 3.425059  5.170717 58.084030  29.011227      0.1
           trial 14          5                 1               1.0        0.9         1.0        1.0              39 3.428103  5.200806 58.315273  29.037007      0.1
production-defaults          5                 1               1.0        0.9         1.0        0.0              37 3.433715  5.231136 58.547471  29.084548      0.1
```

## Candidate summary (val_df selection)

```text
                               name  n_estimators target_mode  val_wmape  val_mae
full-features (best regularization)            44    quantity  28.530378 3.368290
            relative-target (ratio)             5       ratio  29.459493 3.477981
  rolling-features-removed ablation            56    quantity  30.068917 3.549930
```

Winner: **full-features (best regularization)**

## FINAL real test-set result (evaluated once)

- Model: MAE=3.234, RMSE=5.620, WMAPE=37.47%
- Naive lag_7: MAE=3.963, RMSE=7.473, WMAPE=45.92%
- Naive rolling_7: MAE=2.966, RMSE=5.449, WMAPE=34.36%

### By volume tier

```text
volume_tier  n_products  n_rows  model_wmape  naive_lag7_wmape  naive_rolling7_wmape  beats_lag7  beats_rolling7
       High          11     701    34.548283         44.772157             33.233615        True           False
     Medium          10     636    36.567506         46.433109             34.468273        True           False
        Low          19    1214    52.633138         50.254842             39.381583       False           False
```

