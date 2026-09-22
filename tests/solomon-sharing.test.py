import importlib.util
import sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'scripts'))
from solomon_sync_share_tokens import prepare
from solomon_master_file_transformer import extract_scholars
rows=[['Scholar ID','Scholar Share Token'],['SOL-S0001','a'*40],['SOL-S0002','']]
writes,mapping=prepare(rows)
assert mapping['SOL-S0001']=='a'*40 and len(mapping['SOL-S0002'])==40
assert writes[0]['range']=="'Scholars'!B3"
assert prepare(rows,create_missing=False)[1]=={'SOL-S0001':'a'*40}
assert prepare([rows[0],rows[2],rows[1]],create_missing=False)[1]=={'SOL-S0001':'a'*40}
for invalid in [[rows[0],rows[1],rows[1]],[rows[0],['TNG-S0001','a'*40]]]:
    try: prepare(invalid)
    except ValueError: pass
    else: raise AssertionError('Invalid identity accepted')
out=extract_scholars([['Scholar ID','Paternal Province/City Area','Maternal Province/City Area','Maternal Specific Island','Maternal Village/Community','Maternal Clan/Tribe/Lineage'],['SOL-S0001','','Western','Private island','Private village','Private lineage']])
assert len(out)==1
assert not any('maternal' in k.lower() for k in out[0])
assert out[0]['effective_specific_island']==''
assert out[0]['effective_province_group']=='Unclassified'
print('PASS: persisted tokens stable after row reorder, unpersisted tokens never exported, country/duplicate identity rejected, maternal privacy and no paternal fallback.')

# Empty last header does not make an occupied historical-note column reusable.
writes, links = prepare([['Scholar ID','Name'],['SOL-S0001','Fixture','Historical note']])
assert writes[0]['range']=="'Scholars'!D1"
assert writes[1]['range']=="'Scholars'!D2"
assert len(links['SOL-S0001']) == 40
print('PASS: new token column appends after occupied unnamed columns.')
