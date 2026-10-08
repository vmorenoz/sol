import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {composeNativeFiles} from '../lib/composition.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const native=composeNativeFiles({root});
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const central=native.get('.opencode/agents/sol.md');
const composed=id=>native.get(`.opencode/agents/${id}.md`);

test('la composición nativa distribuye política histórica e inmutabilidad por delegación',()=>{
  for(const id of ['sol-explorer','sol-executor','sol-code-reviewer','sol-qa-auditor','sol-planner']){
    const prompt=composed(id);
    assert.match(prompt,/no sobrescribas una entrega existente/);
    assert.match(prompt,/nuevo delegationId/);
  }
  assert.match(composed('sol-executor'),/baseline suficiente solo en rutas autorizadas/);
  assert.match(composed('sol-code-reviewer'),/changedFiles.*último result.*todo el diff/);
  assert.match(composed('sol-qa-auditor'),/evidencia estructurada/);
  assert.match(central,/TODOS los frentes autorizados/);
});

test('formal persistente y efímero conversacional tienen contratos distintos sin IDs ficticios',()=>{
  const common=read('agents/common.md');
  const delegation=read('templates/delegation.md');
  const docs=read('docs/ORCHESTRATION.md');
  assert.match(central,/Formal persistente/);
  assert.match(central,/Conversacional efímero/);
  assert.match(central,/respuesta narrativa en chat/);
  assert.match(central,/Efímero: indica que responda en chat, sin output de archivo/);
  assert.match(central,/nunca lo reclasifiques como efímero para saltar el registro/);
  assert.match(composed('sol-explorer'),/no requiere Work\/taskIds\/report\/result\.json/);
  assert.match(composed('sol-explorer'),/no fabriques workId\/taskIds\/revisión/);
  assert.match(common,/En formal persistente verifica delegationId, workId, workRevision, taskIds existentes/);
  assert.match(common,/En conversacional efímero.*no requiere Work\/taskIds\/report\/result\.json/);
  assert.match(common,/Si caller pidió formal.*no eludas registro real convirtiéndolo a chat/);
  assert.match(delegation,/formal-persistent \| conversational-ephemeral/);
  assert.match(delegation,/Efímero: respuesta en chat, sin report\/result\.json/);
  assert.match(delegation,/no reclasificarlo como efímero/);
  assert.match(docs,/modo \*\*formal persistente\*\* o \*\*conversacional efímero\*\*/);
  assert.match(docs,/Encargo formal sin IDs requeridos se corrige o bloquea/);
  assert.match(common,/En modo formal persistente, resultados e informes.*históricos/);
});

test('los informes distinguen cobertura completa, ejecución y trazabilidad estructurada',()=>{
  const common=read('agents/common.md');
  for(const phrase of [
    'no sumes PASS parciales como aceptación global',
    'tomes la última subtask como cobertura acumulada',
    'Un informe narrativo no es evidencia estructurada',
    'static`, `manual`, `executed` y `not_run`',
    'no es evidencia estructurada ni demuestra que el comando se ejecutó',
  ]) assert.ok(common.includes(phrase),`falta regla común: ${phrase}`);
  const templates=['templates/implementation.md','templates/review.md','templates/delivery.md'].map(read).join('\n');
  for(const state of ['covered','partial','uncovered','blocked','unverifiable']) assert.ok(templates.includes(state));
  assert.match(read('agents/sol-explorer.md'),/No encontrado.*desconocido, no ausencia global/);
  assert.match(read('agents/sol-code-reviewer.md'),/documentación stale como autoridad única/);
});

test('reglas condicionales de flujo y limpieza preservan semántica e historia',()=>{
  const exploration=read('templates/exploration.md');
  const templates=[exploration,read('templates/review.md'),read('templates/README.md'),read('docs/ORCHESTRATION.md')].join('\n');
  assert.match(templates,/entrada→servicio→contrato→persistencia\/backend→resultado/);
  assert.match(templates,/No hallado en búsqueda acotada significa desconocido/);
  assert.match(templates,/clasifica.*vigente.*histórico.*obsoleto/is);
  assert.match(templates,/fuentes únicas/);
  assert.match(templates,/no simula runtime/);
});

test('correcciones usan output único y no alteran el contrato JSON estricto',()=>{
  const delegation=read('templates/delegation.md');
  const common=read('agents/common.md');
  assert.match(delegation,/Formal: ruta única por delegationId/);
  assert.match(delegation,/Output formal ocupado.*nueva ruta/);
  assert.match(delegation,/una corrección conserva taskIds\/revisión pertinentes/);
  assert.match(common,/Si Sol asignó output ocupado.*corregir el encargo/is);
  assert.match(common,/nunca agregues campos al JSON estricto/);
  assert.match(common,/No borres ni regeneres fingerprints/);
  const schema=JSON.parse(read('schemas/result.schema.json'));
  assert.equal(schema.additionalProperties,false);
  assert.equal(schema.properties.schemaVersion.const,1);
  assert.equal(Object.hasOwn(schema.properties,'supersedes'),false);
});

test('estas son aserciones textuales offline, no aceptación del runtime live',()=>{
  assert.match(read('docs/ORCHESTRATION.md'),/no ejecutan un modelo ni demuestran autonomía o aceptación live/);
  assert.match(read('docs/ORCHESTRATION.md'),/No se promete ejecución automatizada de estas reglas/);
});

test('la guía de entrega separa autorización del host, preview exacta y recibos observados',()=>{
  const ship=read('skills/sol-ship/SKILL.md');
  const reference=read('skills/sol-ship/references/preflight-and-authorization.md');
  for(const phrase of [
    'Push y creación de PR solo con autorización explícita',
    'además de permisos/aprobaciones del runtime',
    'commits ajenos pendientes sin consentimiento explícito',
    'si cambia contenido, destino o alcance de acciones',
    'No hagas merge, tag, release, deploy, force push',
    'URL real del PR si existe',
    'no prometas que el host bloquea otras vías',
  ]) assert.ok(ship.includes(phrase),`falta política de entrega: ${phrase}`);
  for(const event of ['shipping.intent.record','shipping.approval.record','shipping.intent.invalidate','shipping.receipt.record']) assert.ok(reference.includes(event),`falta evento documentado ${event}`);
  assert.match(reference,/No usa `gh pr create --dry-run`/);
  assert.match(reference,/preflight no autentica al usuario ni autoriza/);
  assert.match(reference,/merge\/tag\/release\/deploy\/force-push/);
});
