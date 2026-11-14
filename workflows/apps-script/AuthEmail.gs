/* Supabase Auth Send Email Hook delivery through the existing Apps Script account. */
function dhAuthEmail_(payload){
  var hookId=typeof payload.hookId==='string'?payload.hookId:'';
  var messages=payload.messages;
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(hookId)||!Array.isArray(messages)||messages.length<1||messages.length>2)
    fail('AUTH_EMAIL_INVALID_REQUEST',400);
  var properties=PropertiesService.getScriptProperties(),prefix='DHL_AUTH_EMAIL_',nowMs=Date.now();
  // Keep only seven days of idempotency receipts. Supabase Auth tokens expire far
  // sooner, while this window covers retries without growing Script Properties forever.
  properties.getKeys().forEach(function(key){
    if(key.indexOf(prefix)!==0)return;
    try{var saved=JSON.parse(properties.getProperty(key)||'{}');if(!saved.at||nowMs-Number(saved.at)>7*86400000)properties.deleteProperty(key);}
    catch(error){properties.deleteProperty(key);}
  });
  var prepared=messages.map(function(message){
    if(!message||typeof message!=='object'||Array.isArray(message))fail('AUTH_EMAIL_INVALID_REQUEST',400);
    var to=String(message.to||'').trim().toLowerCase(),subject=String(message.subject||''),htmlBody=String(message.htmlBody||''),textBody=String(message.textBody||'');
    if(!/^[^\s@\r\n]{1,128}@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(to)||subject.length<1||subject.length>160||
      !htmlBody||htmlBody.length>12000||!textBody||textBody.length>12000)fail('AUTH_EMAIL_INVALID_REQUEST',400);
    return {to:to,subject:subject,htmlBody:htmlBody,textBody:textBody,key:prefix+hash(hookId+'|'+to)};
  });
  if(new Set(prepared.map(function(item){return item.to;})).size!==prepared.length)fail('AUTH_EMAIL_INVALID_REQUEST',400);
  var toSend=prepared.filter(function(item){
    var prior=properties.getProperty(item.key);if(!prior)return true;
    try{var receipt=JSON.parse(prior);if(receipt.outcome==='Delivered')return false;}
    catch(error){}
    return false;
  });
  var hasUncertain=prepared.some(function(item){var prior=properties.getProperty(item.key);if(!prior)return false;try{return JSON.parse(prior).outcome!=='Delivered';}catch(error){return true;}});
  if(hasUncertain)return {outcome:'Uncertain'};
  if(!toSend.length)return {outcome:'Delivered',duplicate:true};
  if(MailApp.getRemainingDailyQuota()<toSend.length)return {outcome:'Failed'};
  toSend.forEach(function(item){properties.setProperty(item.key,JSON.stringify({outcome:'Uncertain',at:nowMs}));});
  for(var i=0;i<toSend.length;i++){
    var item=toSend[i];
    try{
      MailApp.sendEmail({to:item.to,subject:item.subject,body:item.textBody,htmlBody:item.htmlBody,name:'DwellHunt'});
      properties.setProperty(item.key,JSON.stringify({outcome:'Delivered',at:Date.now()}));
    }catch(error){
      // Do not resend an ambiguous delivery automatically. The caller retries the
      // exact hook event; an operator must resolve uncertainty with delivery proof.
      return {outcome:'Uncertain'};
    }
  }
  return {outcome:'Delivered'};
}
