import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from master_short_disciplines import build_short_disciplines, build_fiji_short_disciplines, fiji_short_discipline

class ShortDisciplinesTest(unittest.TestCase):
    def test_fiji_spill_failure_recovers_without_counting_errors(self):
        def degree(sid, short, field, broad, stage="Master's", status='Completed'):
            return {'Scholar ID':sid, 'Short Discipline':short,
                    'Field / Discipline':field, 'Broad discipline':broad,
                    'Degree Stage':stage, 'Completion Status':status}
        rows = [
            degree('A', '#REF!', 'Development Studies', 'Social Sciences, Journalism and Information'),
            degree('A', '', 'Development Studies', 'Social Sciences, Journalism and Information', 'PhD/Doctorate'),
            degree('B', '', 'Mathematics Education', 'Education'),
            degree('C', 'Economics', 'Economics', 'Business, Administration and Law'),
            degree('D', '', '', ''),
            degree('E', '', 'Education', 'Education', status='In progress'),
            degree('F', '', 'Education', 'Education', status='Not completed'),
        ]
        before = [dict(r) for r in rows]
        model = build_fiji_short_disciplines(rows, [{'Scholar ID':'A','Gender':'Male'}, {'Scholar ID':'B','Gender':'Female'}])
        self.assertEqual(rows, before, 'source records must remain untouched')
        self.assertEqual(model['overall'], dict(total=3,male=1,female=1,masters=3,phd=1))
        self.assertEqual((model['allCompleted'],model['allMasters']), (4,4))
        self.assertEqual({r['discipline'] for r in model['rows']}, {'Education','Social sciences'})
        # Shared/Tongan counting must not acquire Fiji's recovery classifier.
        shared = build_short_disciplines(rows, [])
        self.assertEqual(shared['overall']['total'], 2)
        self.assertEqual({r['discipline'] for r in shared['rows']}, {'#REF!', 'Economics'})

    def test_fiji_source_formula_precedence_and_unknowns(self):
        cases = [
            ('Theology', 'Arts and Humanities', 'Theology and religious studies'),
            ('Geography / Development Studies', 'Social Sciences, Journalism and Information', 'Social sciences'),
            ('Marine Biology', 'Natural Sciences, Mathematics and Statistics', 'Earth, ocean and atmospheric sciences'),
            ('Chemistry', 'Natural Sciences, Mathematics and Statistics', 'Life and environmental sciences'),
            ('Computer Science', 'Natural Sciences, Mathematics and Statistics', 'Engineering, technology and planning'),
            ('Public Health', 'Natural Sciences, Mathematics and Statistics', 'Health sciences'),
            ('History', 'Arts and Humanities', 'Humanities'),
            ('Agriculture', 'Agriculture, Forestry, Fisheries and Veterinary Science', 'Life and environmental sciences'),
            ('Marine Science', '', 'Earth, ocean and atmospheric sciences'),
            ('Unavailable', 'Unresolved', ''),
            ('#N/A', '#REF!', ''),
        ]
        for field, broad, expected in cases:
            with self.subTest(field=field):
                self.assertEqual(fiji_short_discipline({'Field / Discipline':field, 'Broad discipline':broad}), expected)
        self.assertEqual(fiji_short_discipline({'Short Discipline':'Humanities', 'Field / Discipline':'Education'}), 'Humanities')

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
