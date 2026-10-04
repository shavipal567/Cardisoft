# Engineering decisions (ADRs)

Short records of why the repo looks the way it does. Newest last.

## ADR-1: `training/` owns all ML, `backend/` only serves

`training/` holds preprocessing, training, evaluation, inference helper, and
frozen artifacts; `backend/` imports `training/inference.py` by path and never
fits anything. Consequence: one implementation of cleaning/transform/threshold
— train-serve skew is structurally impossible. Cost: the `sys.path` bootstrap
in `services/*.py` and no `backend/__init__.py` (run uvicorn from `backend/`).

## ADR-2: Four independent heads in v1

One classifier per target with identical protocol, instead of multi-output or
chains. Reason: establishes honest baselines first on 303 rows; vessel
dependence (measured: any-stenotic ⇒ CAD at 0.994–1.0, strong co-occurrence) is
backlogged as chains/multi-task rather than assumed. CAD-as-OR ensemble is a
planned experiment, not the default.

## ADR-3: Shared preprocessor, RobustScaler, no v1 feature engineering

One `ColumnTransformer` (median+RobustScaler / most-frequent+one-hot, 81
outputs) for all heads — correct for future linear models, harmless for trees.
No derived features in v1: baselines before degrees of freedom. Skewed-lab
log-transforms, ratios, and counts are backlogged behind repeated-CV gates.

## ADR-4: Pinned `==` dependencies in both `requirements.txt` files

`joblib` artifacts only unpickle under matching sklearn/xgboost versions, so
both files pin the exact verified set. `shap` stays optional/commented until a
compatible `shap`/`numba`/`coverage` trio is confirmed (current env breaks on
import; the explainer's labeled fallback covers it).

## ADR-5: Artifacts tracked in git (~7.9M)

`training/artifacts/*.joblib` are committed (see `.gitignore` note) so the
backend runs without a training step or model registry — appropriate for a
hackathon prototype, to be revisited (registry/S3 + `ARTIFACTS_DIR`) if this
outgrows a demo.

## ADR-6: No frontend in scope; contract-first visualization doc

3D/dashboard deferred, but the API already serves exactly what the future
frontend needs (`/predict` probabilities, per-head `/explain`, disclaimer via
`/health`), and `visualization.md` pins the mapping and §15 non-localization
constraint so the UI can't misrepresent the science later.

## ADR-7: Honest metrics over tuned metrics

Weak LCX/RCA numbers ship as-is; no SMOTE, no test-peeking, no selectively
reported splits. `IMPROVEMENTS.md` names the ceiling (~0.80 without more data)
instead of engineering around it.
