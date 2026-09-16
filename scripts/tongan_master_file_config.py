"""
Central configuration for the Tongan Master file → dashboard-snapshot pipeline.

Sister clone of scripts/master_file_config.py (iTaukei). Points at the
Tongan spreadsheet ID, never the read-only iTaukei sheet
(1nJvMWLS8jnCOKtRoqdDpEW3s3j9TSAclXBO1txVFxdg).

This module is the single source of truth for:
- Spreadsheet ID
- Sheet names and header-row offsets
- Public-field allowlists (which columns are safe to publish)
- Publication type taxonomy
- Island Division → districts mapping (never a Fijian confederacy)
- Guide-required constants
"""
from __future__ import annotations

# =============================================================================
# Source spreadsheet
# =============================================================================

SPREADSHEET_ID = "1lh6wOFcg2GiFe2YylgxM5cvLOdumdbCrHDLQk87rjRI"  # Tongan sheet — NEVER the iTaukei sheet (1nJvMWLS8jnCOKtRoqdDpEW3s3j9TSAclXBO1txVFxdg)
SPREADSHEET_HUMAN_URL = (
    f"https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit"
)

# =============================================================================
# Sheet-name → (header_row_1indexed, first_data_row_1indexed) mapping
# Row 1 is a title banner, row 2 is a description, row 3 is either blank or
# a confederacy-group label row, row 4 is the real header.
# =============================================================================

SHEETS = {
    "Scholars": {"header_row": 4, "first_data": 5},
    # Part-Tongan: scholars whose father is NOT Tongan (mother is). Because
    # Tongan identity in this database follows the same patrilineal rule as
    # the iTaukei system, these are excluded from every V2 dashboard surface
    # (map popups, uni-detail lists, KPIs, aggregates, publications,
    # discipline breakdowns, etc.). The transformer reads this sheet only to
    # build the exclusion set of Scholar IDs.
    "Part-Tongan": {"header_row": 4, "first_data": 5},
    "Graduate Degrees": {"header_row": 4, "first_data": 5},
    "Non-Completed Degrees": {"header_row": 4, "first_data": 5},
    "Scholarships & Funding": {"header_row": 4, "first_data": 5},
    "Awards & Honours": {"header_row": 4, "first_data": 5},
    "Positions": {"header_row": 4, "first_data": 5},
    "M>PhD mobility": {"header_row": 4, "first_data": 5},
    "Publications": {
        "header_row": 4,
        "first_data": 5,
        "group_row": 3,  # Island Division group labels (never confederacy)
    },
    "Authorship": {"header_row": 4, "first_data": 5},
    # Non-Tongan researcher authorship links (TON-R IDs). Used together
    # with `Authorship` to decide whether a publication is
    # Tongan-associated in Panel C2's Tongan view.
    "Researcher Authorship": {"header_row": 4, "first_data": 5},
    "Research Geography": {"header_row": 4, "first_data": 5},
    "Research Geography Coordinates": {"header_row": 4, "first_data": 5},
    "Institutions": {"header_row": 4, "first_data": 5},
    "Dashboard": {"header_row": None, "first_data": 4},  # freeform QA sheet
}

# =============================================================================
# Publication type taxonomy — guide §7 headline total
# =============================================================================

HEADLINE_PUBLICATION_TYPES = [
    "Journal Article",
    "Master's Thesis",
    "PhD Thesis",
    "Book Chapter",
    "Book",
]

# Full publication-type universe — anything not in HEADLINE_PUBLICATION_TYPES
# is excluded from the "publication count" totals but may still be shown in
# panels that opt-in (like the full type breakdown table).
OTHER_PUBLICATION_TYPES_SEEN = [
    "Report",
    "Conference paper",
    "Unpublished report",
    "Other",
]

# =============================================================================
# Confederacies (guide §9)
# =============================================================================

# Tonga's 5 Island Divisions -> 23 districts (2021 Census, Tonga
# Statistics Department). "CONFEDERACIES" name kept for structural parity
# with the iTaukei config module; values are Tonga Island Divisions, never
# a Fijian confederacy.
CONFEDERACIES = {
    "Tongatapu": ["Kolofo'ou", "Kolomotu'a", "Vaini", "Tatakamotonga", "Lapaha", "Nukunuku", "Kolovai"],
    "Vava'u": ["Neiafu", "Pangaimotu", "Hahake", "Leimatu'a", "Hihifo", "Motu"],
    "Ha'apai": ["Pangai", "Foa", "Lulunga", "Mu'omu'a", "Ha'ano", "'Uiha"],
    "'Eua": ["'Eua Motu'a", "'Eua Fo'ou"],
    "Ongo Niua": ["Niuatoputapu", "Niuafo'ou"],
}

# Ordered 23 districts (Tongatapu → Vava'u → Ha'apai → 'Eua → Ongo Niua) —
# the wide-format order used in the Publications sheet columns and the
# Dashboard sheet.
PROVINCES = [p for provinces in CONFEDERACIES.values() for p in provinces]
assert len(PROVINCES) == 23

# Special "districts" — extra columns in Publications sheet
PROVINCE_FIJI_UNSPECIFIED = "Tonga - no district specified"
PROVINCE_UNSURE = "Unsure"

ALL_FIJI_GEOGRAPHY_LABELS = (
    PROVINCES + [PROVINCE_FIJI_UNSPECIFIED, PROVINCE_UNSURE]
)

# Reverse lookup: province → confederacy
PROVINCE_TO_CONFEDERACY = {
    prov: conf for conf, provs in CONFEDERACIES.items() for prov in provs
}

# =============================================================================
# Public-field allowlists (guide §22)
#
# Any Scholars/Publications/Graduate-Degrees field NOT listed here is
# stripped before writing sanitized JSON. This is the primary sanitization
# gate — never publish a private field.
# =============================================================================

SCHOLAR_PUBLIC_FIELDS = [
    "Scholar ID",
    "Scholar Name",
    "Title / Salutation",
    "Family Name",
    "Given Names",
    "Gender",
    "Year of Birth",
    "Alive / Deceased",
    "Year of Death",
    # Current Tonga hierarchy (Village/Town → District → Specific Island →
    # Island Division). Legacy names remain below so older exports continue
    # to pass the same public-field gate during a rolling deployment.
    "Paternal Island Division",
    "Specific Island Paternal",
    "Village/Town Paternal (Kolo)",
    "Maternal Island Division",
    "Specific Island Maternal",
    "Village/Town Maternal (Kolo)",
    "Paternal Confederacy",
    "Province Paternal",
    "District Paternal",
    "Island Paternal",
    "Village Paternal",
    "Province Maternal",
    "District Maternal",
    "Island Maternal",
    "Village Maternal",
    "Primary Discipline / Field",
    "Current Title / Role",
    "Current Institution",
    "Institution Country",
    "Current Department / Unit",
    "Highest Completed Degree",
    "Current PG Status",
    "Degree Episodes",
    "International Degree Episodes",
    "Tonga Degree Episodes",
    "Fiji Degree Episodes",
    "Funding Episodes",
    "Awards Count",
    "Gold Medals / Prizes Count",
    "Linked Publication Count",
    "First-Author Publication Count",
    "Current Leadership Category",
    "Current Leadership Level",
    "Current Profile URL",
    "ORCID / Researcher ID",
    "Google Scholar URL",
    "Roster Tier",
]

# Notes/Vanua-notes/Review-status/BibTeX-match are private
SCHOLAR_PRIVATE_FIELDS = [
    "Lineage / Provenance Notes",
    "Vanua / Provenance Notes",
    "Review Status",
    "Source Basis",
    "BibTeX Author Match (roster)",
    "BibTeX Author Occurrences (roster)",
    "Name Variants / Aliases",
    "Record Notes",
]

PUBLICATION_PUBLIC_FIELDS = [
    "Publication ID / BibTeX Key",
    "Entry Type",
    "Publication Type",
    "Title",
    "Year",
    "Journal / Book Title",
    "Publisher / Institution / School",
    "DOI",
    "URL",
    "Keywords",
    "Tagged Tonga?",
    "Tagged Tongan?",
    "Thesis Level",
    "Linked Tongan Scholar Count",
    "Auth_Lead Scholar ID",
    "Co-Auth_Scholar IDs",
    "Record Source",
    "Source Database / Repository",
    # Bibliographic authorship (from BibTeX/Zotero, not Authorship worksheet).
    # B4 citation uses these to render Last (Year) / Last & Last (Year) /
    # Last et al. (Year) using the true first author of the record.
    "Bibliographic Lead Author",
    "Bibliographic Author Count",
    # 23 districts + Tonga unspecified + Unsure — one-hot columns
    *PROVINCES,
    PROVINCE_FIJI_UNSPECIFIED,
    PROVINCE_UNSURE,
]

PUBLICATION_PRIVATE_FIELDS = [
    "Abstract",  # copyright-sensitive
    "Discovery / Source URL",  # provenance
    "Deduplication Key",
]

AUTHORSHIP_PUBLIC_FIELDS = [
    "Authorship ID",
    "Scholar ID",
    "Scholar Name",
    "Publication ID / BibTeX Key",
    "Author Name as Recorded",
    "Author Position",
    "Is First Author?",
]

# Non-Tongan researcher authorship. Ron uses this sheet to record
# publication‑researcher links (TON-R IDs) for non‑Tongan collaborators
# whose Scholar ID does not appear in `Scholars`. Panel C2 Tongan view
# accepts either an `Authorship` (Scholar) or `Researcher Authorship`
# (Researcher) link as the Tongan-associated signal.
RESEARCHER_AUTHORSHIP_PUBLIC_FIELDS = [
    "Researcher Authorship ID",
    "Researcher ID",
    "Researcher Name",
    "Publication ID / BibTeX Key",
    "Author Name as Recorded",
    "Author Position",
    "Is First Author?",
]

# Graduate Degrees: C_Uni public, O_Uni allowed in tooltips/metadata ONLY
# (never aggregated, mapped, filtered, or counted). Ron clarified this on
# 2026-08-21: O_Uni is historical institutional metadata, not private, but
# must never drive counts/aggregations/maps/mobility.
GRAD_DEGREE_PUBLIC_FIELDS = [
    "Degree ID",
    "Scholar ID",
    "Scholar Name",
    "Degree Stage",
    "Degree / Qualification",
    "Field / Discipline",
    "C_Uni name",  # canonical for all counts/aggregations
    "O_Uni name",  # historical only — for tooltip/profile display
    "Country",
    "International from Tonga?",
    "City",
    "Region",
    "Year / Status",
    "Completion Status",
    "Thesis / Research Title",
    "Start Year",
    "Finish / Completion Year",
    "Duration (years)",
]

GRAD_DEGREE_PRIVATE_FIELDS = [
    "Thesis / Repository URL",
    "Evidence URL 1",
    "Evidence URL 2",
    "Verification",
    "Notes",
    "Study Date Evidence / Notes",
]

# M>PhD mobility: coords/university fields — these are already aggregated
# for the chord/sankey and are safe to publish. Info links + Notes are private.
MOBILITY_PUBLIC_FIELDS = [
    "scholar_id",
    "New?",
    "m_uni",
    "m_in",
    "m_city",
    "m_country",
    "m_region",
    "m_lon",
    "m_lat",
    "m_year",
    "p_uni",
    "p_in",
    "p_city",
    "p_country",
    "p_region",
    "p_lon",
    "p_lat",
    "p_year",
]

MOBILITY_PRIVATE_FIELDS = ["m_title", "p_title", "Info link1", "Info link2", "Notes"]

# Awards / Funding / Positions — allowlists (subset of columns; assume the
# rest are private until Ron whitelists them).
AWARD_PUBLIC_FIELDS = [
    "Scholar ID",
    "Award Name",
    "Award Category",
    "Year",
    "Country",
    "Institution / Awarding Body",
]

FUNDING_PUBLIC_FIELDS = [
    "Scholar ID",
    "Funding Name",
    "Funding Type",
    "Year",
    "Country",
    "Awarding Body / Institution",
]

POSITION_PUBLIC_FIELDS = [
    "Scholar ID",
    "Position Title",
    "Institution",
    "Country",
    "Start Year",
    "End Year",
    "Is Current?",
]

# =============================================================================
# Output snapshot filenames — these are what the dashboard fetches (encrypted
# to .enc by the encryption script, plaintext gitignored)
# =============================================================================

OUTPUT_FILES = {
    "scholars": "data/tongan-master-scholars.json",
    "publications": "data/tongan-master-publications.json",
    "authorship": "data/tongan-master-authorship.json",
    "researcher_authorship": "data/tongan-master-researcher-authorship.json",
    "grad_degrees": "data/tongan-master-grad-degrees.json",
    "mobility": "data/tongan-master-mobility.json",
    "geography": "data/tongan-master-geography.json",
    "aggregates": "data/tongan-master-aggregates.json",
    "snapshot": "data/tongan-master-snapshot.json",  # compat wrapper
    "last_sync": "data/tongan-last-master-sync.json",
}
