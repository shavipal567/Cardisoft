"""Cardisoft backend: leakage-safe CAD + vessel prediction API."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from routes import explain as explain_route
from routes import predict as predict_route
from routes import model_info as model_info_route
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


@app.exception_handler(RequestValidationError)
async def validation_error(_request, exc: RequestValidationError):
    """Keep invalid NaN/Infinity inputs out of the JSON error response."""
    return JSONResponse(status_code=422, content={
        "detail": [{"loc": error["loc"], "msg": error["msg"], "type": error["type"]}
                   for error in exc.errors()]
    })


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(predict_route.router, tags=["predict"])
app.include_router(explain_route.router, tags=["explain"])
app.include_router(model_info_route.router, tags=["model-info"])


@app.get("/health")
def health():
    return {"status": "ok", "artifacts_loaded": available(),
            "targets": ["cad", "lad", "lcx", "rca"],
            "disclaimer": DISCLAIMER}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
