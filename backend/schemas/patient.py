from datetime import datetime

from pydantic import BaseModel, Field


class VitalsIn(BaseModel):
    heart_rate: float | None = None
    resp_rate: float | None = None
    spo2: float | None = None
    fio2: float | None = None
    map_mmhg: float | None = None
    temperature: float | None = None
    ph: float | None = None
    pco2: float | None = None
    po2: float | None = None
    hco3: float | None = None
    base_excess: float | None = None
    lactate: float | None = None
    glucose: float | None = None
    hemoglobin: float | None = None
    wbc: float | None = None
    platelets: float | None = None
    crp: float | None = None
    sodium: float | None = None
    potassium: float | None = None
    creatinine: float | None = None
    bilirubin: float | None = None
    urine_output: float | None = None
    source: str = "monitor"


class VitalsOut(VitalsIn):
    time: datetime
    patient_id: str

    model_config = {"from_attributes": True}


class PatientBase(BaseModel):
    diagnosis: str
    gestational_age_wk: int = Field(ge=22, le=44)
    birth_weight_g: int = Field(ge=300, le=6000)
    sex: str = Field(pattern="^[MF]$")
    apgar_1: int = Field(ge=0, le=10)
    apgar_5: int = Field(ge=0, le=10)
    delivery_mode: str = "vaginal"
    postnatal_age_h: int = Field(ge=0)
    ventilation_mode: str = "room air"
    bed: str = "07"
    skin_temp_c: float = 36.4
    nfcs: int = Field(default=1, ge=0, le=8)


class PatientCreate(PatientBase):
    id: str = Field(pattern=r"^KZ-\d{4}-\d{3}$")
    hospital_id: str


class PatientOut(PatientBase):
    id: str
    hospital_id: str
    admitted_at: datetime
    event_at: datetime | None = None
    event_label: str | None = None
    latest_vitals: VitalsOut | None = None

    model_config = {"from_attributes": True}
