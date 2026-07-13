# Names that must NEVER be merged

Distinct people with similar names. Any script or agent that reasons
about author identity must treat these as **separate scholars**. Do not
propose them as merge candidates, do not consider them "possibly the
same person", do not fold them into a shared canonical name.

Ron has stated this repeatedly — the note lives here so we stop
repeating the assumption.

## Fongs

| Canonical name (admin) | Notes |
| ---------------------- | ----- |
| `Fong, Patrick S.` | Also appears in Zotero as `Fong, Patrick` and `Fong, Patrick Sakiusa`. Those two variants ARE aliases of Patrick and DO fold in. |
| `Fong, James` | **Different person** from Patrick. Never merge with any Patrick / Sakiusa variant. |
| `Fong, Sakiusa` | **Different person** from Patrick. `Sakiusa` on its own is NOT the same as `Patrick Sakiusa`. Never merge. |
| `Fong-Lomavatu, Mereia` | Also appears as `Fong, Mereia`, `Lomavatu, Mereia Fong`, and the U+2010 hyphen variant — those DO fold. Never merge with any male Fong. |
| `Fong, Teddy`, `Fong, Jack` | Separate individuals. Do not merge with any of the above. |

## Rule for future scripts

- The source of truth for name identity is `data/scholar-profiles.json`
  `nameAliases` (variant → canonical). If two names are not linked
  there, treat them as **different people** — do not infer from surname,
  first-name overlap, or partial matches.
- When in doubt, ask Ron. Do not "helpfully" propose a merge.
