# Training data (git-ignored)

Place de-identified extracts here:

- `kz_nicu_<years>.csv` — one admission per row, the 31 core feature columns + `deteriorated_24h` (0/1).
  Column names must match `services/ml_engine.ALL_FEATURES`; use the schema mapper export from the app to rename Damumed columns.
- `cxr/<class>/*.png` with classes `rds`, `pneumothorax`, `ett`
- `cus/<class>/*.png` with classes `ivh_0` … `ivh_4`

Never commit PHI. Keep raw hospital exports outside the repository and run `ml/anonymize.py`-style
de-identification (drop names, IDs, dates → relative hours) before copying files here.
