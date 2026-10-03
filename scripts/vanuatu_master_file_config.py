"""Vanuatu source and exact supported public fields. Not an approval grant.
The live Public Export Config must separately authorize EACH field below.
Broad phrases (e.g. 'Bibliographic metadata') do not authorize new columns.
"""
SPREADSHEET_ID = '1jfS6Yqyy559kLdoeKW4F4t8RhyBooXpCiwOMukxpPW0'
KEYS = {'Scholars':'Scholar ID','Graduate Degrees':'Degree ID','Publications':'Publication ID','Authorship':'Authorship ID','Research Geography':'Geography Record ID','Institutions':'Institution ID'}
PREFIXES = {'Scholars':'VAN-S','Graduate Degrees':'VAN-D','Publications':'VAN-P','Authorship':'VAN-AUTH-','Research Geography':'VAN-G','Institutions':'VAN-'}
FIELDS = {
 'Scholars': ['Scholar ID','Scholar Name','Salutation','Gender','Vital Status','Paternal Province','Paternal Island','Paternal Area Council / Locality','Paternal Village / Community','Maternal Province','Maternal Island','Maternal Area Council / Locality','Maternal Village / Community','Primary Discipline / Field','Current Title / Role','Current Institution','Institution Country','Current Department / Unit','Current Profile URL','ORCID / Researcher ID','Google Scholar URL'],
 'Graduate Degrees': ['Degree ID','Scholar ID','Degree Level','Degree Name','Field / Discipline','Broad Discipline','Original University Name (O_Uni)','Canonical University Name (C_Uni)','University Country','Start Year','Completion Year','Completion Status','Thesis / Dissertation Title','Thesis URL / Handle','Repository URL'],
 'Publications': ['Publication ID','Title','Publication Type','Year','Authors — Full Ordered List','Container / Journal','Volume','Issue','Pages','Publisher / Institution','DOI','Handle / ISBN','Primary URL','Open Access URL / PDF','Abstract','Author Keywords','Indexed Keywords','Language','Country Focus','About Country?','Methodology Tags','Peer Reviewed','License'],
 'Authorship': ['Authorship ID','Publication ID','Scholar ID','Author Position','Author Name as Published','Lead / First Author?'],
 'Research Geography': ['Geography Record ID','Publication ID','Geography Type','Country','Province','Island','Area Council / Locality','Village / Community','Latitude','Longitude'],
 'Institutions': ['Institution ID','Canonical Institution (C_Uni)','Country','City / Locality','Latitude','Longitude','Website'],
 'Study Pathways': ['Pathway ID','Scholar ID',"Master's Degree ID",'PhD Degree ID'],
 'Admin enrichment': ['photo','summary','sources','keywords','sector','institutionUrl','departmentUrl'],
}
REQUIRED = {
 'Scholars':['Scholar ID','Scholar Name','Identity Verification Status','Public Display Approved'],
 'Graduate Degrees':['Degree ID','Scholar ID','Degree Level','Completion Status','Verification Status','Public Display Approved'],
 'Publications':['Publication ID','Title','Publication Type','Verification Status','Public Display Approved'],
 'Authorship':['Authorship ID','Publication ID','Scholar ID','Verification Status'],
 'Research Geography':['Geography Record ID','Publication ID','Verification Status','Public Display Approved'],
 'Institutions':['Institution ID','Canonical Institution (C_Uni)','Active'],
}
FORBIDDEN = {'Identity Evidence','Identity Source URL','Record Notes','Community / Ancestral Notes','Scholar Share Token','Source Basis','Name Variants / Aliases','Submitter Email','Submitter Name','Attachments JSON','Evidence','Evidence / Notes','Coding Basis / Evidence','Source URL / Note'}
STATUSES = {'Verified','Probable','Unresolved','Excluded','Pending','Rejected','Unknown / verify','Not checked'}
PROVINCES = {'Torba','Sanma','Penama','Malampa','Shefa','Tafea'}
COUNTRY_ALIASES = {'Nauru':'Naoero','Naoero':'Naoero','USA':'United States','United States of America':'United States','UK':'United Kingdom'}
OUTPUT_NAME = 'vanuatu-master-bundle.json.enc'
