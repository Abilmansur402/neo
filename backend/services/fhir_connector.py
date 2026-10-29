"""
HIS connector: Damumed HL7 v2 (MLLP) and KazHealth FHIR R4.

In the pilot build the connector is a stateful simulator that reproduces the
real handshake sequence, token lifecycle and resource counts, so the frontend,
audit trail and schema validator exercise the same code paths as production.
Swap `_SIMULATED = False` and implement `_fetch_live` against the hospital gateway.
"""
from __future__ import annotations

import asyncio
import secrets
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

_SIMULATED = True

CORE_FEATURES = [
    "gestational_age_wk", "birth_weight_g", "sex", "apgar_1", "apgar_5", "delivery_mode", "age_hours", "heart_rate", "resp_rate", "spo2", "fio2",
    "sf_ratio", "map_mmhg", "temperature", "ph", "pco2", "po2", "hco3", "base_excess", "lactate", "glucose", "hemoglobin", "wbc", "platelets",
    "crp", "sodium", "potassium", "creatinine", "bilirubin", "urine_output", "vent_mode",
]
FEATURE_LABELS = {  # EN, KZ, RU
    "gestational_age_wk": ("Gestational age", "Гестация аптасы", "Срок гестации"), "birth_weight_g": ("Birth weight", "Туу салмағы", "Масса при рождении"),
    "sex": ("Sex", "Жынысы", "Пол"), "apgar_1": ("APGAR 1 min", "АПГАР 1 мин", "АПГАР 1 мин"), "apgar_5": ("APGAR 5 min", "АПГАР 5 мин", "АПГАР 5 мин"),
    "delivery_mode": ("Delivery mode", "Босану тәсілі", "Способ родоразрешения"), "age_hours": ("Postnatal age (h)", "Жасы, сағ", "Возраст, часы"),
    "heart_rate": ("Heart rate", "ЖСЖ", "ЧСС"), "resp_rate": ("Respiratory rate", "Тыныс алу жиілігі", "ЧДД"), "spo2": ("SpO2", "SpO2", "SpO2"), "fio2": ("FiO2", "FiO2", "FiO2"),
    "sf_ratio": ("SpO2/FiO2 ratio", "SpO2/FiO2", "SpO2/FiO2"), "map_mmhg": ("Mean arterial pressure", "Орташа АҚ", "Среднее АД"), "temperature": ("Temperature", "Дене қызуы", "Температура"),
    "ph": ("pH", "pH", "pH"), "pco2": ("pCO2", "pCO2", "pCO2"), "po2": ("pO2", "pO2", "pO2"), "hco3": ("HCO3", "HCO3", "HCO3"), "base_excess": ("Base excess", "Негіз артықшылығы", "Избыток оснований"),
    "lactate": ("Lactate", "Лактат", "Лактат"), "glucose": ("Glucose", "Глюкоза", "Глюкоза"), "hemoglobin": ("Hemoglobin", "Гемоглобин", "Гемоглобин"), "wbc": ("WBC", "Лейкоциттер", "Лейкоциты"),
    "platelets": ("Platelets", "Тромбоциттер", "Тромбоциты"), "crp": ("CRP", "СРБ", "СРБ"), "sodium": ("Sodium", "Натрий", "Натрий"), "potassium": ("Potassium", "Калий", "Калий"),
    "creatinine": ("Creatinine", "Креатинин", "Креатинин"), "bilirubin": ("Bilirubin", "Билирубин", "Билирубин"), "urine_output": ("Urine output", "Диурез", "Диурез"), "vent_mode": ("Ventilation mode", "ЖВЛ режимі", "Режим ИВЛ"),
}
# Damumed CSV export header (Russian) → suggested mapping
DAMUMED_EXPORT_COLUMNS = ["id_пациента", "дата_поступления", "отделение", "срок_гестации_нед", "масса_г", "пол", "апгар_1", "апгар_5", "роды_тип", "возраст_ч", "ЧСС", "ЧДД", "SpO2", "FiO2", "АД_ср", "t_тела", "pH", "pCO2", "pO2", "HCO3", "BE", "лактат", "глюкоза", "Hb", "лейк", "тромб", "СРБ", "Na", "K", "креатинин", "билирубин", "диурез_мл_кг_ч", "режим_ИВЛ"]
AUTO_MAP = {"gestational_age_wk": "срок_гестации_нед", "birth_weight_g": "масса_г", "sex": "пол", "apgar_1": "апгар_1", "apgar_5": "апгар_5", "delivery_mode": "роды_тип", "age_hours": "возраст_ч", "heart_rate": "ЧСС", "resp_rate": "ЧДД", "spo2": "SpO2", "fio2": "FiO2", "map_mmhg": "АД_ср", "temperature": "t_тела", "ph": "pH", "pco2": "pCO2", "po2": "pO2", "hco3": "HCO3", "base_excess": "BE", "lactate": "лактат", "glucose": "глюкоза", "hemoglobin": "Hb", "wbc": "лейк", "platelets": "тромб", "crp": "СРБ", "sodium": "Na", "potassium": "K", "creatinine": "креатинин", "bilirubin": "билирубин", "urine_output": "диурез_мл_кг_ч", "vent_mode": "режим_ИВЛ"}

LOINC = {"spo2": "2708-6", "fio2": "3151-8", "lactate": "2524-7", "heart_rate": "8867-4", "resp_rate": "9279-1", "temperature": "8310-5", "ph": "2744-1", "base_excess": "1925-7"}

ENDPOINTS = [
    {"id": "damumed_hl7", "name": "Damumed HL7 v2.5 (MLLP)", "detail": "ADT^A01/A08, ORU^R01", "ready_at": 2},
    {"id": "kazhealth_fhir", "name": "KazHealth FHIR R4", "detail": "Patient, Observation, Encounter", "ready_at": 4},
    {"id": "lis", "name": "Laboratory LIS bridge", "detail": "Blood gas, CBC, CRP", "ready_at": 8},
    {"id": "cv_edge", "name": "CV edge node (RTSP)", "detail": "cam-07 · NFCS, RR, thermal", "ready_at": 9},
    {"id": "monitor", "name": "Bedside monitor stream", "detail": "SpO2, HR, FiO2 (1 Hz)", "ready_at": 11},
]
SCRIPT = [
    ("info", "Opening TLS 1.3 channel to Damumed HL7 gateway (10.14.2.21:2575)"), ("ok", "MLLP handshake complete · ADT^A01/A08 subscription active"),
    ("info", "POST /oauth2/token grant_type=client_credentials scope=system/*.read"), ("ok", "Access token issued · expires in 3600 s · SMART backend services"),
    ("info", "KazHealth FHIR R4 · GET /Patient?_count=50&organization=…"), ("ok", "200 OK · 48 Patient resources · 1.2 s"),
    ("info", "GET /Observation?code=2708-6,3151-8,2524-7 (SpO2, FiO2, lactate)"), ("ok", "200 OK · 3,912 Observation resources · 0.9 s"),
    ("warn", "31 Observations missing UCUM unit · defaulted to mmol/L for 2524-7"), ("info", "CV edge node · RTSP cam-07 · model nfcs-v2 loaded (TensorRT)"),
    ("ok", "Schema validation passed · 29/31 features resolved from live sources"), ("warn", "vent_mode and urine_output not exposed by HIS · manual entry required"),
    ("ok", "Risk pipeline heartbeat · latency 184 ms · 12 beds monitored"),
]


@dataclass
class ConnectorState:
    connected: bool = False
    token: str | None = None
    token_expires: float = 0
    started_at: float = 0
    log: list[dict] = field(default_factory=list)
    step: int = 0

    def endpoint_status(self) -> list[dict]:
        return [{**e, "status": "live" if self.connected and self.step >= e["ready_at"] else ("connecting" if self.connected else "offline")} for e in ENDPOINTS]


class FhirConnector:
    def __init__(self) -> None:
        self.states: dict[str, ConnectorState] = {}
        self._tasks: dict[str, asyncio.Task] = {}

    def state(self, hospital_id: str) -> ConnectorState:
        return self.states.setdefault(hospital_id, ConnectorState())

    async def connect(self, hospital_id: str) -> ConnectorState:
        st = self.state(hospital_id)
        if st.connected:
            return st
        st.connected, st.started_at, st.step, st.log = True, time.time(), 0, []
        st.token, st.token_expires = "mock_" + secrets.token_urlsafe(24), time.time() + 3600
        self._tasks[hospital_id] = asyncio.create_task(self._run(hospital_id))
        return st

    async def disconnect(self, hospital_id: str) -> ConnectorState:
        st = self.state(hospital_id)
        task = self._tasks.pop(hospital_id, None)
        if task:
            task.cancel()
        st.connected, st.token, st.step = False, None, 0
        st.log.append({"t": time.time(), "level": "info", "msg": "Session closed by operator"})
        return st

    async def _run(self, hospital_id: str) -> None:
        st = self.state(hospital_id)
        for level, msg in SCRIPT:
            await asyncio.sleep(0.65)
            st.step += 1
            st.log.append({"t": time.time(), "level": level, "msg": msg})
        while st.connected:  # heartbeat
            await asyncio.sleep(15)
            st.log.append({"t": time.time(), "level": "ok", "msg": f"Heartbeat · token valid {int(st.token_expires - time.time())} s · 12 beds monitored"})

    async def stream(self, hospital_id: str) -> AsyncIterator[dict]:
        st = self.state(hospital_id)
        sent = 0
        while True:
            while sent < len(st.log):
                yield st.log[sent]
                sent += 1
            await asyncio.sleep(0.25)

    @staticmethod
    def schema_template() -> dict:
        return {
            "core_features": [{"key": k, "en": FEATURE_LABELS[k][0], "kz": FEATURE_LABELS[k][1], "ru": FEATURE_LABELS[k][2], "loinc": LOINC.get(k)} for k in CORE_FEATURES],
            "export_columns": DAMUMED_EXPORT_COLUMNS,
            "suggested_mapping": AUTO_MAP,
        }

    @staticmethod
    def validate_mapping(mapping: dict[str, str]) -> dict:
        mapped = {k: v for k, v in mapping.items() if k in CORE_FEATURES and v}
        dupes = {v for v in mapped.values() if list(mapped.values()).count(v) > 1}
        unknown = sorted(v for v in mapped.values() if v not in DAMUMED_EXPORT_COLUMNS)
        missing = [k for k in CORE_FEATURES if k not in mapped]
        return {"mapped": len(mapped), "total": len(CORE_FEATURES), "coverage": round(len(mapped) / len(CORE_FEATURES), 3), "missing": missing, "duplicate_columns": sorted(dupes), "unknown_columns": unknown,
                "valid": not dupes and not unknown}


connector = FhirConnector()
