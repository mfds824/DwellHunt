import {isManagedListing} from '../website/listing-adapter.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const location = await import(new URL('../website/listing-location.js', import.meta.url).href);
const { ownerListingAdapter, isPublicListing, listingPrice } = await import(new URL('../website/listing-adapter.js', import.meta.url).href);
const { createOwnerDraft, publicOwnerListing, loadOwnerDraft, saveOwnerDraft } = await import(new URL('../website/owner-listing-model.js', import.meta.url).href);
const { createListingExtras } = await import(new URL('../website/listing-extras.js', import.meta.url).href);
function draft(category='apartment', purpose='buy') {
  return Object.assign(createOwnerDraft({listingRole:'owner',listingPurpose:purpose,propertyCategory:category}),{
    privateLocation:{lat:6.912345,lng:79.876543,confirmed:true},street:'Private exact street',unit:'Private unit 12',ownerName:'Private owner',email:'private@example.test',enquiryDestination:'private-route@example.test',
    city:'Public area',district:'Colombo',building:'Permitted project',publicBuildingName:true,title:'Permitted project – Studio Apartment',apartmentType:'studio',
    bedrooms:'0',bathrooms:'1',parking:'0',floorArea:'100',floorUnit:'sqm',price:'75000000',description:'Entered description',publicName:'Public Owner',publicMethods:['whatsapp'],publicPhone:'+94771234567',
    photos:[{id:'a',url:'https://res.cloudinary.com/xx8yy8mw/image/upload/a.jpg',status:'ready'},{id:'b',url:'https://res.cloudinary.com/xx8yy8mw/image/upload/b.jpg',status:'ready'}]
  });
}
test('adapter maps supplied owner facts to original listing contract without agency, valuation or private fields',()=>{
  const d=draft();const p=ownerListingAdapter(d);
  assert.equal(p.listingRole,'owner'); assert.equal(p.contact.displayName,'Public Owner');assert.equal(p.contact.whatsapp,d.publicPhone);
  assert.equal(p.floorUnit,'sqm');assert.equal(p.floorArea,100);assert.ok(Math.abs(p.floorAreaSqFt-1076.391)<0.01);
  assert.equal(p.parkingSpaces,0);assert.equal(p.bedrooms,0);assert.equal(p.priceUSD,undefined);assert.equal(p.agencyId,undefined);assert.equal(p.agentName,undefined);assert.equal(p.aiValuation,undefined);
  const json=JSON.stringify(p); for(const privateValue of [d.street,d.unit,d.ownerName,d.email,d.enquiryDestination,'6.912345','79.876543']) assert.equal(json.includes(privateValue),false,privateValue);
  assert.deepEqual(p.images,d.photos.map((p:any)=>p.url));
});
test('missing optional values stay unknown, and every supported category uses supplied photos only',()=>{
  for(const category of ['apartment','villa','house']){
    const d=createOwnerDraft({listingRole:'owner',listingPurpose:'buy',propertyCategory:category}); const p=ownerListingAdapter(d);
    assert.deepEqual(p.images,[]);assert.equal(p.bedrooms,undefined);assert.equal(p.parkingSpaces,undefined);assert.equal(p.coordinates,null);assert.equal(p.price,undefined);
    assert.equal(listingPrice(p,'LKR',()=>''),'Price not provided');
  }
});
test('cover order, 8-photo boundary and all rental billing periods are retained by the adapter',()=>{
  const d=draft(); d.photos.reverse();assert.equal(ownerListingAdapter(d).images[0],d.photos[0].url);
  for(const period of ['night','week','month','year']){ d.selection.listingPurpose='rent';d.billingPeriod=period;assert.match(listingPrice(ownerListingAdapter(d),'USD',()=>''),new RegExp('/ '+period+'$')); }
  assert.equal(listingPrice({price:42},'USD',()=> 'legacy display'),'legacy display');
});
test('only published owner listings enter public inventory; drafts and submissions remain separate',()=>{
  const d=draft(); for(const status of ['draft','submitted']) assert.equal(isPublicListing(ownerListingAdapter(d,status)),false);
  assert.equal(isPublicListing(ownerListingAdapter(d,'published')),true);assert.equal(isPublicListing({id:'legacy'}),true);
});
test('map edits invalidate confirmation and nearby data; exact and public area positions are separate',()=>{
  const d=draft();const coarse=location.publicPosition(d);assert.notEqual(coarse.lat,d.privateLocation.lat);assert.equal(coarse.approximate,true);
  d.locationPrecision='exact';assert.equal(location.publicPosition(d).lat,d.privateLocation.lat);
  const edited=location.updatePrivateLocation({...d,nearby:{results:[]}}, {lat:'6.8'});assert.equal(edited.privateLocation.confirmed,false);assert.equal(edited.nearby,null);assert.equal(location.publicPosition(edited),null);
  assert.equal(location.confirmPrivateLocation(edited).privateLocation.confirmed,true);
  assert.throws(()=>location.confirmPrivateLocation({...d,privateLocation:{lat:91,lng:1}}),/valid/);
  assert.equal(location.validPosition({lat:0,lng:0}),true);assert.equal(location.validPosition({lat:'',lng:''}),false);
});
test('nearby normalization rejects unsupported hospital ownership and road-as-jogging claims',()=>{
  const d=draft(),origin=location.publicPosition(d),key=location.locationKey(d);
  const base={name:'Test fixture only',lat:6.92,lng:79.88,source:'Test provider fixture',evidence:'Test classification'};
  const places=location.normalizePlaces([
    {...base,category:'private_hospital',ownership:'public'}, {...base,category:'walking',placeType:'road'},
    {...base,id:'park',category:'walking',placeType:'park'}, {...base,id:'hospital',category:'private_hospital',ownership:'private'}, {...base,id:'market',category:'supermarket'}
  ],origin,key);
  assert.equal(places.results.length,3);assert.equal(places.results[0].distanceType,'straight-line');assert.equal(places.results[0].approximate,true);
  d.nearby=places;assert.deepEqual(location.publicNearby(d),[]);places.results[0].approved=true;
  const pub=location.publicNearby(d);assert.equal(pub.length,1);assert.equal(pub[0].approximate,true);assert.equal(pub[0].mapUrl.includes('6.912345'),false);
  d.locationPrecision='exact';assert.deepEqual(location.publicNearby(d),[]);
});
test('configured requests use only explicit public nearby position; missing providers and quota failures do not return mock places',async()=>{
  assert.equal(location.mapsConnection({}).searchUrl,null);assert.equal(location.mapsConnection({}).nearbyUrl,null);
  const d=draft();let sent:any;
  const body={position:location.publicPosition(d),categories:['supermarket']};
  await location.requestMapService('https://maps.example.test/nearby',body,{fetcher:async(_url:any,init:any)=>{sent=JSON.parse(init.body);return {ok:true,json:async()=>({results:[]})};}});
  assert.equal(JSON.stringify(sent).includes('6.912345'),false);assert.equal(sent.position.approximate,true);
  await assert.rejects(location.requestMapService(null,body),/connected server/);
  await assert.rejects(location.requestMapService('https://maps.example.test/nearby',body,{fetcher:async()=>({ok:false,status:429})}),/limit/);
  assert.equal(d.privateLocation.confirmed,true);
});
// Exercise the real compiled renderers; the owner workflow injects these same functions.
const app=readFileSync(new URL('../website/app.js',import.meta.url),'utf8');
function rendered(d:any, kind='page') {
  const p=ownerListingAdapter(d); const start=app.indexOf(kind==='page'?'Jn=({':'jn=({');
  const end=app.indexOf(kind==='page'?'},Yn=':'},Mn=',start);
  const component=app.slice(start,end+1);
  const x={jsx:(type:any,props:any)=>({type,props}),jsxs:(type:any,props:any)=>({type,props})};
  const React={createElement:(type:any,props:any,...children:any[])=>({type,props:{...props,children}})};
  const context:any={x,isManagedListing,_:{useState:(v:any)=>[v,()=>{}]},C:()=>({selectedPropertyId:'',properties:[],agencies:[],agents:[],currency:'LKR',setCurrentView(){},toggleSaveProperty(){},isPropertySaved:()=>false,toggleCompareProperty(){},comparePropertyIds:[],navigateToProperty(){},navigateToAgency(){}}),An:()=>'',dhListingExtras:createListingExtras(React,{person:'person-icon'})};
  for(const name of ['me','$t','qt','ct','tn','R','Un','we','Se','un','hn','Ve','Le','fe','Ue','cn','Yt','ut','Ne','rn','Vn','Wn','qn','jn','ke','qe','Ye','it'])context[name]=name;
  const fn=runInNewContext('('+component.slice(component.indexOf('=')+1)+')',context);
  const tree=fn({property:p,preview:true}); const nodes:any[]=[];
  const visit=(n:any)=>{if(Array.isArray(n))return n.forEach(visit);if(n&&typeof n==='object'){nodes.push(n);visit(n.props?.children)}};visit(tree);return {nodes,p};
}
test('existing page and owner preview share gallery, overview, safe contact and map components',()=>{
  const {nodes,p}=rendered(draft());assert.ok(nodes.some(n=>n.type==='Un'&&n.props.images.length===2));
  assert.ok(nodes.some(n=>n.type==='Vn'&&n.props.properties[0].coordinates.approximate));
  assert.ok(nodes.some(n=>n.type?.name==='OwnerContact'&&n.props.preview));assert.equal(nodes.some(n=>n.type==='qn'),false);
  assert.equal(nodes.some(n=>n.props?.children==='Property Overview & Dimensions'),true);
  assert.equal(nodes.some(n=>n.type==='Wn'),false); assert.equal(p.agencyName,undefined);
});
test('original card renderer safely handles missing owner images, unknown values and absent agency',()=>{
  const d=createOwnerDraft({listingRole:'owner',listingPurpose:'buy',propertyCategory:'house'});
  const {nodes}=rendered(d,'card');assert.ok(nodes.some(n=>n.type?.name==='EmptyPhoto'));assert.ok(nodes.some(n=>n.type?.name==='OwnerBadge'));
});

test('private coordinates and copied private address/contact text cannot reappear through public descriptions or features',()=>{
 const d=draft(); d.description=[d.street,d.email,String(d.privateLocation.lat),d.unit].join(' ');d.features=[d.street];
 const output=JSON.stringify(publicOwnerListing(d));
 for(const value of [d.street,d.email,String(d.privateLocation.lat),d.unit]) assert.equal(output.includes(value),false);
 d.locationPrecision='exact'; assert.equal(publicOwnerListing(d).location.position.lat,d.privateLocation.lat);
});
test('real shared map initializes owner and legacy basemaps without mixing private coordinates or shadowing its property array',()=>{
 const start=app.indexOf('Vn=({properties:');const component=app.slice(start,app.indexOf('},Hn=',start)+1);
 for(const owner of [true,false]){
  const effects:any[]=[];const refs:any[]=[];let layerUrl='';let drawn:any;let mapOptions:any;let boundsOptions:any;
  const layer={addTo(){return layer;},remove(){},bindPopup(){return layer;},on(){return layer;}};
  const map={remove(){},fitBounds(_bounds:any,options:any){boundsOptions=options;}};
  const L={map:(_node:any,options:any)=>{mapOptions=options;return map;},tileLayer:(url:string)=>{layerUrl=url;return layer;},latLngBounds:()=>({extend:(p:any)=>{drawn=p},isValid:()=>true}),divIcon:()=>({}),marker:()=>layer,circle:()=>layer};
  const x={jsx:(type:any,props:any)=>{if(props.ref)props.ref.current={};return {type,props};},jsxs:(type:any,props:any)=>({type,props})};
  const context={x,isManagedListing,_:{useRef:(v:any)=>{const r={current:v};refs.push(r);return r;},useEffect:(f:any)=>effects.push(f)},C:()=>({currency:'LKR',navigateToProperty(){}}),Bn:{default:L},An:()=>'',ownerTileOptions:location.ownerTileOptions,dhListingExtras:{price:()=> 'LKR 20M',mapPopup:()=>({})}};
  const fn=runInNewContext('('+component.slice(component.indexOf('=')+1)+')',context);
  const p=owner?ownerListingAdapter(draft()):{id:'legacy',images:[],title:'Legacy',city:'Colombo',district:'Colombo',coordinates:{lat:6.9,lng:79.8}};
  fn({properties:[p]});for(const effect of effects)effect();
  assert.equal(mapOptions.zoomAnimation,!owner);assert.equal(boundsOptions.animate,!owner);
  assert.match(layerUrl,owner?/tile.openstreetmap.org/:/cartocdn/);
  assert.deepEqual(Array.from(drawn),owner?[p.coordinates.lat,p.coordinates.lng]:[6.9,79.8]);
 }
});
