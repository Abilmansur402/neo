"""Portal 2 · Regional & national analytics (Облздрав / Минздрав / analysts).

Regional figures are an illustrative pilot extract shaped like the БНС АСПР (stat.gov.kz) and Ministry of Health
series; every chart in the frontend cites the source it should be replaced with before external reporting.
"""
import hashlib
import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.audit_log import AuditLog
from models.telemetry import ExpertReview, Prediction
from models.user import Hospital, User, UserRole
from services.ml_engine import risk_engine
from config import get_settings
from services import official_data
from services.security import get_current_user, require_roles

router = APIRouter(prefix="/api/analytics", tags=["analytics"])
settings = get_settings()
ANALYSTS = require_roles(UserRole.analyst, UserRole.admin, UserRole.researcher)

# ---- 20 regions (post-2022 administrative map). lon/lat of the regional centre.
# nmr: neonatal mortality per 1,000 live births, five years preceding MICS 2024 (official survey, Bureau of National Statistics /
#      UNICEF "Child mortality" brief); None = suppressed by the source (<250 unweighted person-years).
# nicu_beds / utilisation / specialists_per_10k / live_births / level: PROGRAMME ESTIMATES pending Минздрав data (flagged estimate=True in the API).
REGIONS = [
    {"id": "astana", "en": "Astana", "ru": "Астана", "kz": "Астана", "centre": "Astana", "lon": 71.43, "lat": 51.17, "level": 3, "nmr": 0, "nmr_source": "MICS 2024", "nmr_note": None, "nicu_beds": 164, "utilisation": 79, "specialists_per_10k": 9.8, "live_births": 31500, "growth": False},
    {"id": "almaty_city", "en": "Almaty", "ru": "Алматы", "kz": "Алматы", "centre": "Almaty", "lon": 76.95, "lat": 43.24, "level": 3, "nmr": None, "nmr_source": "MICS 2024", "nmr_note": "suppressed: <250 unweighted person-years", "nicu_beds": 212, "utilisation": 83, "specialists_per_10k": 9.1, "live_births": 48200, "growth": False},
    {"id": "shymkent", "en": "Shymkent", "ru": "Шымкент", "kz": "Шымкент", "centre": "Shymkent", "lon": 69.6, "lat": 42.32, "level": 3, "nmr": 1, "nmr_source": "MICS 2024", "nmr_note": None, "nicu_beds": 148, "utilisation": 92, "specialists_per_10k": 5.4, "live_births": 36100, "growth": False},
    {"id": "abai", "en": "Abai", "ru": "Абай", "kz": "Абай", "centre": "Semey", "lon": 80.23, "lat": 50.41, "level": 2, "nmr": 2, "nmr_source": "MICS 2024", "nmr_note": None, "nicu_beds": 42, "utilisation": 88, "specialists_per_10k": 5.1, "live_births": 9800, "growth": True},
    {"id": "akmola", "en": "Akmola", "ru": "Акмолинская", "kz": "Ақмола", "centre": "Kokshetau", "lon": 69.39, "lat": 53.28, "level": 2, "nmr": None, "nmr_source": "MICS 2024", "nmr_note": "suppressed: <250 unweighted person-years", "nicu_beds": 48, "utilisation": 80, "specialists_per_10k": 5.6, "live_births": 10900, "growth": False},
    {"id": "aktobe", "en": "Aktobe", "ru": "Актюбинская", "kz": "Ақтөбе", "centre": "Aktobe", "lon": 57.17, "lat": 50.28, "level": 3, "nmr": 0, "nmr_source": "MICS 2024", "nmr_note": None, "nicu_beds": 72, "utilisation": 84, "specialists_per_10k": 6.4, "live_births": 16700, "growth": False},
    {"id": "almaty_region", "en": "Almaty Region", "ru": "Алматинская", "kz": "Алматы облысы", "centre": "Konaev", "lon": 77.05, "lat": 43.87, "level": 2, "nmr": 5, "nmr_source": "MICS 2024", "nmr_note": None, "nicu_beds": 64, "utilisation": 90, "specialists_per_10k": 4.9, "live_births": 24300, "growth": False},
    {"id": "atyrau", "en": "Atyrau", "ru": "Атырауская", "kz": "Атырау", "centre": "Atyrau", "lon": 51.92, "lat": 47.1, "level": 2, "nmr": 7, "nmr_source": "MICS 2024", "nmr_note": None, "nicu_beds": 40, "utilisation": 85, "specialists_per_10k": 5.8, "live_births": 13400, "growth": False},
    {"id": "east", "en": "East Kazakhstan", "ru": "Восточно-Казахстанская", "kz": "Шығыс Қазақстан", "centre": "Oskemen", "lon": 82.61, "lat": 49.95, "level": 3, "nmr": None, "nmr_source": "MICS 2024", "nmr_note": "suppressed: <250 unweighted person-years", "nicu_beds": 58, "utilisation": 78, "specialists_per_10k": 6.9, "live_births": 9400, "growth": False},
    {"id": "jambyl", "en": "Jambyl", "ru": "Жамбылская", "kz": "Жамбыл", "centre": "Taraz", "lon": 71.37, "lat": 42.9, "level": 2, "nmr": 1, "nmr_source": "MICS 2024", "nmr_note": None, "nicu_beds": 70, "utilisation": 94, "specialists_per_10k": 4.4, "live_births": 25600, "growth": True},
    {"id": "jetisu", "en": "Jetisu", "ru": "Жетісу", "kz": "Жетісу", "centre": "Taldykorgan", "lon": 78.37, "lat": 45.02, "level": 2, "nmr": 6, "nmr_source": "MICS 2024", "nmr_note": None, "nicu_beds": 36, "utilisation": 89, "specialists_per_10k": 4.7, "live_births": 11800, "growth": True},
    {"id": "karaganda", "en": "Karaganda", "ru": "Карагандинская", "kz": "Қарағанды", "centre": "Karaganda", "lon": 73.1, "lat": 49.8, "level": 3, "nmr": None, "nmr_source": "MICS 2024", "nmr_note": "suppressed: <250 unweighted person-years", "nicu_beds": 96, "utilisation": 86, "specialists_per_10k": 6.7, "live_births": 16400, "growth": False},
    {"id": "kostanay", "en": "Kostanay", "ru": "Костанайская", "kz": "Қостанай", "centre": "Kostanay", "lon": 63.63, "lat": 53.21, "level": 2, "nmr": None, "nmr_source": "MICS 2024", "nmr_note": "suppressed: <250 unweighted person-years", "nicu_beds": 44, "utilisation": 82, "specialists_per_10k": 5.5, "live_births": 9100, "growth": True},
    {"id": "kyzylorda", "en": "Kyzylorda", "ru": "Кызылординская", "kz": "Қызылорда", "centre": "Kyzylorda", "lon": 65.5, "lat": 44.85, "level": 2, "nmr": 3, "nmr_source": "MICS 2024", "nmr_note": None, "nicu_beds": 50, "utilisation": 91, "specialists_per_10k": 4.6, "live_births": 17900, "growth": False},
    {"id": "mangystau", "en": "Mangystau", "ru": "Мангистауская", "kz": "Маңғыстау", "centre": "Aktau", "lon": 51.2, "lat": 43.65, "level": 2, "nmr": 0, "nmr_source": "MICS 2024", "nmr_note": None, "nicu_beds": 46, "utilisation": 93, "specialists_per_10k": 4.8, "live_births": 18600, "growth": False},
    {"id": "north", "en": "North Kazakhstan", "ru": "Северо-Казахстанская", "kz": "Солтүстік Қазақстан", "centre": "Petropavl", "lon": 69.15, "lat": 54.87, "level": 2, "nmr": None, "nmr_source": "MICS 2024", "nmr_note": "suppressed: <250 unweighted person-years", "nicu_beds": 30, "utilisation": 74, "specialists_per_10k": 6.0, "live_births": 5600, "growth": False},
    {"id": "pavlodar", "en": "Pavlodar", "ru": "Павлодарская", "kz": "Павлодар", "centre": "Pavlodar", "lon": 76.95, "lat": 52.29, "level": 3, "nmr": 7, "nmr_source": "MICS 2024", "nmr_note": None, "nicu_beds": 52, "utilisation": 77, "specialists_per_10k": 6.8, "live_births": 8700, "growth": False},
    {"id": "turkestan", "en": "Turkestan", "ru": "Туркестанская", "kz": "Түркістан", "centre": "Turkestan", "lon": 68.25, "lat": 43.3, "level": 2, "nmr": 5, "nmr_source": "MICS 2024", "nmr_note": None, "nicu_beds": 118, "utilisation": 95, "specialists_per_10k": 4.2, "live_births": 52800, "growth": False},
    {"id": "ulytau", "en": "Ulytau", "ru": "Ұлытау", "kz": "Ұлытау", "centre": "Jezkazgan", "lon": 67.7, "lat": 47.8, "level": 1, "nmr": 3, "nmr_source": "MICS 2024", "nmr_note": None, "nicu_beds": 12, "utilisation": 70, "specialists_per_10k": 3.9, "live_births": 2900, "growth": False},
    {"id": "west", "en": "West Kazakhstan", "ru": "Западно-Казахстанская", "kz": "Батыс Қазақстан", "centre": "Oral", "lon": 51.37, "lat": 51.23, "level": 2, "nmr": None, "nmr_source": "MICS 2024", "nmr_note": "suppressed: <250 unweighted person-years", "nicu_beds": 54, "utilisation": 81, "specialists_per_10k": 5.9, "live_births": 9700, "growth": True},
]
# in-utero / neonatal transfer routes: lower-level region → nearest Level III hub
TRANSFER_ROUTES = [("abai", "east"), ("akmola", "astana"), ("north", "astana"), ("kostanay", "astana"), ("pavlodar", "astana"), ("almaty_region", "almaty_city"), ("jetisu", "almaty_city"), ("jambyl", "shymkent"), ("turkestan", "shymkent"), ("kyzylorda", "shymkent"), ("ulytau", "karaganda"), ("atyrau", "aktobe"), ("west", "aktobe"), ("mangystau", "aktobe")]
# simplified national outline (lon, lat) for the SVG map
OUTLINE = [(46.5, 49.0), (47.0, 50.5), (48.5, 51.0), (50.8, 51.7), (52.3, 51.8), (54.5, 51.0), (55.7, 50.6), (58.0, 51.1), (60.0, 50.7), (61.5, 51.3), (61.0, 52.3), (62.0, 53.0), (63.5, 54.2), (65.5, 54.6), (68.2, 55.2), (70.8, 55.3), (73.5, 54.0), (76.5, 54.3), (77.8, 53.3), (79.5, 52.0), (81.0, 51.0), (83.5, 51.0), (85.3, 49.6), (87.3, 49.2), (86.6, 47.9), (85.5, 47.1), (83.0, 47.2), (82.3, 45.5), (80.5, 45.0), (80.0, 43.0), (79.0, 42.3), (76.5, 42.9), (74.0, 43.2), (71.0, 42.6), (70.0, 42.0), (68.5, 40.7), (66.5, 41.9), (66.1, 43.0), (64.5, 43.6), (62.0, 43.5), (58.6, 45.5), (55.9, 44.9), (54.1, 42.3), (52.5, 41.8), (51.3, 43.3), (50.5, 44.5), (51.3, 46.2), (49.5, 46.5), (48.6, 47.6)]
# UN IGME modelled estimates as published by WHO GHO (neonatal mortality, 0–27 days, per 1,000 live births). SDG 3.2 (≤ 12) already met; national programme target 3.0.
NATIONAL_TREND = [{"year": y, "nmr": v, "target": 3.0} for y, v in zip(range(2015, 2025), [5.48, 5.04, 4.80, 4.72, 4.73, 4.78, 4.78, 4.63, 4.30, 3.94])]
NATIONAL_NMR = {"value": 3.94, "year": 2024, "source": "UN IGME / WHO GHO", "mics_2024": 4}
SOURCES = [
    {"id": "mics", "name": "MICS 2024 · БНС РК / UNICEF", "detail": "Regional neonatal mortality (5 years before survey), 'Child mortality' brief", "url": "https://stat.gov.kz/upload/medialibrary/922/21738w9g17uc2usgpudj0sut4xa0g360/Child%20mortality.pdf", "official": True, "retrieved": "2026-10-29"},
    {"id": "igme", "name": "UN IGME via WHO GHO", "detail": "National neonatal mortality 2015–2024, modelled estimates", "url": "https://statisticsoftheworld.com/country/kazakhstan/WHO.NEONATAL_MR", "official": True, "retrieved": "2026-10-29"},
    {"id": "bns", "name": "БНС АСПР РК (stat.gov.kz)", "detail": "Demography publications: births and infant mortality by region", "url": "https://stat.gov.kz/ru/industries/social-statistics/demography/publications/117678/", "official": True},
    {"id": "moh", "name": "Минздрав РК / ҚР ДСМ", "detail": "Perinatal centre levels, NICU beds, specialists — to be supplied by the ministry (currently programme estimates)", "url": "https://www.gov.kz/memleket/entities/dsm", "official": False},
]
ESTIMATED_FIELDS = ["nicu_beds", "utilisation", "specialists_per_10k", "live_births", "level"]
MILESTONES = [
    {"id": "data", "title": "Kazakhstan Dataset", "items": [["Data sharing agreement signed (3 sites)", True], ["Retrospective extract de-identified", True], ["31-feature schema mapped", False], ["Recalibration on KZ cohort complete", False]]},
    {"id": "spec", "title": "Specialist Verification", "items": [["Clinical advisory board formed", True], ["50 predictions reviewed by neonatologists", False], ["Agreement ≥ 85% on risk tier", False], ["Human-in-the-loop sign-off audited (Law 230-VIII)", False]]},
    {"id": "pilot", "title": "Pilot Hospital Access", "items": [["Ethics committee approval", True], ["Pilot site MoU (Astana NRC)", True], ["Role-based access configured", True], ["Shadow-mode go-live date set", False]]},
    {"id": "his", "title": "HIS API Integration", "items": [["Damumed HL7 gateway credentials", True], ["KazHealth FHIR R4 sandbox tested", False], ["On-premise deployment hardened", False]]},
    {"id": "open", "title": "Regional Open Data", "items": [["БНС series ingested", True], ["UNICEF MICS indicators mapped", True], ["Regional benchmarks published", False]]},
]


@router.get("/regions")
async def regions():  # public: open/official data only, used by the landing page before login
    enriched = [{**r, "estimate": True, "official": official_data.regional_overlay(r["id"])} for r in REGIONS]
    return {"regions": enriched, "estimated_fields": ESTIMATED_FIELDS, "ashyq_national": {**official_data.ashyq()["national"], "year": 2025}, "datasets": official_data.DATASETS, "transfer_routes": TRANSFER_ROUTES, "outline": OUTLINE, "national_trend": NATIONAL_TREND, "national": NATIONAL_NMR,
            "national_nmr": NATIONAL_NMR["value"], "sources": SOURCES,
            "note": "Regional NMR: MICS 2024 brief (official; blank where the source suppresses small samples). AshyqData 2025 regional infant/neonatal mortality, beds and nursing staff + MICS microdata and WorldPop pregnancies are attached under `official`. National trend: UN IGME / WHO. NICU beds, utilisation, specialists and births are programme estimates until Минздрав data is loaded."}


@router.get("/regions/trends")
async def region_trends():
    """AshyqData 2020–2025 infant & neonatal mortality trends per region (initial NeoOutcome dataset)."""
    a = official_data.ashyq()
    return {"source_id": "ashyq", "years": list(range(2020, 2026)), "national": a["national"], "trends": a["trends"], "regions": a["regions"]}


@router.get("/datasets")
async def datasets():
    """Catalogue of bundled official/open datasets with provenance, plus GBD and ODIN series."""
    return official_data.catalogue()


@router.get("/datasets/mics-microdata")
async def mics_microdata(user: User = Depends(get_current_user)):
    return official_data.mics_micro()


@router.get("/datasets/worldpop")
async def worldpop(user: User = Depends(get_current_user)):
    return official_data.worldpop()


@router.get("/milestones")
async def milestones(user: User = Depends(get_current_user)):
    return MILESTONES


# ---------------- audit & transparency ----------------
_IDS = re.compile(r"\b(patient|prediction):([\w-]+)")


def _pseudo(kind: str, raw: str) -> str:
    return f"{kind}:#{hashlib.sha256(f'{settings.jwt_secret}:{raw}'.encode()).hexdigest()[:8]}"


def _mask_ids(text: str) -> str:
    return _IDS.sub(lambda m: _pseudo(m.group(1), m.group(2)), text or "")


def _mask_detail(detail: dict | None) -> dict:
    d = dict(detail or {})
    for key in ("patient", "patient_id"):
        if key in d and d[key]:
            d[key] = _pseudo("patient", str(d[key]))
    return d


@router.get("/audit")
async def audit_log(limit: int = Query(100, le=500), action: str | None = None, hospital_id: str | None = None, db: AsyncSession = Depends(get_db), user: User = Depends(ANALYSTS)):
    q = select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit)
    if action:
        q = q.where(AuditLog.action.like(f"{action}%"))
    rows = (await db.execute(q)).scalars().all()
    mask = user.role != UserRole.admin
    users = {str(u.id): u for u in (await db.execute(select(User))).scalars().all()}
    hospitals = {h.id: h.name for h in (await db.execute(select(Hospital))).scalars().all()}
    out = []
    for r in rows:
        u = users.get(r.actor_id)
        hid = u.hospital_id if u else None
        if hospital_id and hid != hospital_id:
            continue
        if mask:  # analysts see who did what, but patients only as stable pseudonyms and mothers never by name
            out.append({"id": str(r.id), "at": r.created_at, "actor": "Мама" if r.actor_role == UserRole.mother.value else (u.full_name if u else "system"), "role": r.actor_role,
                        "hospital": hospitals.get(hid, "—"), "action": r.action, "resource": _mask_ids(r.resource), "detail": _mask_detail(r.detail), "ip": None})
        else:
            out.append({"id": str(r.id), "at": r.created_at, "actor": u.full_name if u else "system", "role": r.actor_role, "hospital": hospitals.get(hid, "—"), "action": r.action, "resource": r.resource, "detail": r.detail, "ip": r.ip})
    counts = (await db.execute(select(AuditLog.action, func.count()).group_by(AuditLog.action))).all()
    return {"entries": out, "by_action": {a: c for a, c in counts}}


@router.get("/model-quality")
async def model_quality(db: AsyncSession = Depends(get_db), user: User = Depends(ANALYSTS)):
    """Prediction accuracy and calibration from the live prediction + expert review tables, plus training-time CV metrics."""
    preds = (await db.execute(select(Prediction))).scalars().all()
    reviews = (await db.execute(select(ExpertReview))).scalars().all()
    latest = {}
    for r in sorted(reviews, key=lambda x: x.created_at):
        latest[r.prediction_id] = r
    approved = sum(1 for r in latest.values() if r.status == "approved")
    flagged = sum(1 for r in latest.values() if r.status == "flagged")
    tiers = {t: sum(1 for p in preds if p.risk_tier == t) for t in ("low", "moderate", "high", "critical")}
    bins = []
    for lo in range(0, 100, 20):
        in_bin = [p for p in preds if lo <= p.risk_probability * 100 < lo + 20]
        rev = [latest[p.id] for p in in_bin if p.id in latest]
        bins.append({"bin": f"{lo}–{lo + 20}%", "n": len(in_bin), "reviewed": len(rev), "agreement": round(sum(1 for r in rev if r.status == "approved") / len(rev), 3) if rev else None})
    recent = [p for p in preds if p.created_at and p.created_at > datetime.now(timezone.utc) - timedelta(days=7)]
    return {"model_version": risk_engine.version, "training_metrics": risk_engine.metrics, "calibrated": risk_engine.calibrator is not None,
            "predictions_total": len(preds), "predictions_7d": len(recent), "reviewed": len(latest), "approved": approved, "flagged": flagged,
            "agreement": round(approved / max(approved + flagged, 1), 3), "tier_distribution": tiers, "agreement_by_bin": bins}


# ---------------- economic & outcome impact ----------------
class EconomicsIn(BaseModel):
    """All inputs editable in the UI. Tariff defaults are placeholders — enter the current ФСМС (OSMS) bed-day tariff."""
    nicu_admissions_per_year: int = Field(default=1200, ge=1)
    baseline_los_days: float = Field(default=14.0, ge=1)
    bed_day_tariff_kzt: float = Field(default=85000, ge=0, description="ФСМС тариф за койко-день ОРИТН (placeholder; replace with the current official value)")
    early_alert_coverage: float = Field(default=0.60, ge=0, le=1, description="share of deteriorations the model flags ≥ 6 h early")
    los_reduction_days_per_alert: float = Field(default=2.2, ge=0)
    escalation_rate: float = Field(default=0.22, ge=0, le=1, description="share of admissions that deteriorate (base rate)")
    transfer_cost_kzt: float = Field(default=350000, ge=0, description="avoidable emergency transfer (ambulance/aviation) cost")
    transfers_avoided_share: float = Field(default=0.15, ge=0, le=1)
    pilot_cost_kzt: float = Field(default=24_000_000, ge=0, description="annual platform + integration cost")


@router.post("/economics")
async def economics(body: EconomicsIn, user: User = Depends(ANALYSTS)):
    deteriorations = body.nicu_admissions_per_year * body.escalation_rate
    alerted = deteriorations * body.early_alert_coverage
    bed_days_saved = alerted * body.los_reduction_days_per_alert
    bed_day_savings = bed_days_saved * body.bed_day_tariff_kzt
    transfers_avoided = deteriorations * body.transfers_avoided_share
    transfer_savings = transfers_avoided * body.transfer_cost_kzt
    gross = bed_day_savings + transfer_savings
    return {"deteriorations_per_year": round(deteriorations), "early_alerts": round(alerted), "bed_days_saved": round(bed_days_saved), "bed_day_savings_kzt": round(bed_day_savings),
            "transfers_avoided": round(transfers_avoided), "transfer_savings_kzt": round(transfer_savings), "gross_savings_kzt": round(gross), "net_savings_kzt": round(gross - body.pilot_cost_kzt),
            "roi": round((gross - body.pilot_cost_kzt) / body.pilot_cost_kzt, 2) if body.pilot_cost_kzt else None, "beds_freed_equivalent": round(bed_days_saved / 365, 1),
            "assumptions": body.model_dump(), "note": "Tariff and cost inputs are placeholders; use current ФСМС tariffs and the hospital's own cost data."}
