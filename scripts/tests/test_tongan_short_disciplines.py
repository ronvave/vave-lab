import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tongan_short_disciplines import build_tongan_short_disciplines
from tongan_master_file_transformer import extract_grad_degrees

class TongaDisciplines(unittest.TestCase):
    def test_union_cohort_and_gender(self):
        def d(sid, field='Education', stage="Master's", status='Completed'):
            return {'Scholar ID': sid, 'Short Discipline': field, 'Degree Stage': stage, 'Completion Status': status}
        scholars=[{'Scholar ID':'TNG-S0001','Gender':'Tangata'}, {'Scholar ID':'TNG-S0002','Gender':'Fefine'}, {'Scholar ID':'TNG-S0003','Gender':'Unknown'}, {'Scholar ID':'TNG-S0004','Gender':'Male'}]
        rows=[d('TNG-S0001'), d('TNG-S0001'), d('TNG-S0001',stage='PhD/Doctorate'), d('TNG-S0002'), d('TNG-S0002','Social sciences','PhD/Doctorate'), d('TNG-S0003'), d('TNG-S0004',''),d('TNG-S9999')]
        for status in ['In progress', 'Not completed', 'Uncertain', '']:
            rows.append(d('TNG-S0004','Excluded',status=status))
        m=build_tongan_short_disciplines(rows, scholars)
        self.assertEqual(m['allCompleted'],4)
        self.assertEqual(m['overall'],dict(total=3,male=1,female=1,masters=3,phd=2))
        self.assertEqual(m['rows'][0],dict(discipline='Education',total=3,male=1,female=1,masters=3,phd=1))
        self.assertEqual(m['excludedOrphanScholars'],1)
        self.assertEqual(m['unclassifiedScholars'],1)
        self.assertEqual(m['unknownGenderScholars'],1)
        self.assertEqual(build_tongan_short_disciplines([],scholars)['rows'],[])
    def test_export_keeps_field(self):
        rows=[[],[],[],['Degree ID','Scholar ID','Short Discipline'],['TNG-D0001','TNG-S0001','Education']]
        self.assertEqual(extract_grad_degrees(rows)[0]['Short Discipline'],'Education')
if __name__=='__main__':unittest.main()
