"""Demo seed: hospitals, three role users, four neonate cases with 24 h of vitals."""
from datetime import datetime, timedelta, timezone

import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.clinical import BabyEntry, ClinicalTask, MaternalRecord
from models.patient import Patient
from models.telemetry import VitalSign
from models.user import Hospital, User, UserRole
from services.security import hash_password

HOSPITALS = [
    Hospital(id="astana-nrc", name="National Research Center for Maternal and Child Health", name_kz="Ана мен бала денсаулығын сақтау ұлттық ғылыми орталығы", city="Astana", his_vendor="Damumed", care_level="III"),
    Hospital(id="almaty-pc1", name="Almaty Perinatal Center #1", name_kz="Алматы перинаталдық орталығы №1", city="Almaty", his_vendor="Damumed", care_level="III"),
    Hospital(id="shymkent-rpc", name="Shymkent Regional Perinatal Center", name_kz="Шымкент өңірлік перинаталдық орталығы", city="Shymkent", his_vendor="KazHealth", care_level="II"),
    Hospital(id="karaganda-rpc", name="Karaganda Regional Perinatal Center", name_kz="Қарағанды облыстық перинаталдық орталығы", city="Karaganda", his_vendor="Damumed", care_level="II"),
]
DEMO_PASSWORD = "Pilot2026!"
USERS = [
    ("neonatologist@neooutcome.kz", "Dr. Aigerim Nurlanova", UserRole.neonatologist, "astana-nrc"),
    ("analyst@neooutcome.kz", "Daniyar Akhmetov", UserRole.analyst, "astana-nrc"),
    ("mother@neooutcome.kz", "Aizhan Serikova", UserRole.mother, "astana-nrc"),
    ("admin@neooutcome.kz", "Gulnara Bekova", UserRole.admin, "astana-nrc"),
]
PATIENTS = [
    dict(id="KZ-2026-089", hospital_id="astana-nrc", diagnosis="Extreme prematurity, suspected PDA", gestational_age_wk=28, birth_weight_g=1050, sex="F", apgar_1=4, apgar_5=5, delivery_mode="cesarean", postnatal_age_h=68, ventilation_mode="nCPAP", bed="07", skin_temp_c=35.6, nfcs=4,
         vitals=dict(heart_rate=172, resp_rate=68, spo2=88, fio2=55, map_mmhg=34, temperature=36.2, ph=7.24, pco2=58, po2=48, hco3=19, base_excess=-8.5, lactate=4.1, glucose=3.9, hemoglobin=142, wbc=18.2, platelets=140, crp=22, sodium=136, potassium=5.1, creatinine=78, bilirubin=130, urine_output=1.4)),
    dict(id="KZ-2026-104", hospital_id="astana-nrc", diagnosis="Respiratory Distress Syndrome", gestational_age_wk=31, birth_weight_g=1480, sex="M", apgar_1=5, apgar_5=6, delivery_mode="vaginal", postnatal_age_h=19, ventilation_mode="SIMV", bed="03", skin_temp_c=36.3, nfcs=2,
         vitals=dict(heart_rate=158, resp_rate=62, spo2=91, fio2=40, map_mmhg=38, temperature=36.7, ph=7.29, pco2=52, po2=55, hco3=21, base_excess=-5.0, lactate=2.8, glucose=4.4, hemoglobin=155, wbc=13.1, platelets=210, crp=9, sodium=138, potassium=4.7, creatinine=64, bilirubin=95, urine_output=2.1)),
    dict(id="KZ-2026-117", hospital_id="astana-nrc", diagnosis="Transient tachypnoea of newborn", gestational_age_wk=36, birth_weight_g=2600, sex="F", apgar_1=7, apgar_5=8, delivery_mode="cesarean", postnatal_age_h=30, ventilation_mode="HFNC", bed="11", skin_temp_c=36.6, nfcs=1,
         vitals=dict(heart_rate=140, resp_rate=54, spo2=96, fio2=25, map_mmhg=44, temperature=36.9, ph=7.33, pco2=46, po2=64, hco3=23, base_excess=-2.0, lactate=1.6, glucose=4.9, hemoglobin=168, wbc=11.4, platelets=240, crp=3, sodium=139, potassium=4.4, creatinine=55, bilirubin=110, urine_output=2.8)),
    dict(id="KZ-2026-121", hospital_id="astana-nrc", diagnosis="ELBW, early-onset sepsis suspected", gestational_age_wk=26, birth_weight_g=820, sex="M", apgar_1=3, apgar_5=4, delivery_mode="cesarean", postnatal_age_h=41, ventilation_mode="HFOV", bed="01", skin_temp_c=35.1, nfcs=6,
         vitals=dict(heart_rate=185, resp_rate=72, spo2=84, fio2=80, map_mmhg=28, temperature=35.9, ph=7.18, pco2=64, po2=42, hco3=16, base_excess=-12.0, lactate=6.3, glucose=2.9, hemoglobin=128, wbc=3.1, platelets=68, crp=48, sodium=133, potassium=5.6, creatinine=96, bilirubin=150, urine_output=0.8)),
]


async def seed(db: AsyncSession) -> None:
    if (await db.execute(select(Hospital).limit(1))).scalar_one_or_none():
        return
    db.add_all(HOSPITALS)
    for email, name, role, hosp in USERS:
        db.add(User(email=email, full_name=name, hashed_password=hash_password(DEMO_PASSWORD), role=role, hospital_id=hosp))
    await db.flush()
    now = datetime.now(timezone.utc)
    rng = np.random.default_rng(7)
    EVENTS = {"KZ-2026-089": (now - timedelta(hours=3, minutes=30), "Escalated to HFOV, suspected sepsis"), "KZ-2026-121": (now - timedelta(hours=1, minutes=30), "Intubated; inotropes started")}
    for spec in PATIENTS:
        vitals = spec.pop("vitals")
        ev = EVENTS.get(spec["id"])
        db.add(Patient(**spec, event_at=ev[0] if ev else None, event_label=ev[1] if ev else None))
        # 24 h of 15-minute monitor samples. Deteriorating cases drift from a stable baseline toward their current
        # (abnormal) values with a smooth sigmoid so the time machine shows a gradual rise → alert → event.
        unstable = spec["id"] in EVENTS
        base = {"heart_rate": 150 if unstable else vitals["heart_rate"] + 4, "spo2": 94 if unstable else vitals["spo2"] - 1, "fio2": 30 if unstable else vitals["fio2"] + 3,
                "resp_rate": 55 if unstable else vitals["resp_rate"], "lactate": 1.8 if unstable else vitals["lactate"], "base_excess": -2.5 if unstable else vitals["base_excess"], "temperature": 36.8 if unstable else vitals["temperature"]}
        for i in range(96, -1, -1):
            h = (96 - i) / 4.0                                    # hours since window start
            k = 1 / (1 + np.exp(-(h - 14) / 2.2)) if unstable else 1.0   # smooth transition centred ~10 h before "now"
            row = {}
            for key, val in vitals.items():
                target = base.get(key, val) + (val - base.get(key, val)) * k
                if key in ("heart_rate", "spo2", "fio2", "resp_rate"):
                    row[key] = float(target + rng.normal(0, 0.8))
                else:
                    row[key] = float(target) if i % 16 == 0 else None     # labs every 4 h
            db.add(VitalSign(time=now - timedelta(minutes=15 * i), patient_id=spec["id"], source="monitor" if i % 16 else "lab", **row))
    # Portal 3: the mother account owns KZ-2026-104's pregnancy record and sees the family log
    mother = (await db.execute(select(User).where(User.email == "mother@neooutcome.kz"))).scalar_one()
    db.add(MaternalRecord(user_id=mother.id, hospital_id="astana-nrc", patient_id="KZ-2026-104", maternal_age=29, gravidity=2, parity=1, gestational_age_wk=31, bmi=27.4, bp_systolic=138, bp_diastolic=88,
                          pre_eclampsia=False, gestational_diabetes=True, chronic_hypertension=False, antenatal_steroids=True, magnesium_sulfate=False, prom_hours=22, chorioamnionitis=False,
                          multiple_gestation=False, smoking=False, hemoglobin=104, planned_delivery_mode="vaginal"))
    for day, w, feed, resp, ms, note in [(1, 1480, "parenteral", "SIMV", "Admitted to NICU, surfactant given", "Your baby is breathing with help from a ventilator. The team gave surfactant to help the lungs open."),
                                          (2, 1410, "tube", "SIMV", None, "Small feeds through a tube started. Weight loss in the first days is expected."),
                                          (3, 1395, "tube", "nCPAP", "Extubated to CPAP", "Off the ventilator today — breathing with gentle pressure support."),
                                          (5, 1420, "tube", "HFNC", "First skin-to-skin contact", "Kangaroo care for 40 minutes. Weight is climbing again.")]:
        db.add(BabyEntry(patient_id="KZ-2026-104", day=day, weight_g=w, feeding=feed, respiratory_support=resp, milestone=ms, note_for_family=note))
    doc = (await db.execute(select(User).where(User.email == "neonatologist@neooutcome.kz"))).scalar_one()
    for title, pid, prio, mins in [("Repeat blood gas", "KZ-2026-089", "high", 60), ("Echocardiogram for suspected PDA", "KZ-2026-089", "normal", 240), ("Review feeding plan with dietitian", "KZ-2026-117", "low", 480), ("Blood culture results due", "KZ-2026-121", "critical", 30)]:
        db.add(ClinicalTask(hospital_id="astana-nrc", patient_id=pid, title=title, priority=prio, created_by=doc.id, due_at=now + timedelta(minutes=mins)))
    await db.commit()
    print(f"[seed] demo data loaded · users: {', '.join(u[0] for u in USERS)} · password: {DEMO_PASSWORD}")
