"""
Central configuration for the Samoa Scholar Database Master file → dashboard-
snapshot pipeline.

Sister clone of scripts/master_file_config.py (iTaukei) and
scripts/tongan_master_file_config.py (Tongan). Points at the Samoa
spreadsheet ID and never any other jurisdiction's sheet:

  iTaukei sheet:  1nJvMWLS8jnCOKtRoqdDpEW3s3j9TSAclXBO1txVFxdg  (never touch)
  Tongan sheet:   1lh6wOFcg2GiFe2YylgxM5cvLOdumdbCrHDLQk87rjRI  (never touch)
  Solomon sheet:  set in scripts/solomon_master_file_config.py  (never touch)
  Samoa sheet:    set below                                     (this file's target)

This module is the single source of truth for:
- Spreadsheet ID
- Sheet names and header-row offsets
- Public-field allowlists (which columns are safe to publish)
- Publication type taxonomy
- Statistical Region → Political/Census District mapping
- Traditional itūmālō lookup (constitutional, kept separate from census)
- Electoral Constituency lookup (time-versioned)
- Specific Island vocabulary (independent, never derived from district)
- Guide-required constants

CRITICAL — six independent geography dimensions
-----------------------------------------------
Samoa's blueprint (Samoa-Scholarly-Database-Master-Schema-Build-Blueprint.docx,
Prof. Ron Vave, 2026-08-30) requires that these six systems be preserved as
separate lookup dimensions. This module exposes them as six independent Python
constants and NEVER as a single "province" or "confederacy" hierarchy:

  1. STATISTICAL_REGIONS          - 4 SBS census regions
  2. REGION_TO_DISTRICTS          - SBS Political/Census districts by region
  3. VILLAGES                     - SBS Village Directory (loaded from workbook)
  4. SPECIFIC_ISLANDS             - independent island vocabulary
  5. TRADITIONAL_ITUMALO          - 11 constitutional traditional districts
  6. ELECTORAL_CONSTITUENCIES     - time-versioned electoral constituencies

Any code that tries to substitute one for another (e.g. traditional itūmālō
for a census district) must be rejected in review.
"""
from __future__ import annotations

# =============================================================================
# Source spreadsheet
# =============================================================================

# NOTE: this constant is populated when Ron creates the Samoa Master Sheet and
# copies its spreadsheet ID here. Until then, the pipeline is inert — the
# transformer refuses to run against a placeholder. NEVER paste the iTaukei,
# Tongan, or Solomon Islands sheet ID here.
SPREADSHEET_ID = "SET_ME_TO_SAMOA_MASTER_SHEET_ID"

SPREADSHEET_HUMAN_URL = (
    f"https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit"
)

# =============================================================================
# Sheet-name → (header_row_1indexed, first_data_row_1indexed) mapping
# Row 1 is a title banner, row 2 is a description, row 3 is either blank or
# a group-label row (only for Publications), row 4 is the real header.
# =============================================================================

SHEETS = {
    "Scholars": {"header_row": 4, "first_data": 5},
    # Part-Indigenous: mixed-heritage scholars kept in a separate roster so
    # V2 headline counts / cards / geography summaries stay a clean Indigenous
    # roster. Headline inclusion of this tier is an explicit dashboard filter.
    "Part-Indigenous": {"header_row": 4, "first_data": 5},
    "Graduate Degrees": {"header_row": 4, "first_data": 5},
    "Non-Completed Degrees": {"header_row": 4, "first_data": 5},
    "Scholarships & Funding": {"header_row": 4, "first_data": 5},
    "Awards & Honours": {"header_row": 4, "first_data": 5},
    "Positions": {"header_row": 4, "first_data": 5},
    "M>PhD Mobility": {"header_row": 4, "first_data": 5},
    "Publications": {
        "header_row": 4,
        "first_data": 5,
        "group_row": 3,  # Statistical Region group labels (never itūmālō)
    },
    "Authorship": {"header_row": 4, "first_data": 5},
    "Researcher Authorship": {"header_row": 4, "first_data": 5},
    "Research Geography": {"header_row": 4, "first_data": 5},
    "Research Geography Coordinates": {"header_row": 4, "first_data": 5},
    "Institutions": {"header_row": 4, "first_data": 5},
    "Regions Lookup": {"header_row": 4, "first_data": 5},
    "Region-District Lookup": {"header_row": 4, "first_data": 5},
    "Village Geography Lookup": {"header_row": 4, "first_data": 5},
    "Traditional Itūmālō Lookup": {"header_row": 4, "first_data": 5},
    "Electoral Constituency Lookup": {"header_row": 4, "first_data": 5},
    "Source Register": {"header_row": 4, "first_data": 5},
    "Change Log": {"header_row": 4, "first_data": 5},
    "Coauthor Network": {"header_row": 4, "first_data": 5},
    "Samoan Researchers": {"header_row": 4, "first_data": 5},
    "Dashboard": {"header_row": None, "first_data": 4},  # freeform QA sheet
}

# =============================================================================
# Publication type taxonomy — blueprint §5.3
# =============================================================================

HEADLINE_PUBLICATION_TYPES = [
    "Journal Article",
    "Master's Thesis",
    "PhD Thesis",
    "Book Chapter",
    "Book",
]

# Present but excluded from V2 headline counts (matches iTaukei V2 policy).
OTHER_PUBLICATION_TYPES_SEEN = [
    "Report",
    "Conference Paper",
    "Preprint",       # V2-excluded
    "Unpublished",    # V2-excluded pending reclassification
    "Other",
]

# =============================================================================
# Six geography dimensions — kept SEPARATE
# -----------------------------------------------------------------------------
# 1. Statistical Regions (SBS census spine top)
# 2. Region → SBS Political/Census District mapping
# 3. Traditional Itūmālō (constitutional; parallel dimension)
# 4. Specific Island (independent field; never inferred from district)
# 5. Electoral Constituencies (time-versioned)
# 6. Villages — sourced from the workbook's Village Geography Lookup tab
#    (not embedded here because it is ~340 rows)
# =============================================================================

# ---------- (1) Statistical Regions ----------
STATISTICAL_REGIONS = [
    "Apia Urban Area",
    "North-West Upolu",
    "Rest of Upolu",
    "Savai'i",
]

# ---------- (2) Region → SBS Political/Census District ----------
# Populated by the transformer from the "Region-District Lookup" tab of the
# Master Sheet. The default value here is the authoritative SBS 2021 Census
# structure and is regenerated on every refresh. Do not hardcode edits here;
# fix the lookup tab instead.
#
# The complete list of ~43 SBS districts is loaded at runtime — see
# scripts/samoa_master_file_transformer.py.
REGION_TO_DISTRICTS: dict[str, list[str]] = {
    "Apia Urban Area": [],
    "North-West Upolu": [],
    "Rest of Upolu": [],
    "Savai'i": [],
}

# ---------- (3) Traditional Itūmālō (constitutional, 11 districts) ----------
# From the Constitution of the Independent State of Samoa, Second Schedule.
# Parallel to the SBS statistical spine; NEVER substituted for census district.
TRADITIONAL_ITUMALO = [
    # Upolu / offshore
    "Tuamasaga",
    "A'ana",
    "Aiga-i-le-Tai",
    "Va'a-o-Fonoti",
    "Atua",
    # Savai'i
    "Fa'asaleleaga",
    "Gaga'emauga",
    "Gaga'ifomauga",
    "Vaisigano",
    "Satupa'itea",
    "Palauli",
]
assert len(TRADITIONAL_ITUMALO) == 11

# ---------- (4) Specific Island (independent) ----------
# Kept as its own vocabulary because a village's district does not uniquely
# determine which island it sits on (Manono and Apolima villages sit within
# Aiga-i-le-Tai; the four offshore islets of Aleipata sit within Aleipata
# districts). Never derive island from district name.
SPECIFIC_ISLANDS = [
    "Upolu",
    "Savai'i",
    "Manono",
    "Apolima",
    "Nu'utele",
    "Nu'ulua",
    "Namu'a",
    "Fanuatapu",
]

# ---------- (5) Electoral Constituencies ----------
# Loaded at runtime from the "Electoral Constituency Lookup" tab. Time-versioned
# because the Electoral Constituencies Act 2019 replaced the earlier structure.
# The dashboard filter must always display the election-year alongside the name.
ELECTORAL_VERSIONS = [
    "2019-Act (Electoral Constituencies Act 2019)",
    "Pre-2019",
]

# =============================================================================
# Cross-country label for the discipline breakdown panel (matches Fiji/Tonga)
# =============================================================================

BROAD_DISCIPLINES = [
    "Natural & Environmental Sciences",
    "Health & Medical Sciences",
    "Social Sciences",
    "Humanities",
    "Education",
    "Law & Policy",
    "Business & Economics",
    "Engineering & Technology",
    "Arts",
    "Interdisciplinary",
    "Unclassified",
]

# =============================================================================
# Public-field allowlist
# =============================================================================
# Only the fields listed here may appear in encrypted snapshots destined for
# GitHub Pages. Everything else stays inside the Master workbook.
PUBLIC_ALLOWLIST_SCHOLARS = [
    "Scholar ID", "Display Name", "Family Name", "Given Names",
    "Title / Salutation", "Gender", "Living Status", "Birth Year", "Death Year",
    "Photo URL",
    # Public geography = paternal only (owner-confirmed 2026-08-30)
    "Statistical Region (Paternal)", "Political/Census District (Paternal)",
    "Traditional Itūmālō (Paternal)", "Specific Island (Paternal)",
    "Village (Paternal)", "Electoral Constituency (Paternal)",
    "Electoral Version (Paternal)",
    # Career
    "Primary Discipline", "Broad Discipline", "Current Role",
    "Current Institution ID", "Current Department", "Current Country",
    "Highest Completed Degree", "Current Postgraduate Status",
    # Profiles
    "ORCID", "Google Scholar URL", "Scopus Author ID",
    "Official Profile URL", "ResearchGate URL", "Personal Website",
    # Derived
    "Total Completed Degrees", "Total Publications",
    "Total First-Author Publications", "Total Awards",
    "Leadership Category", "Leadership Level",
    # Aliases (used for search)
    "Aliases (semicolon-separated)",
]

PUBLIC_DENY_FIELDS_SCHOLARS = [
    # Never public — matches Fiji V2 / Tongan public-boundary policy
    "Statistical Region (Maternal)", "Political/Census District (Maternal)",
    "Traditional Itūmālō (Maternal)", "Specific Island (Maternal)",
    "Village (Maternal)", "Electoral Constituency (Maternal)",
    "Electoral Version (Maternal)",
    "Maternal Geography Source ID",
    "Family / ʻĀiga (Paternal)", "Family / ʻĀiga (Maternal)",
    "Matai Title", "Matai Title Village", "Customary Affiliation",
    "Self-identified Home / Community", "Cultural Evidence Notes",
    "Notes (internal — never public)",
    "Review Status", "Inclusion Status",
    "Identity Source ID", "Paternal Geography Source ID",
]

# =============================================================================
# Cross-system safety guardrail — refuse to run if SPREADSHEET_ID looks wrong
# =============================================================================

_FORBIDDEN_SPREADSHEET_IDS = {
    "1nJvMWLS8jnCOKtRoqdDpEW3s3j9TSAclXBO1txVFxdg",  # iTaukei
    "1lh6wOFcg2GiFe2YylgxM5cvLOdumdbCrHDLQk87rjRI",  # Tongan
}


def assert_samoa_spreadsheet() -> None:
    """Called at the top of every transformer entry point."""
    if SPREADSHEET_ID in _FORBIDDEN_SPREADSHEET_IDS:
        raise SystemExit(
            f"REFUSING TO RUN: SPREADSHEET_ID={SPREADSHEET_ID!r} is a "
            f"non-Samoa sister system. Update scripts/samoa_master_file_config.py "
            f"to point at the Samoa Master Sheet ID."
        )
    if SPREADSHEET_ID == "SET_ME_TO_SAMOA_MASTER_SHEET_ID":
        raise SystemExit(
            "REFUSING TO RUN: Samoa Master Sheet ID has not been set yet. "
            "Edit scripts/samoa_master_file_config.py after creating the sheet."
        )
