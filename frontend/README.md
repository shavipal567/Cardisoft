# Frontend — Cardisoft clinical dashboard

React 19 + TypeScript + Vite + Three.js (R3F) + Recharts. Patient form,
ML predictions, SHAP-style explanations, and an interactive schematic 3D
heart with vessel-level risk mapping (PROBLEM.md §§12–18). Talks to
`backend/` over REST/JSON, or runs fully offline on static mocks.

Related docs: `../PROBLEM.md`, `../docs/visualization.md` (3D contract),
`../backend/README.md` (API), `../docs/explainability.md`.

## 1. Layout

```text
frontend/
├── src/
│   ├── App.tsx               # patient form + risk cards + explanation + dashboard wiring
│   ├── api.ts                # predict()/explain() + response normalization + mock toggle
│   ├── fields.ts             # 19 form fields (keys match backend CSV aliases), SAMPLE patient
│   ├── pdf/
│   │   ├── extractText.ts    # client-only pdf.js text extraction (lazy chunk)
│   │   └── fieldMap.ts       # deterministic alias-regex parser → 19 fields + confidence
│   ├── components/
│   │   ├── HeartViewer.tsx   # procedural schematic heart + LAD/LCX/RCA tubes (R3F)
│   │   └── Logo.tsx
│   ├── App.css / index.css   # theme (light/dark), cards, canvas, HUD, spec-table styles
│   └── main.tsx
├── public/
│   ├── mock_predict.json / mock_explain.json  # offline demo responses (§23 examples)
│   ├── sample-lab-report.pdf (+ make_sample_report.py)  # dummy report for the PDF scanner
│   └── wallpapers, icons, heart.png
├── .env                      # VITE_USE_MOCK / VITE_API_URL (tracked; dev defaults)
└── package.json              # react@19, three@0.186, @react-three/{fiber@9,drei@10},
                              # recharts@3, pdfjs-dist@6, vite@8, typescript@6, oxlint
```

## 2. Features

- **Patient form (19 fields)** — 9 numbers (Age, BMI, BP, PR, FBS, LDL, HDL,
  TG, EF-TTE) + 10 toggles (Sex, DM, HTN, smoker, FH, chest pain, ECG flags),
  grouped, validated against `FIELDS.min/max`. Missing backend fields fall back
  to server defaults/imputation. `Load sample patient` fills the demo case.
- **📄 Scan lab PDF** — text-based lab PDFs are parsed **in the browser**
  (pdf.js lazy chunk + worker; no upload). `fieldMap.ts` maps aliases
  (e.g. `LDL-C`, `Fasting Blood Sugar`, `EF`) with range clamping, negation
  handling (`no/not/absent/...`), DOB→age fallback, and per-field
  high/medium confidence + skipped reasons. Values merge into the form for
  review — Analyze is always manual. Scanned-image PDFs get a clean error.
  Try it with `public/sample-lab-report.pdf` (all 19 fields parse).
- **Risk cards** — CAD/LAD/LCX/RCA probabilities with animated %, meter,
  Positive/Negative pill, and a low-validation-performance note on LCX/RCA.
- **HeartViewer (3D)** — procedural schematic heart (ellipsoid + apex pinch,
  aorta stub) with three clickable `TubeGeometry` vessels. Deterministic
  `P(vessel) → mesh` color + numeric labels, vessel spec table, legend,
  orientation annotations, gentle lub-dub pulse (off under
  `prefers-reduced-motion`). Rendered **only after Analyze**. Schematic
  context only — never lesion localization (§15 copy in-app).
- **Explanations** — per-target (`CAD/LAD/LCX/RCA`) top-8 contribution bar
  chart + patient-value × contribution table, with base value and
  non-causality wording.
- **Safety** — emergency banner (India 112/108) + Clinical Safety Notice on
  every screen.

## 3. Configuration

| var | default | meaning |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8000` | FastAPI base URL |
| `VITE_USE_MOCK` | `true` | anything but `"false"` → use `public/mock_*.json` instead of the backend |

Mock mode needs no backend; set `VITE_USE_MOCK=false` for live inference.

## 4. Run & verify

```bash
npm install
npm run dev      # vite, http://localhost:5173
npm run lint     # oxlint
npm run build    # tsc -b && vite build
```

Manual pass: Load sample (or scan `sample-lab-report.pdf`) → Analyze →
4 risk cards → 3D vessels recolor with `%` labels → click LAD/LCX/RCA →
explanation + table update per vessel → disclaimer visible. Repeat in dark
mode and at mobile width (layout stacks).

## 5. Notes & limits

- Form covers 19/54 backend fields; the rest use server defaults (marked
  `assumed` in `api.ts` normalization).
- 3D bundle is ~1.5MB (Three.js, direct import); pdf.js is code-split into
  its own lazy chunk. Code-split the viewer too if initial load matters.
- Explanations show aggregated one-hot contributions mapped back to form
  fields; live backend currently serves `gain_importance_fallback`
  (ranking, not additive SHAP) until the `shap` trio is pinned.
