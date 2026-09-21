/* Tonga review-only access. Credentials stay in memory and are sent only in POST bodies. */
(function(){
'use strict';
const CLIENT_ID='736953802264-krjcv9i8onhoesmg5fe6vhaie9lc7o4k.apps.googleusercontent.com';
const ENDPOINT='https://script.google.com/macros/s/AKfycbwm6ZOEFya_NOPmMswjxjpqLsoXaYuoH5tMvc2hP29YakWf7dV9728y0iEHmx3WsKGSow/exec';
const $=id=>document.getElementById(id);
let token='',expiryTimer,signingIn=false;
const nonce=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
function message(t){$('auth-message').textContent=t;}
function logout(){token='';clearTimeout(expiryTimer);google.accounts.id.disableAutoSelect();location.reload();}
$('logout').onclick=logout;
async function call(action,params={}){
 if(!token)throw new Error('Please sign in again.');
 const response=await fetch(ENDPOINT,{method:'POST',credentials:'omit',redirect:'follow',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...params,action,idToken:token})});
 const out=await response.json();
 if(out.status==='unauthorized'){
  token='';$('review-app').hidden=true;$('sign-in').hidden=false;$('identity').textContent='';
  message('Your sign-in expired or this account is not authorized. Sign in again.');
 }
 return out;
}
window.adminWriteback={
 isConfigured:()=>!!token,
 reviewCapabilities:()=>call('reviewCapabilities'),
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
  token=result.credential;message('Checking Admin access…');
  const caps=await call('reviewCapabilities');
  if(caps.status!=='ok'||!['owner','admin'].includes(caps.role))throw new Error('Google Admin access is not enabled for this account yet.');
  $('identity').textContent=payload.email+' · '+(caps.role==='owner'?'Owner':'Admin');
  $('owner-link').hidden=caps.role!=='owner';$('logout').hidden=false;
  $('sign-in').hidden=true;$('review-app').hidden=false;$('db-status').textContent='ready';
  clearTimeout(expiryTimer);expiryTimer=setTimeout(logout,Math.max(0,payload.exp*1000-Date.now()));
  if(!document.getElementById('queue-script')){
   const script=document.createElement('script');script.id='queue-script';script.src='js/tongan-submissions-admin.js?v=google-roles-1';
   script.onload=()=>document.querySelector('[data-tab="scholar-submissions"]').click();document.body.append(script);
  }else location.reload();
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
