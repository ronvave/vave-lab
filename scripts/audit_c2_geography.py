#!/usr/bin/env python3
"""Panel C2 geography audit — produces the CSV / table dump required by
`Perplexity_C2_Geography_Repair_Prompt.docx` §"Required audit output".

For every published record, list:
  publication_id, publication_type, is_included, is_itaukei_associated,
  linked_provinces (semi-colon separated), used_non_provincial_flag,
  used_unsure_flag, verification_state, notes.

Definitions match the repaired adapter (js/master-file-adapter.js):
  * "included" = Publication Type in the include-set
    {Journal Article, Master's Thesis, PhD Thesis, Book Chapter, Book,
    Report}. Preprints are excluded.
  * "itaukei_associated" = the publication has at least one Authorship
    row linking a Scholar in `Scholars`, OR at least one Researcher
    Authorship row linking an ITK-R researcher.
  * "linked_provinces" = every distinct `Fiji Province` value from a
    Research Geography row where Country=Fiji AND Verification starts
    with "Verified" (case-insensitive) or equals "Strong".
  * "used_non_provincial_flag" = True iff any linked RG row has
    Fiji Province = "Fiji - no province specified".
  * "used_unsure_flag" = True iff any linked RG row has Fiji Province in
    {"Unsure", "Unclassified"}.
  * "verification_state" = "verified" if at least one linked RG row is
    verified, "unverified" if the pub has RG rows but none pass, empty
    otherwise.
  * "notes" = short explanatory text, e.g. dropped preprint, no RG rows.

Runs against the live Master Google Sheet (requires api_credentials=["gws"]).
Writes CSV to `docs/audit_c2_geography.csv` and prints a summary.
"""

import csv
import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

SPREADSHEET_ID = "1nJvMWLS8jnCOKtRoqdDpEW3s3j9TSAclXBO1txVFxdg"
INCLUDE_TYPES = {
    "Journal Article",
    "Master's Thesis",
    "PhD Thesis",
    "Book Chapter",
    "Book",
    "Report",
}


def gws(range_a1):
    r = subprocess.run(
        ["gws", "sheets", "spreadsheets", "values", "get", "--params",
         json.dumps({"spreadsheetId": SPREADSHEET_ID, "range": range_a1})],
        capture_output=True, text=True, check=True,
    )
    return json.loads(r.stdout).get("values", [])


def rows_to_dicts(rows, header_index=0, first_data_index=1):
    if len(rows) <= header_index:
        return [], []
    header = [str(c).strip() for c in rows[header_index]]
    dicts = []
    for row in rows[first_data_index:]:
        row = row + [""] * (len(header) - len(row))
        dicts.append({h: (row[i] if i < len(row) else "") for i, h in enumerate(header)})
    return header, dicts


def main():
    print("Fetching Master sheets...", file=sys.stderr)
    # Only fetch the columns the audit needs (ID, entry-type, pub type,
    # and the legacy Tagged Fiji? flag) so the response size doesn't
    # truncate rows. `Publications!A4:CE4000` is truncated by the
    # underlying transport at ~3240 rows because the sheet is very wide.
    pub_rows = gws("Publications!A4:D9999")
    # `Tagged Fiji?` lives in column L on Publications; fetch it separately.
    tag_rows = gws("Publications!L4:L9999")
    auth_rows = gws("Authorship!A4:L5000")
    ra_rows = gws("'Researcher Authorship'!A4:L2000")
    rg_rows = gws("'Research Geography'!A4:M2500")

    _, pubs = rows_to_dicts(pub_rows)
    # Splice in Tagged Fiji? column (single-column fetch).
    tag_header = (tag_rows[0][0] if tag_rows else "Tagged Fiji?")
    for i, p in enumerate(pubs):
        row = tag_rows[i + 1] if i + 1 < len(tag_rows) else []
        p[tag_header] = row[0] if row else ""
    _, auth = rows_to_dicts(auth_rows)
    _, ra = rows_to_dicts(ra_rows)
    _, rg = rows_to_dicts(rg_rows)

    # Index authorship by publication ID.
    scholars_by_pub = defaultdict(set)
    for a in auth:
        pid = a.get("Publication ID / BibTeX Key")
        sid = a.get("Scholar ID")
        if pid and sid:
            scholars_by_pub[pid].add(sid)

    researchers_by_pub = defaultdict(set)
    for a in ra:
        pid = a.get("Publication ID / BibTeX Key")
        rid = a.get("Researcher ID")
        if pid and rid:
            researchers_by_pub[pid].add(rid)

    # Index Research Geography by publication ID (Fiji-country rows only).
    def verif_ok(v):
        v = (v or "").strip()
        return v.lower().startswith("verified") or v.lower() == "strong"

    rg_by_pub = defaultdict(list)
    for g in rg:
        pid = g.get("Publication ID / BibTeX Key")
        if not pid:
            continue
        rg_by_pub[pid].append(g)

    out_path = Path("docs") / "audit_c2_geography.csv"
    out_path.parent.mkdir(exist_ok=True)
    rows_out = []

    for p in pubs:
        pid = (p.get("Publication ID / BibTeX Key") or "").strip()
        ptype = (p.get("Publication Type") or "").strip()
        if not pid:
            continue
        is_included = ptype in INCLUDE_TYPES
        is_itaukei = bool(scholars_by_pub.get(pid)) or bool(researchers_by_pub.get(pid))
        rg_rows_for_pub = rg_by_pub.get(pid, [])
        fiji_rows = [g for g in rg_rows_for_pub if (g.get("Country") or "").strip() == "Fiji"]
        verified_fiji_rows = [g for g in fiji_rows if verif_ok(g.get("Verification"))]

        provinces = []
        seen = set()
        for g in verified_fiji_rows:
            prov = (g.get("Fiji Province") or "").strip()
            if prov and prov not in seen:
                seen.add(prov)
                provinces.append(prov)

        used_nonprov = any(
            (g.get("Fiji Province") or "").strip() == "Fiji - no province specified"
            for g in verified_fiji_rows
        )
        used_unsure = any(
            (g.get("Fiji Province") or "").strip() in ("Unsure", "Unclassified")
            for g in verified_fiji_rows
        )

        if not fiji_rows:
            verif_state = ""
        elif verified_fiji_rows:
            verif_state = "verified"
        else:
            verif_state = "unverified"

        notes = []
        if ptype == "Preprint":
            notes.append("dropped: preprint excluded from all C2 counts")
        if ptype and not is_included and ptype != "Preprint":
            notes.append(f"dropped: publication type '{ptype}' not in C2 include-set")
        if fiji_rows and not verified_fiji_rows:
            notes.append("no verified Fiji RG rows (verification field does not pass)")
        if fiji_rows and verified_fiji_rows and not provinces:
            notes.append("verified Fiji rows exist but no province recorded")
        if not fiji_rows and str(p.get("Tagged Fiji?", "")).strip().lower() == "yes":
            notes.append("legacy Tagged Fiji? = Yes but no Research Geography row")

        rows_out.append({
            "publication_id": pid,
            "publication_type": ptype,
            "is_included": is_included,
            "is_itaukei_associated": is_itaukei,
            "linked_provinces": "; ".join(provinces),
            "used_non_provincial_flag": used_nonprov,
            "used_unsure_flag": used_unsure,
            "verification_state": verif_state,
            "notes": "; ".join(notes),
        })

    with out_path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows_out[0].keys()))
        writer.writeheader()
        writer.writerows(rows_out)

    print(f"Wrote {len(rows_out)} rows to {out_path}")
    included = sum(1 for r in rows_out if r["is_included"])
    itaukei = sum(1 for r in rows_out if r["is_included"] and r["is_itaukei_associated"])
    with_prov = sum(1 for r in rows_out if r["is_included"] and r["linked_provinces"])
    itaukei_with_prov = sum(1 for r in rows_out
                             if r["is_included"] and r["is_itaukei_associated"]
                             and r["linked_provinces"])
    print(f"  Included publications:       {included}")
    print(f"  iTaukei-associated:          {itaukei}")
    print(f"  With verified provinces:     {with_prov}")
    print(f"  iTaukei ∩ verified provs:    {itaukei_with_prov}")


if __name__ == "__main__":
    main()
