<div class="cardisoft-hero">
<h1>Cardisoft docs</h1>
<p>Technical documentation for the cardiovascular risk visualization &amp; prediction
system (Multimodal AI Hackathon 2026 — Track A).</p>
<div class="cardisoft-badges">
<span>303 patients</span>
<span>4 prediction heads</span>
<span>Best test AUC 0.877 (CAD)</span>
<span>Leakage-safe pipeline</span>
</div>
</div>

<div class="grid cards" markdown>

-   **Problem Formulation**

    What are we predicting, and what must the system never claim?

    [Start here](problem-formulation.md)

-   **Dataset**

    What's in `dataset/dataset.csv`? Balances, quirks, leakage columns.

    [Inspect the data](dataset.md)

-   **Preprocessing**

    How raw inputs are cleaned, imputed, and encoded (81 features).

    [See the pipeline](preprocessing.md)

-   **Feature Engineering**

    What v1 ships, and what's on the backlog.

    [Read the plan](feature-engineering.md)

-   **Multimodal Fusion**

    Current unimodal state and where new modalities plug in.

    [See the design](multimodal-fusion.md)

-   **Models**

    RF vs XGBoost comparison, winners, artifacts.

    [Compare models](models.md)

-   **Evaluation**

    Metrics, confusion matrices, how to read LCX/RCA honestly.

    [Read the results](evaluation.md)

-   **Explainability**

    SHAP-first design, fallback method, causality wording.

    [Understand explanations](explainability.md)

-   **Visualization**

    3D/dashboard contract (specified, deferred — no frontend in scope).

    [See the contract](visualization.md)

-   **API**

    Endpoints, schemas, errors, run instructions.

    [Use the API](api.md)

-   **Engineering Decisions**

    Why the repo looks the way it does (ADRs).

    [Read the ADRs](engineering-decisions.md)

</div>

Related: `../PROBLEM.md` (challenge spec), `../training/README.md`,
`../backend/README.md`, `../training/IMPROVEMENTS.md` (model backlog).
