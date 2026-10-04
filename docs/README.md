# Cardisoft docs

Technical documentation for the cardiovascular risk visualization & prediction
system (Multimodal AI Hackathon 2026 — Track A). Start here, then follow the
page that matches your question.

| Page | What it answers |
|---|---|
| [problem-formulation](problem-formulation.md) | What are we predicting, and what must the system never claim? |
| [dataset](dataset.md) | What's in `dataset/dataset.csv`? Balances, quirks, leakage columns |
| [preprocessing](preprocessing.md) | How are raw inputs cleaned, imputed, encoded? (81 features) |
| [feature-engineering](feature-engineering.md) | What was built in v1, and what's on the backlog? |
| [multimodal-fusion](multimodal-fusion.md) | Current unimodal state + where new modalities plug in |
| [models](models.md) | RF vs XGBoost comparison, winners, artifacts |
| [evaluation](evaluation.md) | Metrics, confusion matrices, how to read LCX/RCA honestly |
| [explainability](explainability.md) | SHAP-first design, fallback method, causality wording |
| [visualization](visualization.md) | 3D/dashboard contract (specified, deferred — no frontend in scope) |
| [api](api.md) | Endpoints, schemas, errors, run instructions |
| [engineering-decisions](engineering-decisions.md) | Why the repo looks the way it does (ADRs) |

Related: `../PROBLEM.md` (challenge spec), `../training/README.md`,
`../backend/README.md`, `../training/IMPROVEMENTS.md` (model backlog).
