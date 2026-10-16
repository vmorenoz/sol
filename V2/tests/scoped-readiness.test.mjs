import test from 'node:test';
import assert from 'node:assert/strict';
import {repo,create,readWork,atomicWrite} from './helpers.mjs';
import {applyWorkMutation,closeWorkOperation} from '../lib/work-mutations.mjs';
import {deriveTaskReadiness,deriveWorkReadiness,validateWork} from '../lib/artifacts.mjs';
import {schema} from '../lib/schema.mjs';

const at=()=>new Date().toISOString();
const task=(id,criterionIds=['AC-1'],dependsOn=[])=>({id,title:`Implementar ${id}`,kind:'implementation',criterionIds,agent:'sol-executor',status:'pending',dependsOn,writeScope:['src/proof.txt'],resources:[],acceptance:['Resultado comprobado'],evidenceIds:[],summary:''});
const source=()=>({id:'S-1',kind:'user_statement',ref:'Conversación sintética autorizada',observedAt:at()});
const question=(scope={})=>({id:'Q-1',question:'¿Cuál es el alcance?',whyItMatters:'Cambia el resultado',impact:'material',sourceIds:['S-1'],...scope});
const decision=(id,status='confirmed')=>({id,questionIds:['Q-1'],statement:`Decisión ${id}`,status,sourceIds:['S-1'],...(status==='confirmed'?{confirmedAt:at(),confirmedBy:'user_reported'}:{})});
const mutate=(root,id,actions)=>applyWorkMutation(root,{workId:id,expectedRevision:readWork(root,id).revision,actions});
const evidence=(id,taskIds,workId)=>({type:'evidence.add',evidence:{id,kind:'static',status:'pass',taskIds,report:`.sol/work/${workId}/proof.md`,cwd:'.',basis:'Comprobación sintética del contrato',files:['src/proof.txt'],summary:'Resultado observado en la fixture'}});

test('trabajo integrado: rama independiente avanza; alcance, dependencias y cierre conservan sus límites',t=>{
  const root=repo(t),id='SCOPED-FLOW';create(root,id);
  mutate(root,id,[
    {type:'criterion.add',criterion:{id:'AC-2',description:'Rama dependiente',verification:'Comprobación de salida'}},
    ...[task('T-FREE'),task('T-BLOCK',['AC-2']),task('T-DEP',['AC-2'],['T-BLOCK'])].map(task=>({type:'task.add',task})),
    {type:'discovery.source.add',source:source()},
    {type:'discovery.question.add',question:question({taskIds:['T-BLOCK']})},
    {type:'discovery.assumption.add',assumption:{id:'A-1',statement:'Compatibilidad disponible',impact:'material',validation:'Contrastar fuente',status:'open',sourceIds:['S-1'],criterionIds:['AC-2']}},
    {type:'discovery.decision.add',decision:{...decision('D-1','proposed'),taskIds:['T-BLOCK']}}
  ]);
  let work=readWork(root,id);
  assert.equal(deriveWorkReadiness(work).completionReady,false);
  assert.equal(deriveTaskReadiness(work,'T-FREE').ready,true);
  assert.equal(deriveTaskReadiness(work,'T-BLOCK').ready,false);
  assert.deepEqual(deriveTaskReadiness(work,'T-DEP').relevantTaskIds,['T-BLOCK','T-DEP']);
  assert.match(deriveTaskReadiness(work,'T-DEP').reasons.join('; '),/Q-1.*A-1.*D-1.*T-BLOCK/);
  mutate(root,id,[{type:'task.set_status',taskId:'T-FREE',status:'in_progress'}]);
  assert.throws(()=>mutate(root,id,[{type:'task.set_status',taskId:'T-BLOCK',status:'in_progress'}]),/No se puede iniciar implementación/);
  atomicWrite(root,'src/proof.txt','Resultado sintético estable.\n');atomicWrite(root,`.sol/work/${id}/proof.md`,'# Evidencia de fixture\n');
  mutate(root,id,[evidence('E-FREE',['T-FREE'],id),{type:'task.set_status',taskId:'T-FREE',status:'done'}]);
  const unresolved=readWork(root,id);unresolved.tasks.filter(t=>t.status!=='done').forEach(t=>{t.status='cancelled';t.summary='Solo comprobar cierre global';});
  unresolved.status='done';unresolved.closure={id:`${id}:c1`,cycle:1,at:at(),outcome:'done',summary:'No debe cerrar',limitations:[],evidenceIds:['E-FREE']};
  assert.throws(()=>validateWork(root,unresolved),/no listo para completar/);
  mutate(root,id,[
    {type:'discovery.question.answer',questionId:'Q-1',answer:{kind:'user_reported',text:'Alcance confirmado',sourceIds:['S-1'],reportedAt:at()}},
    {type:'discovery.assumption.resolve',assumptionId:'A-1',status:'validated',sourceIds:['S-1']},
    {type:'discovery.decision.supersede',decisionId:'D-1',replacement:{...decision('D-2'),taskIds:['T-BLOCK']},reason:'La persona usuaria confirmó el alcance'}
  ]);
  assert.throws(()=>mutate(root,id,[{type:'task.set_status',taskId:'T-DEP',status:'in_progress'}]),/Dependencia sin completar/);
  mutate(root,id,[{type:'task.set_status',taskId:'T-BLOCK',status:'in_progress'},evidence('E-BLOCK',['T-BLOCK'],id),{type:'task.set_status',taskId:'T-BLOCK',status:'done'}]);
  mutate(root,id,[{type:'task.set_status',taskId:'T-DEP',status:'in_progress'},evidence('E-DEP',['T-DEP'],id),{type:'task.set_status',taskId:'T-DEP',status:'done'}]);
  work=readWork(root,id);assert.equal(deriveWorkReadiness(work).completionReady,true);
  assert.equal(closeWorkOperation(root,{workId:id,expectedRevision:work.revision,summary:'Las tres tareas tienen evidencia vigente'}).status,'done');
});

test('ámbito legacy/vacío sigue global, referencias desconocidas y fuentes de respuestas fallan sin guardar',t=>{
  const root=repo(t),id='SCOPED-SAFE';create(root,id);
  mutate(root,id,[{type:'task.add',task:task('T-1')},{type:'discovery.source.add',source:source()},{type:'discovery.question.add',question:question()}]);
  const work=readWork(root,id),before=work.revision;
  for(const scope of [{},{taskIds:[],criterionIds:[]}]){const copy=structuredClone(work);Object.assign(copy.discovery.questions[0],scope);assert.equal(deriveTaskReadiness(copy,'T-1').ready,false);}
  for(const scope of [{taskIds:['MISSING']},{criterionIds:['MISSING']},{taskIds:['T-1','T-1']}])assert.throws(()=>mutate(root,id,[{type:'discovery.question.add',question:{...question(scope),id:'Q-2'}}]),/inexistente|duplicados/);
  assert.throws(()=>mutate(root,id,[{type:'discovery.question.answer',questionId:'Q-1',answer:{text:'Hallazgo',kind:'investigated',sourceIds:['MISSING'],reportedAt:at()}}]),/referencia fuente inexistente/);
  const invalid=structuredClone(work);invalid.discovery.questions[0].resolutionKind='investigation';invalid.discovery.questions[0].answer={kind:'investigated',text:'Hallazgo',sourceIds:['MISSING'],reportedAt:at()};
  assert.equal(deriveWorkReadiness(invalid).ready,false);
  assert.equal(readWork(root,id).revision,before);
});

test('decisiones D1 → D2 → D3 mantienen historia recíproca y resolución; ciclos o terminal propuesto no pasan',t=>{
  const root=repo(t),id='DECISION-CHAIN';create(root,id);
  mutate(root,id,[{type:'discovery.source.add',source:source()},{type:'discovery.question.add',question:question()},{type:'discovery.decision.add',decision:decision('D-1')},{type:'discovery.question.answer',questionId:'Q-1',answer:{kind:'investigated',text:'Hallazgo adoptado',decisionId:'D-1',sourceIds:['S-1'],reportedAt:at()}}]);
  mutate(root,id,[{type:'discovery.decision.supersede',decisionId:'D-1',replacement:decision('D-2'),reason:'Nuevo alcance confirmado'}]);
  mutate(root,id,[{type:'discovery.decision.supersede',decisionId:'D-2',replacement:decision('D-3'),reason:'Último alcance confirmado'}]);
  const work=readWork(root,id);assert.deepEqual(work.discovery.decisions.map(d=>d.status),['superseded','superseded','confirmed']);assert.equal(deriveWorkReadiness(work).ready,true);
  const broken=structuredClone(work);broken.discovery.decisions[1].supersedes='D-3';assert.throws(()=>validateWork(root,broken),/Cadena de sustitución inconsistente/);
  const terminal=structuredClone(work);terminal.discovery.decisions[2].status='proposed';assert.throws(()=>validateWork(root,terminal),/sin decisión final confirmada/);
  const cyclic=structuredClone(work),[first,,last]=cyclic.discovery.decisions;first.supersedes=last.id;last.status='superseded';last.supersededBy=first.id;last.supersessionReason='Ciclo inválido';assert.throws(()=>validateWork(root,cyclic),/Ciclo de sustitución/);
  assert.equal(deriveWorkReadiness(cyclic).ready,false);
});

test('schemas de incertidumbre y acciones conservan el mismo alcance opcional',()=>{
  const standalone=schema('discovery').properties,stored=schema('work').properties.discovery.properties,actions=schema('work-update').properties.actions.items.anyOf;
  for(const [single,plural] of [['question','questions'],['assumption','assumptions'],['decision','decisions']])for(const field of ['taskIds','criterionIds']){
    const canonical=standalone[plural].items.properties[field];assert.deepEqual(stored[plural].items.properties[field],canonical);
    const action=actions.find(a=>a.properties?.type?.const===`discovery.${single}.add`);assert.deepEqual(action.properties[single].properties[field],canonical);
  }
});
