# Visualization (3D + dashboard) — implemented

Status: **implemented**. `frontend/src/components/HeartViewer.tsx` (procedural
heart + LAD/LCX/RCA tube meshes, R3F) is mounted in `frontend/src/App.tsx` and
implements the binding contract from PROBLEM.md §§12–18 against the
already-stable API. It renders below the risk cards after `/predict`, with vessel
click-to-select synced to the risk/explanation target.

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

Implementation notes: procedural vessel meshes (no license risk, exact
LAD/LCX/RCA correspondence). A licensed `.glb` asset remains optional only if
attribution/licensing is documented (§13).
