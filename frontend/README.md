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

Each input has an info button that opens a brief explanation and a Google search
link in a new tab. Searches use fixed topic names from `src/fieldInfo.ts`, never
patient values. Escape or clicking outside closes the explanation. Model-specific
function-class and wall-motion codes are described without inventing clinical
scale mappings.

The form starts with About the patient expanded. Section headers show supplied
counts and invalid-field counts; Expand/Collapse all controls and a field search
help navigate all inputs. Search matches names, abbreviations and help topics
and opens matching sections without changing values. Invalid values display
inline messages; Analyze clears the search, opens affected sections and focuses
the first invalid input. Empty fields remain valid and optional.

Field badges distinguish Entered, Imported, Sample and Default values. Editing
an imported value changes its badge to Entered; clearing it shows the actual
server default again. Badges describe input source, not clinical reliability.

Results lead with the overall CAD estimate, followed by vessel estimates,
anatomy, explanations, and report/comparison tools. Mobile users can jump between
Inputs, Results and Anatomy using the sticky navigation. Prediction, explanation,
heart loading, PDF import and report preparation each have separate status text.

Start new assessment clears patient inputs, provenance, imported-file details,
results, explanations and comparison state, while retaining theme/view preferences.
Late prediction/import responses are ignored after reset, and leaving/resetting
an assessment cancels its pending report download.

`pdf/extractText.ts` lazily loads pdf.js and extracts selectable text locally
(up to 20 pages/200,000 characters). `pdf/fieldMap.ts` uses aliases and negation
heuristics; out-of-range matches are skipped, not clamped. Review extracted
values before Analyze. Scanned images need manual entry. Imported Sex updates
both model input and the visible Male/Female selection. A preselected Others
identity remains selected, with the imported model-sex radio updated.

`api.ts` calls `/predict`, `/explain`, `/input-defaults`, and `/model-info`. Live explanations use
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

The input coverage panel counts supplied and defaulted fields and lists the
server defaults. Coverage measures completeness, not prediction confidence.
Demo mode reads the matching `public/input-defaults.json` fixture.

After analyzing, choose **Use as comparison baseline**, change inputs, and
analyze again. The comparison shows all four estimates, percentage-point
changes, and changed input values or sources. The baseline stays in browser
memory across dashboard navigation; reloading clears it.

**Download PDF report** exports the completed assessment, including all 54
input values and their sources, predictions, model fingerprints, available
explanations, and the active comparison. Unsubmitted form edits are excluded.
It also embeds a PNG of the current 3D heart view on a dedicated page, including
visible labels and the estimate legend. The image is captured at the export
click, before explanation requests; wait for the heart to load before exporting.
Missing or mismatched-model explanations are explicitly identified. Demo
reports are labelled as fixed examples. Reports are generated locally using
jsPDF; explanation requests send measurements to the configured API.

```bash
npm run build
npm run lint
npm test
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

## Anatomy exploration and image export

- **Isolate selected artery** keeps the selected LAD, LCX or RCA bright and dims
  the other reference paths and their labels. Selecting another artery transfers
  the focus. Enabling isolation from the overall CAD estimate locates LAD first.
- **Anatomy labels** adds the four chamber surface regions, aorta, pulmonary trunk
  and apex. Labels follow the camera, avoid artery buttons, and use conservative
  direction-based visibility; the left atrium appears from behind. These are
  manually registered external landmarks projected onto the mesh, not verified
  chamber segmentation or a view of chamber interiors. Seeds and tour copy live
  in `src/anatomy/exploration.ts`. The anatomical orientation is informed by
  [Cardiac anatomy revisited](https://pmc.ncbi.nlm.nih.gov/articles/PMC1571338/).
- **Guided tour** moves through five steps covering the anterior overview, LAD,
  lateral LCX, posterior surface, and right-sided RCA. Next/Back changes presets
  and selection; Finish/End restores the pre-tour display settings and preset.
  Manual camera or artery selection exits the tour at the current view.
- **Export PNG** downloads the current rendered view with visible artery and
  anatomy labels, orientation, estimates, colour legend, display mode and asset
  credit. It works in expanded view and on mobile. The WebGL frame is rendered
  and copied synchronously, then DOM callouts are composited at twice the display
  resolution; no continuous drawing-buffer preservation or server upload is
  required. A browser error is shown if rendering or encoding fails.

Manual check: select each artery with isolation on; toggle anatomy labels;
inspect front/back/side views; run the tour forward/backward and finish; export
both a labelled view and a view with overlays hidden. Check exported labels,
legend and clipping on desktop/mobile and in expanded view.
