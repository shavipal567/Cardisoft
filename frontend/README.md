# Frontend — Cardisoft dashboard

React + TypeScript + Vite, Recharts, and React Three Fiber. The dashboard
collects patient measurements, imports text PDFs, requests four predictions,
and links the selected vessel to its explanation and schematic 3D heart.
Clinician and patient views use different presentation language.

## Run

Start the backend on port 8000 (see `../README.md`), then:

```bash
npm ci
npm run dev
```

| Setting | Default | Meaning |
|---|---|---|
| `VITE_USE_MOCK` | false | Only the literal `true` enables fixed offline fixtures |
| `VITE_API_URL` | /api | API base; Vite proxies this prefix to localhost:8000 during development |

See `.env.example`. Restart Vite after environment changes. A mode banner is
always visible; demo mode says its outputs do not respond to changed inputs.
Failed live requests show errors, never substitute fixtures. Production hosting
must proxy `/api` to FastAPI or configure an API origin at build time; `vite
preview` has no development proxy.

## Data and display

`fields.ts` defines all 54 model inputs, grouped into eight sections. Every
field is optional; blank numeric inputs and “Not provided” selections are
omitted from requests and receive explicit server defaults. No/absent is an
explicit choice, distinct from missing. Supplied values must pass numeric or
category validation. Names are not included in requests. Category selections
are translated to the backend's exact values. Units appear beside measurements;
acceptance limits are not diagnoses.

`pdf/extractText.ts` lazily loads pdf.js and extracts selectable text locally
(up to 20 pages/200,000 characters). `pdf/fieldMap.ts` uses aliases and negation
heuristics; out-of-range matches are skipped, not clamped. Review extracted
values before Analyze. Scanned images need manual entry. Imported Sex updates
both model input and the visible Male/Female selection. A preselected Others
identity remains selected, with the imported model-sex radio updated.

`api.ts` calls `/predict`, `/explain`, and `/model-info`. Live explanations use
signed, approximate patient-specific Shapley contributions, grouped by original
feature. The chart shows the largest eight contributions, including defaulted
features marked default; the detailed table distinguishes provided values from
server defaults for all 54 inputs.
Errors appear in both clinician and patient views.

`ModelInfo.tsx` uses live saved-artifact metadata. Offline demo mode uses
`public/model-info.json`, an explicitly labelled saved-evaluation snapshot:

```bash
# From repository root, after training and evaluation:
python training/model_info.py --output frontend/public/model-info.json
```

`public/mock_predict.json` and `public/mock_explain.json` remain illustrative
fixtures for explicit demo mode. The obsolete mock metrics file has been removed.

## Verification and limits

```bash
npm run build
npm run lint
```

Manual check: live mode → sample patient → Analyze → edit values → Analyze
again → verify changed probabilities → select all vessels → check signed
explanations → open Model Info. Import a report with the opposite sex and check
both the displayed selection and submitted value. Repeat on mobile/dark mode.

The 3D viewer uses the existing `public/heart.glb` asset, registered so +X is
patient left, +Y superior and +Z anterior. Surface-fitted artery paths replace
the old ellipsoid overlays: LAD follows the anterior interventricular groove;
LCX and RCA follow the left/right AV grooves toward the posterior heart. LAD
and LCX share a left-main origin. Small branches and variants are omitted.
Anterior, posterior and both lateral camera presets accompany rotation/zoom
and accessible artery selection. Hidden labels are occluded by the heart.
Rendering runs on demand; surface raycasting occurs offline. The default display
shows all three coronary reference highlights and positional labels on a muted
heart surface. Original colours restores the textured appearance; the highlights
checkbox can hide the overlays. Locate buttons select each artery and orient the
camera (left lateral for LCX, anterior for LAD/RCA). The current GLB
has 14 generic mesh chunks sharing one material, with no vessel segmentation or
anatomical names. It cannot establish native LAD/LCX/RCA identity by itself.

“Show LAD, LCX and RCA highlights” controls the separately
constructed paths and their labels, enabled by default. These are illustrations, not native-vessel
identifications. In that mode, Vessel focus mutes the heart to make the outlined
routes easier to follow; Original colours restores the asset's materials.
Overlay colours are unlit so they match the risk legend; a white outline
identifies the selected artery. Depth testing still hides posterior segments.
The source asset and cached artery paths are unchanged by these display modes.

`npm run anatomy:register` regenerates `src/anatomy/heart-coronaries.json` from
`src/anatomy/registration.ts` and the GLB. `npm run anatomy:check` checks asset
and landmark fingerprints, surface contact, continuity and route direction.
Regenerate after replacing the asset or changing its registered landmarks.

The asset metadata credits Pigcraft under CC BY 4.0; attribution and the
anatomical reference appear in the viewer. The registration is illustrative,
not clinically validated or patient-specific, and does not locate lesions.
Its direct import still makes the initial JavaScript bundle large.

Original colours uses cloned heart materials at user-adjustable opacity (0–100%, initially 69%) with depth writing
disabled; coronary highlights remain opaque. Source GLB materials/textures are
not mutated. The muted Vessel focus mode remains opaque.

The anatomy workspace places the viewport next to an artery/appearance inspector
on desktop, stacking the inspector below the model on tablet/mobile. Artery cards
show probabilities and orient the camera on selection. Zoom buttons complement
mouse/touch controls; Reset view restores the anterior camera. Expanded view
locks background scrolling, contains keyboard focus and closes with Escape.
The artery table and reference/credit notes live in a collapsible details panel.
The opacity slider remains visible but disabled in the opaque Vessel focus mode.
