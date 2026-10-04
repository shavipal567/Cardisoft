# Visualization (3D + dashboard) — specified, deferred

Status: **no frontend exists in this repo** (scope decision). This page records
the binding contract from PROBLEM.md §§12–18 so a future frontend implements
it correctly on the first pass against the already-stable API.

## Required capabilities

- Interactive 3D heart with **LAD, LCX, RCA** as separately addressable meshes
  (rotate / zoom / pan / vessel select; Three.js / R3F / VTK.js).
- Deterministic mapping: `P(LAD)→LAD mesh`, `P(LCX)→LCX mesh`, `P(RCA)→RCA
  mesh`; vessel visual state updates on every new `/predict` response
  (update materials, never rebuild the scene; §24 performance rules).
- Continuous color scale + visible legend + numeric probability alongside color
  (color must not be the only risk channel; accessibility, §16).
- Vessel selection opens a panel: probability, classification, explanation
  (`/explain` for that head), physiological values (§17).
- Dashboard layout: patient features | 3D anatomy | risk summary | model
  explanation | safety disclaimer (§18).
- Disclaimer visible in-app (§26); performance without dedicated GPU (§24).

## Non-negotiable constraint (§15)

The dataset has no lesion coordinates, plaque geometry, or imaging. A
highlighted LAD means **"elevated predicted LAD stenosis probability"** —
never plaque location, size, morphology, or patient-specific anatomy. Label the
layer as interpretive context in the UI copy.

## API surface the frontend will consume (already live)

- `POST /predict` → `{cad, vessels{LAD,LCX,RCA}}` with probabilities.
- `POST /explain` with `{features, target: cad|lad|lcx|rca, top_k}` →
  contributions for the selected vessel's panel.
- `GET /health` → status + disclaimer text.

Suggested build order when scoped in: procedural vessel meshes first (no
license risk, exact LAD/LCX/RCA correspondence), licensed `.glb` asset only if
attribution/licensing is documented (§13).
