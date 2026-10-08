import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {repo,create,ready,atomicWrite,readWork,saveWork,temp} from './helpers.mjs';
import {applyWorkMutation,createWorkOperation} from '../lib/work-mutations.mjs';
import {closeWork,validateResult,validateWork} from '../lib/artifacts.mjs';
import {assertSchema,schema} from '../lib/schema.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const documentKinds=['work','spec','plan','research','review','decision','delivery','evidence','project'];

test('document.register y tool exponen exactamente los kinds documentales canónicos',t=>{
  const r=repo(t);create(r,'DOCS-1');
  for(const [i,kind] of documentKinds.entries())atomicWrite(r,`docs/d-${i}.md`,`# ${kind}\n`);
  const actions=documentKinds.map((kind,i)=>({type:'document.register',document:{kind,path:`docs/d-${i}.md`,templateVersion:`${kind}@1.0`}}));
  assert.doesNotThrow(()=>applyWorkMutation(r,{workId:'DOCS-1',expectedRevision:1,actions}));
  const canonical=schema('work').properties.documents.items.properties.kind.enum;
  const update=schema('work-update').properties.actions.items.anyOf.find(x=>x.properties?.type?.const==='document.register').properties.document.properties.kind.enum;
  assert.deepEqual(update,canonical);
  const priority=schema('work').properties.priority.enum;
  assert.deepEqual(schema('work-create').properties.priority.enum,priority);
  assert.deepEqual(schema('work-update').properties.actions.items.anyOf.find(x=>x.properties?.type?.const==='work.set_overview').properties.priority.enum,priority);
  const bad={type:'document.register',document:{kind:'mystery',path:'docs/unknown.md',templateVersion:'mystery@1'}};
  assert.throws(()=>assertSchema('work-update',{workId:'DOCS-1',expectedRevision:2,actions:[bad]}),/enum|no coincide/);

  const home=temp(t),schemas=path.join(home,'.sol/schemas');fs.mkdirSync(schemas,{recursive:true});
  fs.copyFileSync(path.join(root,'schemas/work-update.schema.json'),path.join(schemas,'work-update.schema.json'));
  fs.copyFileSync(path.join(root,'schemas/work.schema.json'),path.join(schemas,'work.schema.json'));
  const source=`import plugin from ${JSON.stringify(path.join(root,'plugins/opencode-v2/index.ts'))};\nconst registered={}; await plugin.setup({tool:{transform:async fn=>fn({add:t=>registered[t.name]=t})},session:{get:async()=>({location:{directory:'/workspace'}})}});\nconst action=registered.sol_work_apply.input.properties.actions.items.anyOf;const kind=action.find(x=>x.properties?.type?.const==='document.register').properties.document.properties.kind.enum;const priority=action.find(x=>x.properties?.type?.const==='work.set_overview').properties.priority.enum;const createPriority=registered.sol_work_create.input.properties.priority.enum;if(JSON.stringify(kind)!==JSON.stringify(${JSON.stringify(canonical)})||JSON.stringify(priority)!==JSON.stringify(${JSON.stringify(priority)})||JSON.stringify(createPriority)!==JSON.stringify(${JSON.stringify(priority)})) throw Error('tool enum drift'); console.log(JSON.stringify({kind,priority,createPriority}));`;
  const run=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',source],{encoding:'utf8',env:{...process.env,HOME:home,USERPROFILE:home}});
  assert.equal(run.status,0,`${run.stdout}\n${run.stderr}`);assert.deepEqual(JSON.parse(run.stdout.trim()),{kind:canonical,priority,createPriority:priority});
});

test('priority crítica canónica aplica y crea Work validado; urgent se rechaza temprano sin mutar',t=>{
  const r=repo(t);create(r,'PRIORITY-1');
  const priorities=schema('work').properties.priority.enum;
  assert.deepEqual(priorities,['low','normal','high','critical']);
  assert.doesNotThrow(()=>createWorkOperation(r,{workId:'PRIORITY-CRITICAL',title:'Prioridad crítica',objective:'Resultado',criterion:'Criterio',verification:'Comprobación',priority:'critical'}));
  assert.equal(readWork(r,'PRIORITY-CRITICAL').priority,'critical');
  assert.doesNotThrow(()=>applyWorkMutation(r,{workId:'PRIORITY-1',expectedRevision:1,actions:[{type:'work.set_overview',priority:'critical'}]}));
  assert.equal(readWork(r,'PRIORITY-1').priority,'critical');
  const files=['.sol/work/PRIORITY-1/work.json','.sol/state.json','.sol/history.jsonl'];
  const before=()=>files.map(file=>fs.readFileSync(path.join(r,file)));
  const snapshot=before();
  assert.throws(()=>applyWorkMutation(r,{workId:'PRIORITY-1',expectedRevision:2,actions:[{type:'work.set_overview',priority:'urgent'}]}),/priority inválida.*critical/);
  assert.deepEqual(before(),snapshot);
  assert.throws(()=>createWorkOperation(r,{workId:'PRIORITY-URGENT',title:'x',objective:'x',criterion:'x',verification:'x',priority:'urgent'}),/priority inválida.*critical/);
  assert.deepEqual(before(),snapshot);
  assert.equal(fs.existsSync(path.join(r,'.sol/work/PRIORITY-URGENT/work.json')),false);
});

test('preflight inválido o revisión obsoleta no altera work, índice ni historial',t=>{
  const r=repo(t);create(r,'PREFLIGHT-1');
  const files=['.sol/work/PREFLIGHT-1/work.json','.sol/state.json','.sol/history.jsonl'];
  const before=()=>files.map(file=>fs.readFileSync(path.join(r,file)));
  const initial=before();
  assert.throws(()=>applyWorkMutation(r,{workId:'PREFLIGHT-1',expectedRevision:1,actions:[{type:'document.register',document:{kind:'not-canonical',path:'docs/x.md',templateVersion:'x@1'}}]}),/enum|no coincide/);
  assert.deepEqual(before(),initial);
  assert.throws(()=>applyWorkMutation(r,{workId:'PREFLIGHT-1',expectedRevision:2,actions:[{type:'work.set_overview',summary:'no write'}]}),/Revisión obsoleta/);
  assert.deepEqual(before(),initial);
});

test('document kind evidence registrado no sustituye evidencia estructurada de aceptación',t=>{
  const r=repo(t);create(r,'DOC-EVIDENCE-1');atomicWrite(r,'docs/report.md','# Afirmación textual\nPASS\n');
  applyWorkMutation(r,{workId:'DOC-EVIDENCE-1',expectedRevision:1,actions:[{type:'document.register',document:{kind:'evidence',path:'docs/report.md',templateVersion:'evidence@1'}}]});
  assert.throws(()=>closeWork(r,'DOC-EVIDENCE-1',{summary:'Cierre'}),/Falta evidencia positiva/);
  assert.equal(readWork(r,'DOC-EVIDENCE-1').status,'pending');
  assert.equal(fs.readFileSync(path.join(r,'.sol/history.jsonl'),'utf8'),'');
});

test('referencias taskId inexistentes se rechazan dentro de evidencia y delegación',t=>{
  const r=repo(t),work=ready(r,'TASKREF-1');
  const invalid=structuredClone(work);invalid.evidence[0].taskIds=['UNKNOWN-TASK'];
  assert.throws(()=>validateWork(r,invalid),/referencia inexistente UNKNOWN-TASK/);

  const delegation=JSON.parse(fs.readFileSync(path.join(root,'templates/delegation.json'),'utf8'));
  const result=JSON.parse(fs.readFileSync(path.join(root,'templates/result.json'),'utf8'));
  delegation.workId='TASKREF-1';delegation.workRevision=1;delegation.taskIds=['UNKNOWN-TASK'];
  result.workId='TASKREF-1';result.workRevision=1;
  assert.throws(()=>validateResult(r,delegation,result),/tarea inexistente.*UNKNOWN-TASK/);
});

test('validateResult comprueba taskIds declarados sin invalidar revisión histórica legítima y queda pendiente de revisión',t=>{
  const r=repo(t),original=create(r,'TASKREF-2'),candidate=structuredClone(original);
  candidate.tasks=[{id:'T-VALID',title:'Trabajo',criterionIds:['AC-1'],agent:'sol-executor',status:'pending',dependsOn:[],writeScope:[],resources:[],acceptance:['Completar'],evidenceIds:[],summary:''}];
  saveWork(r,candidate,1); // Work pasa a rev. 2; la delegación conserva su snapshot rev. 1.
  const delegation=JSON.parse(fs.readFileSync(path.join(root,'templates/delegation.json'),'utf8'));
  const result=JSON.parse(fs.readFileSync(path.join(root,'templates/result.json'),'utf8'));
  Object.assign(delegation,{workId:'TASKREF-2',workRevision:1,taskIds:['T-VALID']});
  Object.assign(result,{workId:'TASKREF-2',workRevision:1});
  const checked=validateResult(r,delegation,result);
  assert.equal(checked.semanticAcceptance,'PENDING_REVIEW');
  assert.match(checked.note,/No prueba ejecución/);
});
