import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';import {createHash} from 'node:crypto';
const source=readFileSync(new URL('../apps-script/ListingTracking.gs',import.meta.url),'utf8');
const ID='TEST-DHL-11111111-1111-4111-8111-111111111111';
function harness(){
 const ctx:Record<string,any>={};runInNewContext(source,ctx);
 const headers=runInNewContext('DH_LISTING_HEADERS_',ctx) as string[];
 const values=Array.from({length:9},()=>Array(headers.length).fill(''));
 const formulas=Array.from({length:9},()=>Array(headers.length).fill(''));
 values[5]=[...headers];for(const name of ['Expires at','Days remaining','Publication action','Followup action','7-day reminder due','2-day reminder due'])formulas[6][headers.indexOf(name)]='=IF(A7="","",1)';
 const batches:any[][]=[];let rows=9,sends=0,ambiguous=false;const properties=new Map<string,string>();
 const range=(r:number,c:number,n=1,w=1)=>({getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:w},(_,j)=>values[r-1+i]?.[c-1+j]??'')),getFormulas:()=>Array.from({length:n},(_,i)=>Array.from({length:w},(_,j)=>formulas[r-1+i]?.[c-1+j]??'')),getValue:()=>'',getFormula:()=>formulas[r-1]?.[c-1]??''}); // Native cache deliberately remains stale after REST writes.
 const sheet={getLastColumn:()=>headers.length,getMaxRows:()=>rows,getSheetId:()=>10,getRange:range};
 const followups={...sheet,getLastColumn:()=>9,getRange:(r:number,c:number,n=1,w=1)=>r===6?{getValues:()=>[runInNewContext('DH_FOLLOWUP_HEADERS_',ctx)]}:range(r,c,n,w)};
 const metadata={developerMetadata:[] as any[],sheets:[{properties:{sheetId:10},tables:[{tableId:'table',range:{sheetId:10,startRowIndex:5,endRowIndex:7,startColumnIndex:0,endColumnIndex:33}}],basicFilter:{range:{sheetId:10,startRowIndex:5,endRowIndex:7,startColumnIndex:0,endColumnIndex:33},criteria:{'11':{hiddenValues:['Declined']}}}}],namedRanges:[{namedRangeId:'range',range:{sheetId:10,startRowIndex:5,endRowIndex:7,startColumnIndex:0,endColumnIndex:33}}]};
 Object.assign(ctx,{cfg:(k:string,f='')=>({LISTING_TRACKING_ENABLED:'true',DEV_TEST_EMAIL:'approved@example.test'}[k]??f),fail:(c:string)=>{throw Error(c);},ScriptApp:{getOAuthToken:()=> 'fake-only'},SpreadsheetApp:{openById:()=>({getSpreadsheetTimeZone:()=> 'Asia/Colombo',getSheetByName:(name:string)=>name==='Listings'?sheet:name==='Followups'?followups:{getRange:()=>({getValues:()=>[[1],[7],[2]]})}})},UrlFetchApp:{fetch:(_u:string,o:any)=>{
  if(o.method==='get'){const cell=decodeURIComponent(_u).match(/\/values\/(?:Listings|Followups)!A(\d+)/);return{getResponseCode:()=>200,getContentText:()=>JSON.stringify(cell?{values:[[values[Number(cell[1])-1]?.[0]??'']]}:metadata)};}
  const requests=JSON.parse(o.payload).requests;batches.push(requests);
  for(const req of requests){if(req.createDeveloperMetadata)metadata.developerMetadata.push({...req.createDeveloperMetadata.developerMetadata,metadataId:metadata.developerMetadata.length+1});if(req.updateDeveloperMetadata){const u=req.updateDeveloperMetadata,m=metadata.developerMetadata.find(m=>m.metadataId===u.dataFilters[0].developerMetadataLookup.metadataId);Object.assign(m,u.developerMetadata);}}
  for(const req of requests){if(req.appendDimension)rows+=req.appendDimension.length;if(req.updateCells){const u=req.updateCells,r=u.range.startRowIndex,c=u.range.startColumnIndex;values[r]??=Array(headers.length).fill('');const v=u.rows[0].values[0].userEnteredValue;values[r][c]=v.stringValue??v.numberValue??v.boolValue;}if(req.copyPaste?.pasteType==='PASTE_FORMULA'){const cp=req.copyPaste;formulas[cp.destination.startRowIndex]??=Array(headers.length).fill('');formulas[cp.destination.startRowIndex][cp.destination.startColumnIndex]='=COPIED()';}}
  return{getResponseCode:()=>200,getContentText:()=> '{}'};
 }},PropertiesService:{getScriptProperties:()=>({getProperty:(k:string)=>properties.get(k),setProperty:(k:string,v:string)=>properties.set(k,v)})},hash:(v:string)=>createHash('sha256').update(v).digest('hex'),now:()=>new Date().toISOString(),dhIsDevelopment_:()=>true,MailApp:{getRemainingDailyQuota:()=>100,sendEmail:()=>{sends++;if(ambiguous)throw Error('uncertain network');}}});
 return{ctx,headers,values,formulas,batches,sends:()=>sends,uncertain:()=>{ambiguous=true;}};
}
test('actual Apps Script upserts by ID; preserves staff notes and existing formulas; strings cannot execute as formulas',()=>{
 const h=harness();h.values[6][0]=ID;h.values[6][10]='Staff reviewer';h.values[6][12]='Keep these review notes';
 const original=h.formulas[6][16];const record={'Listing ID':ID,'Listing title':'=HYPERLINK("bad")','Reviewer':'overwrite','Review notes':'overwrite','Expires at':0,'Status':'Submitted'};
 assert.equal(h.ctx.dhListingUpsert_({tab:'Listings',record,revision:1}).row,7);
 assert.equal(h.values[6][10],'Staff reviewer');assert.equal(h.values[6][12],'Keep these review notes');assert.equal(h.formulas[6][16],original);assert.equal(h.values[6][2],"'=HYPERLINK(\"bad\")");
 h.ctx.dhListingUpsert_({tab:'Listings',record:{...record,Status:'Approved'},revision:2});assert.equal(h.values.flat().filter(v=>v===ID).length,1);assert.equal(h.values[6][11],'Approved');
 assert.equal(h.ctx.dhListingUpsert_({tab:'Listings',record,revision:1}).stale,true);assert.equal(h.values[6][11],'Approved','Delayed old lease cannot regress the sheet');
 assert.throws(()=>h.ctx.dhListingUpsert_({tab:'Listings',record:{...record,privateCoordinates:'secret'}}),/LISTING_SHEET_VALUE/);
 h.values[7][0]=ID;assert.throws(()=>h.ctx.dhListingUpsert_({tab:'Listings',record}),/DUPLICATE_ID/);
});
test('new rows extend table, named range and filter without losing filter criteria; copy formula columns only',()=>{
 const h=harness();h.values[6][0]='occupied';h.values[7][0]='occupied';h.values[8][0]='occupied';
 assert.equal(h.ctx.dhListingUpsert_({tab:'Listings',record:{'Listing ID':ID,Status:'Submitted'},revision:1}).row,10);
 const q=h.batches[0];assert.ok(q.find(r=>r.appendDimension));assert.equal(q.find(r=>r.updateTable).updateTable.table.range.endRowIndex,10);assert.equal(q.find(r=>r.updateNamedRange).updateNamedRange.namedRange.range.endRowIndex,10);
 assert.deepEqual(q.find(r=>r.setBasicFilter).setBasicFilter.filter.criteria,{'11':{hiddenValues:['Declined']}});
 assert.equal(q.filter(r=>r.copyPaste?.pasteType==='PASTE_FORMULA').length,6);
});
test('ambiguous mail is never resent; only approved synthetic recipient can receive a test',()=>{
 const h=harness(),payload={idempotencyKey:'renewal:'+ID+':22222222-2222-4222-8222-222222222222:7',recipient:'approved@example.test',synthetic:true,listingId:ID,title:'SYNTHETIC',expiresAt:'2026-12-01T00:00:00Z'};
 assert.throws(()=>h.ctx.dhListingReminder_({...payload,recipient:'real-customer@example.test'},false),/TEST_RECIPIENT_REQUIRED/);assert.equal(h.sends(),0);
 h.uncertain();assert.equal(h.ctx.dhListingReminder_(payload,false).outcome,'Uncertain');assert.equal(h.ctx.dhListingReminder_(payload,false).outcome,'Uncertain');assert.equal(h.sends(),1);
 assert.equal(h.ctx.dhListingReminder_(payload,true).outcome,'Uncertain');assert.equal(h.sends(),1);
});

test('agent tracking header setup is additive and idempotent, with no formula or data writes',()=>{
 const h=harness();const headers=[...h.headers];const requests:any[]=[];
 h.ctx.dhListingSchema_=()=>({Listings:{headers,sheet:{getMaxColumns:()=>60,getSheetId:()=>10}}});
 h.ctx.dhListingGoogle_=(_method:string,_path:string,body:any)=>{requests.push(...body.requests);for(const req of body.requests){const u=req.updateCells;if(u)u.rows[0].values.forEach((cell:any,index:number)=>headers[u.range.startColumnIndex+index]=cell.userEnteredValue.stringValue);}return {};};
 assert.equal(h.ctx.listingAgentTrackingSetup().added,6);assert.equal(h.ctx.listingAgentTrackingSetup().added,0);
 assert.equal(requests.length,1);assert.equal(requests[0].updateCells.range.startRowIndex,5);assert.equal(requests[0].updateCells.range.startColumnIndex,h.headers.length);
 assert.deepEqual(headers.slice(0,h.headers.length),[...h.headers]);assert.equal(headers.filter(name=>name==='Assigned agent ID').length,1);assert.ok(h.formulas[6][16]);
});
test('agent sheet schema gaps hold only the agent sync job, without writing a partial row or changing formulas',()=>{
 const h=harness();const original=h.formulas[6][16];
 assert.throws(()=>h.ctx.dhListingUpsert_({tab:'Listings',record:{'Listing ID':ID,'Submitting agent ID':'synthetic-agent'},revision:1}),/LISTING_AGENT_SHEET_SCHEMA_REQUIRED/);
 assert.equal(h.batches.length,0);assert.equal(h.formulas[6][16],original);assert.equal(h.values[6][0],'');
});
