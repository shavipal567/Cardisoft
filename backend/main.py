"""Cardisoft backend: leakage-safe CAD + vessel prediction API."""

from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes import explain as explain_route
from routes import predict as predict_route
from services.predictor import available

DISCLAIMER = (
    "Clinical Safety Notice: this system is a machine-learning research and "
    "decision-support prototype for educational and demonstration purposes. "
    "Its predictions are not a medical diagnosis and must not substitute for "
    "qualified clinical assessment, diagnostic imaging, or professional advice. "
    "Vessel highlighting reflects statistical stenosis probability per named "
    "vessel, not lesion localization."
)

app = FastAPI(title="Cardisoft API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(predict_route.router, tags=["predict"])
app.include_router(explain_route.router, tags=["explain"])


@app.get("/health")
def health():
    return {"status": "ok", "artifacts_loaded": available(),
            "targets": ["cad", "lad", "lcx", "rca"],
            "disclaimer": DISCLAIMER}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
