import test from 'node:test';
import assert from 'node:assert/strict';
import {buildShippingPreflight,buildShippingArgv,compareShippingSnapshot,computeShippingSnapshot} from '../lib/shipping.mjs';
import {observeShippingGit} from '../lib/shipping-snapshot.mjs';
import {bindEvidence,workContractDigest} from '../lib/contracts.mjs';
import {assertSchema} from '../lib/schema.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const sha='a'.repeat(64),head='b'.repeat(40),baseSha='c'.repeat(40);
function fixture(){
  const work={id:'SHIP-1',revision:4,status:'in_progress',closure:null,objective:{outcome:'Ship reviewed implementation',criteria:[{id:'AC-1',description:'Implementation works',verification:'automated checks pass',contractRevision:1,evidenceIds:['EV-1']}]},decisionsPending:[],discovery:{decisions:[],questions:[],assumptions:[]},tasks:[
    {id:'T-IMPL',kind:'implementation',status:'done',criterionIds:['AC-1'],dependsOn:[],writeScope:['src'],evidenceIds:['EV-1']},
    {id:'T-SHIP',kind:'shipping',status:'pending',criterionIds:['AC-1'],dependsOn:['T-IMPL'],writeScope:['src'],evidenceIds:[]}
  ],evidence:[],shipping:{schemaVersion:1,intents:[],receipts:[]}};
  const ev={id:'EV-1',kind:'executed',status:'pass',criterionIds:['AC-1'],taskIds:['T-IMPL'],files:[{path:'src/app.js',sha256:sha}]};
  ev.contractBindings=bindEvidence(work,ev);work.evidence=[ev];
  const request={repository:'owner/repo',remote:'origin',branch:'feature-safe',base:'main',title:'Ship it',body:'Review changes',commitMessage:'Ship implementation',actions:['create_commit','push_branch','create_pr'],expectedPaths:['src/app.js'],includedCommitShas:[]};
  const gitSnapshot={complete:true,filesComplete:true,rootVerified:true,pathSafetyVerified:true,targetResolved:true,observedAt:'2026-10-04T12:00:00.000Z',repository:'owner/repo',headRepository:'owner/repo',remote:'origin',branch:'feature-safe',base:'main',baseSha,headSha:head,diffSha256:sha,detached:false,localCommits:[],evidenceFiles:[{path:'src/app.js',sha256:sha}],evidenceFilesComplete:true,files:[{path:'src/app.js',sha256:sha,staged:false,unstaged:true,untracked:false,ignored:false}]};
  return {work,request,gitSnapshot};
}

function git(cwd,...args){
  const result=spawnSync('git',args,{cwd,encoding:'utf8',env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});
  if(result.status!==0)throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

test('readonly Git snapshot marks ignored files ignored, never staged',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sol-shipping-ignored-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  git(root,'init','-q','-b','main');
  git(root,'config','user.name','Sol Test');git(root,'config','user.email','sol-test@example.invalid');
  fs.writeFileSync(path.join(root,'README.md'),'fixture\n');
  git(root,'add','README.md');git(root,'commit','-qm','fixture');
  git(root,'remote','add','origin','https://github.com/owner/repo.git');
  git(root,'update-ref','refs/remotes/origin/main','HEAD');git(root,'switch','-qc','feature');
  fs.mkdirSync(path.join(root,'.sol'));
  fs.writeFileSync(path.join(root,'.sol/private.md'),'local-only\n');
  fs.writeFileSync(path.join(root,'.sol/state.json'),'state one\n');
  fs.writeFileSync(path.join(root,'.sol/history.jsonl'),'history one\n');
  fs.mkdirSync(path.join(root,'.sol/work','SHIP-IGNORED'),{recursive:true});
  fs.writeFileSync(path.join(root,'.sol/work','SHIP-IGNORED','work.json'),'work one\n');
  fs.appendFileSync(path.join(root,'.git/info/exclude'),'\n.sol/private.md\n');

  const snapshot=observeShippingGit({sessionRoot:root,request:{repository:'owner/repo',remote:'origin',branch:'feature',base:'main',expectedPaths:['README.md']},work:{id:'SHIP-IGNORED',evidence:[]}});
  const ignored=snapshot.files.find(file=>file.path==='.sol/private.md');
  assert.deepEqual({staged:ignored.staged,unstaged:ignored.unstaged,untracked:ignored.untracked,ignored:ignored.ignored},{staged:false,unstaged:false,untracked:false,ignored:true});
  fs.writeFileSync(path.join(root,'.sol/work','SHIP-IGNORED','work.json'),'work two\n');
  const afterWorkBookkeeping=observeShippingGit({sessionRoot:root,request:{repository:'owner/repo',remote:'origin',branch:'feature',base:'main',expectedPaths:['README.md']},work:{id:'SHIP-IGNORED',evidence:[]}});
  assert.equal(afterWorkBookkeeping.diffSha256,snapshot.diffSha256,'la metadata Work propia no invalida el snapshot de contenido');
  fs.writeFileSync(path.join(root,'.sol/unrelated.md'),'unapproved\n');
  const afterOtherUntracked=observeShippingGit({sessionRoot:root,request:{repository:'owner/repo',remote:'origin',branch:'feature',base:'main',expectedPaths:['README.md']},work:{id:'SHIP-IGNORED',evidence:[]}});
  assert.notEqual(afterOtherUntracked.diffSha256,snapshot.diffSha256,'otro archivo no rastreado sigue cambiando el snapshot');
});

test('builds schema-shaped preview, exact argv previews, no execution',()=>{
  const {work,request,gitSnapshot}=fixture();
  const result=buildShippingPreflight({work,expectedRevision:4,gitSnapshot,request});
  assert.deepEqual(result.blockers,[]);
  assert.doesNotThrow(()=>assertSchema('shipping-intent-input',result.intent));
  assert.equal(result.intent.status,'previewed');
  assert.equal(result.intent.contentSha256.length,64);
  assert.equal(result.argvPreview.length,4);
  assert.deepEqual(result.argvPreview[0],['git','--literal-pathspecs','add','--','src/app.js']);
  assert.deepEqual(result.argvPreview[1],['git','commit','-m','Ship implementation']);
  assert.deepEqual(result.argvPreview[3],['gh','pr','create','--repo','owner/repo','--base','main','--head','feature-safe','--title','Ship it','--body','Review changes']);
});

test('blocks stale revision, unverified root, unresolved destination, foreign and unsafe paths',()=>{
  const {work,request,gitSnapshot}=fixture();
  assert.match(buildShippingPreflight({work,expectedRevision:3,gitSnapshot,request}).blockers.join(' '),/Revisión obsoleta/);
  assert.match(buildShippingPreflight({work,expectedRevision:4,gitSnapshot:{...gitSnapshot,rootVerified:false},request}).blockers.join(' '),/root Git/);
  assert.match(buildShippingPreflight({work,expectedRevision:4,gitSnapshot:{...gitSnapshot,base:'other'},request}).blockers.join(' '),/no coincide/);
  assert.match(buildShippingPreflight({work,expectedRevision:4,gitSnapshot:{...gitSnapshot,headRepository:'fork/repo'},request}).blockers.join(' '),/fork|repositorios/i);
  const traversal={...gitSnapshot,files:[{path:'src/../outside',sha256:sha,unstaged:true}]};
  assert.match(buildShippingPreflight({work,expectedRevision:4,gitSnapshot:traversal,request}).blockers.join(' '),/inválido|fuera/);
  const changed={...gitSnapshot,files:[...gitSnapshot.files,{path:'elsewhere/x.js',sha256:sha,untracked:true}]};
  assert.match(buildShippingPreflight({work,expectedRevision:4,gitSnapshot:changed,request}).blockers.join(' '),/fuera del alcance|no coincide/);
});

test('requires current contract-bound evidence and fresh observed file hashes',()=>{
  const {work,request,gitSnapshot}=fixture();
  const stale={...gitSnapshot,evidenceFiles:[{path:'src/app.js',sha256:'d'.repeat(64)}]};
  assert.match(buildShippingPreflight({work,expectedRevision:4,gitSnapshot:stale,request}).blockers.join(' '),/vigente|evidencia/i);
  work.objective.criteria[0].description='Changed contract';
  assert.match(buildShippingPreflight({work,expectedRevision:4,gitSnapshot,request}).blockers.join(' '),/evidencia positiva/);
});

test('requires explicit inclusion of every local unpublished commit and does not block pending shipping task',()=>{
  const {work,request,gitSnapshot}=fixture();
  gitSnapshot.localCommits=[{sha:'d'.repeat(40),subject:'local commit'}];
  assert.match(buildShippingPreflight({work,expectedRevision:4,gitSnapshot,request}).blockers.join(' '),/includedCommitShas/);
  request.includedCommitShas=['d'.repeat(40)];
  assert.deepEqual(buildShippingPreflight({work,expectedRevision:4,gitSnapshot,request}).blockers,[]);
});

test('allows metadata shipping on an already completed Work and treats only exact Sol bookkeeping as warning',()=>{
  const {work,request,gitSnapshot}=fixture();
  work.status='done';work.closure={id:'SHIP-1:c1',cycle:1,outcome:'done'};
  gitSnapshot.files.push({path:'.sol/work/SHIP-1/work.json',sha256:'d'.repeat(64),unstaged:true});
  const result=buildShippingPreflight({work,expectedRevision:4,gitSnapshot,request});
  assert.deepEqual(result.blockers,[]);
  assert.equal(result.warnings.length,1);
  assert.equal(result.intent.expectedPaths.includes('.sol/work/SHIP-1/work.json'),false);
});

test('blocks sensitive and ignored paths rather than force-adding them',()=>{
  const {work,request,gitSnapshot}=fixture();
  work.tasks[0].writeScope=['.env.example'];work.tasks[1].writeScope=['.env.example'];
  request.expectedPaths=['.env.example'];
  gitSnapshot.files=[{path:'.env.example',sha256:sha,unstaged:true,ignored:true}];
  assert.match(buildShippingPreflight({work,expectedRevision:4,gitSnapshot,request}).blockers.join(' '),/ignorado/);
  request.expectedPaths=['.env'];gitSnapshot.files=[{path:'.env',sha256:sha,unstaged:true}];
  work.tasks[0].writeScope=['.env'];work.tasks[1].writeScope=['.env'];
  assert.match(buildShippingPreflight({work,expectedRevision:4,gitSnapshot,request}).blockers.join(' '),/sensible/);
});

test('argv planner requires active approval and checkpoints, uses exact paths/refspec and explicit PR destination',()=>{
  const {work,request,gitSnapshot}=fixture();
  const {intent}=buildShippingPreflight({work,expectedRevision:4,gitSnapshot,request});
  assert.throws(()=>buildShippingArgv(intent,'push_branch'),/Falta aprobación/);
  const committedHead='e'.repeat(40);
  const postCommit={...gitSnapshot,headSha:committedHead,files:[{...gitSnapshot.files[0],staged:false,unstaged:false,untracked:false}],localCommits:[{sha:committedHead,subject:'approved commit'}]};
  const snapshot=computeShippingSnapshot({gitSnapshot:postCommit,work,request,workScope:intent.workScope,expectedPaths:intent.expectedPaths,evidenceIds:intent.evidenceIds,includedCommitShas:[committedHead]});
  const approved={...intent,sourceWorkRevision:4,workContractSha256:workContractDigest(work),status:'approved',approval:{status:'user_reported',snapshotSha256:intent.snapshotSha256,actions:intent.actions}};
  const auth={currentSnapshot:snapshot,currentWork:work,expectedWorkId:work.id,expectedRevision:work.revision};
  assert.throws(()=>buildShippingArgv(approved,'push_branch',auth),/checkpoint/);
  approved.completedActions=['create_commit'];
  const receipts=[{intentId:intent.id,action:'create_commit',status:'succeeded',afterHeadSha:committedHead,observedSnapshotSha256:snapshot.snapshotSha256}];
  assert.deepEqual(buildShippingArgv(approved,'push_branch',{...auth,receipts}),[['git','push','--porcelain','origin','refs/heads/feature-safe:refs/heads/feature-safe']]);
  approved.completedActions.push('push_branch');receipts.push({intentId:intent.id,action:'push_branch',status:'succeeded',afterHeadSha:committedHead,observedSnapshotSha256:snapshot.snapshotSha256});
  assert.deepEqual(buildShippingArgv(approved,'create_pr',{...auth,receipts}),[['gh','pr','create','--repo','owner/repo','--base','main','--head','feature-safe','--title','Ship it','--body','Review changes']]);
  assert.throws(()=>buildShippingArgv({...approved,branch:'-u'},'create_pr'),/incompleto o inseguro/);
});

test('failed action can retry itself only at its receipt snapshot; metadata revision advances do not reapprove semantic contract',()=>{
  const {work,request,gitSnapshot}=fixture();
  const {intent:preview}=buildShippingPreflight({work,expectedRevision:4,gitSnapshot,request});
  const intent={...preview,sourceWorkRevision:4,workContractSha256:workContractDigest(work),status:'approved',approval:{status:'user_reported',snapshotSha256:preview.snapshotSha256,actions:preview.actions}};
  const stagedGit={...gitSnapshot,diffSha256:'f'.repeat(64),files:[{...gitSnapshot.files[0],staged:true,unstaged:false}]};
  const snapshot=computeShippingSnapshot({gitSnapshot:stagedGit,work,request,workScope:intent.workScope,expectedPaths:intent.expectedPaths,evidenceIds:intent.evidenceIds,includedCommitShas:[]});
  const receipts=[{intentId:intent.id,action:'create_commit',status:'failed',beforeHeadSha:head,afterHeadSha:head,observedSnapshotSha256:snapshot.snapshotSha256}];
  const options={currentSnapshot:snapshot,currentWork:{...work,revision:6,shipping:{...work.shipping,intents:[intent],receipts}},expectedWorkId:work.id,expectedRevision:6,receipts};
  assert.deepEqual(buildShippingArgv(intent,'create_commit',options)[0],['git','--literal-pathspecs','add','--','src/app.js']);
  assert.throws(()=>buildShippingArgv(intent,'push_branch',options),/misma acción/);
  const changedWork={...options.currentWork,objective:{...work.objective,criteria:[{...work.objective.criteria[0],description:'different'}]}};
  assert.throws(()=>buildShippingArgv(intent,'create_commit',{...options,currentWork:changedWork}),/Contrato del Work cambió/);
});

test('shared comparison catches changed content and accepts exactly the digest helper output',()=>{
  const {work,request,gitSnapshot}=fixture();
  const {intent}=buildShippingPreflight({work,expectedRevision:4,gitSnapshot,request});
  const snap=computeShippingSnapshot({gitSnapshot,work,request,workScope:intent.workScope,expectedPaths:intent.expectedPaths,evidenceIds:intent.evidenceIds,includedCommitShas:intent.includedCommitShas});
  const {sourceWorkRevision,...compareIntent}=intent;
  compareIntent.workContractSha256=workContractDigest(work);
  assert.equal(compareShippingSnapshot(compareIntent,snap).matches,true);
  assert.equal(compareShippingSnapshot(compareIntent,{...snap,contentSha256:'e'.repeat(64)}).matches,false);
});
