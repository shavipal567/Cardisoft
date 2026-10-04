# Multimodal fusion

## Current state: unimodal (tabular only)

The system today consumes one modality: the 54 structured clinical inputs
(demographics, history, exam, symptoms, ECG flags, labs, echo). There is no
imaging, waveform, or signal input — the dataset provides none. Every
statement here and in READMEs reflects that; nothing claims fusion that
doesn't exist.

## Where fusion plugs in (design, not yet built)

The architecture isolates modality-specific work so a new modality touches few
files:

```text
modality A (tabular: present) ──┐
modality B (e.g. ECG waveform) ─┼─► fusion ─► 4 heads (CAD/LAD/LCX/RCA)
modality C (e.g. echo imaging) ─┘
```

1. **Preprocessing**: new modality gets its own builder beside
   `build_preprocessor()` (e.g. `build_ecg_preprocessor()`), returning a fixed
   vector per patient. Tabular branch untouched.
2. **Fusion operator** (in order of complexity): late fusion (concatenate
   modality vectors → current RF/XGB heads — no API change); score-level fusion
   (per-modality heads → meta-learner, mirrors the planned stacking in
   IMPROVEMENTS.md); joint training only if data scale justifies it.
3. **Inference contract**: `predict_patient()` gains optional modality keys;
   missing modalities fall back to tabular-only via the existing imputation
   path (same partial-input philosophy as `schemas.py`).
4. **Explainability**: per-modality attribution blocks concatenated in
   `/explain` (modality-level + feature-level contributions).
5. **Docs**: dataset page gains a modality-availability matrix; evaluation
   gains per-modality ablations (fusion must beat tabular-only by repeated-CV
   AUC to ship).

## What not to do

Add a modality without paired labels for the same 4 heads, or fuse at the raw
input level across mismatched patient cohorts — both break the leakage and
validation guarantees documented in [evaluation](evaluation.md).
