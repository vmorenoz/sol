import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {repo,create,readWork,atomicWrite,fingerprint} from './helpers.mjs';
import {applyWorkMutation,completeMapOperation} from '../lib/work-mutations.mjs';
import {history,inspectContextMap,status} from '../lib/artifacts.mjs';
import {assertSchema} from '../lib/schema.mjs';

const at=()=>new Date().toISOString();
const mappingTask=()=>({type:'task.add',task:{id:'MAP-TASK',title:'Inspeccionar las fuentes y redactar el mapa',kind:'exploration',criterionIds:['AC-1'],agent:'sol-explorer',status:'in_progress',dependsOn:[],writeScope:['.sol/project.md'],resources:['templates/project.md'],acceptance:['Afirmaciones trazables a fuentes leídas'],evidenceIds:[],summary:''}});
function mapDoc(claimId,statement,sourceIds){return `# Contexto del proyecto\n<!-- template: project@1.0 -->\n\n<!-- claim:${claimId} -->\n${statement}\n\n${sourceIds.map(id=>`<!-- source:${id} -->\nFuente ${id}.`).join('\n')}\n`;}
function addLocalFinding(root,id='MAP-1',{inspection='read',lane='existing-project'}={}){
  create(root,id);atomicWrite(root,'src/entry.mjs','export const entry = true;\n');
  const statement='El repositorio contiene un módulo de entrada en src/entry.mjs.';
  const receipt=applyWorkMutation(root,{workId:id,expectedRevision:1,actions:[
    mappingTask(),
    {type:'discovery.context.set',contextLane:lane},
    {type:'discovery.source.add',source:{id:'S-1',kind:'repository',ref:'src/entry.mjs',path:'src/entry.mjs',inspection,observedAt:at()}},
    {type:'discovery.claim.add',claim:{id:'C-1',kind:'fact',statement,sourceIds:['S-1']}}
  ]});
  atomicWrite(root,'.sol/project.md',mapDoc('C-1',statement,['S-1']));
  return {revision:receipt.revision,statement};
}

test('Un marker template vacío no completa el mapeo ni fabrica PASS o revisión de sol-explorer',t=>{
  const root=repo(t);create(root,'MAP-EMPTY');
  atomicWrite(root,'.sol/project.md','# Proyecto\n<!-- template: project@1.0 -->\nContexto todavía no levantado.\n');
  applyWorkMutation(root,{workId:'MAP-EMPTY',expectedRevision:1,actions:[{type:'discovery.context.set',contextLane:'existing-project'}]});
  assert.throws(()=>completeMapOperation(root,{workId:'MAP-EMPTY',expectedRevision:2,summary:'Intento de cierre'}),/tarea exploration en curso creada antes/);
  applyWorkMutation(root,{workId:'MAP-EMPTY',expectedRevision:2,actions:[mappingTask()]});
  assert.throws(()=>completeMapOperation(root,{workId:'MAP-EMPTY',expectedRevision:3,summary:'Intento de cierre'}),/al menos una afirmación Discovery/);
  const work=readWork(root,'MAP-EMPTY');assert.equal(work.revision,3);assert.equal(work.status,'pending');assert.equal(work.tasks[0].status,'in_progress');assert.deepEqual(work.evidence,[]);
});

test('Map completa una afirmación enlazada a una fuente local leída con hash calculado por el core',t=>{
  const root=repo(t),fixture=addLocalFinding(root,'MAP-LOCAL');
  const before=readWork(root,'MAP-LOCAL');assert.equal(before.discovery.sources[0].fileSha256,fingerprint(root,'src/entry.mjs').sha256);assert.equal(before.discovery.sources[0].inspectionProvenance,'caller_reported');
  const result=completeMapOperation(root,{workId:'MAP-LOCAL',expectedRevision:fixture.revision,summary:'Cartographie des observations disponibles; les zones non examinées restent inconnues.'});
  const work=readWork(root,'MAP-LOCAL');
  const originalDocument=fs.readFileSync(path.join(root,'.sol/project.md'),'utf8');
  assert.equal(result.status,'done');assert.equal(work.tasks[0].kind,'exploration');assert.equal(work.tasks[0].id,'MAP-TASK');assert.equal(work.tasks[0].title,before.tasks[0].title);assert.deepEqual(work.tasks[0].acceptance,before.tasks[0].acceptance);assert.equal(work.evidence[0].kind,'static');
  assert.deepEqual(work.evidence[0].files.map(f=>f.path).sort(),['.sol/project.md','src/entry.mjs']);
  assert.match(work.evidence[0].basis,/No acredita verdad semántica/);assert.deepEqual(inspectContextMap(root,work).status,'current');
  const legacy=structuredClone(work);legacy.evidence[0].files=legacy.evidence[0].files.filter(file=>file.path!=='.sol/project.md');
  assert.equal(inspectContextMap(root,legacy).status,'legacy_unverified');
  atomicWrite(root,'.sol/project.md',fs.readFileSync(path.join(root,'.sol/project.md'),'utf8')+'\nTexto añadido después del cierre.\n');
  const staleDocument=inspectContextMap(root,readWork(root,'MAP-LOCAL'));assert.equal(staleDocument.status,'stale');assert.match(staleDocument.reasons[0],/Documento de mapeo cambió/);
  atomicWrite(root,'.sol/project.md',originalDocument);
  atomicWrite(root,'src/entry.mjs','export const entry = false;\n');
  const staleSource=inspectContextMap(root,readWork(root,'MAP-LOCAL'));assert.equal(staleSource.status,'stale');assert.match(staleSource.reasons[0],/Fuente del mapeo cambió/);
});

test('Encontrar archivo sin leerlo no basta y archivo cambiado exige refresco selectivo',t=>{
  const root=repo(t),fixture=addLocalFinding(root,'MAP-FOUND',{inspection:'found'});
  assert.throws(()=>completeMapOperation(root,{workId:'MAP-FOUND',expectedRevision:fixture.revision,summary:'No debe completar'}),/read o contrasted/);
  const root2=repo(t),changed=addLocalFinding(root2,'MAP-STALE');
  atomicWrite(root2,'src/entry.mjs','cambio posterior a la observación\n');
  assert.throws(()=>completeMapOperation(root2,{workId:'MAP-STALE',expectedRevision:changed.revision,summary:'No debe completar'}),/cambió desde su lectura/);
  assert.equal(readWork(root2,'MAP-STALE').revision,changed.revision);
});

test('Greenfield puede cerrar con intención reportada y unknowns sin inventar arquitectura',t=>{
  const root=repo(t);create(root,'MAP-GREEN');
  const statement='La persona usuaria reporta que quiere una herramienta nueva para organizar recetas familiares.';
  const result=applyWorkMutation(root,{workId:'MAP-GREEN',expectedRevision:1,actions:[
    mappingTask(),
    {type:'discovery.context.set',contextLane:'greenfield'},
    {type:'discovery.source.add',source:{id:'S-USER',kind:'user_statement',ref:'Objetivo expresado en esta conversación',observedAt:at()}},
    {type:'discovery.claim.add',claim:{id:'C-INTENT',kind:'fact',statement,sourceIds:['S-USER']}}
  ]});
  atomicWrite(root,'.sol/project.md',mapDoc('C-INTENT',statement,['S-USER']));
  completeMapOperation(root,{workId:'MAP-GREEN',expectedRevision:result.revision,summary:'Solo se registró la intención reportada; stack y arquitectura permanecen desconocidos.',limitations:['Stack, datos y arquitectura todavía no investigados.']});
  const work=readWork(root,'MAP-GREEN');assert.equal(work.status,'done');assert.equal(work.discovery.claims.length,1);assert.equal(work.discovery.claims[0].kind,'fact');
});

test('Fuente local no admite hash del caller ni sigue symlinks; preserva contenido ajeno',t=>{
  const root=repo(t);create(root,'MAP-SAFE');atomicWrite(root,'.sol/user-note.txt','preservar intacto\n');
  atomicWrite(root,'src/owned.txt','local\n');fs.symlinkSync(path.join(root,'.sol/user-note.txt'),path.join(root,'src','linked.txt'));
  const base={id:'S-1',kind:'repository',ref:'src/owned.txt',path:'src/owned.txt',inspection:'read',observedAt:at()};
  assert.throws(()=>assertSchema('work-update',{workId:'MAP-SAFE',expectedRevision:1,actions:[{type:'discovery.source.add',source:{...base,fileSha256:'a'.repeat(64)}}]}),/no coincide/);
  assert.throws(()=>applyWorkMutation(root,{workId:'MAP-SAFE',expectedRevision:1,actions:[{type:'discovery.source.add',source:{...base,path:'src/linked.txt'}}]}),/Symlink no permitido/);
  assert.equal(fs.readFileSync(path.join(root,'.sol/user-note.txt'),'utf8'),'preservar intacto\n');assert.equal(readWork(root,'MAP-SAFE').revision,1);
});

test('Fuentes/afirmaciones legacy sin metadata nueva siguen siendo legibles pero no pasan el nuevo gate',t=>{
  const root=repo(t);create(root,'MAP-LEGACY');
  const statement='Se conserva una observación de una versión previa.';
  const r=applyWorkMutation(root,{workId:'MAP-LEGACY',expectedRevision:1,actions:[
    mappingTask(),
    {type:'discovery.context.set',contextLane:'existing-project'},
    {type:'discovery.source.add',source:{id:'S-OLD',kind:'repository',ref:'src/old.mjs',observedAt:at()}},
    {type:'discovery.claim.add',claim:{id:'C-OLD',kind:'hypothesis',statement,sourceIds:['S-OLD']}}
  ]});
  const work=readWork(root,'MAP-LEGACY');assert.equal(work.discovery.sources[0].inspection,undefined);
  atomicWrite(root,'.sol/project.md',mapDoc('C-OLD',statement,['S-OLD']));
  assert.throws(()=>completeMapOperation(root,{workId:'MAP-LEGACY',expectedRevision:r.revision,summary:'No debe certificar fuente no leída'}),/read o contrasted/);
});

test('Limitations inválidas abortan el mapeo antes de guardar Work, índice o historial',t=>{
  const root=repo(t),fixture=addLocalFinding(root,'MAP-ATOMIC');
  const beforeWork=readWork(root,'MAP-ATOMIC'),beforeStatus=status(root),beforeHistory=history(root);
  assert.throws(()=>completeMapOperation(root,{workId:'MAP-ATOMIC',expectedRevision:fixture.revision,summary:'Mapeo válido',limitations:['']}),/history-entry/);
  assert.deepEqual(readWork(root,'MAP-ATOMIC'),beforeWork);
  assert.deepEqual(status(root),beforeStatus);assert.deepEqual(history(root),beforeHistory);
});
