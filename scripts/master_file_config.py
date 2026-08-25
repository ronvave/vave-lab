"""
Central configuration for the iTaukei_Master_file → dashboard-snapshot pipeline.

This module is the single source of truth for:
- Spreadsheet ID
- Sheet names and header-row offsets
- Public-field allowlists (which columns are safe to publish)
- Publication type taxonomy
- Confederacy → provinces mapping
- Guide-required constants
"""
from __future__ import annotations

# =============================================================================
# Source spreadsheet
# =============================================================================

SPREADSHEET_ID = "1nJvMWLS8jnCOKtRoqdDpEW3s3j9TSAclXBO1txVFxdg"
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
    "Graduate Degrees": {"header_row": 4, "first_data": 5},
    "Non-Completed Degrees": {"header_row": 4, "first_data": 5},
    "Scholarships & Funding": {"header_row": 4, "first_data": 5},
    "Awards & Honours": {"header_row": 4, "first_data": 5},
    "Positions": {"header_row": 4, "first_data": 5},
    "M>PhD mobility": {"header_row": 4, "first_data": 5},
    "Publications": {
        "header_row": 4,
        "first_data": 5,
        "group_row": 3,  # confederacy group labels
    },
    "Authorship": {"header_row": 4, "first_data": 5},
    # Non-iTaukei researcher authorship links (ITK-R IDs). Used together
    # with `Authorship` to decide whether a publication is
    # iTaukei-associated in Panel C2's iTaukei view.
    "Researcher Authorship": {"header_row": 4, "first_data": 5},
    "Research Geography": {"header_row": 4, "first_data": 5},
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

CONFEDERACIES = {
    "Burebasaga": ["Kadavu", "Nadroga/Navosa", "Namosi", "Rewa", "Serua"],
    "Kubuna": ["Ba", "Lomaiviti", "Naitasiri", "Ra", "Tailevu"],
    "Tovata": ["Bua", "Cakaudrove", "Lau", "Macuata"],
}

# Ordered 14 provinces (Burebasaga → Kubuna → Tovata) — the wide-format order
# used in the Publications sheet columns 22..35 and in the Dashboard sheet.
PROVINCES = [p for provinces in CONFEDERACIES.values() for p in provinces]
assert len(PROVINCES) == 14

# Special "provinces" — extra columns 36..37 in Publications sheet
PROVINCE_FIJI_UNSPECIFIED = "Fiji - no province specified"
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
    "Tagged Fiji?",
    "Tagged iTaukei?",
    "Thesis Level",
    "Linked iTaukei Scholar Count",
    "Auth_Lead Scholar ID",
    "Co-Auth_Scholar IDs",
    "Record Source",
    "Source Database / Repository",
    # Bibliographic authorship (from BibTeX/Zotero, not Authorship worksheet).
    # B4 citation uses these to render Last (Year) / Last & Last (Year) /
    # Last et al. (Year) using the true first author of the record.
    "Bibliographic Lead Author",
    "Bibliographic Author Count",
    # 14 provinces + Fiji unspecified + Unsure — one-hot columns
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

# Non-iTaukei researcher authorship. Ron uses this sheet to record
# publication‑researcher links (ITK-R IDs) for non‑iTaukei collaborators
# whose Scholar ID does not appear in `Scholars`. Panel C2 iTaukei view
# accepts either an `Authorship` (Scholar) or `Researcher Authorship`
# (Researcher) link as the iTaukei-associated signal.
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
    "International from Fiji?",
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
    "scholars": "data/itaukei-master-scholars.json",
    "publications": "data/itaukei-master-publications.json",
    "authorship": "data/itaukei-master-authorship.json",
    "researcher_authorship": "data/itaukei-master-researcher-authorship.json",
    "grad_degrees": "data/itaukei-master-grad-degrees.json",
    "mobility": "data/itaukei-master-mobility.json",
    "geography": "data/itaukei-master-geography.json",
    "aggregates": "data/itaukei-master-aggregates.json",
    "snapshot": "data/itaukei-master-snapshot.json",  # compat wrapper
    "last_sync": "data/last-master-sync.json",
}
