"""
Build the 31-feature baseline cohort from a real PIC (Paediatric Intensive Care) database extract.

PIC v1.1.0 (Zeng et al., 2020) is distributed through PhysioNet under a credentialed data-use agreement;
it cannot be bundled with this repository. Download the CSV tables, then run:

    python -m ml.build_pic_cohort --pic-dir /data/PIC --out ml/baseline/picdb_baseline_804.csv --max-rows 804

Tables used: PATIENTS, ADMISSIONS, ICUSTAYS, CHARTEVENTS, LABEVENTS, D_ITEMS, D_LABITEMS.
The script keeps neonatal ICU stays (age at admission < 28 days, NICU care unit), takes the first 24 h of
observations after ICU admission as the feature window, and labels `deteriorated_24h` = 1 when, in the
following 24 h, the stay shows invasive ventilation onset, vasopressor start, or in-ICU death.
Item IDs differ between PIC releases, so they are matched by label text (see ITEM_LABELS) and the
resolved mapping is written next to the output as `<out>.itemmap.json` for review.
"""
from __future__ import annotations

import argparse, hashlib, json, re
from pathlib import Path

import numpy as np, pandas as pd

ITEM_LABELS = {  # feature → regex matched against D_ITEMS / D_LABITEMS label (case-insensitive)
    "heart_rate": r"heart rate", "resp_rate": r"respiratory rate", "spo2": r"spo2|oxygen saturation", "fio2": r"fio2|inspired oxygen",
    "map_mmhg": r"mean (arterial|blood) pressure|\bmap\b", "temperature": r"temperature", "ph": r"^ph$|\bph\b(?!os)", "pco2": r"pco2", "po2": r"\bpo2\b",
    "hco3": r"hco3|bicarbonate", "base_excess": r"base excess", "lactate": r"lactate", "glucose": r"glucose", "hemoglobin": r"hemoglobin|haemoglobin",
    "wbc": r"white blood cell|wbc", "platelets": r"platelet", "crp": r"c-reactive|crp", "sodium": r"sodium", "potassium": r"potassium",
    "creatinine": r"creatinine", "bilirubin": r"total bilirubin|bilirubin", "urine_output": r"urine output|foley",
}
DETERIORATION_LABELS = {"ventilation": r"ventilat|intubat|endotracheal", "vasopressor": r"dopamine|dobutamine|epinephrine|norepinephrine|vasopress"}


def resolve_items(d_items: pd.DataFrame) -> dict[str, list[int]]:
    out = {}
    for feat, rx in {**ITEM_LABELS, **DETERIORATION_LABELS}.items():
        m = d_items[d_items["LABEL"].str.contains(rx, case=False, regex=True, na=False)]
        out[feat] = m["ITEMID"].astype(int).tolist()
    return out


def main() -> None:
    ap = argparse.ArgumentParser(); ap.add_argument("--pic-dir", required=True); ap.add_argument("--out", required=True); ap.add_argument("--max-rows", type=int, default=804); ap.add_argument("--seed", type=int, default=42)
    a = ap.parse_args(); d = Path(a.pic_dir)
    pat = pd.read_csv(d / "PATIENTS.csv", parse_dates=["DOB"]); adm = pd.read_csv(d / "ADMISSIONS.csv", parse_dates=["ADMITTIME", "DISCHTIME", "DEATHTIME"])
    icu = pd.read_csv(d / "ICUSTAYS.csv", parse_dates=["INTIME", "OUTTIME"])
    items = pd.concat([pd.read_csv(d / "D_ITEMS.csv")[["ITEMID", "LABEL"]], pd.read_csv(d / "D_LABITEMS.csv")[["ITEMID", "LABEL"]]])
    itemmap = resolve_items(items)
    stays = icu.merge(adm[["HADM_ID", "ADMITTIME", "DEATHTIME"]], on="HADM_ID").merge(pat[["SUBJECT_ID", "DOB", "GENDER"]], on="SUBJECT_ID")
    stays["age_days"] = (stays["INTIME"] - stays["DOB"]).dt.days
    stays = stays[(stays["age_days"] < 28) & stays["FIRST_CAREUNIT"].str.contains("NICU|neonat", case=False, na=False)].copy()
    print(f"[pic] neonatal ICU stays: {len(stays)}")
    chart = pd.read_csv(d / "CHARTEVENTS.csv", usecols=["ICUSTAY_ID", "ITEMID", "CHARTTIME", "VALUENUM"], parse_dates=["CHARTTIME"])
    labs = pd.read_csv(d / "LABEVENTS.csv", usecols=["HADM_ID", "ITEMID", "CHARTTIME", "VALUENUM"], parse_dates=["CHARTTIME"])
    labs = labs.merge(stays[["HADM_ID", "ICUSTAY_ID"]], on="HADM_ID")
    ev = pd.concat([chart, labs[["ICUSTAY_ID", "ITEMID", "CHARTTIME", "VALUENUM"]]]).merge(stays[["ICUSTAY_ID", "INTIME", "OUTTIME", "DEATHTIME"]], on="ICUSTAY_ID")
    ev["h"] = (ev["CHARTTIME"] - ev["INTIME"]).dt.total_seconds() / 3600
    win = ev[(ev["h"] >= 0) & (ev["h"] < 24)]; nxt = ev[(ev["h"] >= 24) & (ev["h"] < 48)]
    rows = []
    for sid, g in win.groupby("ICUSTAY_ID"):
        st = stays[stays["ICUSTAY_ID"] == sid].iloc[0]
        r = {"admission_id": f"PIC-{sid}", "gestational_age_wk": np.nan, "birth_weight_g": np.nan, "sex": "F" if st["GENDER"] == "F" else "M", "apgar_1": np.nan, "apgar_5": np.nan, "delivery_mode": "vaginal", "age_hours": int(st["age_days"] * 24), "vent_mode": "room air"}
        for feat, ids in ITEM_LABELS.items():
            v = g[g["ITEMID"].isin(itemmap[feat])]["VALUENUM"]; r[feat] = float(v.median()) if len(v) else np.nan
        if not np.isnan(r.get("spo2", np.nan)) and not np.isnan(r.get("fio2", np.nan)):
            fio2 = r["fio2"] if r["fio2"] > 1 else r["fio2"] * 100; r["fio2"] = fio2; r["sf_ratio"] = r["spo2"] / (max(fio2, 21) / 100)
        else: r["sf_ratio"] = np.nan
        if len(g[g["ITEMID"].isin(itemmap["ventilation"])]): r["vent_mode"] = "SIMV"
        n = nxt[nxt["ICUSTAY_ID"] == sid]
        died = pd.notna(st["DEATHTIME"]) and 24 <= (st["DEATHTIME"] - st["INTIME"]).total_seconds() / 3600 < 48
        r["deteriorated_24h"] = int(died or len(n[n["ITEMID"].isin(itemmap["ventilation"] + itemmap["vasopressor"])]) > 0 and r["vent_mode"] == "room air")
        rows.append(r)
    df = pd.DataFrame(rows).sample(frac=1, random_state=a.seed).head(a.max_rows)
    df.to_csv(a.out, index=False)
    Path(str(a.out) + ".itemmap.json").write_text(json.dumps(itemmap, indent=2))
    manifest = {"file": Path(a.out).name, "rows": int(len(df)), "prevalence": round(float(df["deteriorated_24h"].mean()), 4), "sha256": hashlib.sha256(open(a.out, "rb").read()).hexdigest(),
                "origin": "PIC v1.1.0", "origin_label": f"PIC v1.1.0 extract ({len(df)} neonatal ICU admissions)", "description": "Built by ml/build_pic_cohort.py from the credentialed PIC tables.", "features": 31, "label": "deteriorated_24h"}
    Path(Path(a.out).parent / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"[pic] wrote {len(df)} rows · prevalence {manifest['prevalence']} → {a.out}")


if __name__ == "__main__":
    main()
