"""Out-of-fold ensemble predictions with fold-local preprocessing."""

import numpy as np
from sklearn.base import clone
from sklearn.model_selection import StratifiedKFold


def out_of_fold_probabilities(estimators, X, y, cv=3, seed=42, *, preprocessor=None):
    """Return one positive-class probability per row and ensemble member.

    With a preprocessor, X contains raw features. Each inner fold gets a fresh
    clone fitted only on that fold's training rows. The supplied preprocessor
    is left unfitted so the caller can later fit it on all available training
    rows for the separate serving artifact. Without a preprocessor, X must
    already be numeric and require no learned preprocessing.
    """
    if not hasattr(X, "iloc"):
        X = np.asarray(X, dtype=float)
    y = np.asarray(y, dtype=int)
    splitter = StratifiedKFold(n_splits=cv, shuffle=True, random_state=seed)
    oof = np.zeros((len(y), len(estimators)))
    for train_idx, valid_idx in splitter.split(X, y):
        if hasattr(X, "iloc"):
            X_train, X_valid = X.iloc[train_idx], X.iloc[valid_idx]
        else:
            X_train, X_valid = X[train_idx], X[valid_idx]
        y_train = y[train_idx]
        if preprocessor is not None:
            fold_prep = clone(preprocessor)
            X_train = fold_prep.fit_transform(X_train, y_train)
            X_valid = fold_prep.transform(X_valid)
        for column, (_, estimator) in enumerate(estimators):
            fitted = clone(estimator).fit(X_train, y_train)
            oof[valid_idx, column] = fitted.predict_proba(X_valid)[:, 1]
    return oof
