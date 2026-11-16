import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createHash} from 'node:crypto';

const source=readFileSync(new URL('../apps-script/AuthEmail.gs',import.meta.url),'utf8');
function harness(){
 const properties=new Map<string,string>();const sent:unknown[]=[];let failOnce=false;
 const context={Date,JSON,String,Array,Object,Set,Error,RegExp,Number,PropertiesService:{getScriptProperties:()=>({
  getKeys:()=>Array.from(properties.keys()),getProperty:(key:string)=>properties.get(key)||null,
  setProperty:(key:string,value:string)=>properties.set(key,value),deleteProperty:(key:string)=>properties.delete(key),
 })},hash:(v:string)=>createHash('sha256').update(v).digest('hex'),
 fail:(code:string,status:number)=>{throw Object.assign(new Error(code),{publicCode:code,httpStatus:status});},
 MailApp:{getRemainingDailyQuota:()=>100,sendEmail:(message:unknown)=>{sent.push(message);if(failOnce){failOnce=false;throw Error('private provider detail');}}}};
 runInNewContext(source,context);
 return {send:(payload:unknown)=>(context as any).dhAuthEmail_(payload),sent,properties,failOnce:()=>{failOnce=true;}};
}
const message={to:'owner@example.test',subject:'DwellHunt code',textBody:'Your code is 123456',htmlBody:'<p>Your code is <b>123456</b></p>'};

test('Apps Script auth delivery sends once and deduplicates by signed hook id and recipient',()=>{
 const h=harness(),payload={hookId:'msg_auth_test_1',messages:[message]};
 assert.equal(h.send(payload).outcome,'Delivered');assert.equal(h.sent.length,1);
 assert.equal(h.send(payload).duplicate,true);assert.equal(h.sent.length,1);
});

test('Apps Script auth delivery holds ambiguous sends instead of replaying a one-time code',()=>{
 const h=harness(),payload={hookId:'msg_auth_test_2',messages:[message]};h.failOnce();
 assert.equal(h.send(payload).outcome,'Uncertain');assert.equal(h.sent.length,1);
 assert.equal(h.send(payload).outcome,'Uncertain');assert.equal(h.sent.length,1);
});

test('Apps Script auth gateway validates message count, destination and body sizes before MailApp',()=>{
 const h=harness();
 assert.throws(()=>h.send({hookId:'msg_auth_test_3',messages:[{...message,to:'bad'}]}),/AUTH_EMAIL_INVALID_REQUEST/);
 assert.throws(()=>h.send({hookId:'msg_auth_test_4',messages:Array(3).fill(message)}),/AUTH_EMAIL_INVALID_REQUEST/);
 assert.equal(h.sent.length,0);
});

