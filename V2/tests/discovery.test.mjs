import test from 'node:test';
import assert from 'node:assert/strict';
import {repo,create,readWork} from './helpers.mjs';
import {applyWorkMutation} from '../lib/work-mutations.mjs';
import {deriveWorkReadiness} from '../lib/artifacts.mjs';

test('Discovery conserva respuestas: implementation pending puede planearse, empezar no; decisión humana resuelve respuesta investigada',t=>{
  const root=repo(t);create(root,'DISC-1');
  let r=applyWorkMutation(root,{workId:'DISC-1',expectedRevision:1,actions:[
    {type:'discovery.source.add',source:{id:'S-1',kind:'user_statement',ref:'Conversación',observedAt:new Date().toISOString()}},
    {type:'discovery.question.add',question:{id:'Q-1',question:'¿Qué compatibilidad?',whyItMatters:'Afecta alcance',impact:'material',sourceIds:['S-1']}},
    {type:'discovery.question.answer',questionId:'Q-1',answer:{text:'La documentación indica X',kind:'investigated',sourceIds:['S-1'],reportedAt:new Date().toISOString()}}
  ]});
  let work=readWork(root,'DISC-1');assert.equal(deriveWorkReadiness(work).ready,false);
  r=applyWorkMutation(root,{workId:'DISC-1',expectedRevision:r.revision,actions:[{type:'task.add',task:{id:'T-1',title:'Implementar',criterionIds:['AC-1'],agent:null,status:'pending',dependsOn:[],writeScope:[],resources:[],acceptance:['Completar'],evidenceIds:[],summary:''}}]});
  assert.throws(()=>applyWorkMutation(root,{workId:'DISC-1',expectedRevision:r.revision,actions:[{type:'task.set_status',taskId:'T-1',status:'in_progress'}]}),/No se puede iniciar implementación/);
  assert.throws(()=>applyWorkMutation(root,{workId:'DISC-1',expectedRevision:r.revision,actions:[{type:'discovery.question.answer',questionId:'Q-1',answer:{text:'Otra cosa',kind:'user_reported',sourceIds:['S-1'],reportedAt:new Date().toISOString()}}]}),/es inmutable/);
  applyWorkMutation(root,{workId:'DISC-1',expectedRevision:r.revision,actions:[{type:'discovery.decision.add',decision:{id:'D-1',questionIds:['Q-1'],statement:'Compatibilidad X',rationale:'Confirmado con la persona usuaria',status:'confirmed',confirmedBy:'user_reported',confirmedAt:new Date().toISOString(),sourceIds:['S-1']}}]});
  assert.equal(deriveWorkReadiness(readWork(root,'DISC-1')).ready,true);
});

test('Pregunta de investigación se resuelve con hallazgo citado sin fabricar decisión humana',t=>{
  const root=repo(t);create(root,'DISC-2');
  const r=applyWorkMutation(root,{workId:'DISC-2',expectedRevision:1,actions:[
    {type:'discovery.source.add',source:{id:'S-1',kind:'official_documentation',ref:'manual-v1',observedAt:new Date().toISOString()}},
    {type:'discovery.question.add',question:{id:'Q-1',question:'¿La API soporta formato Y?',whyItMatters:'Determina implementación',impact:'material',resolutionKind:'investigation',sourceIds:['S-1']}},
    {type:'discovery.question.answer',questionId:'Q-1',answer:{text:'Sí, desde v1',kind:'investigated',sourceIds:['S-1'],reportedAt:new Date().toISOString()}}
  ]});
  assert.equal(deriveWorkReadiness(readWork(root,'DISC-2')).implementationReady,true);
  assert.equal(readWork(root,'DISC-2').discovery.decisions.length,0);
  assert.equal(r.revision,2);
});

test('Supuesto rechazado mantiene bloqueo hasta documentar resolución y fuente',t=>{
  const root=repo(t);create(root,'DISC-3');
  const r=applyWorkMutation(root,{workId:'DISC-3',expectedRevision:1,actions:[
    {type:'discovery.source.add',source:{id:'S-1',kind:'repository',ref:'src/config',observedAt:new Date().toISOString()}},
    {type:'discovery.assumption.add',assumption:{id:'A-1',statement:'No se soporta Y',impact:'material',validation:'Revisar código',status:'open',sourceIds:['S-1']}}
  ]});
  assert.throws(()=>applyWorkMutation(root,{workId:'DISC-3',expectedRevision:r.revision,actions:[{type:'discovery.assumption.resolve',assumptionId:'A-1',status:'rejected',sourceIds:['S-1']}]}),/resolution/);
  applyWorkMutation(root,{workId:'DISC-3',expectedRevision:r.revision,actions:[{type:'discovery.assumption.resolve',assumptionId:'A-1',status:'rejected',sourceIds:['S-1'],resolution:'La premisa no aplica; el alcance excluye Y.'}]});
  assert.equal(deriveWorkReadiness(readWork(root,'DISC-3')).implementationReady,true);
});
