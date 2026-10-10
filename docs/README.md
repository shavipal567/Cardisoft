# docs/

MkDocs site sources. Home page: [`index.md`](index.md).

## Build

```bash
pip install -r docs/requirements-docs.txt
mkdocs build --strict   # or: mkdocs serve
```

The `--strict` mode treats warnings as errors. All pages must resolve internal
links, have valid front matter, and pass Markdown linting.

## Navigation

The site is organized as a linear reading path:

1. **Problem formulation** — what we predict and constraints
2. **Dataset** — data overview, column groups, quirks
3. **Preprocessing** — cleaning, imputation, encoding tracks
4. **Feature engineering** — current state + backlog
5. **Multimodal fusion** — unimodal status + future design
6. **Models** — families, CV protocol, saved winners
7. **Evaluation** — held-out metrics, honest interpretation
8. **Explainability** — algorithm walkthrough, contract, limitations
9. **Visualization** — 3D heart, dashboard, API surface
10. **API** — endpoints, schemas, examples
11. **Engineering decisions** — ADRs

Plus API reference pages (auto-generated from Python docstrings via mkdocstrings).

## Adding a page

1. Create a new `.md` file in `docs/`
2. Add it to the `nav` section in `mkdocs.yml`
3. Cross-reference from relevant existing pages
4. Run `mkdocs build --strict` to verify

## Style guide

- British spelling (colour, normalise) to match existing docs
- Probability values in decimal form (0.893, not 89.3%)
- File paths in backticks, class names in backticks
- Internal links in relative format: `[Page](page.md)`
- External links with descriptive anchor text
- Tables for structured data, prose for narrative
