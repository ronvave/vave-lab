"""Automatic resolver for new countries and universities.

This module lets `refresh-graduate-studies.py` self-heal when Zotero
picks up a country or university that isn't yet in the hardcoded
COUNTRY_ISO / COUNTRY_REGION / UNIVERSITY_COORDS dicts.

Two entry points:

    resolve_country(name)     -> {"iso": "TO", "region": "Pacific"} | None
    resolve_university(name)  -> {"lat": ..., "lng": ..., "country": ...,
                                  "city": ...} | None

Results are cached in ``data/auto-resolved.json`` so the same lookup
never repeats. The cache is version-tagged; bump ``CACHE_VERSION`` if
we ever change the shape.

Design goals (Ron's July 2026 mandate — repo'd in docs/DATA-COVERAGE-GAPS.md
under 'Auto-resolve policy'):

- A new country or university in Zotero must NOT block the 3-hourly
  refresh. The build should self-heal without an engineer editing the
  hardcoded dicts.
- The hardcoded dicts remain authoritative overrides. If a name is in
  the hardcoded map, we use that value even if the cache disagrees.
- Every auto-resolved entry writes a provenance line to the run log
  (which URL it came from, what confidence) so we can audit later.
- Network failures degrade gracefully: on a lookup timeout we fall
  back to the strict-coverage warning so we don't ship silently-broken
  world-map bubbles.

External services used (all free, no auth):

  * https://api.worldbank.org/v2/country          country ISO + region
                                                  (bulk download, 295 rows)
  * https://en.wikipedia.org/api/rest_v1/page/summary/{title}
                                                  university location
                                                  + country fallback
  * https://nominatim.openstreetmap.org/search    fallback geocoder

Historical note (2026-07-19): restcountries.com deprecated all its
free /v1 -> /v4 endpoints and now requires an API key for /v5. We
switched to World Bank's public API instead — no key, stable
long-term, ships ISO2 + country name + geographic region for every
country in a single request. See docs/DATA-COVERAGE-GAPS.md for the
full auto-resolve policy.

Nominatim requires a descriptive User-Agent per its usage policy
(https://operations.osmfoundation.org/policies/nominatim/); we set one
that names the project and links to the repo so operators can contact
Ron if we misbehave.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Optional

REPO = Path(__file__).resolve().parents[1]
CACHE_PATH = REPO / "data" / "auto-resolved.json"

# Bump this when the cache schema changes to force a re-lookup.
CACHE_VERSION = 1

# Region grouping used by the world-map dropdown. Keep in sync with
# COUNTRY_REGION in refresh-graduate-studies.py. Mapping is by ISO2 for
# stability — restcountries returns 'region'/'subregion' strings but
# those don't match our custom Pacific/Asia/Europe/etc. buckets exactly.
ISO_TO_REGION = {
    # Pacific — includes Australia + NZ per Ron's dropdown convention.
    "FJ": "Pacific", "AU": "Pacific", "NZ": "Pacific", "PG": "Pacific",
    "TO": "Pacific", "WS": "Pacific", "VU": "Pacific", "SB": "Pacific",
    "KI": "Pacific", "TV": "Pacific", "NR": "Pacific", "PW": "Pacific",
    "FM": "Pacific", "MH": "Pacific", "CK": "Pacific", "NU": "Pacific",
    "TK": "Pacific", "NC": "Pacific", "PF": "Pacific", "WF": "Pacific",
    "AS": "Pacific", "GU": "Pacific", "MP": "Pacific",
    # Asia
    "CN": "Asia", "IN": "Asia", "ID": "Asia", "JP": "Asia",
    "PH": "Asia", "KR": "Asia", "TH": "Asia", "VN": "Asia",
    "MY": "Asia", "SG": "Asia", "TW": "Asia", "HK": "Asia",
    "PK": "Asia", "BD": "Asia", "LK": "Asia", "NP": "Asia",
    "KH": "Asia", "LA": "Asia", "MM": "Asia", "MN": "Asia",
    # Europe
    "GB": "Europe", "DE": "Europe", "FR": "Europe", "IT": "Europe",
    "ES": "Europe", "PT": "Europe", "NL": "Europe", "BE": "Europe",
    "LU": "Europe", "IE": "Europe", "DK": "Europe", "SE": "Europe",
    "NO": "Europe", "FI": "Europe", "IS": "Europe", "PL": "Europe",
    "CZ": "Europe", "SK": "Europe", "HU": "Europe", "AT": "Europe",
    "CH": "Europe", "GR": "Europe", "MT": "Europe", "CY": "Europe",
    "HR": "Europe", "SI": "Europe", "EE": "Europe", "LV": "Europe",
    "LT": "Europe", "RO": "Europe", "BG": "Europe", "RS": "Europe",
    "UA": "Europe", "RU": "Europe",
    # North America
    "US": "North America", "CA": "North America", "MX": "North America",
    # Americas (South + Central + Caribbean)
    "BR": "Americas", "AR": "Americas", "CL": "Americas", "PE": "Americas",
    "CO": "Americas", "VE": "Americas", "EC": "Americas", "UY": "Americas",
    "PY": "Americas", "BO": "Americas", "GY": "Americas", "SR": "Americas",
    # Africa
    "ZA": "Africa", "KE": "Africa", "NG": "Africa", "EG": "Africa",
    "MA": "Africa", "TN": "Africa", "GH": "Africa", "TZ": "Africa",
    "UG": "Africa", "ET": "Africa", "SN": "Africa", "ZW": "Africa",
    "NA": "Africa", "BW": "Africa", "MZ": "Africa", "MG": "Africa",
    "CI": "Africa", "CM": "Africa", "RW": "Africa",
    # Middle East (grouped under 'Asia' in Ron's dropdown convention).
    "AE": "Asia", "SA": "Asia", "IL": "Asia", "IR": "Asia",
    "IQ": "Asia", "JO": "Asia", "LB": "Asia", "QA": "Asia",
    "KW": "Asia", "OM": "Asia", "TR": "Asia",
}

USER_AGENT = (
    "vave-lab-refresh/1.0 (+https://github.com/ronvave/vave-lab; "
    "contact: ronvave2011@gmail.com)"
)

HTTP_TIMEOUT_S = 10.0
NOMINATIM_MIN_INTERVAL_S = 1.1  # Nominatim rate limit is ≤1 req/sec.
_last_nominatim_call = 0.0


# ------------------------------------------------------------------
# Cache
# ------------------------------------------------------------------
def _load_cache() -> dict:
    if not CACHE_PATH.exists():
        return {"version": CACHE_VERSION, "countries": {}, "universities": {}}
    try:
        raw = json.loads(CACHE_PATH.read_text())
    except (json.JSONDecodeError, OSError):
        return {"version": CACHE_VERSION, "countries": {}, "universities": {}}
    if raw.get("version") != CACHE_VERSION:
        return {"version": CACHE_VERSION, "countries": {}, "universities": {}}
    raw.setdefault("countries", {})
    raw.setdefault("universities", {})
    return raw


def _save_cache(cache: dict) -> None:
    CACHE_PATH.write_text(json.dumps(cache, indent=2, ensure_ascii=False) + "\n")


# ------------------------------------------------------------------
# HTTP helper
# ------------------------------------------------------------------
def _get_json(url: str) -> Optional[dict | list]:
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as resp:
            body = resp.read().decode("utf-8", errors="replace")
        return json.loads(body)
    except Exception as e:  # noqa: BLE001 — surface + move on
        print(f"    auto-resolve HTTP fail: {url} -> {type(e).__name__}: {e}",
              file=sys.stderr)
        return None


# ------------------------------------------------------------------
# Country resolver
# ------------------------------------------------------------------
_WB_COUNTRIES_URL = (
    "https://api.worldbank.org/v2/country?format=json&per_page=400"
)
_wb_countries_cache: Optional[list] = None  # module-level, one fetch per run

# Common name / alias overrides for entries the World Bank feed spells
# differently from Zotero. Extend as new mismatches surface.
_COUNTRY_ALIASES = {
    "usa": "United States",
    "united states of america": "United States",
    "uk": "United Kingdom",
    "england": "United Kingdom",
    "scotland": "United Kingdom",
    "wales": "United Kingdom",
    "northern ireland": "United Kingdom",
    "south korea": "Korea, Rep.",
    "north korea": "Korea, Dem. People's Rep.",
    "russia": "Russian Federation",
    "iran": "Iran, Islamic Rep.",
    "egypt": "Egypt, Arab Rep.",
    "venezuela": "Venezuela, RB",
    "vietnam": "Viet Nam",
    "laos": "Lao PDR",
    "czech republic": "Czechia",
    "ivory coast": "Cote d'Ivoire",
    "tanzania": "Tanzania",
    "kyrgyzstan": "Kyrgyz Republic",
    "slovakia": "Slovak Republic",
    "syria": "Syrian Arab Republic",
    "turkey": "Turkiye",
}

# World Bank uses macro-region strings (e.g. 'Europe & Central Asia').
# Map those to the dashboard's dropdown buckets.
_WB_REGION_TO_OURS = {
    "East Asia & Pacific": "Asia",  # Overridden by ISO_TO_REGION per country.
    "Europe & Central Asia": "Europe",
    "Latin America & Caribbean": "Americas",
    "Middle East & North Africa": "Asia",
    "North America": "North America",
    "South Asia": "Asia",
    "Sub-Saharan Africa": "Africa",
}


def _load_world_bank_countries() -> list:
    """Fetch the full country list from World Bank once per process."""
    global _wb_countries_cache
    if _wb_countries_cache is not None:
        return _wb_countries_cache
    data = _get_json(_WB_COUNTRIES_URL)
    # World Bank's shape is [meta, [rows]]; anything else means failure.
    if not isinstance(data, list) or len(data) < 2 or not isinstance(data[1], list):
        _wb_countries_cache = []
        return _wb_countries_cache
    # Filter out aggregate 'regions' (which have empty iso2Code or 'X'/'Z' codes).
    rows = [r for r in data[1]
            if r.get("iso2Code") and not r["iso2Code"].startswith(("X", "Z"))]
    _wb_countries_cache = rows
    return rows


def _resolve_country_uncached(name: str) -> Optional[dict]:
    rows = _load_world_bank_countries()
    if not rows:
        return None
    needle = name.strip().lower()
    # 1. Alias lookup (Zotero-friendly names -> World Bank canonical).
    canonical_needle = _COUNTRY_ALIASES.get(needle, name).strip().lower()
    # 2. Exact match on World Bank's `name` field.
    best = None
    for r in rows:
        if (r.get("name") or "").strip().lower() == canonical_needle:
            best = r; break
    # 3. Fallback: case-insensitive substring match.
    if best is None:
        candidates = [r for r in rows
                      if canonical_needle in (r.get("name") or "").lower()]
        if len(candidates) == 1:
            best = candidates[0]
        elif len(candidates) > 1:
            # Multiple hits — prefer the shortest name (usually the
            # canonical country over 'Something Republic of X').
            best = min(candidates, key=lambda r: len(r.get("name") or ""))
    if best is None:
        return None

    iso = (best.get("iso2Code") or "").strip().upper()
    if not iso or len(iso) != 2:
        return None

    # Region: prefer our ISO2 -> region map (matches Ron's dropdown
    # buckets); fall back to translating World Bank's macro-region.
    region = ISO_TO_REGION.get(iso)
    if not region:
        wb_region = ((best.get("region") or {}).get("value") or "").strip()
        region = _WB_REGION_TO_OURS.get(wb_region, "Other")

    return {
        "iso": iso,
        "region": region,
        "canonicalName": best.get("name"),
        "capitalCity": best.get("capitalCity"),
        "source": _WB_COUNTRIES_URL,
    }


def resolve_country(name: str, cache: dict) -> Optional[dict]:
    """Return {iso, region, source} for `name`, or None on failure.

    Result is cached in `cache["countries"][name]` so a repeat call is
    free. Cache also stores negative results ({"failed": true}) to avoid
    hammering the API for known-bad names — but with a 7-day TTL so a
    fixed upstream typo eventually clears.
    """
    slot = cache["countries"].get(name)
    if slot:
        if slot.get("failed"):
            # Retry after 7 days in case restcountries added the entry.
            if time.time() - slot.get("checkedAt", 0) < 7 * 24 * 3600:
                return None
        else:
            return slot
    result = _resolve_country_uncached(name)
    if result:
        cache["countries"][name] = {**result, "checkedAt": time.time()}
    else:
        cache["countries"][name] = {"failed": True, "checkedAt": time.time()}
    return result


# ------------------------------------------------------------------
# University resolver
# ------------------------------------------------------------------
def _wiki_summary(title: str) -> Optional[dict]:
    """Fetch Wikipedia page summary, returning coord dict or None."""
    q = urllib.parse.quote(title.replace(" ", "_"), safe="")
    url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{q}"
    data = _get_json(url)
    if not isinstance(data, dict):
        return None
    coord = data.get("coordinates") or {}
    lat, lng = coord.get("lat"), coord.get("lon")
    if lat is None or lng is None:
        return None
    return {
        "lat": float(lat),
        "lng": float(lng),
        "title": data.get("title"),
        "description": data.get("description"),
        "extract": (data.get("extract") or "")[:400],
        "source": data.get("content_urls", {}).get("desktop", {}).get("page") or url,
    }


def _wiki_search(name: str) -> Optional[str]:
    """Wikipedia OpenSearch — return the top page title matching `name`."""
    q = urllib.parse.quote(name, safe="")
    url = (f"https://en.wikipedia.org/w/api.php?action=opensearch&search={q}"
           f"&limit=1&namespace=0&format=json")
    data = _get_json(url)
    if not isinstance(data, list) or len(data) < 2 or not data[1]:
        return None
    return data[1][0]


def _nominatim_geocode(name: str) -> Optional[dict]:
    """OpenStreetMap Nominatim geocoder — respects the 1 req/sec rate."""
    global _last_nominatim_call
    elapsed = time.monotonic() - _last_nominatim_call
    if elapsed < NOMINATIM_MIN_INTERVAL_S:
        time.sleep(NOMINATIM_MIN_INTERVAL_S - elapsed)
    _last_nominatim_call = time.monotonic()
    q = urllib.parse.quote(name, safe="")
    url = (f"https://nominatim.openstreetmap.org/search?q={q}"
           f"&format=json&limit=1&addressdetails=1")
    data = _get_json(url)
    if not isinstance(data, list) or not data:
        return None
    row = data[0]
    try:
        lat = float(row["lat"]); lng = float(row["lon"])
    except (KeyError, ValueError, TypeError):
        return None
    addr = row.get("address") or {}
    country = addr.get("country")
    city = (addr.get("city") or addr.get("town") or addr.get("village")
            or addr.get("municipality") or addr.get("state"))
    return {
        "lat": lat,
        "lng": lng,
        "country": country,
        "city": city,
        "source": f"https://nominatim.openstreetmap.org/ui/details.html?"
                  f"osmtype={row.get('osm_type', 'W')[:1].upper()}&"
                  f"osmid={row.get('osm_id', '')}",
    }


def _resolve_university_uncached(name: str, country_hint: Optional[str]) -> Optional[dict]:
    # 1. Try Wikipedia direct.
    hit = _wiki_summary(name)
    if hit:
        return {**hit, "resolver": "wikipedia-direct"}
    # 2. Try Wikipedia search for the top matching page title.
    title = _wiki_search(name)
    if title and title.lower() != name.lower():
        hit = _wiki_summary(title)
        if hit:
            # Sanity-check the description mentions "university" or "college".
            desc = ((hit.get("description") or "") + " "
                    + (hit.get("extract") or "")).lower()
            if any(w in desc for w in ("university", "college", "institute",
                                        "school", "polytechnic", "academy",
                                        "seminary")):
                return {**hit, "resolver": "wikipedia-search",
                        "matchedTitle": title}
    # 3. Nominatim, with country hint appended for disambiguation.
    query = f"{name}, {country_hint}" if country_hint else name
    hit = _nominatim_geocode(query)
    if hit:
        return {**hit, "resolver": "nominatim"}
    return None


def resolve_university(name: str, country_hint: Optional[str],
                       cache: dict) -> Optional[dict]:
    """Return {lat, lng, source, resolver, ...} for `name`, or None on failure."""
    slot = cache["universities"].get(name)
    if slot:
        if slot.get("failed"):
            if time.time() - slot.get("checkedAt", 0) < 7 * 24 * 3600:
                return None
        else:
            return slot
    result = _resolve_university_uncached(name, country_hint)
    if result:
        cache["universities"][name] = {**result, "checkedAt": time.time()}
    else:
        cache["universities"][name] = {"failed": True, "checkedAt": time.time()}
    return result


# ------------------------------------------------------------------
# Public entry point used by refresh-graduate-studies.py
# ------------------------------------------------------------------
def open_cache() -> dict:
    return _load_cache()


def save_cache(cache: dict) -> None:
    _save_cache(cache)
