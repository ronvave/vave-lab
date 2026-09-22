import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from master_short_disciplines import build_short_disciplines

class ShortDisciplinesTest(unittest.TestCase):
    def test_sets_completion_and_missing_categories(self):
        def degree(sid, discipline, stage="Master's", status='Completed'):
            return {'Scholar ID':sid, 'Short Discipline':discipline, 'Degree Stage':stage, 'Completion Status':status}
        rows=[degree('A','Social sciences'),degree('A','Social sciences'),degree('A','Social sciences','PhD/Doctorate'),degree('A','Health sciences'),degree('B','Health sciences'),degree('C',''),degree('D','Excluded',status='In progress'),degree('E','Excluded',status='Uncertain'),degree('F','New discipline','PhD/Doctorate','Completed — verified')]
        m=build_short_disciplines(rows,[{'Scholar ID':'A','Gender':'Male'},{'Scholar ID':'B','Gender':'Female'}])
        self.assertEqual(m['overall'],dict(total=3,male=1,female=1,masters=2,phd=2))
        self.assertEqual((m['allCompleted'],m['allMasters']),(4,3))
        self.assertEqual(len(m['rows']),3)
        social=next(r for r in m['rows'] if r['discipline']=='Social sciences')
        self.assertEqual((social['masters'],social['phd'],social['total']),(1,1,1))
        self.assertEqual(m['rows'][0]['discipline'],'Health sciences')
        changed=build_short_disciplines(rows+[degree('D','New discipline')],[])
        self.assertEqual(changed['overall']['total'],4)
        self.assertEqual(build_short_disciplines([],[])['rows'],[])

if __name__=='__main__': unittest.main()
