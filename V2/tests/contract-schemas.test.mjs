import test from 'node:test';
import assert from 'node:assert/strict';
import {schema,assertSchema} from '../lib/schema.mjs';

test('Discovery y Shipping nuevas acciones tienen ramas input cerradas, sin fallback genérico',()=>{
  const actionSchema=schema('work-update').properties.actions.items;
  const added=['discovery.context.set','discovery.source.add','discovery.claim.add','discovery.assumption.add','discovery.question.add','discovery.decision.add','discovery.assumption.resolve','discovery.question.answer','discovery.decision.supersede','shipping.intent.record','shipping.approval.record','shipping.intent.invalidate','shipping.receipt.record'];
  for(const type of added){const branches=actionSchema.anyOf.filter(branch=>branch.properties?.type?.const===type);assert.equal(branches.length,1,type);assert.equal(branches[0].additionalProperties,false,type);}
  const fallback=actionSchema.anyOf.find(branch=>branch.properties?.type?.enum);for(const type of added)assert.equal(fallback.properties.type.enum.includes(type),false,type);
  assert.throws(()=>assertSchema('work-update',{workId:'X-1',expectedRevision:1,actions:[{type:'discovery.question.answer',questionId:'Q-1',answer:{text:'x',kind:'investigated',sourceIds:[],reportedAt:'2026-10-04T00:00:00.000Z',unexpected:true}}]}),/no coincide/);
});

test('Discovery source input accepts observation metadata but never a caller fingerprint',()=>{
  const action=schema('work-update').properties.actions.items.anyOf.find(branch=>branch.properties?.type?.const==='discovery.source.add').properties.source;
  const stored=schema('discovery').properties.sources.items.properties;
  assert.equal(action.properties.inspection.enum.join(','),'found,read,contrasted,stale,unknown,absent');
  assert.equal(action.properties.path.type,'string');assert.equal(action.properties.fileSha256,undefined);
  assert.equal(stored.fileSha256.pattern,'^[a-f0-9]{64}$');
});

test('Shipping standalone stored/input schemas y ramas de mutación comparten propiedades/requeridos',()=>{
  const work=schema('work').properties.shipping.properties;
  const intent=schema('shipping-intent'),receipt=schema('shipping-receipt');
  assert.deepEqual(intent.properties,work.intents.items.properties);
  assert.deepEqual(intent.required,work.intents.items.required);
  assert.deepEqual(receipt.properties,work.receipts.items.properties);
  assert.deepEqual(receipt.required,work.receipts.items.required);
  const input=schema('shipping-intent-input');
  const action=schema('work-update').properties.actions.items.anyOf.find(branch=>branch.properties?.type?.const==='shipping.intent.record').properties.intent;
  assert.deepEqual(input.properties,action.properties);assert.deepEqual(input.required,action.required);
});
