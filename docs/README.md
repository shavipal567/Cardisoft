# Technical documentation

This folder contains the MkDocs site. [index.md](index.md) is the site home;
this README is a repository navigation guide and is excluded from the build.

## Build and preview

Run from the repository root in an environment with the training/backend
requirements available for API documentation:

```bash
python3 -m pip install -r training/requirements.txt -r backend/requirements.txt
python3 -m pip install -r docs/requirements-docs.txt
python3 -m mkdocs build --strict
python3 -m mkdocs serve
```

The strict build checks site generation and treats warnings as errors. It does
not execute the feature-analysis notebook or rerun model training. Site output
goes to `site/`, which is ignored by Git.

## Reading paths

| Task | Start here |
|---|---|
| Understand the scope and input data | [Problem formulation](problem-formulation.md), [Dataset](dataset.md) |
| Understand the implemented feature pipeline | [Feature engineering](feature-engineering.md), [Preprocessing](preprocessing.md) |
| Compare current models and research results | [Models](models.md), [Evaluation](evaluation.md) |
| Run an isolated CAD experiment | [CAD nested validation](cad-nested-validation.md) |
| Integrate the service | [API](api.md), [Backend reference](api-reference/backend.md) |
| Maintain training code | [Training reference](api-reference/training.md) |
| Interpret explanations and the dashboard | [Explainability](explainability.md), [Visualization](visualization.md) |
| Understand architectural choices | [Engineering decisions](engineering-decisions.md), [Multimodal fusion](multimodal-fusion.md) |

Repository setup/commands are in `README.md`, `training/README.md`,
`backend/README.md` and `frontend/README.md`. The dataset README describes the
executed feature notebook and its exports.

## Documentation conventions

Keep these distinctions explicit when updating a page:

- **Raw inputs:** the 54 measurements accepted by the API.
- **Model features:** the encoded/generated columns produced by a fitted preprocessor.
- **Training defaults:** CAD logs, LAD counts, LCX ratios/counts and RCA baseline.
- **Serving artifacts:** currently baseline models; new defaults do not retrofit them.
- **Exploratory feature results:** three-repeat development CV, selected after inspection.
- **Serving-model metrics:** the historical 61-row holdouts recorded in `metrics.json`.
- **Nested results:** a separate CAD model/calibration experiment; feature sets are fixed per run.

Describe a score with its metric, partition, threshold when applicable and model
or feature configuration. Do not substitute notebook accuracies for saved-model
metrics or imply that a feature choice was selected inside nested CV.

Use relative links between site pages, descriptive link labels, and tables for
comparisons. Keep repository paths outside `docs/` in code formatting on site
pages. API fractions remain decimals; label displayed percentages explicitly.
When adding a page, add it to `mkdocs.yml`, link it from the relevant reading path
and run the strict build. Review local Markdown links/anchors as well as the
rendered page when changing headings.
