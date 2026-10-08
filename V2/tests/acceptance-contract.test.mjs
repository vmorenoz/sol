import test from 'node:test';
import assert from 'node:assert/strict';
import {repo,ready,readWork,saveWork} from './helpers.mjs';
import {applyWorkMutation} from '../lib/work-mutations.mjs';
import {closeWork,createWork} from '../lib/artifacts.mjs';
import {atomicWrite} from '../lib/fs.mjs';

test('Editar criterio desactiva enlaces sin reescribir la evidencia observada y propaga a dependientes',t=>{
  const root=repo(t);ready(root,'AC-EDIT');
  const before=readWork(root,'AC-EDIT');
  before.tasks.push({id:'T-2',title:'Dependiente',kind:'implementation',contractRevision:1,criterionIds:['AC-1'],agent:'sol-executor',status:'done',dependsOn:['T-1'],writeScope:['src/value.mjs'],resources:[],acceptance:['Comprobar salida'],evidenceIds:['E-1'],summary:'completada'});
  before.evidence[0].taskIds.push('T-2');before.tasks[0].dependsOn=[];
  const saved=saveWork(root,before,2);
  const original=structuredClone(saved.evidence[0]);
  applyWorkMutation(root,{workId:'AC-EDIT',expectedRevision:saved.revision,actions:[{type:'criterion.update',criterionId:'AC-1',reason:'Cambió el requisito',description:'Cubre también el caso límite'}]});
  const work=readWork(root,'AC-EDIT');
  assert.equal(work.objective.criteria[0].contractRevision,2);
  assert.equal(work.tasks[0].status,'pending');
  assert.equal(work.tasks[1].status,'pending');
  assert.equal(work.tasks[1].contractRevision,2);
  assert.deepEqual(work.evidence[0],original);
  assert.equal(work.objective.criteria[0].evidenceIds.length,0);
  assert.deepEqual(work.tasks.map(task=>task.evidenceIds),[[],[]]);
});

test('Work clasificado solo como investigación cierra sus AC aunque quede unknown de implementación',t=>{
  const root=repo(t);createWork(root,{id:'RESEARCH-CLOSE',title:'Investigar API',objective:'Documentar soporte',criterion:'La compatibilidad está identificada',verification:'Informe con fuente'});
  applyWorkMutation(root,{workId:'RESEARCH-CLOSE',expectedRevision:1,actions:[
    {type:'discovery.source.add',source:{id:'SRC-1',kind:'repository',ref:'repo docs',observedAt:new Date().toISOString()}},
    {type:'discovery.question.add',question:{id:'Q-1',question:'¿Se soporta la plataforma Z?',whyItMatters:'Futuro alcance',impact:'material',sourceIds:['SRC-1']}},
    {type:'task.add',task:{id:'R-1',title:'Investigar soporte',kind:'research',criterionIds:['AC-1'],agent:'sol-researcher',status:'pending',dependsOn:[],writeScope:[],resources:[],acceptance:['Registrar fuente y conclusión'],evidenceIds:[],summary:''}}
  ]});
  atomicWrite(root,'src/research.md','Conclusión basada en fuente documentada.\n');
  atomicWrite(root,'.sol/work/RESEARCH-CLOSE/evidence/R-1.md','# Investigación\n');
  applyWorkMutation(root,{workId:'RESEARCH-CLOSE',expectedRevision:2,actions:[
    {type:'evidence.add',evidence:{id:'ER-1',kind:'static',status:'pass',taskIds:['R-1'],report:'.sol/work/RESEARCH-CLOSE/evidence/R-1.md',command:null,cwd:'.',exitCode:null,basis:'Revisión del informe',files:['src/research.md'],summary:'La pregunta de investigación queda contestada.'}},
    {type:'task.set_status',taskId:'R-1',status:'done'}
  ]});
  const closed=closeWork(root,'RESEARCH-CLOSE',{summary:'Investigación completada; plataforma Z queda fuera del alcance implementado.'});
  assert.equal(closed.status,'done');
});

test('Work de implementación no reporta done con incertidumbre material abierta',t=>{
  const root=repo(t);createWork(root,{id:'IMPL-BLOCK',title:'Implementar',objective:'Implementación',criterion:'Funciona',verification:'Prueba'});
  applyWorkMutation(root,{workId:'IMPL-BLOCK',expectedRevision:1,actions:[
    {type:'discovery.source.add',source:{id:'SRC-1',kind:'user_statement',ref:'Conversación',observedAt:new Date().toISOString()}},
    {type:'discovery.question.add',question:{id:'Q-1',question:'¿Qué plataforma?',whyItMatters:'Cambia el alcance',impact:'material',sourceIds:['SRC-1']}},
    {type:'task.add',task:{id:'I-1',title:'Implementar',criterionIds:['AC-1'],agent:'sol-executor',status:'pending',dependsOn:[],writeScope:[],resources:[],acceptance:['Implementación'],evidenceIds:[],summary:''}},
    {type:'task.set_status',taskId:'I-1',status:'cancelled',summary:'Fixture: no inició implementación'}
  ]});
  assert.throws(()=>closeWork(root,'IMPL-BLOCK',{summary:'No debe cerrar como implementado'}),/no listo para completar/);
});

test('Evidence task-only binding cubre automáticamente AC de tarea y permite marcarla done',t=>{
  const root=repo(t);createWork(root,{id:'TASK-AC',title:'Trabajo',objective:'Resultado',criterion:'AC comprobado',verification:'Informe'});
  applyWorkMutation(root,{workId:'TASK-AC',expectedRevision:1,actions:[{type:'task.add',task:{id:'T-1',title:'Implementar',criterionIds:['AC-1'],agent:'sol-executor',status:'pending',dependsOn:[],writeScope:[],resources:[],acceptance:['AC-1 comprobado'],evidenceIds:[],summary:''}}]});
  atomicWrite(root,'src/proof.txt','proof\n');atomicWrite(root,'.sol/work/TASK-AC/evidence/E-1.md','# Proof\n');
  const r=applyWorkMutation(root,{workId:'TASK-AC',expectedRevision:2,actions:[{type:'evidence.add',evidence:{id:'E-1',kind:'static',status:'pass',taskIds:['T-1'],report:'.sol/work/TASK-AC/evidence/E-1.md',command:null,cwd:'.',exitCode:null,basis:'fixture',files:['src/proof.txt'],summary:'AC verificado'}}]});
  let w=readWork(root,'TASK-AC');assert.deepEqual(w.evidence[0].criterionIds,['AC-1']);assert.equal(w.evidence[0].contractBindings.criteria[0].id,'AC-1');
  applyWorkMutation(root,{workId:'TASK-AC',expectedRevision:r.revision,actions:[{type:'task.set_status',taskId:'T-1',status:'done'}]});
  w=readWork(root,'TASK-AC');assert.equal(w.tasks[0].status,'done');
});

test('task.set_status done exige filesystem freshness real del evidence bound',t=>{
  const root=repo(t);createWork(root,{id:'TASK-STALE',title:'Trabajo',objective:'Resultado',criterion:'AC comprobado',verification:'Informe'});
  applyWorkMutation(root,{workId:'TASK-STALE',expectedRevision:1,actions:[{type:'task.add',task:{id:'T-1',title:'Implementar',criterionIds:['AC-1'],agent:'sol-executor',status:'pending',dependsOn:[],writeScope:[],resources:[],acceptance:['AC-1 comprobado'],evidenceIds:[],summary:''}}]});
  atomicWrite(root,'src/proof.txt','proof\n');atomicWrite(root,'.sol/work/TASK-STALE/evidence/E-1.md','# Proof\n');
  const r=applyWorkMutation(root,{workId:'TASK-STALE',expectedRevision:2,actions:[{type:'evidence.add',evidence:{id:'E-1',kind:'static',status:'pass',taskIds:['T-1'],report:'.sol/work/TASK-STALE/evidence/E-1.md',command:null,cwd:'.',exitCode:null,basis:'fixture',files:['src/proof.txt'],summary:'AC verificado'}}]});
  atomicWrite(root,'src/proof.txt','changed after observation\n');
  assert.throws(()=>applyWorkMutation(root,{workId:'TASK-STALE',expectedRevision:r.revision,actions:[{type:'task.set_status',taskId:'T-1',status:'done'}]}),/Evidencia obsoleta/);
  assert.equal(readWork(root,'TASK-STALE').revision,r.revision);
});

test('task.add no permite saltar directamente a done sin evidencia bound vigente',t=>{
  const root=repo(t);createWork(root,{id:'TASK-ADD-DONE',title:'Trabajo',objective:'Resultado',criterion:'AC comprobado',verification:'Informe'});
  assert.throws(()=>applyWorkMutation(root,{workId:'TASK-ADD-DONE',expectedRevision:1,actions:[{type:'task.add',task:{id:'T-1',title:'Implementar',criterionIds:['AC-1'],agent:'sol-executor',status:'done',dependsOn:[],writeScope:[],resources:[],acceptance:['AC-1 comprobado'],evidenceIds:[],summary:'Hecho'}}]}),/evidencia positiva vigente/);
  assert.equal(readWork(root,'TASK-ADD-DONE').revision,1);
});

test('explicit [] diagnostic fail y not_run vinculados a tarea no vetan cierre con positiva AC',t=>{
  const root=repo(t);createWork(root,{id:'DIAG-CLOSE',title:'Trabajo',objective:'Resultado',criterion:'AC comprobado',verification:'Informe'});
  applyWorkMutation(root,{workId:'DIAG-CLOSE',expectedRevision:1,actions:[{type:'task.add',task:{id:'T-1',title:'Implementar',criterionIds:['AC-1'],agent:'sol-executor',status:'pending',dependsOn:[],writeScope:[],resources:[],acceptance:['AC-1 comprobado'],evidenceIds:[],summary:''}}]});
  atomicWrite(root,'src/proof.txt','proof\n');atomicWrite(root,'.sol/work/DIAG-CLOSE/evidence/E-1.md','# Proof\n');
  atomicWrite(root,'.sol/work/DIAG-CLOSE/evidence/audit.md','# Audit\n');atomicWrite(root,'.sol/work/DIAG-CLOSE/evidence/axe.md','# Axe\n');
  applyWorkMutation(root,{workId:'DIAG-CLOSE',expectedRevision:2,actions:[
    {type:'evidence.add',evidence:{id:'E-1',kind:'static',status:'pass',criterionIds:['AC-1'],taskIds:['T-1'],report:'.sol/work/DIAG-CLOSE/evidence/E-1.md',command:null,cwd:'.',exitCode:null,basis:'fixture',files:['src/proof.txt'],summary:'AC verificado'}},
    {type:'evidence.add',evidence:{id:'E-AUDIT',kind:'executed',status:'fail',criterionIds:[],taskIds:['T-1'],report:'.sol/work/DIAG-CLOSE/evidence/audit.md',command:'npm audit',cwd:'.',exitCode:1,basis:'diagnóstico audit',files:['src/proof.txt'],summary:'vulnerabilidad detectada'}},
    {type:'evidence.add',evidence:{id:'E-AXE',kind:'not_run',status:'not_run',criterionIds:[],taskIds:['T-1'],report:'.sol/work/DIAG-CLOSE/evidence/axe.md',command:null,cwd:'.',exitCode:null,basis:'diagnóstico axe',files:['src/proof.txt'],summary:'axe no ejecutado'}},
    {type:'task.set_status',taskId:'T-1',status:'done'}
  ]});
  const closed=closeWork(root,'DIAG-CLOSE',{summary:'Cierre con AC positiva y diagnósticos no bloqueantes'});
  assert.equal(closed.status,'done');
});

test('evidencia negativa ligada a criterio requerido sigue bloqueando el cierre',t=>{
  const root=repo(t);createWork(root,{id:'REQ-FAIL',title:'Trabajo',objective:'Resultado',criterion:'AC comprobado',verification:'Informe'});
  applyWorkMutation(root,{workId:'REQ-FAIL',expectedRevision:1,actions:[{type:'task.add',task:{id:'T-1',title:'Implementar',criterionIds:['AC-1'],agent:'sol-executor',status:'pending',dependsOn:[],writeScope:[],resources:[],acceptance:['AC-1 comprobado'],evidenceIds:[],summary:''}}]});
  atomicWrite(root,'src/proof.txt','proof\n');atomicWrite(root,'.sol/work/REQ-FAIL/evidence/E-1.md','# Proof\n');
  atomicWrite(root,'.sol/work/REQ-FAIL/evidence/E-2.md','# Fail\n');
  applyWorkMutation(root,{workId:'REQ-FAIL',expectedRevision:2,actions:[
    {type:'evidence.add',evidence:{id:'E-1',kind:'static',status:'pass',criterionIds:['AC-1'],taskIds:['T-1'],report:'.sol/work/REQ-FAIL/evidence/E-1.md',command:null,cwd:'.',exitCode:null,basis:'fixture',files:['src/proof.txt'],summary:'AC verificado'}},
    {type:'evidence.add',evidence:{id:'E-2',kind:'executed',status:'fail',criterionIds:['AC-1'],taskIds:['T-1'],report:'.sol/work/REQ-FAIL/evidence/E-2.md',command:'test',cwd:'.',exitCode:1,basis:'fallo de criterio',files:['src/proof.txt'],summary:'criterio fallido'}},
    {type:'task.set_status',taskId:'T-1',status:'done'}
  ]});
  assert.throws(()=>closeWork(root,'REQ-FAIL',{summary:'No debe cerrar'}),/Aceptación contiene evidencia no positiva: AC-1/);
});

test('evidencia diagnóstica positiva sola (criterionIds: []) no satisface AC de tarea ni permite cerrar',t=>{
  const root=repo(t);createWork(root,{id:'DIAG-ONLY',title:'Trabajo',objective:'Resultado',criterion:'AC comprobado',verification:'Informe'});
  applyWorkMutation(root,{workId:'DIAG-ONLY',expectedRevision:1,actions:[{type:'task.add',task:{id:'T-1',title:'Implementar',criterionIds:['AC-1'],agent:'sol-executor',status:'pending',dependsOn:[],writeScope:[],resources:[],acceptance:['AC-1 comprobado'],evidenceIds:[],summary:''}}]});
  atomicWrite(root,'src/proof.txt','proof\n');atomicWrite(root,'.sol/work/DIAG-ONLY/evidence/E-1.md','# Proof\n');
  applyWorkMutation(root,{workId:'DIAG-ONLY',expectedRevision:2,actions:[
    {type:'evidence.add',evidence:{id:'E-1',kind:'static',status:'pass',criterionIds:[],taskIds:['T-1'],report:'.sol/work/DIAG-ONLY/evidence/E-1.md',command:null,cwd:'.',exitCode:null,basis:'fixture',files:['src/proof.txt'],summary:'diagnóstico pass'}}
  ]});
  assert.throws(()=>applyWorkMutation(root,{workId:'DIAG-ONLY',expectedRevision:3,actions:[{type:'task.set_status',taskId:'T-1',status:'done'}]}),/evidencia positiva vigente para AC-1/);
});

test('criterionIds explícito no vacío mantiene exactamente los criterios indicados sin unión forzada',t=>{
  const root=repo(t);createWork(root,{id:'EXACT-AC',title:'Trabajo',objective:'Resultado',criterion:'AC comprobado',verification:'Informe'});
  applyWorkMutation(root,{workId:'EXACT-AC',expectedRevision:1,actions:[
    {type:'criterion.add',criterion:{id:'AC-2',description:'Segundo criterio',verification:'Prueba'}},
    {type:'task.add',task:{id:'T-1',title:'Implementar',criterionIds:['AC-1','AC-2'],agent:'sol-executor',status:'pending',dependsOn:[],writeScope:[],resources:[],acceptance:['Ambos AC'],evidenceIds:[],summary:''}}
  ]});
  atomicWrite(root,'src/proof.txt','proof\n');atomicWrite(root,'.sol/work/EXACT-AC/evidence/E-1.md','# Proof\n');
  applyWorkMutation(root,{workId:'EXACT-AC',expectedRevision:2,actions:[
    {type:'evidence.add',evidence:{id:'E-1',kind:'static',status:'pass',criterionIds:['AC-1'],taskIds:['T-1'],report:'.sol/work/EXACT-AC/evidence/E-1.md',command:null,cwd:'.',exitCode:null,basis:'fixture',files:['src/proof.txt'],summary:'solo AC-1'}}
  ]});
  const w=readWork(root,'EXACT-AC');
  assert.deepEqual(w.evidence[0].criterionIds,['AC-1']);
  assert.deepEqual(w.objective.criteria[0].evidenceIds,['E-1']);
  assert.deepEqual(w.objective.criteria[1].evidenceIds,[]);
});

test('evidence.update preserva criterionIds [] de diagnóstico existente',t=>{
  const root=repo(t);createWork(root,{id:'DIAG-UPDATE',title:'Trabajo',objective:'Resultado',criterion:'AC comprobado',verification:'Informe'});
  applyWorkMutation(root,{workId:'DIAG-UPDATE',expectedRevision:1,actions:[{type:'task.add',task:{id:'T-1',title:'Implementar',criterionIds:['AC-1'],agent:'sol-executor',status:'pending',dependsOn:[],writeScope:[],resources:[],acceptance:['AC-1 comprobado'],evidenceIds:[],summary:''}}]});
  atomicWrite(root,'src/proof.txt','proof\n');atomicWrite(root,'.sol/work/DIAG-UPDATE/evidence/E-1.md','# Proof\n');
  applyWorkMutation(root,{workId:'DIAG-UPDATE',expectedRevision:2,actions:[
    {type:'evidence.add',evidence:{id:'E-1',kind:'static',status:'pass',criterionIds:[],taskIds:['T-1'],report:'.sol/work/DIAG-UPDATE/evidence/E-1.md',command:null,cwd:'.',exitCode:null,basis:'fixture',files:['src/proof.txt'],summary:'diagnóstico original'}}
  ]});
  applyWorkMutation(root,{workId:'DIAG-UPDATE',expectedRevision:3,actions:[
    {type:'evidence.update',evidenceId:'E-1',patch:{summary:'diagnóstico actualizado'}}
  ]});
  const w=readWork(root,'DIAG-UPDATE');
  assert.deepEqual(w.evidence[0].criterionIds,[]);
  assert.equal(w.evidence[0].summary,'diagnóstico actualizado');
});
