# B2 Master-source audit — Graduate Degrees + Institutions

Source: authoritative Master sheet
(`1nJvMWLS8jnCOKtRoqdDpEW3s3j9TSAclXBO1txVFxdg`), read via gws CLI.

## Graduate Degrees summary

- Rows: **548**
- Rows flagged with validation issues: **18**
- Rows qualifying for B2 (completed Masters or PhD): **423**
  - Masters: **294**
  - PhD: **129**

See `b2_audit_graduate_degrees.csv` for every row with its flags.

### Top validation flag types

- `country_unresolved`: 9
- `cuni_looks_like_discipline`: 4
- `duplicate_degree_id`: 2
- `blank_country_on_qualifying_row`: 2
- `blank_cuni_on_qualifying_row`: 1

## Institutions summary

- Rows: **108**
- Rows flagged: **10**

See `b2_audit_institutions.csv` for every row with its flags.

### Top validation flag types

- `country_unresolved`: 10
- `GEO_contamination_not_an_institution`: 4
- `lon_unparseable`: 4
- `lat_unparseable`: 3
- `lat_unparseable('Report states the Rewa River mangrove study spans Rewa and Tailevu provinces`: 1
- `the brackish-water section sampled four distributaries including Natila, Waicoka and Nasilai on the Tailevu side.')`: 1

## Fiji university list (canonical C_Uni name, qualifying rows only)

Total qualifying Fiji-country episodes: **163**  
Distinct validated Fiji universities: **5**

| University | Masters | PhD | Total |
| :-- | --: | --: | --: |
| University of the South Pacific | 90 | 12 | 102 |
| Fiji National University | 36 | 3 | 39 |
| Pasifika Communities University | 11 | 2 | 13 |
| University of Fiji | 7 | 1 | 8 |
| Agriculture / Horticulture / Breadfruit Propagation | 1 | 0 | 1 |

### Fiji rows with blank C_Uni (excluded from B2):
- blank cuni on Degree ID DEG-0284
