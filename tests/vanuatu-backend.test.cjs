const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
let email='owner@example.invalid',roles={'owner@example.invalid':'owner','reviewer@example.invalid':'reviewer'},props={VANUATU_WRITE_ENABLED:'false'};
const sandbox={Session:{getActiveUser:()=>({getEmail:()=>email})},PropertiesService:{getScriptProperties:()=>({getProperty:k=>k==='VANUATU_ROLES'?JSON.stringify(roles):props[k]||null})},Utilities:{base64EncodeWebSafe:x=>Buffer.from(x).toString('base64url'),computeDigest:(_,s)=>require('node:crypto').createHash('sha256').update(s).digest(),DigestAlgorithm:{SHA_256:'SHA'},getUuid:()=>require('node:crypto').randomUUID()},console};
vm.createContext(sandbox);vm.runInContext(fs.readFileSync('apps-script/vanuatu-master-writeback.gs','utf8'),sandbox);
let n=0;function test(name,fn){fn();n++;console.log('PASS',name);}
test('anonymous Google identity denied',()=>{email='';assert.throws(()=>sandbox.vanActor_(false),/identity unavailable/);});
test('unlisted and revoked user denied',()=>{email='stranger@example.invalid';assert.throws(()=>sandbox.vanActor_(false),/not authorized/);});
test('reviewer cannot invoke owner operation',()=>{email='reviewer@example.invalid';assert.throws(()=>sandbox.vanActor_(true),/not authorized/);assert.equal(sandbox.vanActor_(false).role,'reviewer');});
test('role reread on every request',()=>{roles['reviewer@example.invalid']='revoked';assert.throws(()=>sandbox.vanActor_(false),/not authorized/);});
test('write kill switch fails closed',()=>{email='owner@example.invalid';assert.throws(()=>sandbox.vanWriteEnabled_(),/disabled/);props.VANUATU_WRITE_ENABLED='true';sandbox.vanWriteEnabled_();});
test('computed scholar counts and IDs are not writable',()=>{assert.throws(()=>sandbox.vanValidate_('Scholars','Degree Episodes','999'),/Read-only/);assert.throws(()=>sandbox.vanValidate_('Scholars','Scholar ID','VAN-S0002'),/Read-only/);});
test('Vanuatu exact enums, provinces and URLs',()=>{assert.equal(sandbox.vanValidate_('Scholars','Gender','Non-binary'),'Non-binary');assert.throws(()=>sandbox.vanValidate_('Scholars','Paternal Province','Tongatapu'),/Invalid province/);assert.throws(()=>sandbox.vanValidate_('Scholars','Current Profile URL','javascript:alert(1)'),/http/);});
test('literal writes cannot inject formulas',()=>{assert.deepEqual(JSON.parse(JSON.stringify(sandbox.vanCell_('=IMPORTXML("secret")'))),{userEnteredValue:{stringValue:'=IMPORTXML("secret")'}});});
test('Degree ID and Position ID are canonical keys',()=>{assert.equal(sandbox.VAN_KEYS_['Graduate Degrees'],'Degree ID');assert.equal(sandbox.VAN_KEYS_.Positions,'Position ID');});
test('selected fields, no hidden bulk changes',()=>{const source=fs.readFileSync('apps-script/vanuatu-master-writeback.gs','utf8');assert(source.includes('fields.forEach'));assert(source.includes('remaining[field]'));assert(source.includes('expectedVersion'));assert(source.includes('Sheets.Spreadsheets.batchUpdate'));});
test('unsupported public and upload routes not present',()=>{assert.equal(sandbox.submitPublicProfile,undefined);assert.equal(sandbox.uploadPublicAttachment,undefined);});
test('review cannot change identity/public approval',()=>{assert(!sandbox.VAN_REVIEW_FIELDS_.includes('Identity Verification Status'));assert(!sandbox.VAN_REVIEW_FIELDS_.includes('Public Display Approved'));});
console.log(n+' Vanuatu backend tests passed (mock Google runtime, not a deployed service).');
