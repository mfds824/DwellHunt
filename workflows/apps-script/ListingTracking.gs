/* Optional listing tracking extension. Uses the existing authenticated gateway.
 * The database, not this spreadsheet, authorizes review/publication/expiry. */
const DH_LISTING_TRACKER_ID_='1GvI8qnb5ZKCgtshRJsPBrpmIuKd6M-gi8mMeEMkGH50';
const DH_LISTING_HEADERS_=['Listing ID','Submitted at','Listing title','Lister role','Purpose','Category','City or area','Lister name','Email','Phone','Reviewer','Status','Review notes','Approved at','First published at','Cycle started at','Expires at','Days remaining','Publication action','Next followup at','Followup action','Last contacted at','Availability confirmed at','Renewal decision','Publication URL','Enquiry count','Authority confirmed','Facts confirmed','Photo rights confirmed','Sheet sync status','Updated at','7-day reminder due','2-day reminder due'];
const DH_LISTING_AGENT_HEADERS_=['Submitting agent ID','Assigned agent ID','Agency ID','Lifecycle version','Renewal count','Review status'];
const DH_FOLLOWUP_HEADERS_=['Followup ID','Listing ID','Contacted at','Reason','Channel','Assignee','Outcome','Next followup at','Notes'];
const DH_LISTING_FORMULAS_=['Expires at','Days remaining','Publication action','Followup action','7-day reminder due','2-day reminder due'];
const DH_LISTING_STAFF_=['Reviewer','Review notes','Next followup at','Last contacted at','Renewal decision'];
function dhListingEnabled_(){if(cfg('LISTING_TRACKING_ENABLED','false')!=='true')fail('LISTING_TRACKING_DISABLED',503);}
function dhListingGoogle_(method,path,body){
 const options={method:method,headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true};
 if(body){options.contentType='application/json';options.payload=JSON.stringify(body);}
 const response=UrlFetchApp.fetch('https://sheets.googleapis.com/v4/spreadsheets/'+DH_LISTING_TRACKER_ID_+path,options);
 if(response.getResponseCode()<200||response.getResponseCode()>=300){
  let diagnostic={};try{diagnostic=JSON.parse(response.getContentText()).error||{};}catch(error){}
  const reasons=[...(diagnostic.errors||[]).map(function(e){return e.reason;}),...(diagnostic.details||[]).map(function(e){return e.reason;})];
  if(reasons.indexOf('SERVICE_DISABLED')>=0||reasons.indexOf('accessNotConfigured')>=0)fail('LISTING_SHEETS_API_DISABLED',503);
  if(reasons.indexOf('ACCESS_TOKEN_SCOPE_INSUFFICIENT')>=0)fail('LISTING_SHEETS_SCOPE_REQUIRED',503);
  if(response.getResponseCode()===403)fail('LISTING_SHEETS_PERMISSION_DENIED',503);
  fail('LISTING_SHEETS_UNAVAILABLE',503);
 }
 return JSON.parse(response.getContentText());
}
function dhListingSchema_(){
 const book=SpreadsheetApp.openById(DH_LISTING_TRACKER_ID_);if(book.getSpreadsheetTimeZone()!=='Asia/Colombo')fail('LISTING_SHEET_TIMEZONE',409);
 const sheets={};[['Listings',DH_LISTING_HEADERS_],['Followups',DH_FOLLOWUP_HEADERS_]].forEach(function(pair){
  const s=book.getSheetByName(pair[0]);if(!s)fail('LISTING_SHEET_SCHEMA',409);
  const headers=s.getRange(6,1,1,s.getLastColumn()).getValues()[0];
  pair[1].forEach(function(header){if(headers.filter(function(h){return h===header;}).length!==1)fail('LISTING_SHEET_SCHEMA',409);});
  sheets[pair[0]]={sheet:s,headers:headers};
 });
 const policy=book.getSheetByName('Workflow');if(!policy)fail('LISTING_SHEET_SCHEMA',409);
 const settings=policy.getRange('G3:G5').getValues().map(function(row){return Number(row[0]);});
 if(settings[0]!==1||settings[1]!==7||settings[2]!==2)fail('LISTING_SHEET_POLICY_DIFFERS',409);
 return sheets;
}
function dhListingHealth_(){
 const schema=dhListingSchema_();
 // Metadata read also proves the Sheets REST API needed for atomic writes is enabled.
 dhListingGoogle_('get','?fields='+encodeURIComponent('spreadsheetId,sheets(properties,tables,basicFilter),namedRanges'));
 return {ok:true,httpStatus:200,spreadsheetId:DH_LISTING_TRACKER_ID_,headersRow:6,readiness:'ready',enabled:cfg('LISTING_TRACKING_ENABLED','false')==='true'};
}
// Read-only operator probe. No bulk processing, uploads or notifications.
function listingTrackingReadiness(){
 const result=dhListingHealth_();console.log(JSON.stringify(result));return result;
}
function dhListingCell_(value){
 if(typeof value==='number'){if(!isFinite(value))fail('LISTING_SHEET_VALUE',400);return {numberValue:value};}
 if(typeof value==='boolean')return {boolValue:value};
 let text=String(value==null?'':value);if(text.length>2000)text=text.slice(0,2000);
 // Literal stringValue prevents evaluation. Prefix spreadsheet operators as a second
 // defense for later exports/reimports; never accept formulaValue from a caller.
 if(/^[=+\-@\t\r\n]/.test(text))text="'"+text;
 return {stringValue:text};
}
function dhListingUpsert_(payload){
 dhListingEnabled_();const tab=payload.tab;if(tab!=='Listings'&&tab!=='Followups')fail('LISTING_SHEET_SCHEMA',400);
 const record=payload.record;if(!record||typeof record!=='object'||Array.isArray(record))fail('LISTING_SHEET_VALUE',400);
 const expected=tab==='Listings'?DH_LISTING_HEADERS_.concat(DH_LISTING_AGENT_HEADERS_):DH_FOLLOWUP_HEADERS_;
 if(Object.keys(record).some(function(k){return expected.indexOf(k)<0;}))fail('LISTING_SHEET_VALUE',400);
 const schema=dhListingSchema_()[tab],sheet=schema.sheet,headers=schema.headers,idHeader=expected[0],id=String(record[idHeader]||'');
 if(!(tab==='Listings'?/^(TEST-)?DHL-[0-9a-f-]{36}$/i:/^[0-9a-f-]{36}$/i).test(id))fail('LISTING_SHEET_ID',400);
 const idCol=headers.indexOf(idHeader)+1,maxRows=sheet.getMaxRows(),count=maxRows-6;
 const ids=count>0?sheet.getRange(7,idCol,count,1).getValues():[];let row=0;
 ids.forEach(function(v,i){if(String(v[0])===id){if(row)fail('LISTING_SHEET_DUPLICATE_ID',409);row=i+7;}});
 const existing=!!row;
 if(!row){
  for(let i=0;i<ids.length;i++)if(!ids[i][0]){
   const values=sheet.getRange(i+7,1,1,headers.length).getValues()[0],formulas=sheet.getRange(i+7,1,1,headers.length).getFormulas()[0];
   if(!values.some(function(v,c){return !formulas[c]&&v!==''&&v!==null;})){row=i+7;break;}
  }
 }
 if(!row)row=maxRows+1;
 const metadata=dhListingGoogle_('get','?fields='+encodeURIComponent('spreadsheetId,sheets(properties,tables,basicFilter),namedRanges,developerMetadata'));
 const requests=[],sheetId=sheet.getSheetId();
 if(row>maxRows)requests.push({appendDimension:{sheetId:sheetId,dimension:'ROWS',length:Math.max(100,row-maxRows)}});
 // Commit a monotonic database revision in the same atomic batch as the row.
 // A slow, expired lease cannot overwrite a newer review/publication status.
 if(tab==='Listings'){
  const revision=Number(payload.revision);if(!Number.isSafeInteger(revision)||revision<1)fail('LISTING_SHEET_REVISION',400);
  const metadataKey='dwellhunt_listing_revision:'+id;
  const matches=(metadata.developerMetadata||[]).filter(function(m){return m.metadataKey===metadataKey;});
  if(matches.length>1)fail('LISTING_SHEET_DUPLICATE_ID',409);
  const prior=matches[0];
  if(prior&&Number(prior.metadataValue)>revision)return {ok:true,httpStatus:200,existing:true,stale:true};
  if(prior)requests.push({updateDeveloperMetadata:{dataFilters:[{developerMetadataLookup:{metadataId:prior.metadataId}}],developerMetadata:{metadataValue:String(revision)},fields:'metadataValue'}});
  else requests.push({createDeveloperMetadata:{developerMetadata:{metadataKey:metadataKey,metadataValue:String(revision),visibility:'DOCUMENT',location:{dimensionRange:{sheetId:sheetId,dimension:'ROWS',startIndex:row-1,endIndex:row}}}}});
 }
 if(!existing&&row!==7)requests.push({copyPaste:{source:{sheetId:sheetId,startRowIndex:6,endRowIndex:7,startColumnIndex:0,endColumnIndex:headers.length},destination:{sheetId:sheetId,startRowIndex:row-1,endRowIndex:row,startColumnIndex:0,endColumnIndex:headers.length},pasteType:'PASTE_FORMAT'}});
 const formulas=row<=maxRows?sheet.getRange(row,1,1,headers.length).getFormulas()[0]:headers.map(function(){return '';});
 Object.keys(record).forEach(function(header){
  const col=headers.indexOf(header);if(col<0)fail(tab==='Listings'&&DH_LISTING_AGENT_HEADERS_.indexOf(header)>=0?'LISTING_AGENT_SHEET_SCHEMA_REQUIRED':'LISTING_SHEET_SCHEMA',409);
  if(tab==='Listings'&&(DH_LISTING_FORMULAS_.indexOf(header)>=0||DH_LISTING_STAFF_.indexOf(header)>=0))return;
  if(tab==='Followups'&&existing&&['Assignee','Next followup at','Notes'].indexOf(header)>=0)return;
  if(formulas[col])fail('LISTING_SHEET_FORMULA_CONFLICT',409);
  requests.push({updateCells:{range:{sheetId:sheetId,startRowIndex:row-1,endRowIndex:row,startColumnIndex:col,endColumnIndex:col+1},rows:[{values:[{userEnteredValue:dhListingCell_(record[header])}]}],fields:'userEnteredValue'}});
 });
 if(tab==='Listings')DH_LISTING_FORMULAS_.forEach(function(header){
  const col=headers.indexOf(header);if(formulas[col])return;
  const source=sheet.getRange(7,col+1).getFormula();if(!source)fail('LISTING_SHEET_FORMULA_TEMPLATE_MISSING',409);
  if(row!==7)requests.push({copyPaste:{source:{sheetId:sheetId,startRowIndex:6,endRowIndex:7,startColumnIndex:col,endColumnIndex:col+1},destination:{sheetId:sheetId,startRowIndex:row-1,endRowIndex:row,startColumnIndex:col,endColumnIndex:col+1},pasteType:'PASTE_FORMULA'}});
 });
 (metadata.sheets||[]).filter(function(s){return s.properties.sheetId===sheetId;}).forEach(function(s){
  (s.tables||[]).forEach(function(t){const r=t.range;if(r.startRowIndex===5&&r.startColumnIndex===0&&r.endColumnIndex>=(tab==='Listings'?DH_LISTING_HEADERS_.length:DH_FOLLOWUP_HEADERS_.length)&&r.endRowIndex<row)requests.push({updateTable:{table:{tableId:t.tableId,range:Object.assign({},r,{endRowIndex:row})},fields:'range'}});});
  const f=s.basicFilter;if(f&&f.range.startRowIndex===5&&f.range.endRowIndex&&f.range.endRowIndex<row)requests.push({setBasicFilter:{filter:Object.assign({},f,{range:Object.assign({},f.range,{endRowIndex:row})})}});
 });
 (metadata.namedRanges||[]).forEach(function(n){const r=n.range;if(r.sheetId===sheetId&&r.startRowIndex===5&&r.startColumnIndex===0&&r.endColumnIndex>=(tab==='Listings'?DH_LISTING_HEADERS_.length:DH_FOLLOWUP_HEADERS_.length)&&r.endRowIndex<row)requests.push({updateNamedRange:{namedRange:{namedRangeId:n.namedRangeId,range:Object.assign({},r,{endRowIndex:row})},fields:'range'}});});
 dhListingGoogle_('post',':batchUpdate',{requests:requests});
 // SpreadsheetApp can retain the pre-write cell cache after an external REST
 // batch. Verify through the same API instead of treating that stale cache as failure.
 let column='',index=idCol;while(index>0){index--;column=String.fromCharCode(65+index%26)+column;index=Math.floor(index/26);}
 const verified=dhListingGoogle_('get','/values/'+encodeURIComponent(tab+'!'+column+row)+'?valueRenderOption=UNFORMATTED_VALUE');
 if(!verified.values||!verified.values[0]||String(verified.values[0][0])!==id)fail('LISTING_SHEET_VERIFY_FAILED',503);
 return {ok:true,httpStatus:200,spreadsheetId:DH_LISTING_TRACKER_ID_,tab:tab,row:row,existing:existing};
}
function dhListingReminder_(payload,lookupOnly){
 dhListingEnabled_();const key=String(payload.idempotencyKey||'');if(!/^renewal:(TEST-)?DHL-[0-9a-f-]{36}:[0-9a-f-]{36}:(7|2)$/i.test(key))fail('LISTING_REMINDER_KEY',400);
 const properties=PropertiesService.getScriptProperties(),slot='DHL_MAIL_'+hash(key),saved=properties.getProperty(slot);
 if(saved){const prior=JSON.parse(saved);return {ok:true,httpStatus:200,outcome:prior.outcome,receipt:prior.receipt||null};}
 if(lookupOnly)return {ok:true,httpStatus:200,outcome:'Not found'};
 const to=String(payload.recipient||'').trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))fail('LISTING_REMINDER_RECIPIENT',400);
 // Listing activation is independent of the existing booking Development mode.
 if(cfg('LISTING_ENVIRONMENT','development')!=='production'&&payload.synthetic!==true)fail('LISTING_TEST_RECIPIENT_REQUIRED',403);
 if(payload.synthetic!==true&&cfg('LISTING_LIVE_REMINDERS_ENABLED','false')!=='true')fail('LISTING_LIVE_REMINDERS_DISABLED',503);
 if(payload.synthetic===true&&to!==String(cfg('DEV_TEST_EMAIL')).trim().toLowerCase())fail('LISTING_TEST_RECIPIENT_REQUIRED',403);
 if(MailApp.getRemainingDailyQuota()<1)return {ok:true,httpStatus:200,outcome:'Failed'};
 // Persist ambiguity BEFORE the external call; an unknown retry never sends twice.
 properties.setProperty(slot,JSON.stringify({outcome:'Uncertain',at:now()}));
 try{
  MailApp.sendEmail({to:to,subject:(payload.synthetic?'[SYNTHETIC TEST] ':'')+'DwellHunt listing renewal reminder',name:'DwellHunt',
   body:'Your DwellHunt listing '+String(payload.listingId)+' ('+String(payload.title||'')+') expires at '+String(payload.expiresAt)+'.\nTo renew, sign in and confirm the current price, availability and advertising authority. Renewal is optional; there is no automatic renewal or charge.\nReference: '+hash(key)});
  const receipt='mail:'+hash(key);properties.setProperty(slot,JSON.stringify({outcome:'Delivered',receipt:receipt,at:now()}));
  return {ok:true,httpStatus:200,outcome:'Delivered',receipt:receipt};
 }catch(error){return {ok:true,httpStatus:200,outcome:'Uncertain'};}
}

// Explicit operator-only additive setup, not called by submission or a schedule.
// Existing formulas, staff columns, records and sharing settings are untouched.
function listingAgentTrackingSetup(){
 const schema=dhListingSchema_().Listings,sheet=schema.sheet,headers=schema.headers;
 const missing=DH_LISTING_AGENT_HEADERS_.filter(function(name){return headers.indexOf(name)<0;});
 DH_LISTING_AGENT_HEADERS_.forEach(function(name){if(headers.filter(function(h){return h===name;}).length>1)fail('LISTING_SHEET_SCHEMA',409);});
 if(!missing.length)return {ok:true,added:0};
 const requests=[],width=headers.length+missing.length;
 if(width>sheet.getMaxColumns())requests.push({appendDimension:{sheetId:sheet.getSheetId(),dimension:'COLUMNS',length:width-sheet.getMaxColumns()}});
 requests.push({updateCells:{range:{sheetId:sheet.getSheetId(),startRowIndex:5,endRowIndex:6,startColumnIndex:headers.length,endColumnIndex:width},rows:[{values:missing.map(function(name){return {userEnteredValue:{stringValue:name}};})}],fields:'userEnteredValue'}});
 dhListingGoogle_('post',':batchUpdate',{requests:requests});
 return {ok:true,added:missing.length};
}
