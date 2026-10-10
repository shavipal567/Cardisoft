<div class="cardisoft-hero">
<h1>Cardisoft docs</h1>
<p>Technical documentation for the cardiovascular risk visualization &amp; prediction
system (Multimodal AI Hackathon 2026 — Track A).</p>
<div class="cardisoft-badges">
<span>303 patients</span>
<span>4 prediction heads</span>
<span>Test AUC 0.893 (CAD)</span>
<span>Leakage-safe pipeline</span>
</div>
</div>

<div class="grid cards" markdown>

-   **Problem Formulation**

    What are we predicting, and what must the system never claim? Four binary targets,
    hard constraints (leakage, no lesion localization), and current scope status.

    [Start here](problem-formulation.md)

-   **Dataset**

    What's in `dataset/dataset.csv`? 303 rows × 59 columns, zero missing values.
    Column groups, target balance, label structure, and known data quirks.

    [Inspect the data](dataset.md)

-   **Preprocessing**

    How raw inputs are cleaned, imputed, and encoded. Two tracks: one-hot (81 columns
    for vessel models) and native categorical (54 columns for CAD). Median imputation,
    RobustScaler, and leakage-safe design.

    [See the pipeline](preprocessing.md)

-   **Feature Engineering**

    Current raw-inputs-only approach and the backlog of planned experiments:
    log transforms, domain-motivated composites, encoding ablations.

    [Read the plan](feature-engineering.md)

-   **Multimodal Fusion**

    Current unimodal (tabular-only) state and the design for where new modalities
    (ECG waveforms, echo imaging) would plug in without breaking leakage guarantees.

    [See the design](multimodal-fusion.md)

-   **Models**

    Six model families (RF, XGB, HGB, LGBM, CatBoost, Stacking), 31 configurations
    per target, 10×5-fold repeated CV selection. Current winners: CatBoost for CAD,
    Random Forest for vessels.

    [Compare models](models.md)

-   **Evaluation**

    Held-out test metrics on 61 patients, confusion matrices, and how to honestly
    read LCX/RCA results. Calibration status and external validation gaps.

    [Read the results](evaluation.md)

-   **Explainability**

    Patient-specific grouped permutation Shapley values: algorithm walkthrough,
    additivity contract, interpretation guidelines, and limitations.

    [Understand explanations](explainability.md)

-   **Visualization**

    Implemented React dashboard and interactive schematic 3D heart. Coronary surface
    registration, camera presets, vessel selection, and the API surface consumed
    by the frontend.

    [See the contract](visualization.md)

-   **API**

    FastAPI endpoints (`/health`, `/predict`, `/explain`, `/model-info`), request/
    response schemas, validation rules, error codes, and curl examples.

    [Use the API](api.md)

-   **Engineering Decisions**

    Architecture decision records (ADRs): why separate training/serving, four
    independent models, two preprocessing tracks, reproducible artifacts, and more.

    [Read the ADRs](engineering-decisions.md)

</div>

Related: `../PROBLEM.md` (challenge spec), `../training/README.md`,
`../backend/README.md`, `../training/IMPROVEMENTS.md` (model backlog).
