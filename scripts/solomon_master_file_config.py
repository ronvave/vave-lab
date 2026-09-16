"""
Central configuration for the Solomon Islands Master file -> dashboard-snapshot
pipeline.

Sister clone of scripts/tongan_master_file_config.py (Tongan) / 
scripts/master_file_config.py (iTaukei). Points at the Solomon Islands
Scholars Master File spreadsheet ID, never the iTaukei or Tongan sheets.

This module is the single source of truth for:
- Spreadsheet ID
- Sheet names and header-row offsets
- Public-field allowlists (which columns are safe to publish)
- Publication type taxonomy
- Province/City Area -> Ward geography (9 provinces + Honiara City, 182 wards)
- Guide-required constants

GEOGRAPHY MODEL (the key structural difference from Tonga/Fiji):
    Village/Community/Study Site -> Ward -> Province/City Area -> Solomon Islands

  - Honiara City is its OWN first-level reporting area with its own 12
    wards -- a sibling of the 9 provinces, NOT folded into Guadalcanal.
    A combined national total = the 9 provinces + Honiara City.
  - Specific Island is a SEPARATE, independent attribute from administrative
    geography (a ward/province can span multiple islands; a scholar's
    origin island may not itself be an administrative unit). It is NEVER
    derived from ward/province.
  - Customary/cultural fields (Clan/Tribe/Lineage, Customary Place,
    Self-identified Home/Community) are separate from administrative
    geography and must never be inferred from it.
"""
from __future__ import annotations

# =============================================================================
# Source spreadsheet
# =============================================================================

SPREADSHEET_ID = "1um6pHKriEhbtvmkm7e8E1j0_Zt9A-oYpY88fuPoAmFY"  # Solomon Islands Scholars Master File -- NEVER the iTaukei or Tongan sheets
SPREADSHEET_HUMAN_URL = (
    f"https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit"
)

# =============================================================================
# Sheet-name -> (header_row_1indexed, first_data_row_1indexed) mapping
#
# Unlike the Tongan/iTaukei Master Sheets (title banner row 1, description
# row 2, group-label row 3, header row 4), the Solomon Islands Master Sheet
# was built with the header as ROW 1 on every data worksheet (verified via
# `gws sheets spreadsheets values get` against the live sheet, Aug 2026).
# =============================================================================

SHEETS = {
    "Scholars": {"header_row": 1, "first_data": 2},
    # Part-Solomon Islander: scholars with only one Solomon Islander parent/
    # line. Excluded from every V2 dashboard surface (map popups, uni-detail
    # lists, KPIs, aggregates, publications, discipline breakdowns, etc.).
    # The transformer reads this sheet only to build the exclusion set of
    # Scholar IDs.
    "Part-Solomon Islander": {"header_row": 1, "first_data": 2},
    "Graduate Degrees": {"header_row": 1, "first_data": 2},
    "Non-Completed Degrees": {"header_row": 1, "first_data": 2},
    "Scholarships & Funding": {"header_row": 1, "first_data": 2},
    "Awards & Honours": {"header_row": 1, "first_data": 2},
    "Positions": {"header_row": 1, "first_data": 2},
    "M>PhD Mobility": {"header_row": 1, "first_data": 2},
    "Publications": {"header_row": 1, "first_data": 2},
    "Authorship": {"header_row": 1, "first_data": 2},
    # Non-Solomon-Islander researcher authorship links (SOL-R IDs). Used
    # together with `Authorship` to decide whether a publication is
    # Solomon-Islander-associated in Panel C2's Solomon Islands view.
    "Researcher Authorship": {"header_row": 1, "first_data": 2},
    "Research Geography": {"header_row": 1, "first_data": 2},
    "Research Geography Coordinates": {"header_row": 1, "first_data": 2},
    "Institutions": {"header_row": 1, "first_data": 2},
    "Solomon Islander Researchers": {"header_row": 1, "first_data": 2},
    "Province-Ward Lookup": {"header_row": 1, "first_data": 2},
    "Village Geography Lookup": {"header_row": 1, "first_data": 2},
    "Lookups": {"header_row": 1, "first_data": 2},
    "Dashboard": {"header_row": None, "first_data": 1},  # freeform QA sheet
}

# =============================================================================
# Publication type taxonomy -- guide headline total
# =============================================================================

HEADLINE_PUBLICATION_TYPES = [
    "Journal Article",
    "Master's Thesis",
    "PhD Thesis",
    "Book Chapter",
    "Book",
]

# Full publication-type universe -- anything not in HEADLINE_PUBLICATION_TYPES
# is excluded from the "publication count" totals but may still be shown in
# panels that opt-in (like the full type breakdown table).
OTHER_PUBLICATION_TYPES_SEEN = [
    "Report",
    "Conference paper",
    "Unpublished report",
    "Other",
]

# =============================================================================
# Geography: 9 Provinces + Honiara City -> 182 Wards
# (Province-Ward Lookup worksheet; Statoids-sourced, Sep 2025, pending
# verification against SIG Gazette No.7 Sup.5, 23 Jan 2024's figure of 172
# wards -- see SOLOMON-DASHBOARD-BUILD-NOTES.md.)
#
# "PROVINCE_GROUPS" name kept for structural parity with the Tongan/iTaukei
# config modules; values are the real Solomon province -> ward structure,
# never a Fijian confederacy or Tongan Island Division.
# =============================================================================

PROVINCE_GROUPS = {
    "Central": ["Banika", "East Gela", "Lovukol", "North East Gela", "North Savo", "North West Gela", "Pavuvu", "Sandfly/Buenavista", "South East Gela", "South Savo", "South West Gela", "Tulagi"],
    "Choiseul": ["Babatana", "Bangera", "Batava", "Katupika", "Kerepangara", "Kirugela", "Polo", "Senga", "Susuka", "Tavula", "Tepazaka", "Vasipuki", "Viviru", "Wagina"],
    "Guadalcanal": ["Aola", "Avuavu", "Birao", "Duidui", "East Ghaobata", "East Tasimboko", "Kolokarako", "Longgu", "Malango", "Moli", "Paripao", "Saghalu", "Savulei", "Talise", "Tandai", "Tangarare", "Tetekanji", "Valasi", "Vatukulau", "Vulolo", "Wanderer Bay", "West Ghaobata"],
    "Isabel": ["Baolo", "Buala", "Hovikoilo", "Japuana", "Kaloka", "Kia", "Kmaga", "Kokota", "Kolomola", "Kolotubi", "Koviloko", "Samasodu", "Sigana", "Susubona", "Tatamba", "Tirotongana"],
    "Makira-Ulawa": ["Arosi East", "Arosi North", "Arosi South", "Arosi West", "Bauro Central", "Bauro East", "Bauro West", "Haununu", "North Ulawa", "Rawo", "Santa Ana", "Santa Catalina", "South Ulawa", "Star Harbour North", "Star Harbour South", "Ugi and Pio", "Wainoni East", "Wainoni West", "Weather Coast", "West Ulawa"],
    "Malaita": ["Aba/Asimeuru", "Aiaisi", "Aimela", "Areare", "Asimae", "Auki", "Buma", "East Baegu", "Fauabu", "Faumamanu/Kwai", "Fo'ondo/Gwaiau", "Fouenda", "Gulalofou", "Keaimela/Radefasu", "Kwarekwareo", "Langalanga", "Luaniua", "Malu'u", "Mandalua/Folotana", "Mareho", "Matakwalao", "Nafinua", "Pelau", "Raroisu'u", "Siesie", "Sikaiana", "Sububenu/Burianiasi", "Sulufou/Kwarande", "Tai", "Takwa", "Waneagu Silana Sina", "Waneagu/Taelanasina", "West Baegu/Fataleka"],
    "Rennell-Bellona": ["East Gaongau", "East Tenggano", "Kanava", "Lughu", "Matangi", "Mugi Henua", "Sa'aiho", "Te Tau Gangoto", "West Gaongau", "West Tenggano"],
    "Temotu": ["Duff Islands", "Fenualoa", "Graciosa Bay", "Lipe/Temua", "Luva Station", "Manuopo", "Nanggu/Lord Howe", "Nea/Noole", "Nenumpo", "Neo", "Nevenema", "Nipua/Nopoli", "North East Santa Cruz", "Polynesian Outer Islands", "Tikopia", "Utupua", "Vanikoro"],
    "Western": ["Central Ranongga", "Gizo", "Inner Shortlands", "Irringgilla", "Kolombaghea", "Kusaghe", "Mbilua", "Mbuini Tusu", "Munda", "Ndovele", "Nggatokae", "Nono", "Noro", "North Kolombangara", "North Ranongga", "North Rendova", "North Vangunu", "Nusa Roviana", "Outer Shortlands", "Roviana Lagoon", "Simbo", "South Kolombangara", "South Ranongga", "South Rendova", "Vonavona", "Vonunu"],
    "Honiara City": ["Cruz", "Kola'a", "Kukum", "Mataniko", "Mbumburu", "Naha", "Nggossi", "Panatina", "Rove/Lengakiki", "Vavaea", "Vuhokesa", "Vura"],
}

PROVINCE_TO_CONFEDERACY: dict[str, str] = {}
for _prov, _wards in PROVINCE_GROUPS.items():
    for _w in _wards:
        PROVINCE_TO_CONFEDERACY[_w] = _prov

# Ordered 10 first-level reporting areas (9 provinces + Honiara City).
PROVINCES = list(PROVINCE_GROUPS.keys())
assert len(PROVINCES) == 10
WARDS = list(PROVINCE_TO_CONFEDERACY.keys())
assert len(WARDS) == 182, f"expected 182 wards, got {len(WARDS)}"
HONIARA_WARDS = PROVINCE_GROUPS["Honiara City"]

# Self-documenting aliases
WARD_TO_PROVINCE = PROVINCE_TO_CONFEDERACY
ALL_REPORTING_AREAS = PROVINCES  # combined national total = these 10 summed

# Special "provinces" -- extra columns some sheets may carry
PROVINCE_SOLOMON_UNSPECIFIED = "Solomon Islands - no province specified"
PROVINCE_UNSURE = "Unsure"

ALL_SOLOMON_GEOGRAPHY_LABELS = (
    PROVINCES + [PROVINCE_SOLOMON_UNSPECIFIED, PROVINCE_UNSURE]
)

# =============================================================================
# Public-field allowlists
#
# Any Scholars/Publications/Graduate-Degrees field NOT listed here is
# stripped before writing sanitized JSON. This is the primary sanitization
# gate -- never publish a private field. Field names below match the real
# Solomon Islands Scholars Master File column headers (verified via `gws
# sheets spreadsheets values get` against the live sheet, Aug 2026).
# =============================================================================

SCHOLAR_PUBLIC_FIELDS = [
    "Scholar ID",
    "Display Name",
    "Family Name",
    "Given Names",
    "Title/Salutation",
    "Gender",
    "Birth Year",
    "Alive/Deceased",
    "Death Year",
    "Photo URL",
    "Solomon Islander Status",
    "Roster Tier",
    # Administrative geography: 3-tier (Village/Community -> Ward ->
    # Province/City Area), Paternal + Maternal.
    "Paternal Province/City Area",
    "Paternal Ward",
    "Paternal Specific Island",
    "Paternal Village/Community",
    "Maternal Province/City Area",
    "Maternal Ward",
    "Maternal Specific Island",
    "Maternal Village/Community",
    # Customary/cultural -- independent of administrative geography, never
    # inferred from it.
    "Paternal Clan/Tribe/Lineage",
    "Maternal Clan/Tribe/Lineage",
    "Customary Place",
    "Self-identified Home/Community",
    "Primary Discipline",
    "Broad Discipline",
    "Current Role",
    "Current Institution ID",
    "Department",
    "Institution Country",
    "Highest Completed Degree",
    "Current PG Status",
    "ORCID",
    "Google Scholar",
    "Scopus Author ID",
    "Researcher Profile URL",
    "Personal/Official Profile URL",
    "Degree Episodes",
    "Funding Episodes",
    "Awards Count",
    "Linked Publications",
    "First-author Publications",
    "Current Leadership Category",
    "Current Leadership Level",
    "Aliases",
]

# Notes/evidence/review-status/source-basis are private
SCHOLAR_PRIVATE_FIELDS = [
    "Identity Evidence Source ID",
    "Review Status",
    "Inclusion Status",
    "Paternal Evidence Source ID",
    "Maternal Evidence Source ID",
    "Customary Evidence Notes",
    "Source Basis",
    "Record Notes",
    "Created At",
    "Created By",
    "Updated At",
    "Updated By",
]

PUBLICATION_PUBLIC_FIELDS = [
    "Publication ID",
    "BibTeX Key",
    "Type",
    "Title",
    "Year",
    "Authors as Published",
    "Journal/Publisher",
    "Volume",
    "Issue",
    "Pages",
    "DOI",
    "URL",
    "Open Access/Full Text",
    "Language",
    "Verification Status",
    # 9 provinces + Honiara City + unspecified/unsure -- one-hot columns
    # (mirrors the Tongan/iTaukei sheets' wide-format geography columns, if
    # the Solomon Publications sheet is later extended with them; currently
    # per-publication geography lives in the separate Research Geography
    # sheet and is joined in by Publication ID instead).
    *PROVINCES,
    PROVINCE_SOLOMON_UNSPECIFIED,
    PROVINCE_UNSURE,
]

PUBLICATION_PRIVATE_FIELDS = [
    "Abstract",  # copyright-sensitive
    "Zotero Key",  # provenance
    "Notes",
    "Created At",
    "Created By",
    "Updated At",
    "Updated By",
]

AUTHORSHIP_PUBLIC_FIELDS = [
    "Authorship ID",
    "Publication ID",
    "Scholar ID",
    "Author Name as Published",
    "Author Position",
    "Is First Author",
    "Corresponding Author",
]

# Non-Solomon-Islander researcher authorship. Records publication-researcher
# links (SOL-R IDs) for non-Solomon-Islander collaborators whose Scholar ID
# does not appear in `Scholars`. Panel C2's Solomon Islands view accepts
# either an `Authorship` (Scholar) or `Researcher Authorship` (Researcher)
# link as the Solomon-Islander-associated signal.
RESEARCHER_AUTHORSHIP_PUBLIC_FIELDS = [
    "Authorship ID",
    "Publication ID",
    "Researcher ID",
    "Author Name as Published",
    "Author Position",
]

GRAD_DEGREE_PUBLIC_FIELDS = [
    "Degree ID",
    "Scholar ID",
    "Stage",
    "Degree Name",
    "Field/Discipline",
    "Broad Discipline",
    "Thesis Title",
    "Institution ID",
    "Institution Name (Original)",
    "Institution Name (Current)",  # canonical for all counts/aggregations
    "Country",
    "Start Year",
    "End Year",
    "Graduation Year",
    "Completion Status",
    "Repository URL",
    "DOI/Handle",
    "Thesis Publication ID",
]

GRAD_DEGREE_PRIVATE_FIELDS = [
    "Evidence Source ID",
    "Notes",
    "Created At",
    "Created By",
    "Updated At",
    "Updated By",
]

# M>PhD Mobility -- derived from the Graduate Degrees links; Notes is private.
MOBILITY_PUBLIC_FIELDS = [
    "Mobility ID",
    "Scholar ID",
    "Master's Degree ID",
    "Master's Institution ID",
    "Master's Country",
    "PhD Degree ID",
    "PhD Institution ID",
    "PhD Country",
    "Same Institution (Y/N)",
    "Same Country (Y/N)",
    "Gap Years",
]

MOBILITY_PRIVATE_FIELDS = ["Notes"]

# Awards / Funding / Positions -- allowlists (subset of columns; assume the
# rest are private until Ron whitelists them).
AWARD_PUBLIC_FIELDS = [
    "Award ID",
    "Scholar ID",
    "Award Name",
    "Awarding Body",
    "Category",
    "Year",
    "Country",
]

FUNDING_PUBLIC_FIELDS = [
    "Funding ID",
    "Scholar ID",
    "Program/Funder",
    "Award Type",
    "Destination Country",
    "Destination Institution ID",
    "Start Year",
    "End Year",
    "Cohort Name",
]

POSITION_PUBLIC_FIELDS = [
    "Position ID",
    "Scholar ID",
    "Title",
    "Institution ID",
    "Department",
    "Country",
    "Leadership Category",
    "Leadership Level",
    "Start Year",
    "End Year",
    "Current Flag",
]

RESEARCH_GEOGRAPHY_PUBLIC_FIELDS = [
    "Geography ID",
    "Publication ID",
    "Country",
    "Province/City Area",
    "Ward",
    "Specific Island",
    "Village/Community/Site",
    "Latitude",
    "Longitude",
    "Geography Scale",
    "Verification Status",
]

RESEARCH_GEOGRAPHY_COORDINATES_PUBLIC_FIELDS = [
    "Place Name",
    "Level (Country/Province/Ward/Village/Site)",
    "Parent Place",
    "Latitude",
    "Longitude",
    "Alias(es)",
]

INSTITUTION_PUBLIC_FIELDS = [
    "Institution ID",
    "Canonical Name",
    "Aliases/Historical Names",
    "Country",
    "Campus",
    "Type",
    "Website",
]

RESEARCHER_PUBLIC_FIELDS = [
    "Researcher ID",
    "Display Name",
    "Family Name",
    "Given Names",
    "Gender",
    "Role/Contribution Type",
    "Affiliation",
    "Province/City Area (if known)",
]

# =============================================================================
# Output snapshot filenames -- these are what the dashboard fetches (encrypted
# to .enc by the encryption script, plaintext gitignored)
# =============================================================================

OUTPUT_FILES = {
    "scholars": "data/solomon-master-scholars.json",
    "publications": "data/solomon-master-publications.json",
    "authorship": "data/solomon-master-authorship.json",
    "researcher_authorship": "data/solomon-master-researcher-authorship.json",
    "grad_degrees": "data/solomon-master-grad-degrees.json",
    "mobility": "data/solomon-master-mobility.json",
    "geography": "data/solomon-master-geography.json",
    "geography_coordinates": "data/solomon-master-geography-coordinates.json",
    "aggregates": "data/solomon-master-aggregates.json",
    "snapshot": "data/solomon-master-snapshot.json",  # compat wrapper
    "last_sync": "data/solomon-last-master-sync.json",
}
