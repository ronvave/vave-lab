# Panel F paternal-geography contamination audit — 2026-08-25

Source: deployed snapshot `data/itaukei-master-scholars.json.enc`.

Total scholars scanned: **474**
Scholars whose pre-fix Panel F line differed from the fixed paternal-only line: **4**

## Affected scholars (before → after)

| Scholar ID | Name | Before (buggy) | After (fixed) | Leaked field(s) |
| :-- | :-- | :-- | :-- | :-- |
| ITK-S0003 | Aporosa, Apo | Naduri vlg, Macuata Province. | (empty) | village, island, province |
| ITK-S0092 | Lako, Jimaima | Mabula vlg (Cicia Is), Lau Province. | Lau Province. | village, island |
| ITK-S0123 | Mateiviti-Tulavu, Eseta K | Lomanikoro vlg, Rewa Province. | (empty) | village, island, province |
| ITK-S0212 | Rokomatu, Malelili Naulivou | Naseyani vlg (Beqa Is), Ra Province. | Naseyani vlg, Ra Province. | island |

The `leaked field(s)` column names the fields where the buggy adapter took a maternal-side value because the paternal-side cell was blank or a sentinel (`Unclassified`, `Unknown`, `N/A`, `-`).