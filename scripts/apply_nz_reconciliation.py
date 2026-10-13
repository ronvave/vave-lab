"""Apply an encrypted owner-requested reconciliation and verify native values."""
import base64, gzip, hashlib, json, os
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from google.oauth2 import service_account
from googleapiclient.discovery import build

ALLOWED_IDS = ["1nJvMWLS8jnCOKtRoqdDpEW3s3j9TSAclXBO1txVFxdg","1um6pHKriEhbtvmkm7e8E1j0_Zt9A-oYpY88fuPoAmFY","1oPBnQHzjRNnmzS5_md5Lagmk_jQorqCRd3zhyKM1iC8","1jfS6Yqyy559kLdoeKW4F4t8RhyBooXpCiwOMukxpPW0","1jvRz1HHK90_6Uk3junJHPS03NqUuGfHO1JUQSpjz2wA","1UYhthbTDVosC6_6zcwXH_k2WNjTo1ijs2oYQe8FOzqI","15gmd0Q7NostzeSAZg27fpIoGUDYCE64kGSbYoh-RjqE","1Ys80AYWishhDSDZFG5B49MfDJopgCmLR3dbSCJqtB5w","1aBvlPZfivXMRcG2UfWCojIC_BBBloZHf2khA5qnlHzE","1KLj6zST1U_nhCtBMW37lR5ZppVdGzvfoowinjbgyF_U"]
def scalar(value):
    if value is None: return ""
    if isinstance(value,bool): return str(value).lower()
    return str(value).strip()
def value_cell(value):
    return {"userEnteredValue": {"formulaValue" if str(value).startswith("=") else "stringValue": str(value)}}
def write(sheet_id,row,col,values):
    return {"updateCells":{"start":{"sheetId":sheet_id,"rowIndex":row-1,"columnIndex":col},"rows":[{"values":[value_cell(v) for v in r]} for r in values],"fields":"userEnteredValue"}}
def main():
    encrypted=base64.b64decode(Path(os.environ["RECONCILIATION_BUNDLE"]).read_text().strip())
    if encrypted[:4]!=b"IVAV": raise ValueError("Invalid encrypted bundle marker")
    key=hashlib.pbkdf2_hmac("sha256",os.environ["VAVELAB_PASSCODE"].encode(),encrypted[4:20],200000,32)
    doc=json.loads(gzip.decompress(AESGCM(key).decrypt(encrypted[20:32],encrypted[32:],None)))
    sid=doc["spreadsheetId"]
    if sid not in ALLOWED_IDS: raise ValueError("Unapproved spreadsheet")
    credentials=service_account.Credentials.from_service_account_info(json.loads(os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"]),scopes=["https://www.googleapis.com/auth/spreadsheets"])
    api=build("sheets","v4",credentials=credentials,cache_discovery=False).spreadsheets()
    def read(range_name):
        return api.values().get(spreadsheetId=sid,range=range_name,valueRenderOption="UNFORMATTED_VALUE").execute(num_retries=5).get("values",[])
    chunks,current,size=[],[],0
    for request in doc["requests"]:
        length=len(json.dumps(request).encode())
        if current and size+length>1500000:
            chunks.append(current); current=[]; size=0
        current.append(request); size+=length
    if current: chunks.append(current)
    for index,chunk in enumerate(chunks,1):
        api.batchUpdate(spreadsheetId=sid,body={"requests":chunk}).execute(num_retries=5)
        print(f"Applied batch {index}/{len(chunks)} ({len(chunk)} requests).",flush=True)
    if doc.get("dashboard"):
        d=doc["dashboard"]; values=read("Dashboard!A49:I62")
        requests=[]
        if not any(r and r[0]=="Report" for r in values):
            requests.append({"insertDimension":{"range":{"sheetId":d["sheetId"],"dimension":"ROWS","startIndex":56,"endIndex":57},"inheritFromBefore":True}})
        report_formulas=[str(f).replace("$A56","$A57") for f in d["formulas"]]
        requests += [
            write(d["sheetId"],49,2,[["iTaukei Scholarship — Six headline publication categories"]]),
            write(d["sheetId"],57,0,[["Report"]+report_formulas]),
            write(d["sheetId"],58,1,[[f"=SUM({col}52:{col}57)" for col in "BCDEFGHI"]]),
            write(d["sheetId"],61,0,[["*Headline totals include journal articles, books, book chapters, Masters theses, PhD theses and reports. Conference contributions, preprints, unresolved/other types and duplicate rows are retained outside counts."]])]
        api.batchUpdate(spreadsheetId=sid,body={"requests":requests}).execute(num_retries=5)
    v=doc["verify"]; start=v["publicationStartRow"]; expected=v["newPublications"]
    actual=read(f"Publications!A{start}:E{start+len(expected)-1}")
    if len(actual)!=len(expected): raise AssertionError("Publication row count mismatch")
    for index,(row,want) in enumerate(zip(actual,expected)):
        got=[row[0],row[2],row[3],row[4]]
        if list(map(scalar,got))!=list(map(scalar,want)): raise AssertionError(f"Publication mismatch at row {start+index}")
    start=v["authorshipStartRow"]; expected=v["newAuthorship"]
    actual=read(f"Authorship!A{start}:G{start+len(expected)-1}")
    if len(actual)!=len(expected): raise AssertionError("Authorship row count mismatch")
    for index,(row,want) in enumerate(zip(actual,expected)):
        if list(map(scalar,row))!=list(map(scalar,want)): raise AssertionError(f"Authorship mismatch at row {start+index}")
    eligible={"Journal Article","Master's Thesis","PhD Thesis","Book Chapter","Book","Report"}
    publications=read("Publications!A5:E9987")
    count=sum(len(r)>2 and r[2] in eligible for r in publications)
    if count!=v["expectedEligible"]: raise AssertionError(f"Eligible count mismatch: {count}")
    audit=read("'NZ Reconciliation 2026-10-12'!A2:M667")
    if len(audit)!=v["sourceRows"]: raise AssertionError("Source audit incomplete")
    degree=read("'Graduate Degrees'!A150:Z150")[0]
    if degree[1]!="ITK-S0127" or int(degree[14])!=2015 or degree[15]!="Completed": raise AssertionError("PhD realignment failed")
    if int(read("Publications!E421")[0][0])!=2015: raise AssertionError("PhD publication repair failed")
    if int(read("Dashboard!B58")[0][0])!=count: raise AssertionError("Dashboard total mismatch")
    print(f"PASS: {len(v['newPublications'])} new publications, {len(v['newAuthorship'])} new authorship links, {len(audit)} source audit rows; {count} eligible publications; thesis repairs and native Dashboard verified.",flush=True)
if __name__=="__main__": main()
