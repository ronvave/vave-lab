/* Tonga review-only access. Credentials stay in memory and are sent only in POST bodies. */
(function(){
'use strict';
const CLIENT_ID='736953802264-krjcv9i8onhoesmg5fe6vhaie9lc7o4k.apps.googleusercontent.com';
const ENDPOINT='https://script.google.com/macros/s/AKfycbwm6ZOEFya_NOPmMswjxjpqLsoXaYuoH5tMvc2hP29YakWf7dV9728y0iEHmx3WsKGSow/exec';
const $=id=>document.getElementById(id);
let token='',expiresAt=0,expiryTimer,renewTimer,signingIn=false,identitySub='';
function renew(messageText){$('sign-in').hidden=false;message(messageText||'Sign in again to continue saving. Your open review and selections are preserved.');$('db-status').textContent='sign-in required';}
function expire(){token='';renew();}
function checkExpiry(){if(token&&Date.now()>=expiresAt)expire();}
window.addEventListener('focus',checkExpiry);document.addEventListener('visibilitychange',checkExpiry);
const nonce=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
function message(t){$('auth-message').textContent=t;}
function logout(){token='';clearTimeout(expiryTimer);clearTimeout(renewTimer);google.accounts.id.disableAutoSelect();location.reload();}
$('logout').onclick=logout;
async function call(action,params={}){
 checkExpiry();if(!token){renew();throw new Error('Sign in again above, then retry. Your review is preserved.');}
 const requestToken=token;
 const send=async(name,values={})=>{const response=await fetch(ENDPOINT,{method:'POST',cache:'no-store',signal:AbortSignal.timeout(90000),credentials:'omit',redirect:'follow',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...values,action:name,idToken:requestToken})});return response.json();};
 let out=await send(action,params);
 if(out.status==='unauthorized'&&token===requestToken&&action!=='reviewCapabilities'&&Date.now()<expiresAt){
  // A redirected/transient response must not discard a still-valid session.
  // Probe the signed server capability; never replay a write automatically.
  const probe=await send('reviewCapabilities');
  if(probe.status==='ok'&&['owner','admin'].includes(probe.role)){
   if(/^(read|reviewQueueCounts$)/.test(action))out=await send(action,params);
   if(out.status==='unauthorized')return {status:'error',error:'This request was interrupted. Your sign-in and open review are preserved. Refresh the queue to check the saved outcome before retrying.'};
  }else if(probe.status==='unauthorized'&&probe.reason){out=probe;}
  else return {status:'error',error:'The service could not confirm this request. Your open review is preserved. Try again shortly.'};
 }
 if(out.status==='unauthorized'&&token===requestToken){token='';renew((out.reason||'Please sign in again.')+' Your open review and selections are preserved.');}
 return out;
}
window.adminWriteback={
 isConfigured:()=>!!token&&Date.now()<expiresAt,
 readChangeLog:limit=>call('readChangeLog',{limit:limit||100}),
 readAttachmentAnalysis: submissionId=>call('readAttachmentAnalysis',{submissionId}),
 refreshAttachmentProposals: params=>call('refreshAttachmentProposals',params),
 analyseScholarAttachment: params=>call('analyseScholarAttachment',params),
 editAttachmentProposal: params=>call('editAttachmentProposal',params),
 approveAttachmentProposals: params=>call('approveAttachmentProposals',params),
 reviewCapabilities:()=>call('reviewCapabilities'),
 reviewQueueCounts:()=>call('reviewQueueCounts'),
 readScholarSubmission:submissionId=>call('readScholarProfileSubmissions',{submissionId}),
 reviewScholarSelection:(submissionId,selectedChanges,selectedFiles,reviewNotes)=>call('reviewScholarSelection',{submissionId,selectedChanges,selectedFiles,reviewNotes}),
 readScholarSubmissions:status=>call('readScholarProfileSubmissions',{status}),
 readGeographySubmissions:status=>call('readPublicationGeographySubmissions',{status}),
 readSubmissionAttachment:(submissionId,fileId)=>call('readScholarSubmissionAttachment',{submissionId,fileId}),
 beginScholarReview:(submissionId,selectedChanges,selectedFiles,reviewNotes)=>call('beginScholarReview',{submissionId,selectedChanges,selectedFiles,reviewNotes}),
 approveScholarSubmission:(submissionId,selectedChanges,reviewNotes)=>call('approveScholarProfileSubmission',{submissionId,selectedChanges,reviewNotes}),
 recordAttachmentReview:(submissionId,fileId,disposition,evidence)=>call('recordScholarAttachmentReview',{submissionId,fileId,disposition,evidence}),
 finishScholarReview:(submissionId,reviewNotes)=>call('finishScholarReview',{submissionId,reviewNotes}),
 resolveScholarSubmission:(submissionId,decision,reviewNotes)=>call('resolveScholarProfileSubmission',{submissionId,decision,reviewNotes}),
 resolveGeographySubmission:(submissionId,decision,reviewNotes)=>call('resolvePublicationGeographySubmission',{submissionId,decision,reviewNotes}),
 banScholarSubmitter:(submissionId,reason)=>call('banScholarSubmitter',{submissionId,reason,confirmed:true})
};
window.TongaSubmissionAdmin={
 refreshMessage:'Master saved. The public dashboard will update after its next successful scheduled refresh.',
 approvePhoto:async()=>{throw new Error('Owner photo publishing required. This photo stays Pending; approved text is saved.');}
};
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{
 document.querySelectorAll('[data-tab]').forEach(other=>{const selected=b===other;other.setAttribute('aria-selected',String(selected));$(other.dataset.tab).hidden=!selected;});
}));
async function signedIn(result){
 if(signingIn)return;signingIn=true;
 try{
  // Bind the Google callback to this page instance. Backend independently
  // verifies the signature/claims; this decode alone never grants access.
  const payload=JSON.parse(atob(result.credential.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
  if(payload.nonce!==nonce)throw new Error('Sign-in did not match this page. Reload and try again.');
  if(identitySub&&payload.sub!==identitySub)throw new Error('Use the same Google account to resume this review. To switch accounts, log out first.');
  if(!Number.isFinite(payload.exp)||payload.exp*1000<=Date.now())throw new Error('Google returned an expired sign-in. Please sign in again.');
  token=result.credential;expiresAt=payload.exp*1000;message('Checking Admin access…');
  const caps=await call('reviewCapabilities');
  if(caps.status!=='ok'||!['owner','admin'].includes(caps.role))throw new Error(caps.reason||caps.error||'The deployed backend did not return a Google review role. Ask the Owner to check the deployed version and private access settings.');
  identitySub=payload.sub;
  $('identity').textContent=payload.email+' · '+(caps.role==='owner'?'Owner':'Admin');
  $('owner-link').hidden=caps.role!=='owner';$('logout').hidden=false;
  $('sign-in').hidden=true;$('review-app').hidden=false;$('db-status').textContent='ready';
  clearTimeout(expiryTimer);clearTimeout(renewTimer);expiryTimer=setTimeout(expire,Math.max(0,expiresAt-Date.now()));
  renewTimer=setTimeout(()=>renew('Your Google sign-in will expire soon. Sign in here to renew it without losing your review.'),Math.max(0,expiresAt-Date.now()-120000));
  if(!document.getElementById('queue-script')){
   const script=document.createElement('script');script.id='queue-script';script.src='js/tongan-submissions-admin.js?v=queue-refresh-20261007';
   script.onload=()=>document.querySelector('[data-tab="scholar-submissions"]').click();document.body.append(script);
  } // Reauthentication keeps the existing queue DOM, notes and selections intact.
 }catch(e){token='';message(e.message||'Sign-in failed. Try again.');}
 finally{signingIn=false;}
}
let attempts=0;
const wait=setInterval(()=>{
 if(window.google?.accounts?.id){
  clearInterval(wait);google.accounts.id.initialize({client_id:CLIENT_ID,callback:signedIn,nonce,auto_select:false});
  google.accounts.id.renderButton($('google-button'),{theme:'outline',size:'large',text:'signin_with'});message('');
 }else if(++attempts>=60){clearInterval(wait);message('Google sign-in could not load. Check your connection and reload.');}
},250);
})();
