"""
Maternal pre-birth screen: probability that the newborn will need NICU admission / preterm delivery,
from the 18 maternal fields. A transparent logistic scorecard (coefficients approximate published
odds ratios for preterm birth and NICU admission); it is a screening aid for mothers and midwives,
not a diagnosis. Returns the top contributing factors so the mother portal can explain the score.
"""
from __future__ import annotations

import math

FACTORS = [  # (field, label_en, label_ru, label_kz, contribution(record) -> log-odds)
    ("gestational_age_wk", "Gestational age", "Срок беременности", "Жүктілік мерзімі", lambda r: max(0.0, 37 - r["gestational_age_wk"]) * 0.28),
    ("pre_eclampsia", "Pre-eclampsia", "Преэклампсия", "Преэклампсия", lambda r: 1.1 if r["pre_eclampsia"] else 0.0),
    ("bp", "Blood pressure", "Артериальное давление", "Артериялық қысым", lambda r: 0.6 if (r["bp_systolic"] >= 140 or r["bp_diastolic"] >= 90) else 0.0),
    ("gestational_diabetes", "Gestational diabetes", "Гестационный диабет", "Гестациялық диабет", lambda r: 0.45 if r["gestational_diabetes"] else 0.0),
    ("chronic_hypertension", "Chronic hypertension", "Хроническая гипертензия", "Созылмалы гипертензия", lambda r: 0.5 if r["chronic_hypertension"] else 0.0),
    ("multiple_gestation", "Multiple pregnancy", "Многоплодная беременность", "Көп ұрықты жүктілік", lambda r: 1.0 if r["multiple_gestation"] else 0.0),
    ("prom_hours", "Rupture of membranes", "Излитие вод", "Қағанақ суының кетуі", lambda r: 0.9 if r["prom_hours"] >= 18 else (0.4 if r["prom_hours"] > 0 else 0.0)),
    ("chorioamnionitis", "Chorioamnionitis", "Хориоамнионит", "Хориоамнионит", lambda r: 1.2 if r["chorioamnionitis"] else 0.0),
    ("smoking", "Smoking", "Курение", "Темекі шегу", lambda r: 0.35 if r["smoking"] else 0.0),
    ("hemoglobin", "Anaemia", "Анемия", "Анемия", lambda r: 0.4 if r["hemoglobin"] < 100 else (0.15 if r["hemoglobin"] < 110 else 0.0)),
    ("bmi", "BMI", "ИМТ", "ДМИ", lambda r: 0.3 if (r["bmi"] >= 35 or r["bmi"] < 18.5) else 0.0),
    ("maternal_age", "Maternal age", "Возраст матери", "Ана жасы", lambda r: 0.3 if (r["maternal_age"] >= 40 or r["maternal_age"] < 18) else 0.0),
    ("antenatal_steroids", "Antenatal steroids (protective)", "Антенатальные стероиды (защита)", "Антенаталды стероидтар (қорғаныс)", lambda r: -0.5 if (r["antenatal_steroids"] and r["gestational_age_wk"] < 34) else 0.0),
    ("magnesium_sulfate", "Magnesium sulfate (protective)", "Сульфат магния (защита)", "Магний сульфаты (қорғаныс)", lambda r: -0.25 if (r["magnesium_sulfate"] and r["gestational_age_wk"] < 32) else 0.0),
]
BASE_LOGIT = -2.0  # ≈ 12 % background NICU admission rate


def score(record: dict) -> dict:
    contribs = []
    for key, en, ru, kz, fn in FACTORS:
        c = float(fn(record))
        if abs(c) > 1e-9:
            contribs.append({"key": key, "label": {"en": en, "ru": ru, "kz": kz}, "logodds": round(c, 3), "direction": "risk" if c > 0 else "protective"})
    logit = BASE_LOGIT + sum(c["logodds"] for c in contribs)
    p = 1 / (1 + math.exp(-logit))
    tier = "critical" if p >= 0.6 else "high" if p >= 0.35 else "moderate" if p >= 0.18 else "low"
    contribs.sort(key=lambda c: -abs(c["logodds"]))
    advice = {
        "low": {"en": "Routine antenatal schedule. Keep tracking blood pressure and fetal movements.", "ru": "Плановое наблюдение. Продолжайте измерять давление и считать шевеления.", "kz": "Жоспарлы бақылау. Қысымды өлшеп, ұрық қимылын санауды жалғастырыңыз."},
        "moderate": {"en": "Discuss delivery planning at a Level II–III perinatal centre with your obstetrician.", "ru": "Обсудите с акушером план родов в перинатальном центре II–III уровня.", "kz": "Акушермен II–III деңгейлі перинаталдық орталықта босану жоспарын талқылаңыз."},
        "high": {"en": "Plan delivery at a Level III centre; ask about antenatal steroids if before 34 weeks.", "ru": "Планируйте роды в центре III уровня; спросите об антенатальных стероидах до 34 недель.", "kz": "Босануды III деңгейлі орталықта жоспарлаңыз; 34 аптаға дейін антенаталды стероидтар туралы сұраңыз."},
        "critical": {"en": "Contact your obstetrician today. In-utero transfer to a Level III centre is usually recommended.", "ru": "Свяжитесь с акушером сегодня. Обычно рекомендуется перевод в центр III уровня до родов.", "kz": "Бүгін акушерге хабарласыңыз. Әдетте босануға дейін III деңгейлі орталыққа ауыстыру ұсынылады."},
    }[tier]
    return {"probability": round(p, 3), "percent": round(p * 100), "tier": tier, "factors": contribs[:6], "advice": advice, "disclaimer": "Screening aid, not a diagnosis. Decisions are made by your doctor."}
