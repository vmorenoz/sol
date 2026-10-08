import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const skills=['sol-new-project','sol-onboard','sol-discuss','sol-plan','sol-execute','sol-verify','sol-ship','sol-discovery'];
const discoveryRefs=['interview-lenses.md','evidence-triage.md','rich-questions.md','adaptive-dialogue.md','decision-handoff.md','sufficiency.md','context-map.md'];

function frontmatter(source){return source.match(/^---\n([\s\S]*?)\n---\n/)?.[1]??'';}

test('cada atajo existe como recurso de conversación con alcance explícito',()=>{
  for(const id of skills){
    const body=read(`skills/${id}/SKILL.md`);
    assert.match(body,new RegExp(`name: ${id}`));
    assert.match(body,/description:/);
    assert.ok(body.length>300,`${id} parece solo un stub`);
    for(const line of frontmatter(body).split('\n')) if(line.trim()) assert.match(line,/^(name|description|slash):\s/,'frontmatter incluye clave no confirmada por OpenCode V2');
  }
  for(const id of skills.slice(0,7)) assert.match(frontmatter(read(`skills/${id}/SKILL.md`)),/^slash: true$/m);
  assert.match(frontmatter(read('skills/sol-discovery/SKILL.md')),/^slash: false$/m);
});

test('el índice de discovery carga referencias selectivamente y el grafo local está cerrado',()=>{
  const index=read('skills/sol-discovery/SKILL.md');
  const linked=[...new Set([...index.matchAll(/references\/([a-z0-9-]+\.md)/g)].map(match=>match[1]))].sort();
  assert.deepEqual(linked,[...discoveryRefs].sort(),'todos los links deben apuntar a recursos incluidos, sin referencias ocultas');
  assert.ok(index.includes('references/evaluation-cases.json'));
  for(const ref of discoveryRefs){
    assert.ok(index.includes(`references/${ref}`),`no hay ruta de carga para ${ref}`);
    const body=read(`skills/sol-discovery/references/${ref}`);
    assert.ok(body.length>700,`${ref} debe contener procedimiento desarrollado`);
    assert.match(body,/refs@1/);
  }
  const ship=read('skills/sol-ship/SKILL.md');
  assert.deepEqual([...ship.matchAll(/references\/([a-z0-9-]+\.md)/g)].map(match=>match[1]),['preflight-and-authorization.md']);
  assert.ok(ship.includes('references/preflight-and-authorization.md'));
  assert.ok(read('skills/sol-ship/references/preflight-and-authorization.md').length>1200);
});

test('el caso de evaluación mantiene separados resumen fuente, observación, obligación y límite',()=>{
  const fixture=JSON.parse(read('skills/sol-discovery/references/evaluation-cases.json'));
  assert.equal(fixture.schemaVersion,1);
  assert.equal(fixture.kind,'conversational_evaluation_case');
  assert.equal(fixture.evaluationStatus,'not_retested');
  assert.equal(fixture.evidenceClass,'user_provided_transcript_summary');
  assert.match(fixture.provenance.productUnderTest,/Not installed Sol/);
  assert.ok(fixture.provenance.limitations.some(x=>/no observed third/i.test(x)));
  assert.equal(fixture.case.observedTurns.length,2,'no fabricar turno/answer adicional');
  const facts=fixture.case.observedTurns[0].userAnswer.join(' ');
  for(const fact of ['tres academias independientes','no mueve dinero','solo ve sus cursos y ventas','director','varias academias','sin aprobación administrativa']) assert.ok(facts.toLowerCase().includes(fact),`falta hecho reportado ${fact}`);
  assert.match(fixture.case.observedTurns[1].assistantQuestionQuote,/comprar sin cobro real/);
  assert.ok(fixture.desiredObligations.some(x=>/provisional, easily correctable behavior/.test(x)));
  assert.ok(fixture.desiredObligations.some(x=>/tenant\/trust-boundary\/privacy/.test(x)));
  assert.ok(fixture.evaluationUse.notEvidenceOf.some(x=>/successful retest/.test(x)));
  assert.match(fixture.evaluationUse.appliesTo,/historical controlled resource exercise/);
  const native=fixture.nativeObservedEvaluation;
  assert.equal(native.recordedOutcome,'four_synthetic_cases_recorded_pass');
  assert.equal(native.evidenceClass,'operator_record_of_native_sessions');
  assert.equal(native.runtime.opencode,'2.0.22');
  assert.equal(native.runtime.model,'openai/gpt-6-luna');
  assert.match(native.recordRef,/native-acceptance-tejU2F\/evaluation-record\.json$/);
  assert.deepEqual(native.cases.map(item=>item.caseId),['A-clear-discount','B-academy-discovery-plan','C-brownfield-academy-csv','D-contract-contradiction-and-resume']);
  assert.ok(native.cases.every(item=>item.recordedStatus==='PASS'));
  assert.ok(native.cases.find(item=>item.caseId.startsWith('D-')).limitation.includes('Work is open'));
  assert.ok(native.limits.some(x=>/seven challenge examples/.test(x)));
  assert.ok(native.limits.some(x=>/microconfirmation exercise above remains not_retested/.test(x)));
  assert.ok(native.limits.some(x=>/nativeRuntime NOT_RUN/.test(x)));
});

test('documenta resultados nativos acotados sin convertirlos en cobertura universal ni Ship PASS',()=>{
  const docs=read('docs/DISCOVERY.md');
  assert.match(docs,/Evidencia de evaluación nativa observada/);
  for(const phrase of ['OpenCode 2.0.22','5\/5','ACADEMIES-PLAN','isDirectorOf','sesión nueva recuperó la decisión','Ship continúa pendiente','nativeRuntime: NOT_RUN','búsqueda truncada']) assert.ok(docs.includes(phrase),`falta evidencia/límite ${phrase}`);
  assert.match(docs,/no transcripciones completas/);
  assert.match(docs,/no se reescribe como PASS de Sol/);
  assert.doesNotMatch(docs,/Ship (?:completado|exitoso)|PR creada|merge realizado/i);
});

test('casos de evaluación cubren verde, brownfield y premisa contradictoria sin cuota de preguntas',()=>{
  const evals=read('docs/DISCOVERY.md');
  const cases=[
    {id:'greenfield',must:['Greenfield: «hazlo más rápido»','no elige tecnología aún']},
    {id:'brownfield',must:['Brownfield: «añade OAuth»','ADR dice sesión local','callback parcial']},
    {id:'fact contradiction',must:['manifiesto accesible declara 50','comunica discrepancia']},
    {id:'follow-up changes solution',must:['sustituye la decisión anterior','conserva el resto']},
    {id:'authorization',must:['permiso explícito y aprobación host','recibo observado']},
    {id:'unknown',must:['No hay datos','desconocido','búsqueda truncada']},
  ];
  for(const scenario of cases) for(const phrase of scenario.must) assert.ok(evals.toLowerCase().includes(phrase.toLowerCase()),`${scenario.id}: falta ${phrase}`);
  for(const rubric of ['Contexto y escucha','Detección de grises','Investigación y procedencia','Calidad de la pregunta','Adaptación','Suficiencia y continuidad','Identidad/autoridad']) assert.ok(evals.includes(rubric),`falta rúbrica ${rubric}`);
});

test('plantillas permiten trazabilidad y procedencia sin reemplazar metadata canónica',()=>{
  const research=read('templates/research.md');
  const spec=read('templates/spec.md');
  const plan=read('templates/plan.md');
  assert.match(research,/Fuente exacta/);
  assert.match(research,/Recomendación condicional/);
  assert.match(research,/Sin puntuación\/cuota/);
  assert.match(spec,/confirmada\/propuesta\/abierta/i);
  assert.match(plan,/Objetivo\/AC.*Resultado\/verdad esperada.*Tarea\(s\).*Comprobación observable/);
  assert.match(plan,/productor→contrato→consumidor→resultado/);
  assert.match(plan,/research\/exploration\/specification\/planning/);
});

test('guía de contexto usa el contrato real de acciones, anclas y frescura sin sobreafirmar',()=>{
  const map=read('skills/sol-discovery/references/context-map.md');
  const template=read('templates/project.md');
  const schema=JSON.parse(read('schemas/work-update.schema.json'));
  const action=type=>schema.properties.actions.items.anyOf.find(branch=>branch.properties?.type?.const===type);
  assert.ok(action('discovery.context.set').properties.contextLane);
  for(const field of ['id','kind','ref','observedAt','path','inspection']) assert.ok(action('discovery.source.add').properties.source.properties[field],`source schema: ${field}`);
  for(const field of ['id','kind','statement','sourceIds']) assert.ok(action('discovery.claim.add').properties.claim.properties[field],`claim schema: ${field}`);
  for(const term of ['sol_work_apply','fileSha256','caller','completeProjectMap','inspectContextMap','current','stale','legacy_unverified','not_mapped','greenfield','project-in-existing-repo']) assert.ok(map.includes(term),`context-map: ${term}`);
  assert.match(map,/<!-- claim:C-1 --> <!-- source:S-1 -->/);
  assert.match(template,/<!-- claim:ID -->/);
  assert.match(map,/no verdad semántica/i);
  assert.match(map,/no reescribas automáticamente un Work cerrado/i);
});

test('guía de Ship enruta autorización por tool dedicada, no mutación pública del ledger',()=>{
  const skill=read('skills/sol-ship/SKILL.md');
  const guide=read('skills/sol-ship/references/preflight-and-authorization.md');
  const delivery=read('templates/delivery.md');
  for(const body of [skill,guide,delivery]){
    assert.ok(body.includes('sol_ship_preflight'));
    assert.ok(body.includes('sol_ship_authorize'));
    assert.match(body,/shipping\.approval\.record[^\n]{0,150}(?:filtrada|no llamar|no autoriz)/i);
  }
  assert.match(guide,/host.*(?:no|ni).*salta|no.*host approval/i);
  assert.match(guide,/no es autenticación/i);
});

test('formatos de decisión/evidencia/entrega preservan historia, tipado y límites de autorización',()=>{
  const decision=read('templates/decision.md');
  const evidence=read('templates/evidence.md');
  const delivery=read('templates/delivery.md');
  const catalog=read('templates/README.md');
  for(const token of ['propuesta','confirmada','sustituida','fuente de confirmación','supersession']) assert.ok(decision.toLowerCase().includes(token.toLowerCase()),`decision: ${token}`);
  for(const token of ['fact/hypothesis/recommendation/user-reported','histórico','stale','not_run','Nunca PASS requerido']) assert.ok(evidence.toLowerCase().includes(token.toLowerCase()),`evidence: ${token}`);
  for(const token of ['shipping.intent.record','shipping.approval.record','shipping.intent.invalidate','shipping.receipt.record','no autoriza operaciones','host']) assert.ok(delivery.toLowerCase().includes(token.toLowerCase()),`delivery: ${token}`);
  for(const action of ['discovery.source.add','discovery.claim.add','discovery.assumption.add','discovery.assumption.resolve','discovery.question.add','discovery.question.answer','discovery.decision.add','discovery.decision.supersede']) assert.ok(catalog.includes(action),`catálogo debe documentar ${action}`);
  assert.match(catalog,/no inventar `resolutionKind`/i);
});

test('las expectativas son criterios de revisión de transcripción, no un clasificador de PASS conversacional',()=>{
  const docs=read('docs/DISCOVERY.md');
  assert.match(docs,/no demuestran diálogo autónomo o aceptación live/);
  assert.match(docs,/No hay interlocutor investigador paralelo, cuotas, puntuación, rondas obligatorias/);
  assert.doesNotMatch(docs,/PASS automático|puntuación mínima|al menos \d+ preguntas/i);
});
