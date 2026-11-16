import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const { createOwnerDraft } = await import(new URL('../website/owner-listing-model.js', import.meta.url).href);
const source = readFileSync(new URL('../website/app.js', import.meta.url), 'utf8');
// Exercise the actual shipped component; no duplicate implementation of its state logic.
const component = source.slice(source.lastIndexOf('Zn=()=>'), source.lastIndexOf('Qn=()=>')).replace(/,$/, '');
type Node = { type: string; props: any };
function harness() {
  const state: any[] = [];
  let account: any = null;
  let cursor = 0, submitted: any, stored: any[] = [];
  const agency = { id: 'test-agency', name: 'Test agency' };
  const agent = { id: 'test-agent', agencyId: agency.id };
  const storeStart = source.indexOf('addProperty:e=>') + 'addProperty:'.length;
  const store = source.slice(storeStart, source.indexOf(',deleteProperty:', storeStart));
  const addProperty = runInNewContext('(' + store + ')', { n: (update: any) => { stored = update(stored); } });
  const factory = runInNewContext('(' + component.slice(3) + ')', {
    _: { useState: (initial: any) => {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (value: any) => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    } },
    x: { jsx: (type: string, props: any) => ({ type, props }), jsxs: (type: string, props: any) => ({ type, props }) },
    C: () => ({ agencies: [agency], agents: [agent], addProperty: (data: any) => { submitted = data; return addProperty(data); }, navigateToProperty: () => {}, setCurrentView: () => {} }),
    listingService: {account:()=>account}, dhOwnerListing: 'owner-component', dhAgentListing: 'agent-component', createOwnerDraft, $e: 'icon', ge: 'icon', cn: 'icon', Ze: 'icon', Kn: () => {},
  });
  function nodes() {
    cursor = 0;
    const result: Node[] = [];
    function visit(node: any) {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node || typeof node !== 'object') return;
      result.push(node); visit(node.props?.children);
    }
    visit(factory()); return result;
  }
  function text(node: any): string {
    if (Array.isArray(node)) return node.map(text).join('');
    return node && typeof node === 'object' ? text(node.props?.children) : String(node ?? '');
  }
  const button = (name: string) => nodes().find(node => node.type === 'button' && text(node) === name)!;
  const select = (name: string, value: string) => nodes().find(node => node.type === 'input' && node.props.name === 'listing-' + name && node.props.value === value)!.props.onChange();
  return { nodes, button, select, setAccount:(id:string)=>{account={id};}, get submitted() { return submitted; }, get stored() { return stored; } };
}

test('Step 1 requires all groups, retains one selection per group, and preserves the moved headline through Back', () => {
  const h = harness();
  assert.equal(h.nodes().filter(n => n.type === 'fieldset').length, 3);
  assert.equal(h.nodes().filter(n => n.type === 'input' && n.props.type === 'radio').length, 8);
  assert.equal(h.button('Continue').props.disabled, true);
  // The handler also guards against programmatic navigation with incomplete state.
  h.button('Continue').props.onClick();
  assert.ok(h.button('Continue'));
  h.select('role', 'developer'); h.select('purpose', 'buy');
  assert.equal(h.button('Continue').props.disabled, true);
  h.select('category', 'villa'); h.select('category', 'house');
  assert.equal(h.nodes().filter(n => n.props?.name === 'listing-category' && n.props.checked).length, 1);
  assert.equal(h.button('Continue').props.disabled, false);
  h.button('Continue').props.onClick();
  h.nodes().find(n => n.props?.id === 'dh-property-headline')!.props.onChange({ target: { value: 'Retained property title' } });
  h.button('Back').props.onClick();
  assert.deepEqual(h.nodes().filter(n => n.props?.checked).map(n => n.props.value), ['developer', 'buy', 'house']);
  assert.equal(h.nodes().some(n => n.props?.id === 'dh-property-headline'), false);
  h.button('Continue').props.onClick();
  assert.equal(h.nodes().find(n => n.props?.id === 'dh-property-headline')!.props.value, 'Retained property title');
});

test('changing category preserves role, purpose and their saved selected styling', () => {
  const h = harness();
  const checked = () => h.nodes().filter(n => n.type === 'input' && n.props.checked).map(n => n.props.value);
  const selectedCards = () => h.nodes().filter(n => n.type === 'label' && n.props['data-selected']);
  const count = () => h.nodes().find(n => n.props?.role === 'status')!.props.children.join('');
  const checkmarks = () => h.nodes().filter(n => n.props?.className === 'dh-listing-check');
  assert.equal(count(), '0 of 3 selected');
  assert.equal(checkmarks().length, 0);
  const names = h.nodes().filter(n => n.type === 'input' && n.props.type === 'radio').map(n => n.props.name);
  assert.equal(new Set(names).size, 3);
  h.select('role', 'owner'); h.select('purpose', 'buy'); h.select('category', 'villa');
  assert.deepEqual(checked(), ['owner', 'buy', 'villa']);
  assert.equal(selectedCards().length, 3);
  assert.equal(count(), '3 of 3 selected');
  assert.equal(checkmarks().length, 3);
  const before = selectedCards().slice(0, 2).map(n => n.props.className);
  h.select('category', 'house');
  assert.deepEqual(checked(), ['owner', 'buy', 'house']);
  assert.equal(selectedCards().length, 3);
  assert.deepEqual(selectedCards().slice(0, 2).map(n => n.props.className), before);
  h.button('Continue').props.onClick(); h.nodes().find(n => n.type === 'owner-component')!.props.onStart();
  assert.deepEqual(checked(), ['owner', 'buy', 'house']);
  assert.equal(selectedCards().length, 3);
  assert.equal(h.button('Continue').props.disabled, false);
  assert.equal(count(), '3 of 3 selected');
  assert.equal(checkmarks().length, 3);
});

test('unrelated developer submission flow retains its existing compatible values', () => {
  for (const role of ['developer']) for (const category of ['apartment', 'villa', 'house']) for (const purpose of ['buy', 'rent']) {
    const h = harness();
    h.select('role', role); h.select('purpose', purpose); h.select('category', category);
    for (const label of ['Continue', 'Continue to Specs', 'Continue to Amenities', 'Review & Publish']) h.button(label).props.onClick();
    h.button('Publish Listing to Marketplace Now').props.onClick({ preventDefault() {} });
    for (const item of [h.submitted, h.stored[0]]) {
      assert.equal(item.listingRole, role); assert.equal(item.purpose, purpose); assert.equal(item.category, category);
    }
  }
});


test('owner routes to its draft workflow without assigning an agency or publishing', () => {
  for (const category of ['apartment', 'villa', 'house']) for (const purpose of ['buy', 'rent']) {
    const h = harness(); h.select('role', 'owner'); h.select('purpose', purpose); h.select('category', category);
    h.button('Continue').props.onClick();
    const owner = h.nodes().find(n => n.type === 'owner-component')!;
    assert.equal(owner.props.draft.status, 'draft');
    assert.equal(owner.props.draft.selection.listingPurpose, purpose);
    assert.equal(owner.props.draft.selection.propertyCategory, category);
    assert.equal(owner.props.draft.ownerName, '');
    assert.equal(owner.props.draft.photos.length, 0);
    assert.equal(h.submitted, undefined); assert.equal(h.stored.length, 0);
    owner.props.onStart();
    assert.deepEqual(h.nodes().filter(n => n.props?.checked).map(n => n.props.value), ['owner', purpose, category]);
  }
});


test('agents route through authenticated shared workflow and never reach legacy mock publication',()=>{
 for(const category of ['apartment','villa','house'])for(const purpose of ['buy','rent']){
  const h=harness();h.select('role','agent');h.select('purpose',purpose);h.select('category',category);h.button('Continue').props.onClick();
  const agent=h.nodes().find(n=>n.type==='agent-component')!;assert.ok(agent);assert.equal(agent.props.selection.propertyCategory,category);assert.equal(agent.props.selection.listingPurpose,purpose);assert.equal(h.submitted,undefined);assert.equal(h.stored.length,0);
  agent.props.onStart();assert.deepEqual(h.nodes().filter(n=>n.props?.checked).map(n=>n.props.value),['agent',purpose,category]);
 }
});


test('returning to an owner form after an account switch cannot reopen its previous in-memory private draft',()=>{
 const h=harness();h.setAccount('11111111-1111-4111-8111-111111111111');h.select('role','owner');h.select('purpose','buy');h.select('category','apartment');h.button('Continue').props.onClick();
 const owner=h.nodes().find(n=>n.type==='owner-component')!;owner.props.onDraftChange((old:any)=>({...old,draftAccountId:'11111111-1111-4111-8111-111111111111',ownerName:'PRIVATE ACCOUNT A'}));owner.props.onStart();
 h.setAccount('22222222-2222-4222-8222-222222222222');h.button('Continue').props.onClick();assert.equal(h.nodes().find(n=>n.type==='owner-component')!.props.draft.ownerName,'');
});
