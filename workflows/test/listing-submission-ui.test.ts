import {test} from 'node:test';import assert from 'node:assert/strict';
// @ts-ignore browser ESM module
import {createListingSubmission} from '../website/listing-submission.js';
function harness(service:any,valid=true){
 let draft:any={id:'synthetic-draft',title:'Retain my entered title',email:'approved@example.test',selection:{listingPurpose:'buy'},price:'25000000',currency:'LKR'},cursor=0;const states:any[]=[];
 const React:any={Fragment:'fragment',createElement:(type:any,props:any,...children:any[])=>({type,props:{...props,children}}),useState:(value:any)=>{const i=cursor++;if(!(i in states))states[i]=value;return[states[i],(next:any)=>states[i]=typeof next==='function'?next(states[i]):next];},useRef:(value:any)=>{const i=cursor++;return states[i]||=( {current:value});}};
 const Component=createListingSubmission(React,service),text=(v:any):string=>Array.isArray(v)?v.map(text).join(''):v&&typeof v==='object'?text(v.props?.children):String(v??'');
 const nodes=()=>{cursor=0;const result:any[]=[];const walk=(n:any)=>{if(Array.isArray(n))n.forEach(walk);else if(n&&typeof n==='object'){result.push(n);walk(n.props?.children);}};walk(Component({draft,valid,onDraftChange:(update:any)=>draft=update(draft)}));return result;};
 return{nodes,text:()=>nodes().map(text).join(' '),button:(label:string)=>nodes().find(n=>n.type==='button'&&text(n)===label),get draft(){return draft;}};
}
test('actual submission UI waits for durable confirmation; a failed request retains the draft and retry key',async()=>{
 let fail=true;const keys:string[]=[];let resolve:any;const pending=new Promise(r=>resolve=r);
 const service={ready:true,signedIn:()=>true,submit:async(_d:any,key:string)=>{keys.push(key);if(fail)throw{code:'CONNECTION_FAILED'};return pending;}};
 const h=harness(service);await h.button('Submit listing for review').props.onClick();assert.match(h.text(),/draft is retained/);assert.equal(h.draft.title,'Retain my entered title');assert.ok(h.draft.submissionRequestKey);
 fail=false;const saving=h.button('Submit listing for review').props.onClick();assert.equal(h.text().includes('Listing stored for review'),false);assert.equal(h.button('Submit listing for review').props.disabled,true);
 resolve({listing:{listingId:'TEST-DHL-receipt',status:'submitted',submittedAt:'2026-11-13T00:00:00Z',version:1}});await saving;
 assert.equal(keys[0],keys[1]);assert.match(h.text(),/Listing stored for review/);assert.equal(h.draft.submissionListingId,'TEST-DHL-receipt');assert.equal(h.draft.title,'Retain my entered title');
});
test('actual submission UI does not offer a valid submit action until required fields and confirmations pass',()=>{
 const h=harness({ready:true,signedIn:()=>true},false);assert.equal(h.button('Submit listing for review').props.disabled,true);
});
