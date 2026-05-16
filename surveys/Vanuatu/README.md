# Vanuatu CPWB Survey

Trilingual (English / Bislama / French) web survey suite documenting **Culturally Protected Water Bodies (CPWBs)** in Vanuatu. Part of the Vave Lab Pacific CPWB / FPA survey series.

## Files

| File | Role |
|---|---|
| `van-cpwb-survey.html` | Public trilingual survey (EN / BI / FR), branching for chiefs vs. community |
| `van-cpwb-dashboard.html` | Live response viewer — KPIs, Chart.js charts, clustered Leaflet map |
| `van-cpwb-admin.html` | Password-gated CRUD (SHA-256), CSV/JSON export |
| `van-cpwb-backend.gs` | Google Apps Script backend (doPost + doGet) |
| `van-cpwb-questionnaire.pdf` | 35-page printable trilingual field form |

## CPWB types covered

FPA (Funerary), CIPA (Chiefly Installation), CircPA (Circumcision), MecPA (Medicinal), ConcPA (Conception) — adapted from the Fiji CPWB framework with Vanuatu vocabulary (*kastom*, *jif*, *nakamal*, *ples tabu*).

## Setup

See the top-level [surveys/README.md](../README.md) for the full 10-step setup checklist that applies to every Pacific country survey in this folder. Vanuatu-specific values to plug in:

- **Google Sheet name (exact):** `Vanuatu CPWB survey form results`
- **Apps Script project name:** `Vanuatu project`
- **Village dataset:** 2,099 villages across 73 islands, inlined in `van-cpwb-survey.html`
- **Provinces:** Torba, Sanma, Penama, Malampa, Shefa, Tafea

## Items to review before launch

- Bislama strings marked with `<!-- review -->` — needs native-speaker pass
- IRB protocol number — currently placeholder `[University of Hawaii at Manoa IRB Protocol #TBD]`
