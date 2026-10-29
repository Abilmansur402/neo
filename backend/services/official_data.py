"""Official / open datasets bundled with the platform, each with provenance.

All files live in ``backend/data/official``. Nothing here is patient-level.

* ``ashyq_regional_2025.json``  – AshyqData 2025 regional infant & neonatal mortality, hospital beds,
                                   nursing staff + 2020–2025 trends (initial NeoOutcome repository).
* ``mics_bh_nmr.json``          – MICS Kazakhstan 2024 *microdata* (bh.sav birth history): weighted neonatal
                                   and infant mortality for births in the 60 months before interview, by region.
                                   Region cells have 0–3 deaths → shown with the unweighted n and flagged unreliable.
* ``worldpop_pregs_2015.json``  – WorldPop 1 km pregnancies raster (KAZ_pregs_pp_v1_2015) summed per
                                   admin-1 polygon (OSM boundaries).
* ``ihme_gbd2023_neonatal_preterm_global.csv`` – IHME GBD 2023, deaths & DALYs from neonatal preterm birth,
                                   Global, 2015–2023 (benchmark context only; the export has no KZ rows).
* ``odin_kazakhstan_2015.csv``  – Open Data Watch ODIN 2015 openness scores for Kazakhstan (CC-BY 4.0).
* BNS 2023 vital statistics (Естественное движение населения РК, январь–декабрь 2023, release 09.02.2024).
"""
from __future__ import annotations

import csv
import json
from functools import lru_cache
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "official"

# MICS HH7 region code -> platform region id
MICS_CODE_TO_ID = {10: "abai", 11: "akmola", 15: "aktobe", 19: "almaty_region", 23: "atyrau", 27: "west", 31: "jambyl", 33: "jetisu", 35: "karaganda",
                   39: "kostanay", 43: "kyzylorda", 47: "mangystau", 55: "pavlodar", 59: "north", 61: "turkestan", 62: "ulytau", 63: "east",
                   71: "astana", 75: "almaty_city", 79: "shymkent"}
# OSM relation id (kazakhstan-admin1.geojson) -> platform region id
OSM_TO_ID = {"214834": "atyrau", "215441": "west", "215683": "aktobe", "215686": "mangystau", "215699": "east", "215718": "almaty_region",
             "215722": "jambyl", "215727": "kyzylorda", "215739": "turkestan", "215743": "akmola", "215760": "north", "215772": "pavlodar",
             "215776": "karaganda", "1288730": "kostanay", "2465058": "almaty_city", "3087155": "astana", "3389772": "shymkent",
             "14243026": "abai", "14312169": "jetisu", "14312737": "ulytau"}

DATASETS = [
    {"id": "ashyq", "name": "AshyqData 2025 · Минздрав РК", "kind": "official", "year": 2025,
     "detail": "Infant & neonatal mortality, hospital beds and nursing staff by region; 2020–2025 trends",
     "url": "https://data.egov.kz", "license": "Open data of the Republic of Kazakhstan", "file": "ashyq_regional_2025.json"},
    {"id": "mics_micro", "name": "MICS Kazakhstan 2024 · microdata (bh.sav)", "kind": "official", "year": 2024,
     "detail": "Birth-history recode: weighted NMR/IMR for births in the 60 months before interview; n per region is small",
     "url": "https://mics.unicef.org/surveys", "license": "UNICEF MICS data-use terms", "file": "mics_bh_nmr.json"},
    {"id": "worldpop", "name": "WorldPop · pregnancies 2015 (1 km)", "kind": "official", "year": 2015,
     "detail": "KAZ_pregs_pp_v1_2015.tif summed per admin-1 polygon; denominators for perinatal demand mapping",
     "url": "https://dx.doi.org/10.5258/SOTON/WP00612", "license": "CC BY 4.0 — WorldPop, University of Southampton (2018)", "file": "worldpop_pregs_2015.json"},
    {"id": "gbd", "name": "IHME GBD 2023 · neonatal preterm birth (Global)", "kind": "official", "year": 2023,
     "detail": "Deaths, DALYs — number, percent, rate; global benchmark 2015–2023",
     "url": "https://vizhub.healthdata.org/gbd-results/", "license": "IHME free-of-charge non-commercial user agreement", "file": "ihme_gbd2023_neonatal_preterm_global.csv"},
    {"id": "odin", "name": "Open Data Watch · ODIN 2015 Kazakhstan", "kind": "official", "year": 2015,
     "detail": "Openness/coverage scores per statistical category (population & vital statistics, health outcomes …)",
     "url": "https://odin.opendatawatch.com", "license": "CC BY 4.0", "file": "odin_kazakhstan_2015.csv"},
    {"id": "bns2023", "name": "БНС АСПР РК · Естественное движение населения, 2023", "kind": "official", "year": 2023,
     "detail": "Births 387.9 k, deaths 130.6 k, natural increase 257.4 k; release 09.02.2024",
     "url": "https://stat.gov.kz/ru/industries/social-statistics/demography/publications/", "license": "Open government data", "file": None},
    {"id": "asfendiyarov", "name": "KazNMU n.a. S.D. Asfendiyarov · de-identified NICU extract", "kind": "real",
     "year": 2025, "detail": "1 105 admissions 2021–2025, 25 columns; admission model (temporal validation 2024–2025)",
     "url": None, "license": "Hackathon use only; delete on request of the data owner", "file": "ml/asfendiyarov/asfendiyarov_deidentified.csv"},
]

BNS_2023 = {"year": 2023, "births": 387_900, "deaths": 130_600, "natural_increase": 257_400, "marriages": 120_900, "divorces": 16_800,
            "highest_birth_rate": {"region": "mangystau", "value": 26.78, "unit": "per 1000 population"},
            "highest_death_rate": {"region": "north", "value": 11.08, "unit": "per 1000 population"},
            "release": "2024-02-09", "source_id": "bns2023"}


@lru_cache
def ashyq() -> dict:
    return json.loads((DATA_DIR / "ashyq_regional_2025.json").read_text("utf-8"))


@lru_cache
def mics_micro() -> dict:
    raw = json.loads((DATA_DIR / "mics_bh_nmr.json").read_text("utf-8"))
    regions = {}
    for r in raw["regions"]:
        rid = MICS_CODE_TO_ID[r["code"]]
        regions[rid] = {**r, "id": rid, "reliable": r["neo_deaths"] >= 5}  # <5 events: not a usable regional rate
    return {"national": raw["national"], "window": raw["window"], "weight": raw["weight"], "interview_years": raw["interview_years"], "regions": regions}


@lru_cache
def worldpop() -> dict:
    raw = json.loads((DATA_DIR / "worldpop_pregs_2015.json").read_text("utf-8"))
    regions = {OSM_TO_ID[str(r["props"]["osm_id"])]: r["pregnancies"] for r in raw["regions"]}
    return {"total": raw["total"], "year": 2015, "regions": regions}


@lru_cache
def gbd() -> list[dict]:
    with (DATA_DIR / "ihme_gbd2023_neonatal_preterm_global.csv").open(encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    out = [{"measure": r["measure_name"], "metric": r["metric_name"], "location": r["location_name"], "year": int(r["year"]),
            "val": float(r["val"]), "upper": float(r["upper"]), "lower": float(r["lower"])} for r in rows]
    return sorted(out, key=lambda r: (r["measure"], r["metric"], r["year"]))


@lru_cache
def odin() -> list[dict]:
    with (DATA_DIR / "odin_kazakhstan_2015.csv").open(encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    out = []
    for r in rows:
        cat = (r.get("Data category") or "").strip()
        if not cat or not r.get("Overall score"):
            continue
        def f(k):
            v = (r.get(k) or "").strip()
            try:
                return float(v)
            except ValueError:
                return None
        out.append({"category": cat, "coverage": f("Coverage subscore"), "openness": f("Openness subscore"), "overall": f("Overall score"),
                    "first_admin_level": f("First administrative level"), "machine_readable": f("Machine readability")})
    return out


def regional_overlay(region_id: str) -> dict:
    """Everything the official datasets know about one region, with source ids."""
    a = ashyq()["regions"].get(region_id)
    m = mics_micro()["regions"].get(region_id)
    w = worldpop()["regions"].get(region_id)
    return {
        "ashyq": {**a, "year": 2025, "source_id": "ashyq"} if a else None,
        "ashyq_trend": ashyq()["trends"].get(region_id, []),
        "mics_micro": {"nmr": m["nmr"], "imr": m["imr"], "births": m["births"], "neo_deaths": m["neo_deaths"], "inf_deaths": m["inf_deaths"], "reliable": m["reliable"], "source_id": "mics_micro"} if m else None,
        "worldpop_pregnancies_2015": w,
    }


def catalogue() -> dict:
    return {"datasets": DATASETS, "bns_2023": BNS_2023, "ashyq_national": {**ashyq()["national"], "year": 2025},
            "mics_micro_national": mics_micro()["national"], "worldpop_total": worldpop()["total"], "gbd": gbd(), "odin": odin()}
