import test from 'node:test';
import assert from 'node:assert/strict';
import {forgetNativeShippingApproval,nativeShippingApproval,rememberNativeShippingApproval} from '../lib/shipping-authority.mjs';

test('la autoridad nativa queda ligada a root, sesión, Work e intent y no acepta bearer del caller',()=>{
  const intent={id:'SHIP-1',snapshotSha256:'a'.repeat(64),actions:['create_commit'],approval:{approvedAt:'2026-10-04T00:00:00.000Z'}};
  const input={root:'/workspace/a',sessionID:'session-a',workId:'WORK-1',intent,workContractSha256:'b'.repeat(64)};
  const result=rememberNativeShippingApproval(input);
  assert.deepEqual(result,{intentId:'SHIP-1',snapshotSha256:intent.snapshotSha256,actions:['create_commit']});
  assert.deepEqual(nativeShippingApproval({root:'/workspace/a',sessionID:'session-a',workId:'WORK-1',intentId:'SHIP-1'}),{intent,workContractSha256:'b'.repeat(64),approvedAt:intent.approval.approvedAt});
  assert.equal(nativeShippingApproval({root:'/workspace/b',sessionID:'session-a',workId:'WORK-1',intentId:'SHIP-1'}),null);
  assert.equal(nativeShippingApproval({root:'/workspace/a',sessionID:'session-b',workId:'WORK-1',intentId:'SHIP-1'}),null);
  assert.equal(nativeShippingApproval({root:'/workspace/a',sessionID:'session-a',workId:'WORK-2',intentId:'SHIP-1'}),null);
  assert.equal(forgetNativeShippingApproval({root:'/workspace/a',sessionID:'session-a',workId:'WORK-1',intentId:'SHIP-1'}),true);
  assert.equal(nativeShippingApproval({root:'/workspace/a',sessionID:'session-a',workId:'WORK-1',intentId:'SHIP-1'}),null);
});

test('re-autorización tras reinicio de proceso recupera cache de sesión para intent ya aprobado',()=>{
  const approvedIntent={id:'SHIP-2',status:'approved',snapshotSha256:'c'.repeat(64),actions:['create_commit','push_branch'],approval:{status:'user_reported',approvedAt:'2026-10-04T01:00:00.000Z',snapshotSha256:'c'.repeat(64),actions:['create_commit','push_branch']}};
  const restored=rememberNativeShippingApproval({root:'/workspace/c',sessionID:'new-session',workId:'WORK-2',intent:approvedIntent,workContractSha256:'d'.repeat(64)});
  assert.deepEqual(restored,{intentId:'SHIP-2',snapshotSha256:'c'.repeat(64),actions:['create_commit','push_branch']});
  assert.deepEqual(nativeShippingApproval({root:'/workspace/c',sessionID:'new-session',workId:'WORK-2',intentId:'SHIP-2'}),{intent:approvedIntent,workContractSha256:'d'.repeat(64),approvedAt:'2026-10-04T01:00:00.000Z'});
});
