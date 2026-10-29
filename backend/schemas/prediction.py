from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class FeatureVector(BaseModel):
    """The 31 core clinical features. Unknown values are imputed by the engine."""

    gestational_age_wk: float
    birth_weight_g: float
    sex: str = "F"
    apgar_1: float = 7
    apgar_5: float = 8
    delivery_mode: str = "vaginal"
    age_hours: float = 24
    heart_rate: float = 145
    resp_rate: float = 50
    spo2: float = 95
    fio2: float = 21
    sf_ratio: float | None = None
    map_mmhg: float = 40
    temperature: float = 36.8
    ph: float = 7.32
    pco2: float = 45
    po2: float = 60
    hco3: float = 22
    base_excess: float = -2
    lactate: float = 1.8
    glucose: float = 4.5
    hemoglobin: float = 160
    wbc: float = 12
    platelets: float = 220
    crp: float = 3
    sodium: float = 138
    potassium: float = 4.5
    creatinine: float = 60
    bilirubin: float = 80
    urine_output: float = 2.5
    vent_mode: str = "room air"


class PredictRequest(BaseModel):
    patient_id: str
    overrides: dict[str, float | str] = Field(default_factory=dict, description="Slider edits applied on top of latest vitals")
    persist: bool = True


class ShapItem(BaseModel):
    feature: str
    label: str
    value: float | str
    shap: float            # log-odds contribution
    pp: float              # probability-point contribution (allocated)


class PredictResponse(BaseModel):
    prediction_id: UUID | None
    patient_id: str
    model_version: str
    risk_probability: float
    risk_percent: int
    risk_tier: str
    base_rate_percent: int
    shap: list[ShapItem]
    recommendations: list[str]
    features: dict


class ReviewCreate(BaseModel):
    status: str = Field(pattern="^(approved|flagged)$")
    note: str = ""
    observed_outcome: str = ""
    confidence_flag: int = Field(default=0, ge=0, le=2)


class ReviewOut(BaseModel):
    id: UUID
    prediction_id: UUID
    reviewer_name: str
    status: str
    note: str
    observed_outcome: str
    confidence_flag: int
    created_at: datetime

    model_config = {"from_attributes": True}


class PredictionListItem(BaseModel):
    id: UUID
    patient_id: str
    risk_percent: int
    risk_tier: str
    model_version: str
    created_at: datetime
    review: ReviewOut | None = None
