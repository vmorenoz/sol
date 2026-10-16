import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {composeNativeFiles} from '../lib/composition.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const native=composeNativeFiles({root});
const prompt=native.get('.opencode/agents/sol.md');
const section=name=>{const value=prompt.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1];assert.ok(value,`falta ${name}`);return value;};

test('principal conserva fronteras nativas, permisos y gates de cierre',()=>{
  const native=section('native_opencode_boundary');
  for(const clause of [/OpenCode producto v2/,/herramienta subagent/,/No lances agentes por shell\/SDK/,/denegación explícita.*nunca se elude/,/No cambies providers, credenciales, permisos/,/preview, confirmación y aprobación host/,/shipping expresamente solicitado usa sol-ship/])assert.match(native,clause);
  assert.match(section('canonical_state_and_evidence'),/sol_work_close.*aceptación positiva vigente/);
});

test('selección dinámica conserva todos los frentes y paraleliza por dependencias y capacidad',()=>{
  const body=section('dynamic_orchestration');
  for(const clause of [/todos los frentes autorizados/,/incertidumbre, dependencias, riesgo, capacidad/,/No sigas Researcher→Explorer→Planner/,/contratos API\/DTO.*bases de datos compartidos/,/no asignes el mismo scope a dos escritores/,/sin duplicar trabajo en curso/,/no esperes a una rama independiente/,/Serializa mutaciones del mismo Work/,/revisión independiente.*auth\/permisos\/RLS/])assert.match(body,clause);
});

test('handoff y respuesta de especialista usan contratos Markdown concisos',()=>{
  const body=section('delegation_and_return');
  const delegation=fs.readFileSync(path.join(root,'templates/delegation.md'),'utf8');
  const docs=fs.readFileSync(path.join(root,'docs/ORCHESTRATION.md'),'utf8');
  for(const heading of ['Objetivo','Contexto y referencias','Alcance y restricciones','Criterios de aceptación','Entrega esperada'])assert.ok(delegation.includes(`## ${heading}`),`falta sección de entrada ${heading}`);
  const specialists=JSON.parse(fs.readFileSync(path.join(root,'agents/catalog.json'),'utf8')).specialists;
  for(const {id} of specialists){
    const composed=native.get(`.opencode/agents/${id}.md`);
    for(const heading of ['Resultado','Evidencia y comprobaciones','Pendientes y límites'])assert.ok(composed.includes(`## ${heading}`),`${id} no recibe ## ${heading}`);
    assert.match(composed,/estado declarado/ ,`${id} no recibe el contrato común de respuesta`);
  }
  for(const clause of [/Markdown normal/,/cinco encabezados.*en ese orden/,/No añade parser ni protocolo runtime/,/completed.*estado declarado.*aceptación/,/parece truncado/,/No reinicies el trabajo ni inventes evidencia/,/correlaciona con la llamada nativa/,/autoinforme no prueba ejecución/,/revisión avanzó.*compara scopes, contratos, decisiones y base.*integra lo disjunto.*sin sobrescribir cambios posteriores/,/Work requiere evidencia.*ruta Markdown.*writeScope.*archivos fingerprintables.*históricas.*código como sustituto del report/,/No exijas JSON/,/plantillas de documentos persistentes/])assert.match(body,clause);
  assert.match(docs,/Entrada de Sol → especialista/);
  assert.match(docs,/Respuesta especialista → Sol/);
});

test('recuperación distingue capacidad, denegación, contrato y efecto incierto',()=>{
  const body=section('recovery_and_finish');
  for(const clause of [/blocked.*diagnóstico/,/herramienta ausente, autenticación, permiso/,/command -v negativo.*PATH/,/API\/schema vigente/,/efecto es incierto.*verifica estado\/recibo antes de repetir/,/denegación no se reintenta por otra vía/,/no inventes polling, scheduler/])assert.match(body,clause);
});

test('metadata conserva enums, scope, evidencia real y cierre global',()=>{
  const body=section('canonical_state_and_evidence');
  for(const clause of [/documents\[\]\.kind admite work, spec, plan, research, review, decision, delivery, evidence o project/,/evidence\[\]\.kind distingue executed, manual, static y not_run/,/Sol es el único escritor de metadata/,/expectedRevision vigente/,/Nunca escribas.*state\/history mediante shell\/write\/edit/,/No presentes autoinforme como ejecución observada/,/Cierre global sigue requiriendo aceptación completa/])assert.match(body,clause);
});

test('intención separa plan-only, cambio local y preparación persistente explícita',()=>{
  const body=section('intent_and_authority');
  for(const clause of [/plan-only.*espera antes de implementar/,/Solo.*\/sol-init|solo \/sol-init/,/encargo ordinario.*no lo activa/,/cambio local explícito y acotado puede delegarse en sesión/,/sin fabricar Work\/IDs/,/no bloquees un cambio menor/,/No conviertas un encargo persistente incompleto en efímero/])assert.match(body,clause);
  assert.match(section('recovery_and_finish'),/continúa la siguiente acción autorizada/);
});

test('discovery tiene preguntas adaptativas y suficiencia para el próximo paso',()=>{
  const body=section('discovery_and_decisions');
  for(const clause of [/qué\/por qué y cómo\/viabilidad/,/Investiga lo verificable/,/respuestas humanas.*materialmente/,/recomendación condicional/,/No hay cuotas, puntuaciones ni rondas fijas/,/si es parcial, pregunta solo el residuo/,/La suficiencia sirve al próximo paso/,/continúa frentes independientes/,/dev\/prod/])assert.match(body,clause);
});

test('skills y consultas son selectivas sin convertirlas en un runtime propio',()=>{
  const skills=section('skill_routing');
  for(const id of ['sol-new-project','sol-onboard','sol-discuss','sol-plan','sol-execute','sol-verify','sol-ship','sol-discovery','sol-resume'])assert.ok(skills.includes(id));
  for(const clause of [/ID real/,/no carga automáticamente cuerpos ni archivos vecinos/,/no permisos, estado ni un pipeline/,/No cargues todo el catálogo/])assert.match(skills,clause);
  for(const clause of [/sol_status.*paginados/,/itemId recupera un detalle/,/no abren el contenido de archivos citados/])assert.match(section('context_and_continuity'),clause);
});

test('entrega diferencia resultados, evidencia y aceptación live no observada',()=>{
  const body=section('recovery_and_finish');
  assert.match(body,/resultado útil de cada frente, evidencia ejecutada y no ejecutada/);
  assert.match(body,/checks offline.*conducta autónoma.*aprobación live/);
});
