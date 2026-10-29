# NeoOutcome AI — NICU Clinical Decision Support Platform (Kazakhstan)

Three role-segmented portals under one FastAPI + React platform with JWT RBAC and strict data isolation:

| Portal | Role | What it contains |
|---|---|---|
| **Doctors / ОРИТН** | `neonatologist` | Ward home (patients by risk, unit stats, appointments), 31-parameter intake (manual or pulled from Damumed/KazHealth), 24h XGBoost risk with SHAP, **admission-time risk from 15 maternal/birth features (Asfendiyarov model)**, **CSV/JSON bundle import with PDF patient card**, appointments, «Машина времени» replay, mandatory clinical sign-off (human-in-the-loop, Law No. 230-VIII), shift task list with AI-generated tasks, imaging |
| **Analytics / Облздрав, Минздрав** | `analyst`, `admin` | **Model Ops** (retrain, versions, rollback, dataset ingestion); **child-health choropleth of the 20 regions (OSM boundaries, d3-geo) with AshyqData 2025, MICS 2024 microdata and WorldPop layers, multi-region filter, year range, sortable table and 2020–2025 trends**; centre-level map with transfer routes and growth regions; **dataset catalogue with licences**; audit log; model quality (agreement by risk bin, CV metrics, calibration); economic impact calculator in tenge; dataset & HIS hub; readiness tracker |
| **Mothers / families** | `mother` | 18-field pregnancy record with a plain-language risk screen (KZ/RU/EN), newborn weight, breathing, feeding, milestones and daily notes written by staff |

The landing page opens on the real map: the WorldPop 2015 pregnancies raster (`frontend/public/data/worldpop_pregs_2015_3857.png`, warped to Web Mercator) under OSM admin-1 boundaries, with AshyqData / MICS / WorldPop figures per region. Design: bright clinical palette (aqua-white background, teal `#0E9F9B` primary, navy ink, mint/amber/coral risk tones), Lora (display) + Source Sans 3 (body) — both with Kazakh Cyrillic — 16 px cards, logo in `frontend/public/logo.svg`. `frontend/src/lib/fx.js` adds the pointer light (cards cast a shadow away from the cursor, a soft glow follows the pointer) and synthesised interface sounds (hover tick, click, result chime, alert tone; mute button in every header, persisted). Both respect `prefers-reduced-motion` and are off on touch devices. UI is trilingual (Қазақша / Русский / English) with a switch in the header. Kazakhstan pilot edition. Visual language: warm paper background, deep-navy ink, Newsreader serif headings with Public Sans text, soft 16 px cards and navy pill buttons — the same calm editorial style across the landing page and all three portals. A full-stack monorepo: FastAPI backend (XGBoost + SHAP risk engine, CV/Grad-CAM, HL7/FHIR connector, TimescaleDB telemetry, JWT/RBAC) and a React 19 + Tailwind v4 frontend with live canvas telemetry and Recharts analytics.

> Decision support only. Model outputs never replace the judgement of the treating neonatologist. No real patient data ships with this repository.

## Quick start

```bash
docker compose up --build
```

| Service   | URL                          | Notes                                              |
|-----------|------------------------------|----------------------------------------------------|
| Frontend  | http://localhost             | nginx serving the Vite build, proxies `/api` + WS  |
| Backend   | http://localhost:8000/docs   | FastAPI + Swagger UI                               |
| Database  | localhost:5433               | TimescaleDB (`neo` / `neo` / `neooutcome`); host port is `DB_PORT` |

Port clashes: `DB_PORT=5434 FRONTEND_PORT=8080 docker compose up --build` remaps the host ports.

Demo accounts are seeded on first boot (password `Pilot2026!`):

| Portal / role             | Email                          |
|---------------------------|--------------------------------|
| Doctor (neonatologist)    | neonatologist@neooutcome.kz    |
| Regional analyst          | analyst@neooutcome.kz          |
| Mother                    | mother@neooutcome.kz           |
| Hospital administrator    | admin@neooutcome.kz            |

Upgrading an existing database: the bootstrap adds the new `analyst`/`mother` roles and patient event columns automatically; if you prefer a clean slate run `docker compose down -v` first.

Selecting a role on the sign-in screen logs in with that account. If the backend is unreachable the frontend switches to an **offline demo mode** that uses the same data shapes locally, so the UI can be demoed from a static build alone.

### Local development

```bash
# database
docker compose up db

# backend
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # NEO_DATABASE_URL=postgresql+asyncpg://neo:neo@localhost:5432/neooutcome
uvicorn main:app --reload

# frontend (proxies /api to :8000)
cd frontend && npm install && npm run dev
```

Optional: install PyTorch (`pip install torch --index-url https://download.pytorch.org/whl/cpu`) to run true Grad-CAM through a CNN; without it the imaging endpoint falls back to an OpenCV saliency map with the same response contract.

## Architecture

```
frontend (React 19 / Vite / Tailwind v4 / Recharts / lucide-react)
  ├─ services/api.js        REST client + offline fallback
  ├─ services/websocket.js  telemetry + HIS log streams (auto-reconnect)
  └─ components/            Auth, Navbar, Sidebar, five module tabs
backend (FastAPI / SQLAlchemy 2 async / Pydantic v2)
  ├─ routers/auth           JWT, RBAC, hospital list
  ├─ routers/patients       cases + TimescaleDB vital_signs hypertable
  ├─ routers/predictions    POST /api/predictions → XGBoost + SHAP waterfall; expert review loop
  ├─ routers/computer_vision  WS /api/cv/ws/telemetry/{id}; POST /api/cv/imaging/analyze (Grad-CAM)
  ├─ routers/integration    benchmarks, 31-feature schema mapper + validator, HIS connect/WS log
  ├─ routers/analytics      regional stats, milestones
  └─ services/              ml_engine, shap_service, cv_engine, fhir_connector, security, audit, seed
```

### Risk engine

`services/ml_engine.py` trains an XGBoost classifier over the 31 core features on first boot when no artifact exists under `backend/artifacts/`, using a synthetic cohort whose generating process mirrors PIC-database effect sizes. Drop the model trained on the Kazakhstan retrospective cohort at `artifacts/xgb-24h.json` (+ `.meta.json`) to go live. SHAP log-odds values are mapped to percentage points so the waterfall walks exactly from the base rate to the patient's probability.

### Computer vision

* `WS /api/cv/ws/telemetry/{patient_id}` streams `TelemetryFrame` JSON (NFCS landmarks, chest-wall phase, cyanosis index, surface temperatures, posture) at `NEO_TELEMETRY_HZ`. The frame contract is what the bedside edge node emits; the server synthesises frames from the patient's latest vitals in the pilot build.
* `POST /api/cv/imaging/analyze` accepts a chest X-ray (`modality=cxr`) or cranial ultrasound (`modality=cus`) and returns class probabilities plus a Grad-CAM overlay PNG (base64).

### HIS integration

`services/fhir_connector.py` reproduces the Damumed HL7 v2 MLLP handshake, OAuth2 client-credentials token lifecycle and KazHealth FHIR R4 resource pulls as a stateful simulator; flip `_SIMULATED` and implement `_fetch_live` against the hospital gateway. The schema template exposes LOINC codes for the observation features and the Damumed CSV export header for the mapper.

### Security

* JWT bearer tokens (`python-jose`), bcrypt password hashing, role dependency `require_roles(...)`.
* Expert review sign-off is restricted to `neonatologist`; patient creation to `neonatologist`/`admin`; non-admins only see their own hospital's patients.
* Every PHI read/write is appended to `audit_logs` (ship to the hospital SIEM in production).
* WebSockets authenticate with `?token=<jwt>`.

### Migrations

```bash
cd backend
alembic revision --autogenerate -m "init"
alembic upgrade head
```

`init_db()` runs `create_all` and the TimescaleDB hypertable bootstrap for development; use Alembic for environments beyond that.

## Data provenance (what is real, what is not)

| Component | Origin | Pill in the UI |
|---|---|---|
| Tabular 24h model | Trained at first boot on `backend/ml/baseline/picdb_baseline_804.csv` — **a PICDB-shaped synthetic baseline of 804 admissions** (manifest in `ml/baseline/manifest.json`). Replace it with the credentialed PIC v1.1.0 extract via `python -m ml.build_pic_cohort --pic-dir … --out ml/baseline/picdb_baseline_804.csv`; the pill flips to *PIC v1.1.0* automatically. Local Kazakhstan datasets uploaded in Model Ops are added on every retrain. | `synthetic` → `real` |
| Regional neonatal mortality | **Official**: MICS 2024 (Bureau of National Statistics / UNICEF "Child mortality" brief); regions the source suppresses (<250 person-years) are shown blank, never imputed. | `official` |
| National trend | **Official**: UN IGME modelled estimates via WHO GHO, 2015–2024 (3.94 ‰ in 2024). | `official` |
| NICU beds, utilisation, specialists, births, centre levels, transfer routes | Programme estimates pending Минздрав data (`estimate: true` in the API). | `estimate` |
| CV telemetry, X-ray / ultrasound Grad-CAM | **Simulated** frames and synthetic studies, pending clinical retrospective validation. | `simulated` |
| Maternal risk screen | Transparent logistic scorecard (literature odds ratios), screening aid only. | — |
| Admission model | **Real, de-identified**: KazNMU Asfendiyarov extract, 1 105 admissions 2021–2025; temporal test 2024–2025 AUROC ≈ 0.83 (95 % CI in `artifacts/asfendiyarov_metrics.json`). | `real` |
| AshyqData 2025 regional indicators, MICS 2024 microdata, WorldPop 2015, GBD 2023, ODIN 2015, БНС 2023 | **Official / open** sources bundled in `backend/data/official` with licences. | `official` |

`GET /api/ml/provenance` is the single source for these pills; `GET /api/analytics/regions` carries `sources[]` with URLs and retrieval dates.

## Merged from the initial NeoOutcome repository (`Abilmansur402/Final_Check`)

The first version of the project (React/TS + Supabase + a stdlib Python demo API) is folded into this monorepo so that nothing is lost:

| Initial-version feature | Where it lives now |
|---|---|
| `train_asfendiyarov.py` (temporal validation, 80 % sensitivity threshold, recency weights, leakage reference) | `backend/ml/train_admission.py` — importable; trained automatically on first boot into `artifacts/neooutcome_admission_xgb.joblib` |
| `data/asfendiyarov_deidentified.csv` (1 105 admissions, 2021–2025) + README | `backend/ml/asfendiyarov/` |
| `admission_model.py` → `POST /predict/admission` | `backend/services/admission_engine.py` → `POST /api/predictions/admission`, `GET /api/predictions/admission/info` (JWT, audit, optional persistence to the patient) |
| `patient_demo.py` (31-feature 12-h contract, synthetic SYN-NICU-0001, review actions, reportlab PDF card, `/demo`, `/predict`) | `backend/services/patient_card.py` + `routers/intake.py`: `GET /api/intake/demo`, `/contract`, `POST /api/intake/import` (CSV/JSON, PII columns rejected), `/score`, `/card.pdf`, `GET /api/intake/patients/{id}/card.pdf` |
| Supabase `appointments` table with RLS | `Appointment` model in Postgres; `GET/POST/PATCH /api/intake/appointments` — rows are visible only to their author (and the hospital admin) |
| `AdmissionRiskCard` («Оценка при поступлении») | `frontend/src/components/doctor/IntakePage.jsx` — on the intake page and under every ward patient |
| `PatientIntakePage` (source selector, bundle view, PDF iframe, CSV import, appointments) | `components/doctor/IntakePage.jsx` |
| `WelcomeDashboard` (stat cards, patients by risk, distribution chart) + `StreamStatus` | `components/doctor/WelcomeDashboard.jsx`; stream toggle in the portal header |
| `data/regional.ts` (AshyqData 2025: infant/neonatal mortality, beds, nursing staff; 2020–2025 trends) | `backend/data/official/ashyq_regional_2025.json` → `GET /api/analytics/regions` (`official.ashyq`) and `/regions/trends`; frontend copy for offline mode |
| `KazakhstanChoropleth` (d3-geo) + `public/data/kazakhstan-admin1.geojson` + boundaries licence | `frontend/public/data/`, `components/regional/KazakhstanChoropleth.jsx` |
| `RegionalDashboard`, `InteractiveMapPage`, `RegionMultiSelect`, `DateRangePicker`, `RegionTable`, `RegionalTrendChart` | `components/regional/RegionalDashboard.jsx` (Analyst portal → «Регионы») |
| Security rules from the initial README | Kept below (no real patient files, no secrets in git) |

### Attached open datasets (all with provenance in the UI)

| Dataset | File | Use |
|---|---|---|
| MICS Kazakhstan 2024 microdata (`bh.sav`, `wm.sav`, `hh.sav`, …) | `backend/data/official/mics_bh_nmr.json` (weighted NMR/IMR per region, births in the 60 months before interview; built with `pyreadstat`) | Region card + «Данные и источники»; regional cells are flagged unreliable when < 5 events |
| WorldPop `KAZ_pregs_pp_v1_2015.tif` (1 km pregnancies) | `backend/data/official/worldpop_pregs_2015.json` (raster summed per admin-1 polygon with `rasterio`) | Choropleth metric «Беременности 2015», region card |
| IHME GBD 2023 — neonatal preterm birth (Global) | `backend/data/official/ihme_gbd2023_neonatal_preterm_global.csv` | Global benchmark chart |
| Open Data Watch ODIN 2015 Kazakhstan | `backend/data/official/odin_kazakhstan_2015.csv` | Openness chart |
| БНС АСПР РК «Естественное движение населения, 2023» (PDF) | `services/official_data.BNS_2023` | Headline births/deaths |

`GET /api/analytics/datasets` returns the catalogue with licences and URLs.

### Security rules (from the initial repository, still in force)

* Never commit real patient CSV/XLSX/JSON/PDF/DOCX, screenshots, EHR exports or database dumps. No names, IIN/passport numbers, dates of birth, phones, addresses, MRNs or encounter IDs of real persons.
* Never commit `.env`, database passwords, API/SSH keys, VPS credentials or S3 keys; `deploy/.env.production` is git-ignored. Rotate any secret that was ever committed.
* The Asfendiyarov extract is de-identified and for hackathon use only; delete it on request of the data owner.

## Automated retraining (MLOps)

The backend retrains itself and hot-swaps the model without a restart:

| Trigger | How |
|---|---|
| Manual | `POST /api/ml/retrain` (analyst / admin) or the **Model Ops** page |
| Dataset ingestion | `POST /api/ml/datasets/upload` (CSV / Parquet with the 31 core features + `deteriorated_24h`; PII columns are rejected) — also from the Dataset hub |
| Clinician feedback | every `NEO_RETRAIN_FEEDBACK_THRESHOLD` (default 25) new sign-offs; reviews with an explicit observed outcome become labelled rows |
| Scheduler | call `/api/ml/retrain` from cron, or `./deploy/deploy.sh models` |

Pipeline (`services/retraining_engine.py`): gather baseline + uploads + feedback → validate schema → 5-fold CV (AUROC, AUPRC, sensitivity, specificity, F1, Brier, ECE) → final fit + calibration → compare with the active model → register `vMAJOR.MINOR.PATCH-kz-local` in `model_versions` (minor bump for new data/feedback, patch for manual) → **hot-swap** into `RiskEngine` if not worse than active by > 2 pp AUROC, otherwise keep as `candidate` → push to S3 when configured.

Endpoints: `GET /api/ml/status` (progress, stage, log), `GET /api/ml/versions`, `POST /api/ml/rollback {version}`, `GET /api/ml/datasets`.

## Training the models (CLI)

```bash
cd backend && source .venv/bin/activate
python -m ml.train_tabular                                      # synthetic demo cohort
python -m ml.train_tabular --data data/kz_nicu_2023_2025.csv --version v3.2   # real extract (see data/README.md)
python -m ml.train_imaging cxr --data data/cxr --epochs 15      # needs torch; omit --data for a procedural demo set
python -m ml.train_imaging cus --data data/cus --epochs 15
```

`train_tabular` runs stratified 5-fold CV (AUROC, AUPRC, Brier, ECE), fits the final XGBoost on 80 %, calibrates on the held-out 20 % (Platt by default, `--calibration isotonic`), and writes `artifacts/xgb-24h.{json,meta.json,calib.joblib}`. The backend loads whatever is in `artifacts/` at start-up and reports the version, metrics and calibration flag on `/api/health`.

### S3 model registry
Set the `NEO_S3_*` variables (see `deploy/.env.production.example`) and add `--push` to either training command; artifacts land at `models/<name>/<version>/` with a `latest.json` pointer. On start-up the backend pulls the latest set, so a retrain is: train locally → `--push` → `docker compose restart backend` (or `./deploy/deploy.sh models`).

## Production deployment (VPS + team domain + S3)

```bash
cp deploy/.env.production.example deploy/.env.production   # fill in server, domain, port, S3, secrets
ssh-copy-id -p 22 <login>@<server>                         # enter the VPS password once; it is never stored
./deploy/deploy.sh setup                                   # installs Docker + firewall on the VPS
./deploy/deploy.sh                                         # rsync + build + start (db, backend, frontend, Caddy TLS)
./deploy/deploy.sh status                                  # GET /api/health through https://<domain>
```
Caddy terminates TLS on `APP_PORT` (443 by default) with automatic Let's Encrypt certificates, proxies `/api/*` and WebSockets to the backend and everything else to the nginx-served frontend. Point the domain's A record at the VPS before the first deploy.

## Frontend-only deployment

### Frontend on Vercel or Netlify (optional split hosting)
Both configs ship in `frontend/` (`vercel.json`, `netlify.toml`). Import the repo, set the root to `frontend`, and add environment variables:

```
VITE_API_URL=https://api.your-domain.kz
VITE_WS_URL=wss://api.your-domain.kz
```

### 2. Backend + TimescaleDB on a VPS (DigitalOcean, AWS EC2, or a Kazakhstani provider for data residency)
```bash
git clone <repo> && cd neooutcome-ai
export NEO_JWT_SECRET=$(openssl rand -hex 32)
export NEO_CORS_ORIGINS='["https://app.your-domain.kz"]'
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```
The prod overlay runs 4 Uvicorn workers, disables demo seeding, and stops exposing Postgres. Terminate TLS with Caddy or nginx + certbot in front of `:8000` (API, including WebSockets) and `:80` (optional self-hosted frontend).

### 3. Environment variables
| Variable | Where | Purpose |
|---|---|---|
| `NEO_DATABASE_URL` | backend | async Postgres/TimescaleDB DSN |
| `NEO_JWT_SECRET` | backend | HS256 signing key (rotate per environment) |
| `NEO_CORS_ORIGINS` | backend | JSON list of allowed frontend origins |
| `NEO_SEED_DEMO_DATA` | backend | `false` in production |
| `VITE_API_URL` / `VITE_WS_URL` | frontend | public API origin when not reverse-proxied |

### 4. Hardening checklist
- JWT + RBAC tested per role (`neonatologist` signs reviews; `admin` sees all sites; others scoped to their hospital).
- Seed data is synthetic and anonymised; disable seeding in production and load de-identified extracts only.
- Audit log → ship `audit_logs` to the hospital SIEM; WebSocket auth via `?token=`.
- Responsive layout verified at tablet (768px) and desktop widths used in clinical settings.

## Data provenance

Regional figures in `routers/analytics.py` are an illustrative pilot extract. Replace with official stat.gov.kz, UNICEF MICS, DHS and UN IGME series before any external reporting.
