import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {temp,repo,create,atomicWrite,readWork} from './helpers.mjs';
import {applyWorkMutation} from '../lib/work-mutations.mjs';
import {closeWork} from '../lib/artifacts.mjs';
import {deriveTaskReadiness,evidenceBindingsCurrent} from '../lib/contracts.mjs';
import {observeShippingGit} from '../lib/shipping-snapshot.mjs';
const task=(id,kind='implementation',dependsOn=[])=>({id,title:id,kind,criterionIds:['AC-1'],agent:'sol-executor',status:'pending',dependsOn,writeScope:['source.txt'],resources:[],acceptance:['correct'],evidenceIds:[],summary:''});
const decision=(id,taskIds)=>({id,questionIds:[],statement:id,status:'confirmed',sourceIds:[],confirmedBy:'user_reported',confirmedAt:new Date().toISOString(),...(taskIds?{taskIds}:{})});
const mutate=(root,id,actions)=>applyWorkMutation(root,{workId:id,expectedRevision:readWork(root,id).revision,actions});
const evidence=(id,taskIds)=>({id,kind:'static',status:'pass',taskIds,report:'report.md',cwd:'.',basis:'reviewed',files:['source.txt'],summary:'checked'});
test('decision replacement resets only affected tasks and transitive dependants, preserving historical evidence',t=>{
 const root=repo(t);create(root,'W');atomicWrite(root,'source.txt','old');atomicWrite(root,'report.md','checked');
 mutate(root,'W',[{type:'task.add',task:task('A')},{type:'task.add',task:task('B','implementation',['A'])},{type:'task.add',task:task('C')},{type:'discovery.decision.add',decision:decision('D1',['A'])}]);
 for(const id of ['A','B','C'])mutate(root,'W',[{type:'evidence.add',evidence:evidence(`E-${id}`,[id])},{type:'task.set_status',taskId:id,status:'done'}]);
 mutate(root,'W',[{type:'discovery.decision.supersede',decisionId:'D1',replacement:decision('D2',['A']),reason:'Material change'}]);
 const w=readWork(root,'W');assert.deepEqual(w.tasks.map(t=>t.status),['pending','pending','done']);assert.equal(w.evidence.length,3);assert.equal(evidenceBindingsCurrent(w,w.evidence[0]),false);assert.equal(evidenceBindingsCurrent(w,w.evidence[2]),true);assert.throws(()=>closeWork(root,'W',{summary:'done'}),/tareas abiertas/);
});
test('global replacement invalidates criterion-only acceptance as well',t=>{
 const root=repo(t);create(root,'W');atomicWrite(root,'source.txt','old');atomicWrite(root,'report.md','checked');
 mutate(root,'W',[{type:'discovery.decision.add',decision:decision('D1')},{type:'evidence.add',evidence:{...evidence('E',[]),criterionIds:['AC-1']}}]);
 mutate(root,'W',[{type:'discovery.decision.supersede',decisionId:'D1',replacement:decision('D2'),reason:'Material change'}]);
 const w=readWork(root,'W');assert.equal(evidenceBindingsCurrent(w,w.evidence[0]),false);assert.deepEqual(w.objective.criteria[0].evidenceIds,[]);
});
test('research and planning respect dependency gates when starting or completing',t=>{
 const root=repo(t);create(root,'W');atomicWrite(root,'source.txt','old');atomicWrite(root,'report.md','checked');
 mutate(root,'W',[{type:'task.add',task:task('A','research')},{type:'task.add',task:task('B','planning',['A'])},{type:'evidence.add',evidence:evidence('E',['B'])}]);
 assert.equal(deriveTaskReadiness(readWork(root,'W'),'B').ready,false);
 for(const status of ['in_progress','done'])assert.throws(()=>mutate(root,'W',[{type:'task.set_status',taskId:'B',status}]),/Dependencia sin completar/);
});
function gitRepo(t){
 const root=temp(t);const git=(...args)=>{const r=spawnSync('git',args,{cwd:root,encoding:'utf8',env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 git('init','-q','-b','main');git('config','user.name','Audit');git('config','user.email','audit@example.invalid');atomicWrite(root,'app/a.txt','old');git('add','.');git('commit','-qm','initial');git('remote','add','origin','https://github.com/owner/repo.git');git('update-ref','refs/remotes/origin/main','HEAD');git('switch','-qc','feature');
 return {root,git,observe:(sessionRoot=root,expectedPaths=['app/a.txt'])=>observeShippingGit({sessionRoot,request:{remote:'origin',base:'main',expectedPaths},work:{id:'W',evidence:[]}})};
}
test('ignored directory summaries do not block shipping or read ignored secrets',t=>{
 const {root,observe}=gitRepo(t);fs.appendFileSync(path.join(root,'.git/info/exclude'),'\n.sol/\nnode_modules/\n');atomicWrite(root,'.sol/state.json','{}');atomicWrite(root,'node_modules/.env','secret');atomicWrite(root,'app/a.txt','new');
 const snap=observe();assert.deepEqual(snap.files.map(f=>f.path),['app/a.txt']);assert.equal(observe(root,['.sol/state.json']).files.find(f=>f.path==='.sol/state.json').ignored,true);
});
test('tracked deletions have typed tombstones; unknown missing files remain rejected',t=>{
 const {root,observe}=gitRepo(t);fs.unlinkSync(path.join(root,'app/a.txt'));const snap=observe();assert.equal(snap.files.find(f=>f.path==='app/a.txt').deleted,true);assert.throws(()=>observe(root,['missing.txt']),/ENOENT/);
});
test('nested workspace Git paths are normalized exactly once',t=>{
 const {root,observe}=gitRepo(t);atomicWrite(root,'app/a.txt','new');const snap=observe(path.join(root,'app'),['a.txt']);assert.equal(snap.files[0].path,'a.txt');
});
test('tracked local bookkeeping edits do not change the approved content snapshot',t=>{
 const {root,git,observe}=gitRepo(t);atomicWrite(root,'.sol/work/W/work.json','one');atomicWrite(root,'.sol/state.json','one');atomicWrite(root,'.sol/history.jsonl','one');git('add','.sol');git('commit','-qm','metadata');atomicWrite(root,'app/a.txt','new');const before=observe();atomicWrite(root,'.sol/work/W/work.json','two');atomicWrite(root,'.sol/state.json','two');atomicWrite(root,'.sol/history.jsonl','two');assert.equal(observe().diffSha256,before.diffSha256);
});
test('publication observation separates PR commits from locally observed unpublished commits without fetching',t=>{
 const {root,git,observe}=gitRepo(t);atomicWrite(root,'app/a.txt','new');git('add','app/a.txt');git('commit','-qm','feature');const unknown=observe();assert.equal(unknown.publishedHeadSha,null);assert.equal(unknown.unpublishedCommitShas,null);assert.equal(unknown.localCommits.length,1);
 git('update-ref','refs/remotes/origin/feature','HEAD');const observed=observe();assert.equal(observed.localCommits.length,1);assert.deepEqual(observed.unpublishedCommitShas,[]);assert.equal(observed.publicationObservation,'local_remote_tracking_ref_only');
});
test('unrequested ignored files are not read; requested or tracked sensitive paths stay blocked',t=>{
 const {root,git,observe}=gitRepo(t);fs.appendFileSync(path.join(root,'.git/info/exclude'),'\n.env\nprivate.md\n');atomicWrite(root,'.env','secret');atomicWrite(root,'private.md','private');atomicWrite(root,'app/a.txt','new');
 assert.deepEqual(observe().files.map(f=>f.path),['app/a.txt']);assert.throws(()=>observe(root,['.env']),/sensible/);
 // An ignored root-level file also must not block a nested workspace.
 assert.equal(observe(path.join(root,'app'),['a.txt']).files[0].path,'a.txt');
 git('add','-f','.env');assert.throws(()=>observe(),/sensible/);
});
test('regressive task status or withdrawn acceptance resets transitive dependants, keeping unrelated acceptance',t=>{
 for(const change of ['pending','cancelled','evidence.update','evidence.remove']){
  const root=repo(t);create(root,'W');atomicWrite(root,'source.txt','old');atomicWrite(root,'report.md','checked');
  mutate(root,'W',[{type:'task.add',task:task('A')},{type:'task.add',task:task('B','implementation',['A'])},{type:'task.add',task:task('C','implementation',['B'])},{type:'task.add',task:task('D')}]);
  for(const id of ['A','B','C','D'])mutate(root,'W',[{type:'evidence.add',evidence:evidence(`E-${id}`,[id])},{type:'task.set_status',taskId:id,status:'done'}]);
  const action=change==='evidence.update'?{type:change,evidenceId:'E-A',patch:{status:'fail'}}:change==='evidence.remove'?{type:change,evidenceId:'E-A'}:{type:'task.set_status',taskId:'A',status:change,summary:'Acceptance withdrawn'};
  mutate(root,'W',[action]);const w=readWork(root,'W');assert.deepEqual(w.tasks.map(t=>t.status),[change==='cancelled'?'cancelled':'pending','pending','pending','done']);assert.equal(w.evidence.some(e=>e.id==='E-B'),true);assert.equal(evidenceBindingsCurrent(w,w.evidence.find(e=>e.id==='E-B')),false);assert.equal(evidenceBindingsCurrent(w,w.evidence.find(e=>e.id==='E-D')),true);assert.throws(()=>closeWork(root,'W',{summary:'done'}),/tareas abiertas/);
 }
});
