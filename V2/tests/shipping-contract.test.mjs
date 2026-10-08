import test from 'node:test';
import assert from 'node:assert/strict';
import {repo,ready,readWork} from './helpers.mjs';
import {applyWorkMutation} from '../lib/work-mutations.mjs';
import {closeWork,history} from '../lib/artifacts.mjs';
import {compareShippingSnapshot} from '../lib/contracts.mjs';

const H=(ch,n=40)=>ch.repeat(n),D=new Date().toISOString();
function preview(){return {schemaVersion:1,id:'SHIP-1',createdAt:D,repository:'owner/repo',branch:'feat/change',remote:'origin',base:'main',title:'Ship change',body:'Summary',commitMessage:'feat: change',headSha:H('a'),diffSha256:H('b',64),contentSha256:H('c',64),snapshotSha256:H('d',64),workScope:['src/value.mjs'],expectedPaths:['src/value.mjs'],evidenceIds:['E-1'],includedCommitShas:[],actions:['create_commit','push_branch','create_pr'],status:'previewed'};}
function receipt({id,action,status='succeeded',before,after,beforeSnapshot,observedSnapshot,branch,url}){return {schemaVersion:1,id,intentId:'SHIP-1',observedAt:new Date().toISOString(),action,status,beforeHeadSha:before,afterHeadSha:after,beforeSnapshotSha256:beforeSnapshot,observedSnapshotSha256:observedSnapshot,contentSha256:H('c',64),snapshotSha256:H('d',64),...(branch?{pushedBranch:branch}:{}),...(url?{prUrl:url}:{}),summary:`Observed ${action}`};}

test('Closed done Work can append Ship checkpoints without changing closure or history',t=>{
  const root=repo(t);ready(root,'SHIP-WORK');closeWork(root,'SHIP-WORK',{summary:'Acceptance verified'});
  const closureBefore=readWork(root,'SHIP-WORK').closure,historyBefore=history(root),rev=readWork(root,'SHIP-WORK').revision;
  let r=applyWorkMutation(root,{workId:'SHIP-WORK',expectedRevision:rev,actions:[{type:'shipping.intent.record',intent:preview()}]});
  let work=readWork(root,'SHIP-WORK'),intent=work.shipping.intents[0];assert.equal(intent.sourceWorkRevision,rev);assert.equal(intent.checkpointHeadSha,H('a'));
  assert.equal(intent.workContractSha256,work.shipping.intents[0].workContractSha256);
  assert.equal(compareShippingSnapshot(intent,{repository:'owner/repo',remote:'origin',branch:'feat/change',base:'main',headSha:H('a'),snapshotSha256:H('d',64),contentSha256:H('c',64),diffSha256:H('b',64),title:'Ship change',body:'Summary',commitMessage:'feat: change',actions:intent.actions,workScope:['src/value.mjs'],expectedPaths:['src/value.mjs'],evidenceIds:['E-1'],includedCommitShas:[],workContractSha256:intent.workContractSha256}).matches,true);
  assert.equal(compareShippingSnapshot(intent,{repository:'owner/repo',remote:'origin',branch:'feat/change',base:'main',headSha:H('a'),snapshotSha256:H('d',64),contentSha256:H('e',64),diffSha256:H('b',64),title:'Ship change',body:'Summary',commitMessage:'feat: change',actions:intent.actions,workScope:['src/value.mjs'],expectedPaths:['src/value.mjs'],evidenceIds:['E-1'],includedCommitShas:[]}).matches,false);
  r=applyWorkMutation(root,{workId:'SHIP-WORK',expectedRevision:r.revision,actions:[{type:'shipping.approval.record',intentId:intent.id,snapshotSha256:intent.snapshotSha256,actions:intent.actions,approvedAt:D}]});
  const approved=readWork(root,'SHIP-WORK').shipping.intents[0].approval;
  const commit=receipt({id:'RC-1',action:'create_commit',before:H('a'),after:H('e'),beforeSnapshot:H('d',64),observedSnapshot:H('f',64)});
  r=applyWorkMutation(root,{workId:'SHIP-WORK',expectedRevision:r.revision,actions:[{type:'shipping.receipt.record',receipt:commit}]});
  work=readWork(root,'SHIP-WORK');intent=work.shipping.intents[0];assert.equal(intent.checkpointHeadSha,H('e'));assert.deepEqual(intent.approval,approved);
  const push=receipt({id:'RC-2',action:'push_branch',before:H('e'),after:H('e'),beforeSnapshot:H('f',64),observedSnapshot:H('1',64),branch:'feat/change'});
  r=applyWorkMutation(root,{workId:'SHIP-WORK',expectedRevision:r.revision,actions:[{type:'shipping.receipt.record',receipt:push}]});
  const pr=receipt({id:'RC-3',action:'create_pr',before:H('e'),after:H('e'),beforeSnapshot:H('1',64),observedSnapshot:H('2',64),url:'https://example.invalid/pr/1'});
  applyWorkMutation(root,{workId:'SHIP-WORK',expectedRevision:r.revision,actions:[{type:'shipping.receipt.record',receipt:pr}]});
  work=readWork(root,'SHIP-WORK');assert.equal(work.shipping.intents[0].status,'completed');assert.equal(work.status,'done');assert.deepEqual(work.closure,closureBefore);assert.deepEqual(history(root),historyBefore);
  assert.deepEqual(work.shipping.intents[0].approval,approved);
});

test('Shipping rejects receipts with unexpected content, wrong checkpoint, or duplicate successful operation',t=>{
  const root=repo(t);ready(root,'SHIP-GUARD');closeWork(root,'SHIP-GUARD',{summary:'Acceptance verified'});
  let r=applyWorkMutation(root,{workId:'SHIP-GUARD',expectedRevision:3,actions:[{type:'shipping.intent.record',intent:preview()}]});
  r=applyWorkMutation(root,{workId:'SHIP-GUARD',expectedRevision:r.revision,actions:[{type:'shipping.approval.record',intentId:'SHIP-1',snapshotSha256:H('d',64),actions:['create_commit','push_branch'],approvedAt:D}]});
  const wrong=receipt({id:'BAD-1',action:'create_commit',before:H('a'),after:H('e'),beforeSnapshot:H('d',64),observedSnapshot:H('f',64)});wrong.contentSha256=H('9',64);
  assert.throws(()=>applyWorkMutation(root,{workId:'SHIP-GUARD',expectedRevision:r.revision,actions:[{type:'shipping.receipt.record',receipt:wrong}]}),/checkpoint\/contenido/);
  const good=receipt({id:'RC-1',action:'create_commit',before:H('a'),after:H('e'),beforeSnapshot:H('d',64),observedSnapshot:H('f',64)});
  r=applyWorkMutation(root,{workId:'SHIP-GUARD',expectedRevision:r.revision,actions:[{type:'shipping.receipt.record',receipt:good}]});
  assert.throws(()=>applyWorkMutation(root,{workId:'SHIP-GUARD',expectedRevision:r.revision,actions:[{type:'shipping.receipt.record',receipt:{...good,id:'RC-2'}}]}),/siguiente=push_branch/);
});
