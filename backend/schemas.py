"""Validated CSV-aliased inputs. Omitted fields use explicit prototype defaults.

Ranges are input acceptance limits, not reference intervals or diagnoses.
Explicit nulls, unknown keys, non-finite numbers and invalid categories fail.
"""
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator

Binary = Annotated[int, Field(strict=True, ge=0, le=1)]
YesNo = Literal["Y", "N"]
Nonnegative = Annotated[float, Field(ge=0)]
Positive = Annotated[float, Field(gt=0)]
Percent = Annotated[float, Field(ge=0, le=100)]


class PatientInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid", allow_inf_nan=False, validate_default=True)

    Age: float = Field(58, ge=20, le=100)
    Weight: Positive = 74
    Length: Positive = 165
    Sex: Literal["Male", "Female"] = "Male"
    BMI: float = Field(26.8, ge=10, le=60)
    DM: Binary = 0
    HTN: Binary = 0
    Current_Smoker: Binary = Field(0, alias="Current Smoker")
    EX_Smoker: Binary = Field(0, alias="EX-Smoker")
    FH: Binary = 0
    Obesity: YesNo = "Y"
    CRF: YesNo = "N"
    CVA: YesNo = "N"
    Airway_disease: YesNo = Field("N", alias="Airway disease")
    Thyroid_Disease: YesNo = Field("N", alias="Thyroid Disease")
    CHF: YesNo = "N"
    DLP: YesNo = "N"
    BP: float = Field(130, ge=60, le=250)
    PR: float = Field(70, ge=30, le=200)
    Edema: Binary = 0
    Weak_Peripheral_Pulse: YesNo = Field("N", alias="Weak Peripheral Pulse")
    Lung_rales: YesNo = Field("N", alias="Lung rales")
    Systolic_Murmur: YesNo = Field("N", alias="Systolic Murmur")
    Diastolic_Murmur: YesNo = Field("N", alias="Diastolic Murmur")
    Typical_Chest_Pain: Binary = Field(0, alias="Typical Chest Pain")
    Dyspnea: YesNo = "N"
    Function_Class: Annotated[int, Field(strict=True, ge=0, le=3)] = Field(0, alias="Function Class")
    Atypical: YesNo = "N"
    Nonanginal: YesNo = "N"
    LowTH_Ang: YesNo = Field("N", alias="LowTH Ang")
    Q_Wave: Binary = Field(0, alias="Q Wave")
    St_Elevation: Binary = Field(0, alias="St Elevation")
    St_Depression: Binary = Field(0, alias="St Depression")
    Tinversion: Binary = 0
    LVH: YesNo = "N"
    Poor_R_Progression: YesNo = Field("N", alias="Poor R Progression")
    BBB: Literal["N", "LBBB", "RBBB"] = "N"
    FBS: float = Field(98, ge=50, le=500)
    CR: Nonnegative = 1
    TG: float = Field(122, ge=20, le=1100)
    LDL: float = Field(100, ge=10, le=300)
    HDL: float = Field(39, ge=10, le=120)
    BUN: Nonnegative = 16
    ESR: Nonnegative = 15
    HB: Positive = 13.2
    K: Positive = 4.2
    Na: Positive = 141
    WBC: Positive = 7100
    Lymph: Percent = 32
    Neut: Percent = 60
    PLT: Nonnegative = 210
    EF_TTE: float = Field(50, alias="EF-TTE", ge=10, le=80)
    Region_RWMA: Annotated[int, Field(strict=True, ge=0, le=4)] = Field(0, alias="Region RWMA")
    VHD: Literal["N", "mild", "Moderate", "Severe"] = "mild"

    @field_validator("Sex", mode="before")
    @classmethod
    def _fix_sex(cls, value):
        return "Female" if value == "Fmale" else value

    def to_feature_dict(self) -> dict:
        return self.model_dump(by_alias=True)


class ExplainRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    features: PatientInput = Field(default_factory=PatientInput)
    target: Literal["cad", "lad", "lcx", "rca"] = "cad"
    top_k: int = Field(default=10, ge=1, le=60)
