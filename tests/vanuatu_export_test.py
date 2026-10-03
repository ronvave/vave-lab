import copy
import importlib.util
import json
import sys
import unittest
import os
import tempfile
from unittest.mock import patch
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import vanuatu_master_file_config as C
import vanuatu_master_file_transformer as T


def sheet(records,headers):
    return [['title'],['description'],[],headers]+[[r.get(h,'') for h in headers] for r in records]


def fixture():
    source={t:sheet([],C.REQUIRED[t]) for t in C.KEYS}
    source['Scholars']=sheet([{'Scholar ID':'VAN-S0001','Scholar Name':'Fictional Scholar','Identity Verification Status':'Verified','Public Display Approved':True,'Identity Evidence':'PRIVATE SENTINEL','Scholar Share Token':'PRIVATE TOKEN','Paternal Province':''},{'Scholar ID':'VAN-S0002','Scholar Name':'Excluded example','Identity Verification Status':'Excluded','Public Display Approved':False}],C.REQUIRED['Scholars']+['Identity Evidence','Scholar Share Token','Paternal Province'])
    source['Graduate Degrees']=sheet([{'Degree ID':'VAN-D0001','Scholar ID':'VAN-S0001','Degree Level':"Master's",'Completion Status':'Completed','Verification Status':'Verified','Public Display Approved':True,'Thesis / Dissertation Title':'Example thesis'}],C.REQUIRED['Graduate Degrees']+['Thesis / Dissertation Title','Thesis URL / Handle'])
    approvals=[{'Table':'Scholars','Field':'Scholar ID','Publicly Exportable':'Yes'},{'Table':'Scholars','Field':'Scholar Name','Publicly Exportable':'Yes'},{'Table':'Graduate Degrees','Field':'Thesis / Dissertation Title','Publicly Exportable':'Yes'},{'Table':'Publications','Field':'Bibliographic metadata','Publicly Exportable':'Yes'}]
    source['Public Export Config']=sheet(approvals,['Table','Field','Publicly Exportable'])
    return source


class ExportTests(unittest.TestCase):
    def test_minimal_exact_allowlist(self):
        b=T.transform(fixture());self.assertEqual(b['tables']['Scholars'],[{'Scholar ID':'VAN-S0001','Scholar Name':'Fictional Scholar'}]);self.assertEqual(b['tables']['Graduate Degrees'],[]);self.assertEqual(b['theses'],[{'Thesis / Dissertation Title':'Example thesis'}]);self.assertNotIn('PRIVATE',json.dumps(b))
    def test_prepared_null_rows_not_records(self):
        s=fixture();s['Graduate Degrees'] += [[None]*len(s['Graduate Degrees'][3]) for _ in range(100)];self.assertEqual(len(T.transform(s)['theses']),1)
    def test_empty_source_never_overwrites(self):
        s=fixture();s['Scholars']=s['Scholars'][:4]
        with self.assertRaises(ValueError):T.transform(s)
    def test_duplicates_block(self):
        s=fixture();s['Graduate Degrees'].append(s['Graduate Degrees'][4])
        with self.assertRaises(ValueError):T.transform(s)
    def test_foreign_keys_block(self):
        s=fixture();s['Graduate Degrees'][4][1]='VAN-S0099'
        with self.assertRaises(ValueError):T.transform(s)
    def test_unknown_approved_status_blocks(self):
        s=fixture();s['Graduate Degrees'][4][4]='Invented'
        with self.assertRaises(ValueError):T.transform(s)
    def test_pending_unapproved_blank_status_is_not_public(self):
        s=fixture();r=s['Graduate Degrees'][4];r[4]=None;r[5]=False
        self.assertEqual(T.transform(s)['theses'],[])
    def test_private_fields_never_become_approved(self):
        s=fixture();s['Public Export Config'].append(['Scholars','Identity Evidence','Yes']);self.assertNotIn('Identity Evidence',T.transform(s)['fields']['Scholars'])
    def test_new_unknown_columns_do_not_leak(self):
        s=fixture();s['Scholars'][3].append('New Sensitive Column');s['Scholars'][4].append('NEW PRIVATE');self.assertNotIn('NEW PRIVATE',json.dumps(T.transform(s)))
    def test_duplicate_headers_block(self):
        s=fixture();s['Scholars'][3].append('Scholar ID')
        with self.assertRaises(ValueError):T.transform(s)
    def test_encryption_roundtrip_and_cross_country_secret(self):
        blob=T.encrypt(b'{"country":"Vanuatu"}','test-only-vanuatu-secret');self.assertEqual(T.decrypt(blob,'test-only-vanuatu-secret'),b'{"country":"Vanuatu"}')
        with self.assertRaises(Exception):T.decrypt(blob,'different-country-test-secret')
    def test_content_generation_is_stable(self):
        self.assertEqual(T.transform(fixture())['generation'],T.transform(fixture())['generation'])
    def test_institution_alias_conservative(self):
        self.assertEqual(T.canonical_institution('Te Herenga Waka—Victoria University of Wellington'),'Victoria University of Wellington');self.assertEqual(T.canonical_institution('Example Wellington College'),'Example Wellington College')

    def test_add_collaborator_without_changing_owner_snapshot(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source.json';source.write_text(json.dumps(fixture()))
            args=['transform','--source',str(source),'--out-dir',str(root/'out')]
            env={'VAVELAB_VANUATU_PASSCODE':'test-only-owner','VAVELAB_VANUATU_COLLABORATOR_PASSCODE':''}
            with patch.dict(os.environ,env),patch.object(sys,'argv',args):T.main()
            owner=root/'out'/C.OUTPUT_NAME;before=owner.read_bytes()
            env['VAVELAB_VANUATU_COLLABORATOR_PASSCODE']='test-only-collaborator'
            with patch.dict(os.environ,env),patch.object(sys,'argv',args):T.main()
            collab=root/'out'/'vanuatu-collaborator-bundle.json.enc'
            self.assertEqual(owner.read_bytes(),before)
            a=json.loads(T.decrypt(before,'test-only-owner'));b=json.loads(T.decrypt(collab.read_bytes(),'test-only-collaborator'))
            self.assertEqual(a['tables'],b['tables']);self.assertEqual(a['generation'],b['generation'])
            self.assertNotIn('PRIVATE',json.dumps(b))
            with self.assertRaises(Exception):T.decrypt(collab.read_bytes(),'test-only-owner')
            with self.assertRaises(Exception):T.decrypt(before,'test-only-collaborator')
            env['VAVELAB_VANUATU_COLLABORATOR_PASSCODE']='test-only-owner'
            with patch.dict(os.environ,env),patch.object(sys,'argv',args),self.assertRaisesRegex(ValueError,'must differ'):T.main()
            self.assertEqual(owner.read_bytes(),before)


if __name__=='__main__':unittest.main()
