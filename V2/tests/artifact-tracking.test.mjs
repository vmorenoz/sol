import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {readArtifactTracking,planArtifactTracking,applyArtifactTracking,restoreArtifactTracking} from '../lib/artifact-tracking.mjs';

function fixture(t,{git=true,nested=false}={}){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'sol-track-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const root=nested?path.join(base,'packages','app'):base;if(nested)fs.mkdirSync(root,{recursive:true});
  const run=(args,cwd=base)=>{const r=spawnSync('git',args,{cwd,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();};
  if(git){run(['init','-q']);run(['config','user.name','Fixture']);run(['config','user.email','fixture@example.invalid']);}
  return {base,root,run};
}
const choose=(root,mode)=>planArtifactTracking(root,{mode,expectedRevision:readArtifactTracking(root).revision});

test('sin repositorio informa bloqueo, sin inicializar Git ni crear .sol',t=>{
  const {root}=fixture(t,{git:false});const r=readArtifactTracking(root);assert.equal(r.available,false);assert.match(r.blockers.join(' '),/Git/);assert.equal(fs.existsSync(path.join(root,'.sol')),false);
});
test('repo Git nuevo informa unconfigured y no aplica silenciosamente el modo Local',t=>{
  const {root}=fixture(t),exclude=path.join(root,'.git','info','exclude'),before=fs.readFileSync(exclude),state=readArtifactTracking(root);
  assert.equal(state.available,true);assert.equal(state.mode,'unconfigured');assert.equal(state.ignored,false);
  assert.equal(fs.readFileSync(exclude).compare(before),0);
  assert.equal(fs.existsSync(path.join(root,'.sol')),false);
});
test('preview no escribe; local ignora .sol sin tocar .gitignore',t=>{
  const {root}=fixture(t);const ignore=path.join(root,'.gitignore');fs.writeFileSync(ignore,'# externo\n*.tmp\n');const original=fs.readFileSync(ignore);
  const plan=choose(root,'local');assert.equal(fs.existsSync(path.join(root,'.sol')),false);assert.equal(fs.readFileSync(ignore).compare(original),0);
  const result=applyArtifactTracking(plan);assert.equal(result.changed,true);assert.equal(fs.readFileSync(ignore).compare(original),0);
  assert.equal(spawnSync('git',['check-ignore','--no-index','--','.sol/state.json'],{cwd:root}).status,0);
});
test('versioned elimina solo su bloque y persiste selección',t=>{
  const {root}=fixture(t), r=readArtifactTracking(root);const external='# foreign\n*.cache\n';fs.writeFileSync(r.excludePath,external);
  const a=applyArtifactTracking(choose(root,'local'));const plan=choose(root,'versioned');assert.equal(plan.previousMode,'local');applyArtifactTracking(plan);
  assert.match(fs.readFileSync(r.excludePath,'utf8'),/^# foreign\n\*\.cache\n# BEGIN SOL ARTIFACTS [a-f0-9]+\n# workspace: \.\n# mode: versioned\n# END SOL ARTIFACTS /);
  assert.doesNotMatch(fs.readFileSync(r.excludePath,'utf8'),/^\/.sol\/$/m);
  assert.equal(readArtifactTracking(root).mode,'versioned');assert.equal(spawnSync('git',['check-ignore','--no-index','--','.sol/state.json'],{cwd:root}).status,1);
  assert.ok(a.recovery);
});
test('artefactos ya tracked bloquean local sin mutar index',t=>{
  const {root,run}=fixture(t);fs.mkdirSync(path.join(root,'.sol'));fs.writeFileSync(path.join(root,'.sol/state.json'),'{}');run(['add','.sol/state.json']);run(['commit','-qm','fixture']);
  const before=run(['ls-files','-s']);assert.throws(()=>choose(root,'local'),/ya versionados/);assert.equal(run(['ls-files','-s']),before);
});
test('workspace anidado cuenta sus artefactos versionados usando rutas repo-relative',t=>{
  const {base,root,run}=fixture(t,{nested:true});const artifact=path.join(root,'.sol','work','one','work.json');fs.mkdirSync(path.dirname(artifact),{recursive:true});fs.writeFileSync(artifact,'{}');
  run(['add','packages/app/.sol/work/one/work.json']);const before=run(['ls-files','-s']);const state=readArtifactTracking(root);assert.equal(state.trackedCount,1);assert.throws(()=>planArtifactTracking(root,{mode:'local',expectedRevision:state.revision}),/ya versionados/);assert.equal(run(['ls-files','-s']),before);assert.ok(base);
});
test('versioned bloquea ignore externo de .gitignore',t=>{
  const {root}=fixture(t);fs.writeFileSync(path.join(root,'.gitignore'),'.sol/\n');assert.throws(()=>choose(root,'versioned'),/regla externa/);
});
test('check-ignore quiet respeta negaciones y no atribuye verbose negativo como ignore',t=>{
  const {root}=fixture(t);fs.writeFileSync(path.join(root,'.gitignore'),'/.sol/*\n!/.sol/artifact-tracking-probe\n');
  assert.equal(readArtifactTracking(root).ignored,false);const p=choose(root,'versioned');applyArtifactTracking(p);assert.equal(readArtifactTracking(root).mode,'versioned');
  const noop=choose(root,'versioned');assert.equal(noop.changed,false);assert.equal(applyArtifactTracking(noop).changed,false);
});
test('líneas ajenas insertadas en bloque gestionado no se eliminan',t=>{
  const {root}=fixture(t);const result=applyArtifactTracking(choose(root,'local'));fs.appendFileSync(result.excludePath,'');
  const raw=fs.readFileSync(result.excludePath,'utf8').replace('# mode: local\n','# mode: local\n# regla ajena\n');fs.writeFileSync(result.excludePath,raw);
  assert.throws(()=>choose(root,'versioned'),/líneas alteradas o ajenas/);assert.match(fs.readFileSync(result.excludePath,'utf8'),/# regla ajena/);
});
test('stale plan no modifica exclude',t=>{
  const {root}=fixture(t),plan=choose(root,'local');fs.writeFileSync(plan.excludePath,'# concurrente\n');assert.throws(()=>applyArtifactTracking(plan),/obsoleto/);assert.equal(fs.readFileSync(plan.excludePath,'utf8'),'# concurrente\n');
});
test('restaurar exige hash exacto y no pisa ediciones concurrentes',t=>{
  const {root}=fixture(t),plan=choose(root,'local'),result=applyArtifactTracking(plan);fs.appendFileSync(plan.excludePath,'# usuario\n');const restored=restoreArtifactTracking(plan,result);assert.equal(restored.restored,false);assert.match(fs.readFileSync(plan.excludePath,'utf8'),/# usuario/);assert.ok(restored.recovery);
});
test('repo anidado usa patrón relativo',t=>{
  const {root}=fixture(t,{nested:true});const result=applyArtifactTracking(choose(root,'local'));const data=fs.readFileSync(result.excludePath,'utf8');assert.match(data,/\/packages\/app\/.sol\//);assert.equal(readArtifactTracking(root).mode,'local');
});
test('no-op no crea copia de recuperación',t=>{
  const {root}=fixture(t);const first=applyArtifactTracking(choose(root,'local'));const plan=choose(root,'local');assert.equal(plan.changed,false);const second=applyArtifactTracking(plan);assert.equal(second.recovery,null);assert.ok(first.recovery);
});
test('worktree linked resuelve info/exclude nativo compartido',t=>{
  const {base,root,run}=fixture(t);fs.writeFileSync(path.join(root,'tracked'),'fixture\n');run(['add','tracked']);run(['commit','-qm','fixture']);
  const linked=path.join(base,'linked');run(['worktree','add','-q','-b','linked-branch',linked]);
  const plan=choose(linked,'local');assert.equal(plan.sharedMetadata,true);assert.equal(plan.excludePath,readArtifactTracking(root).excludePath);
  const applied=applyArtifactTracking(plan);assert.equal(readArtifactTracking(linked).mode,'local');assert.match(fs.readFileSync(applied.excludePath,'utf8'),/workspace: \.\n/);
});
test('backup queda privado',t=>{
  const {root}=fixture(t),result=applyArtifactTracking(choose(root,'local'));
  assert.equal(fs.statSync(result.recovery).mode&0o777,0o700);assert.equal(fs.statSync(path.join(result.recovery,'recovery.json')).mode&0o777,0o600);
});
test('fallo post-rename intenta restaurar exclude original y conserva backup',t=>{
  const {root}=fixture(t);const exclude=path.join(root,'.git','info','exclude');const original='# original\n';fs.writeFileSync(exclude,original);const plan=choose(root,'local');const old=fs.fsyncSync;let failed=false;
  fs.fsyncSync=function(fd){if(!failed&&fs.fstatSync(fd).isDirectory()){failed=true;throw Error('injected directory fsync');}return old.call(this,fd);};
  try{assert.throws(()=>applyArtifactTracking(plan),/restored=true; copia privada/);}finally{fs.fsyncSync=old;}
  assert.equal(fs.readFileSync(exclude,'utf8'),original);const backups=path.join(root,'.git','sol-artifacts-backups');assert.equal(fs.readdirSync(backups).length,1);
});
test('backup directory symlink outside metadata is rejected before exclude mutation',t=>{
  const {root}=fixture(t);const outside=fs.mkdtempSync(path.join(os.tmpdir(),'sol-outside-'));t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));fs.symlinkSync(outside,path.join(root,'.git','sol-artifacts-backups'));
  const plan=choose(root,'local');assert.throws(()=>applyArtifactTracking(plan),/Enlace simbólico/);assert.equal(fs.existsSync(plan.excludePath),true);assert.equal(fs.readdirSync(outside).length,0);
});
