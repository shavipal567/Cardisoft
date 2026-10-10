# Visualization (3D + dashboard) — implemented

Status: **implemented**. `frontend/src/components/HeartViewer.tsx` (registered GLB
heart + surface-fitted LAD/LCX/RCA tube meshes, R3F) is mounted in `frontend/src/App.tsx` and
implements the binding contract from PROBLEM.md §§12–18 against the
already-stable API. It renders below the risk cards after `/predict`, with vessel
click-to-select synced to the risk/explanation target.

## Required capabilities

- Interactive 3D heart with **LAD, LCX, RCA** as separately addressable meshes
  (rotate / zoom / anterior, posterior and lateral presets / vessel select; Three.js / R3F).
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

## API surface consumed by the frontend

- `POST /predict` → `{cad, vessels{LAD,LCX,RCA}}` with probabilities.
- `POST /explain` with `{features, target: cad|lad|lcx|rca, top_k}` →
  contributions for the selected vessel's panel.
- `GET /health` → status + disclaimer text.
- `GET /model-info` → saved model identities and evaluation metrics.

Live mode is the default. Explicit demo mode uses labelled fixed fixtures.
The full-width grouped form sits above results; the heart and explanation
share a row on wide screens and stack on smaller screens.

## Coronary surface registration

The existing `frontend/public/heart.glb` is attributed to Pigcraft under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Its embedded source is
[Anatomically Correct Human Heart](https://sketchfab.com/3d-models/anatomically-correct-human-heart-54fa880728d14c11afff78be8721620a).
The viewer displays this attribution and identifies the modified orientation/overlays.

The asset's native +X anterior direction is rotated to +Z. No additional
arbitrary roll is applied. LAD follows the anterior interventricular groove
toward the apex; LCX follows the left AV groove around the obtuse margin;
RCA follows the right AV groove around the acute margin toward the posterior
crux. The neutral left-main segment joins LAD and LCX at one bifurcation.
RCA has a separate aortic origin; it is not conflated with the PDA.

Routes follow the [normal coronary anatomy review](https://pmc.ncbi.nlm.nih.gov/articles/PMC4919754/).
They are manually registered to an illustrative asset, not clinically validated
segmentations. Small branches, dominance variants and lesion locations are
not represented. Existing texture vessels are contextual; only the three
selectable overlays encode model probabilities.

`frontend/src/anatomy/registration.ts` defines asset-specific landmarks.
Interpolation precedes mesh raycasting, with a small outward offset to keep
the centreline on the epicardial surface. `npm run anatomy:register` (inside
`frontend`) produces the cached overlay, avoiding raycasting a million-triangle
asset on each assessment. `npm run anatomy:check` verifies fingerprints,
shared origin, direction, continuity and surface contact. These are software
geometry checks, not anatomical clinical validation. Regenerate and visually
review all four views whenever the asset or landmarks change.

The viewer renders on demand. Labels are occluded by the model, camera presets
identify the viewing direction, and patient-side labels reverse in posterior
view. Keyboard-accessible table buttons remain available for hidden arteries.

## Coronary visibility

All three mapped reference routes and their positional labels are enabled by
default on a muted heart surface. A checkbox can hide them; Original colours
restores the texture without hiding highlights. Locate buttons select an artery
and switch to an appropriate camera view. Original colours
restores the imported materials without modifying the cached asset. Both modes
use wider coronary tubes with dark silhouette outlines; the selected artery
has a white outline. Unlit, non-tone-mapped overlay colours match the numeric
risk legend. These display widths aid visibility and do not represent measured
artery diameters. Depth testing remains enabled, so vessels behind the heart
must be inspected using the lateral/posterior views rather than drawn through
the myocardium. Registered centreline coordinates remain unchanged.

## Native vessel identification status

Inspection of the current GLB found 14 generically named mesh chunks
(`tripo_node_a904c0bd_tripo_mat_a904c0bd_0`) and a single shared material with
base-colour, normal and metallic/roughness textures. There are no named LAD,
LCX, RCA, coronary-vein meshes or vessel segmentation metadata. The chunk
bounds overlap broad anatomical regions; they are not artery-specific objects.

The visible vessel-like structures remain part of the original asset. They
are **not** automatically assigned arterial identities by their colour, shape
or proximity to our reference routes. Cardiac veins can accompany arteries;
see [cardiac venous anatomy](https://www.ncbi.nlm.nih.gov/books/NBK549786/).
A labelled/segmented asset or reviewed face/vertex annotations is required
before using native regions as verified LAD/LCX/RCA prediction targets.

The interface displays clearly identified reference routes by default to keep
LAD, LCX and RCA visible and selectable. They can be hidden to inspect native
anatomy alone, and remain separate illustrations rather than verified native
vessel identifications.
The model probabilities remain in the table and are not encoded by the native
asset colours. Enabling reference routes does not verify a native mapping.
