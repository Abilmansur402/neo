"""Patient bundle contract, synthetic demo patient and PDF patient card.

Ported from the initial NeoOutcome repository (``patient_demo.py``):
  * the 31-feature *12-hour aggregate* contract (``EXPECTED_FEATURES``) used by
    the CSV / JSON bundle import on the intake page;
  * ``synthetic_patient()`` – one deterministic, entirely fictional encounter;
  * ``review_actions()`` – rule-based checklist for the clinician;
  * ``render_patient_pdf()`` – reportlab card with the "СИНТЕТИЧЕСКИЕ ДАННЫЕ"
    watermark for synthetic bundles.

The 12-hour aggregates are mapped onto the live ``RiskEngine`` contract
(``bundle_to_engine_features``) so that imported bundles are scored by the
same model that scores patients in the ward.
"""

from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

SYNTHETIC_NOTICE = (
    "Синтетические данные. Исследовательский прототип. "
    "Не является диагнозом или медицинской рекомендацией."
)
CLINICAL_NOTICE = (
    "Поддержка принятия решений. Окончательное решение принимает врач (Закон РК № 230-VIII). "
    "Не является диагнозом или медицинской рекомендацией."
)

# 12-hour aggregate contract of the initial NeoOutcome model (31 features).
EXPECTED_FEATURES = [
    "gender", "age_days_at_admission",
    "hr_mean", "hr_min", "hr_max", "rr_mean", "rr_min", "rr_max", "temp_mean", "temp_max", "sbp_mean", "vitals_count_12h",
    "ph_mean", "ph_min", "lactate_mean", "lactate_max", "po2_mean", "po2_min", "pco2_mean", "base_excess_mean", "base_excess_min",
    "glucose_mean", "glucose_min", "glucose_max", "hemoglobin_mean", "platelets_min", "wbc_mean", "wbc_max", "sodium_mean",
    "potassium_mean", "labs_count_12h",
]

FEATURE_LABELS = {
    "gender": "Пол (модель: M=1, F=0)", "age_days_at_admission": "Возраст при поступлении",
    "hr_mean": "ЧСС, среднее", "hr_min": "ЧСС, минимум", "hr_max": "ЧСС, максимум",
    "rr_mean": "ЧДД, среднее", "rr_min": "ЧДД, минимум", "rr_max": "ЧДД, максимум",
    "temp_mean": "Температура, средняя", "temp_max": "Температура, максимум", "sbp_mean": "Систолическое АД, среднее",
    "vitals_count_12h": "Измерений витальных показателей", "ph_mean": "pH, среднее", "ph_min": "pH, минимум",
    "lactate_mean": "Лактат, среднее", "lactate_max": "Лактат, максимум", "po2_mean": "pO2, среднее", "po2_min": "pO2, минимум",
    "pco2_mean": "pCO2, среднее", "base_excess_mean": "Избыток оснований (BE), среднее", "base_excess_min": "Избыток оснований (BE), минимум",
    "glucose_mean": "Глюкоза, средняя", "glucose_min": "Глюкоза, минимум", "glucose_max": "Глюкоза, максимум",
    "hemoglobin_mean": "Гемоглобин, средний", "platelets_min": "Тромбоциты, минимум", "wbc_mean": "Лейкоциты, среднее",
    "wbc_max": "Лейкоциты, максимум", "sodium_mean": "Натрий, средний", "potassium_mean": "Калий, средний",
    "labs_count_12h": "Лабораторных измерений",
}

FEATURE_UNITS = {
    "gender": "код", "age_days_at_admission": "дней", "hr_mean": "уд/мин", "hr_min": "уд/мин", "hr_max": "уд/мин",
    "rr_mean": "вдох/мин", "rr_min": "вдох/мин", "rr_max": "вдох/мин", "temp_mean": "°C", "temp_max": "°C", "sbp_mean": "мм рт. ст.",
    "vitals_count_12h": "измерений", "ph_mean": "", "ph_min": "", "lactate_mean": "ммоль/л", "lactate_max": "ммоль/л",
    "po2_mean": "мм рт. ст.", "po2_min": "мм рт. ст.", "pco2_mean": "мм рт. ст.", "base_excess_mean": "ммоль/л", "base_excess_min": "ммоль/л",
    "glucose_mean": "ммоль/л", "glucose_min": "ммоль/л", "glucose_max": "ммоль/л", "hemoglobin_mean": "г/л", "platelets_min": "10^9/л",
    "wbc_mean": "10^9/л", "wbc_max": "10^9/л", "sodium_mean": "ммоль/л", "potassium_mean": "ммоль/л", "labs_count_12h": "измерений",
}

# 12-h aggregate -> live engine feature (point value). Means are used; extrema sharpen the recommendation rules.
AGGREGATE_TO_ENGINE = {
    "hr_mean": "heart_rate", "rr_mean": "resp_rate", "temp_mean": "temperature", "sbp_mean": "map_mmhg", "ph_mean": "ph",
    "lactate_mean": "lactate", "po2_mean": "po2", "pco2_mean": "pco2", "base_excess_mean": "base_excess", "glucose_mean": "glucose",
    "hemoglobin_mean": "hemoglobin", "platelets_min": "platelets", "wbc_mean": "wbc", "sodium_mean": "sodium", "potassium_mean": "potassium",
}


def synthetic_patient() -> dict[str, Any]:
    """Return one deterministic, entirely fictional NICU encounter."""
    return {
        "schema_version": "1.0",
        "synthetic": True,
        "patient": {
            "patient_id": "SYN-NICU-0001", "full_name": "Демо-пациент N-0001", "sex": "F", "date_of_birth": "2026-07-12",
            "gestational_age": "32 недели 4 дня", "birth_weight_g": 1780, "current_weight_g": 1740, "blood_group": "не определена",
        },
        "encounter": {
            "encounter_id": "SYN-HADM-0001", "institution": "NeoOutcome Demonstration NICU",
            "department": "Отделение реанимации и интенсивной терапии новорождённых",
            "admitted_at": "2026-07-17T08:15:00+05:00", "prediction_time": "2026-07-17T20:15:00+05:00",
            "admission_diagnosis": "Респираторный дистресс, динамическое наблюдение", "attending_clinician": "Демо-врач А. Каримова",
        },
        "features": {
            "gender": 0, "age_days_at_admission": 5.0, "hr_mean": 165.0, "hr_min": 130.0, "hr_max": 205.0, "rr_mean": 52.0, "rr_min": 35.0,
            "rr_max": 78.0, "temp_mean": 36.7, "temp_max": 37.4, "sbp_mean": 52.0, "vitals_count_12h": 96, "ph_mean": 7.21, "ph_min": 7.12,
            "lactate_mean": 3.8, "lactate_max": 5.2, "po2_mean": 64.0, "po2_min": 48.0, "pco2_mean": 52.0, "base_excess_mean": -6.5,
            "base_excess_min": -10.0, "glucose_mean": 4.5, "glucose_min": 2.8, "glucose_max": 7.1, "hemoglobin_mean": 145.0,
            "platelets_min": 155.0, "wbc_mean": 18.0, "wbc_max": 21.0, "sodium_mean": 137.0, "potassium_mean": 4.7, "labs_count_12h": 22,
        },
    }


# ------------------------------------------------------------------ parsing
def _num(raw: Any) -> float | None:
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    s = str(raw).strip().replace(",", ".")
    if not s or s.lower() in ("nan", "null", "none", "—", "-"):
        return None
    return float(s)


def coerce_features(payload: dict[str, Any]) -> tuple[dict[str, float | None], list[str]]:
    values: dict[str, float | None] = {}
    missing: list[str] = []
    for name in EXPECTED_FEATURES:
        try:
            v = _num(payload.get(name))
        except ValueError as exc:
            raise ValueError(f"{name}: ожидается число, получено {payload.get(name)!r}") from exc
        values[name] = v
        if v is None:
            missing.append(name)
    return values, missing


def parse_bundle_upload(filename: str, content: bytes) -> dict[str, Any]:
    """Accept a JSON bundle (``{patient, encounter, features}``) or a one-row CSV of features."""
    name = (filename or "").lower()
    if name.endswith(".json"):
        data = json.loads(content.decode("utf-8-sig"))
        if "features" not in data:
            data = {"features": data}
        data.setdefault("patient", {"patient_id": Path(name).stem.upper(), "full_name": "Импорт из JSON", "sex": "?", "date_of_birth": ""})
        data.setdefault("encounter", {"encounter_id": "—", "institution": "—", "department": "ОРИТН", "admitted_at": "", "prediction_time": "", "admission_diagnosis": "—"})
        data.setdefault("synthetic", bool(data.get("synthetic", False)))
        return data
    rows = list(csv.DictReader(io.StringIO(content.decode("utf-8-sig"))))
    if not rows:
        raise ValueError("CSV не содержит строк")
    row = rows[0]
    if "feature" in row and "value" in row:  # long format: feature,value
        feats = {r["feature"].strip(): r["value"] for r in rows}
    else:  # wide format: one header row
        feats = {k.strip(): v for k, v in row.items() if k}
    pid = feats.pop("patient_id", None) or Path(name).stem.upper()
    return {
        "schema_version": "1.0", "synthetic": str(pid).startswith("SYN"),
        "patient": {"patient_id": str(pid), "full_name": f"Импорт {pid}", "sex": "M" if str(feats.get("gender", "0")).strip() in ("1", "M", "m") else "F", "date_of_birth": ""},
        "encounter": {"encounter_id": "—", "institution": "—", "department": "ОРИТН", "admitted_at": "", "prediction_time": "", "admission_diagnosis": "Импорт из CSV"},
        "features": feats,
    }


def bundle_to_engine_features(bundle: dict[str, Any]) -> dict[str, Any]:
    """Map a 12-h aggregate bundle onto the live RiskEngine contract."""
    f, _ = coerce_features(bundle.get("features", {}))
    p = bundle.get("patient", {})
    out: dict[str, Any] = {}
    for src, dst in AGGREGATE_TO_ENGINE.items():
        if f.get(src) is not None:
            out[dst] = f[src]
    if f.get("age_days_at_admission") is not None:
        out["age_hours"] = f["age_days_at_admission"] * 24
    sex = p.get("sex") or ("M" if f.get("gender") == 1 else "F")
    out["sex"] = "M" if str(sex).upper().startswith("M") else "F"
    if p.get("birth_weight_g"):
        out["birth_weight_g"] = float(p["birth_weight_g"])
    ga = p.get("gestational_age")
    if isinstance(ga, (int, float)):
        out["gestational_age_wk"] = float(ga)
    elif isinstance(ga, str) and ga[:2].isdigit():
        out["gestational_age_wk"] = float(ga[:2])
    return out


# ------------------------------------------------------------------ rules
def risk_band(risk: float, threshold: float) -> str:
    if risk >= threshold:
        return "high"
    if risk >= threshold * 0.7:
        return "elevated"
    if risk >= threshold * 0.35:
        return "moderate"
    return "low"


def review_actions(risk: float, threshold: float, features: dict[str, float | None]) -> list[str]:
    actions = ["Сверить загруженные значения с первичной медицинской документацией."]
    if risk >= threshold:
        actions.extend([
            "Передать оценку старшему врачу для приоритетного клинического осмотра по локальному протоколу.",
            "Продолжить непрерывный мониторинг и задокументировать повторную оценку состояния.",
        ])
    elif risk >= threshold * 0.35:
        actions.append("Запланировать повторный врачебный осмотр и обновить оценку после новых измерений.")
    else:
        actions.append("Продолжить плановое наблюдение по протоколу отделения.")
    if (features.get("ph_min") or 9) < 7.25 or (features.get("base_excess_min") or 0) < -8:
        actions.append("Повторно проверить газовый состав крови и кислотно-основное состояние.")
    if (features.get("lactate_max") or 0) > 4:
        actions.append("Проверить динамику лактата и сопоставить её с клиническими признаками перфузии.")
    if (features.get("glucose_min") or 99) < 3:
        actions.append("Повторно измерить глюкозу и оценить динамику по локальному протоколу.")
    if (features.get("hr_max") or 0) > 200:
        actions.append("Проверить эпизоды тахикардии по исходной записи мониторинга.")
    return actions[:7]


def feature_flag(feature: str, value: float | None) -> str:
    if value is None:
        return "нет данных"
    attention = (
        (feature == "ph_min" and value < 7.25) or (feature == "lactate_max" and value > 4) or (feature == "base_excess_min" and value < -8)
        or (feature == "glucose_min" and value < 3) or (feature == "hr_max" and value > 200)
    )
    return "проверить" if attention else "зафиксировано"


def value_text(value: Any) -> str:
    if value is None:
        return "нет данных"
    if isinstance(value, float):
        return f"{value:.2f}".rstrip("0").rstrip(".")
    return str(value)


# ------------------------------------------------------------------ PDF
_FONT_CANDIDATES = [
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"),
    ("C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/arialbd.ttf"),
    ("/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
]


def register_pdf_fonts() -> tuple[str, str]:
    for regular, bold in _FONT_CANDIDATES:
        if Path(regular).exists() and Path(bold).exists():
            if "NeoSans" not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont("NeoSans", regular))
                pdfmetrics.registerFont(TTFont("NeoSansBold", bold))
            return "NeoSans", "NeoSansBold"
    return "Helvetica", "Helvetica-Bold"


def render_patient_pdf(bundle: dict[str, Any], output_path: Path | None = None) -> bytes:
    """Render the patient card. Returns PDF bytes (also written to ``output_path`` if given)."""
    regular_font, bold_font = register_pdf_fonts()
    styles = getSampleStyleSheet()
    body = ParagraphStyle("BodyRu", parent=styles["BodyText"], fontName=regular_font, fontSize=9, leading=12, textColor=colors.HexColor("#243447"))
    small = ParagraphStyle("SmallRu", parent=body, fontSize=7.5, leading=10, textColor=colors.HexColor("#607284"))
    title = ParagraphStyle("TitleRu", parent=body, fontName=bold_font, fontSize=18, leading=22, textColor=colors.HexColor("#14213D"))
    section = ParagraphStyle("SectionRu", parent=body, fontName=bold_font, fontSize=10, leading=13, textColor=colors.HexColor("#163a45"), spaceBefore=7, spaceAfter=5)
    center = ParagraphStyle("CenterRu", parent=body, alignment=TA_CENTER)
    left_bold = ParagraphStyle("BoldRu", parent=body, fontName=bold_font, alignment=TA_LEFT)
    table_header = ParagraphStyle("TableHeaderRu", parent=left_bold, fontSize=8.5, leading=10, textColor=colors.white)
    action_style = ParagraphStyle("ActionRu", parent=body, fontSize=8, leading=10, spaceAfter=1)

    patient, encounter, prediction, features = bundle["patient"], bundle["encounter"], bundle["prediction"], bundle["features"]
    synthetic = bool(bundle.get("synthetic"))
    buf = io.BytesIO()
    document = SimpleDocTemplate(buf, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=17 * mm, bottomMargin=16 * mm,
                                 title=("Синтетическая карта пациента NeoOutcome" if synthetic else "Карта пациента NeoOutcome"), author="NeoOutcome AI")

    def page_decor(canvas: Any, doc: Any) -> None:
        canvas.saveState()
        width, height = A4
        logo = Path(__file__).resolve().parent.parent / "data" / "logo.png"
        if logo.exists():
            canvas.drawImage(str(logo), 16 * mm, height - 13 * mm, width=6 * mm, height=6 * mm, mask="auto")
        canvas.setFont(bold_font, 7.5)
        canvas.setFillColor(colors.HexColor("#14213D"))
        canvas.drawString(23.5 * mm, height - 10.5 * mm, "NeoOutcome AI · " + ("синтетический пациент" if synthetic else "карта пациента"))
        canvas.setFont(regular_font, 7)
        canvas.setFillColor(colors.HexColor("#6b7b8c"))
        canvas.drawRightString(width - 16 * mm, 9 * mm, f"Страница {doc.page}")
        if synthetic:
            canvas.setFillColor(colors.Color(0.75, 0.12, 0.15, alpha=0.09))
            canvas.setFont(bold_font, 27)
            canvas.translate(width / 2, height / 2)
            canvas.rotate(34)
            canvas.drawCentredString(0, 0, "СИНТЕТИЧЕСКИЕ ДАННЫЕ")
        canvas.restoreState()

    story: list[Any] = [
        Paragraph("Карта пациента NICU", title),
        Paragraph("Демонстрационный документ для проверки интеграции данных, ML-модели и интерфейса врача." if synthetic
                  else "Сводка оценки риска для врачебной проверки и подписи.", small),
        Spacer(1, 5 * mm),
    ]

    def kv_table(rows: list[tuple[str, str]], shaded: bool) -> Table:
        t = Table([[Paragraph(k, left_bold), Paragraph(escape(str(v)), body)] for k, v in rows], colWidths=[52 * mm, 126 * mm])
        style = [("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#b8c9cc")), ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#d8e1e3")),
                 ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                 ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]
        if shaded:
            style.append(("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#e8f3f3")))
        t.setStyle(TableStyle(style))
        return t

    story.extend([kv_table([
        ("Пациент", patient.get("full_name", "—")), ("ID пациента", patient.get("patient_id", "—")), ("Госпитализация", encounter.get("encounter_id", "—")),
        ("Пол / дата рождения", f"{patient.get('sex', '—')} / {patient.get('date_of_birth', '—')}"), ("Гестационный возраст", patient.get("gestational_age", "—")),
        ("Вес", f"{patient.get('current_weight_g', '—')} г (при рождении {patient.get('birth_weight_g', '—')} г)"),
    ], True), Spacer(1, 4 * mm)])

    story.extend([Paragraph("Госпитализация", section), kv_table([
        ("Учреждение", encounter.get("institution", "—")), ("Отделение", encounter.get("department", "—")), ("Поступление", encounter.get("admitted_at", "—")),
        ("Окно прогноза", f"первые 12 часов, до {encounter.get('prediction_time', '—')}"), ("Причина поступления", encounter.get("admission_diagnosis", "—")),
    ], False)])

    band_colors = {"low": "#d9f0e4", "moderate": "#f5e4a8", "elevated": "#f3c08f", "high": "#efaaaa", "critical": "#efaaaa"}
    risk_table = Table([[
        Paragraph("Оценка модели", left_bold),
        Paragraph(f"{prediction['risk_percent']:.1f}%", ParagraphStyle("Risk", parent=title, fontSize=22, alignment=TA_CENTER)),
        Paragraph(f"Уровень: {prediction['risk_band'].upper()}<br/>Порог: {prediction['operating_threshold']:.3f}<br/>Модель: {escape(str(prediction.get('model_version', '')))}", center),
    ]], colWidths=[55 * mm, 55 * mm, 68 * mm])
    risk_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(band_colors.get(prediction["risk_band"], "#f5e4a8"))),
        ("BOX", (0, 0), (-1, -1), 0.7, colors.HexColor("#aebdc1")), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.extend([Paragraph("ML-оценка после первых 12 часов", section), risk_table, Spacer(1, 3 * mm),
                  Paragraph("Оценка предназначена для поддержки решений и требует врачебной проверки.", small)])

    vital_names, lab_names = EXPECTED_FEATURES[2:12], EXPECTED_FEATURES[12:]

    def feature_table(names: list[str]) -> Table:
        rows: list[list[Any]] = [[Paragraph("Показатель", table_header), Paragraph("Значение", table_header), Paragraph("Единица", table_header), Paragraph("Статус", table_header)]]
        for name in names:
            value = _num(features.get(name)) if features.get(name) not in (None, "") else None
            rows.append([Paragraph(escape(FEATURE_LABELS[name]), body), Paragraph(value_text(value), body), Paragraph(FEATURE_UNITS.get(name, ""), small), Paragraph(feature_flag(name, value), small)])
        table = Table(rows, colWidths=[76 * mm, 32 * mm, 33 * mm, 37 * mm], repeatRows=1)
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#14213D")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#becbce")), ("LINEBELOW", (0, 1), (-1, -2), 0.2, colors.HexColor("#dfe6e8")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        for row_number, name in enumerate(names, start=1):
            v = _num(features.get(name)) if features.get(name) not in (None, "") else None
            if feature_flag(name, v) == "проверить":
                table.setStyle(TableStyle([("BACKGROUND", (3, row_number), (3, row_number), colors.HexColor("#fde2df"))]))
        return table

    story.extend([Paragraph("Витальные показатели", section), feature_table(vital_names)])
    story.extend([Paragraph("Лабораторные показатели", section), feature_table(lab_names)])

    factor_rows = [[Paragraph("Фактор", left_bold), Paragraph("Вклад", left_bold), Paragraph("Направление", left_bold)]]
    for factor in prediction["top_factors"]:
        factor_rows.append([Paragraph(escape(str(factor["label"])), body), Paragraph(f"{factor['contribution']:+.3f}", body),
                            Paragraph("повышает" if factor["direction"] == "raises" else "снижает", small)])
    factors_table = Table(factor_rows, colWidths=[112 * mm, 30 * mm, 36 * mm], repeatRows=1)
    factors_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8f3f3")), ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#becbce")),
        ("LINEBELOW", (0, 1), (-1, -2), 0.2, colors.HexColor("#dfe6e8")), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.extend([Paragraph("Ключевые факторы модели", section), factors_table])

    action_flowables = [Paragraph(f"{i}. {escape(a)}", action_style) for i, a in enumerate(prediction["review_actions"], start=1)]
    story.extend([
        Paragraph("Действия для врачебной проверки", section), KeepTogether(action_flowables),
        Paragraph(f"<b>Важно:</b> {escape(SYNTHETIC_NOTICE if synthetic else CLINICAL_NOTICE)}", small), Spacer(1, 1.5 * mm),
        Paragraph("Подпись врача: ____________________    Дата/время: ____________________", small),
    ])
    document.build(story, onFirstPage=page_decor, onLaterPages=page_decor)
    data = buf.getvalue()
    if output_path:
        Path(output_path).write_bytes(data)
    return data


def score_bundle(bundle: dict[str, Any]) -> dict[str, Any]:
    """Score a 12-h aggregate bundle with the live RiskEngine and attach a ``prediction`` block."""
    from services.ml_engine import risk_engine, tier_for
    from services.shap_service import waterfall

    feats, missing = coerce_features(bundle.get("features", {}))
    engine_feats = bundle_to_engine_features(bundle)
    # the 12-h contract has no SpO2/FiO2: impute both from the cohort medians instead of assuming room air
    for k in ("spo2", "fio2"):
        if k not in engine_feats and k in risk_engine.medians:
            engine_feats[k] = float(risk_engine.medians[k])
    result = risk_engine.predict(engine_feats)
    rows, _ = waterfall(result, top_k=31)
    threshold = 0.389  # operating point of the initial 12-h model (GovTech Camp presentation); kept as the alert line
    risk = float(result.probability)
    top = [{"feature": r["feature"], "label": r["label"], "value": r["value"], "unit": "", "contribution": round(r["shap"], 5),
            "direction": "raises" if r["shap"] >= 0 else "lowers"} for r in rows if r["feature"] != "other"]
    bundle = dict(bundle)
    bundle["features"] = feats
    bundle["prediction"] = {
        "model_name": "neooutcome_xgb", "model_version": risk_engine.version, "prediction_window_hours": 24,
        "risk_probability": round(risk, 6), "risk_percent": round(risk * 100, 1), "operating_threshold": threshold,
        "threshold_crossed": risk >= threshold, "risk_band": risk_band(risk, threshold), "tier": tier_for(round(risk * 100)),
        "top_factors": top[:6], "shap_values": top, "shap_method": "TreeExplainer (log-odds)", "shap_feature_count": len(top),
        "shap_base_probability": round(float(result.base_rate), 6), "missing_features": missing,
        "mapped_engine_features": sorted(engine_feats.keys()),
        "caveats": ["12-часовой контракт не содержит SpO₂/FiO₂, режима вентиляции и Апгар — подставлены медианы когорты (комнатный воздух), поэтому оценка может быть занижена для детей на респираторной поддержке."],
        "review_actions": review_actions(risk, threshold, feats),
        "disclaimer": SYNTHETIC_NOTICE if bundle.get("synthetic") else CLINICAL_NOTICE,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    return bundle


def bundle_from_patient(p: Any, v: Any, pred: Any, hospital_name: str) -> dict[str, Any]:
    """Build a card bundle from a ward patient, its latest vitals and latest prediction."""
    feats = {k: None for k in EXPECTED_FEATURES}
    feats["gender"] = 1 if p.sex == "M" else 0
    feats["age_days_at_admission"] = round(p.postnatal_age_h / 24, 1)
    if v is not None:
        for src, dst in AGGREGATE_TO_ENGINE.items():
            val = getattr(v, dst, None)
            if val is not None:
                feats[src] = float(val)
        for agg, base in (("hr_min", "heart_rate"), ("hr_max", "heart_rate"), ("rr_min", "resp_rate"), ("rr_max", "resp_rate"), ("temp_max", "temperature"),
                          ("ph_min", "ph"), ("lactate_max", "lactate"), ("po2_min", "po2"), ("base_excess_min", "base_excess"), ("glucose_min", "glucose"), ("glucose_max", "glucose"), ("wbc_max", "wbc")):
            val = getattr(v, base, None)
            if val is not None:
                feats[agg] = float(val)
    risk = float(pred.risk_probability) if pred else 0.0
    threshold = 0.5
    top = [{"feature": r.get("feature"), "label": r.get("label"), "value": r.get("value"), "unit": "", "contribution": round(float(r.get("shap", r.get("pp", 0))), 5),
            "direction": "raises" if float(r.get("shap", r.get("pp", 0))) >= 0 else "lowers"} for r in (pred.shap_values if pred else []) if r.get("feature") != "other"]
    return {
        "schema_version": "1.0", "synthetic": True,  # demo seed patients are synthetic
        "patient": {"patient_id": p.id, "full_name": f"Пациент {p.id}", "sex": p.sex, "date_of_birth": p.admitted_at.date().isoformat() if p.admitted_at else "",
                    "gestational_age": f"{p.gestational_age_wk} нед", "birth_weight_g": p.birth_weight_g, "current_weight_g": p.birth_weight_g, "blood_group": "не определена"},
        "encounter": {"encounter_id": f"ENC-{p.id}", "institution": hospital_name, "department": "ОРИТН", "admitted_at": p.admitted_at.isoformat() if p.admitted_at else "",
                      "prediction_time": pred.created_at.isoformat() if pred and getattr(pred, "created_at", None) else "", "admission_diagnosis": p.diagnosis},
        "features": feats,
        "prediction": {"model_name": "neooutcome_xgb", "model_version": pred.model_version if pred else "—", "risk_probability": risk, "risk_percent": round(risk * 100, 1),
                       "operating_threshold": threshold, "threshold_crossed": risk >= threshold, "risk_band": (pred.risk_tier if pred else "low"),
                       "top_factors": top[:6], "review_actions": review_actions(risk, threshold, feats), "generated_at": datetime.now(timezone.utc).isoformat()},
    }
