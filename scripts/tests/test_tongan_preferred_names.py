import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from tongan_master_file_transformer import extract_scholars
class PreferredNames(unittest.TestCase):
 def test_public_identity_preserves_source(self):
  headers=['Scholar ID','Scholar Name','Given Names','Family Name','Preferred Given Names','Preferred Family Name']
  canonical=['TNG-S0001','Mele Ana Test','Mele Ana','Test','Mele','Test-Family']
  rows=[[],[],[],headers,canonical,['TNG-S0002','Unchanged Person','Unchanged','Person','','']]
  out=extract_scholars(rows)
  self.assertEqual(out[0]['Scholar Name'],'Mele Test-Family')
  self.assertEqual(out[0]['Given Names'],'Mele')
  self.assertNotIn('Mele Ana',str(out[0]))
  self.assertEqual(canonical[2],'Mele Ana')
  self.assertEqual(out[1]['Scholar Name'],'Unchanged Person')
if __name__=='__main__':unittest.main()
