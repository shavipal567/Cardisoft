"""Patient input schema. All fields optional with typical-value defaults so
 callers may send partial measurements; missing values are imputed by the
frozen training preprocessor (median / most-frequent, fit on train only)."""

from typing import Optional

from pydantic import BaseModel, Field, field_validator


class PatientInput(BaseModel):
    Age: float = 58.0
    Weight: float = 74.0
    Length: float = 165.0
    Sex: str = "Male"
    BMI: float = 26.8
    DM: int = 0
    HTN: int = 0
    Current_Smoker: Optional[int] = Field(default=0, alias="Current Smoker")
    EX_Smoker: Optional[int] = Field(default=0, alias="EX-Smoker")
    FH: int = 0
    Obesity: str = "Y"
    CRF: str = "N"
    CVA: str = "N"
    Airway_disease: Optional[str] = Field(default="N", alias="Airway disease")
    Thyroid_Disease: Optional[str] = Field(default="N", alias="Thyroid Disease")
    CHF: str = "N"
    DLP: str = "N"
    BP: float = 130.0
    PR: float = 70.0
    Edema: int = 0
    Weak_Peripheral_Pulse: Optional[str] = Field(default="N", alias="Weak Peripheral Pulse")
    Lung_rales: Optional[str] = Field(default="N", alias="Lung rales")
    Systolic_Murmur: Optional[str] = Field(default="N", alias="Systolic Murmur")
    Diastolic_Murmur: Optional[str] = Field(default="N", alias="Diastolic Murmur")
    Typical_Chest_Pain: Optional[int] = Field(default=0, alias="Typical Chest Pain")
    Dyspnea: str = "N"
    Function_Class: Optional[int] = Field(default=0, alias="Function Class")
    Atypical: str = "N"
    Nonanginal: str = "N"
    LowTH_Ang: Optional[str] = Field(default="N", alias="LowTH Ang")
    Q_Wave: Optional[int] = Field(default=0, alias="Q Wave")
    St_Elevation: Optional[int] = Field(default=0, alias="St Elevation")
    St_Depression: Optional[int] = Field(default=0, alias="St Depression")
    Tinversion: int = 0
    LVH: str = "N"
    Poor_R_Progression: Optional[str] = Field(default="N", alias="Poor R Progression")
    BBB: str = "N"
    FBS: float = 98.0
    CR: float = 1.0
    TG: float = 122.0
    LDL: float = 100.0
    HDL: float = 39.0
    BUN: float = 16.0
    ESR: float = 15.0
    HB: float = 13.2
    K: float = 4.2
    Na: float = 141.0
    WBC: float = 7100.0
    Lymph: float = 32.0
    Neut: float = 60.0
    PLT: float = 210.0
    EF_TTE: Optional[float] = Field(default=50.0, alias="EF-TTE")
    Region_RWMA: Optional[int] = Field(default=0, alias="Region RWMA")
    VHD: str = "mild"

    model_config = {"populate_by_name": True}

    @field_validator("Sex", mode="before")
    @classmethod
    def _fix_sex(cls, v):
        return "Female" if v == "Fmale" else v

    def to_feature_dict(self) -> dict:
        data = self.model_dump(by_alias=True)
        # Drop the pythonic duplicate keys, keep CSV-column aliases only.
        for dup in ("Current_Smoker", "EX_Smoker", "Airway_disease",
                    "Thyroid_Disease", "Weak_Peripheral_Pulse", "Lung_rales",
                    "Systolic_Murmur", "Diastolic_Murmur", "Typical_Chest_Pain",
                    "Function_Class", "LowTH_Ang", "Q_Wave", "St_Elevation",
                    "St_Depression", "Poor_R_Progression", "EF_TTE", "Region_RWMA"):
            data.pop(dup, None)
        return data


class ExplainRequest(BaseModel):
    features: PatientInput = PatientInput()
    target: str = Field(default="cad", pattern="^(cad|lad|lcx|rca)$")
    top_k: int = Field(default=10, ge=1, le=60)

    model_config = {"populate_by_name": True}
