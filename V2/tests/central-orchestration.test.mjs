import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {composeNativeFiles} from '../lib/composition.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const composed=composeNativeFiles({root});
const prompt=composed.get('.opencode/agents/sol.md');

test('el agente central compuesto conserva límites y gates de seguridad',()=>{
  assert.match(prompt,/Usa SOLO la delegación, herramientas, permisos, sesiones y paralelismo que el runtime expone/);
  assert.match(prompt,/No configures providers, credenciales, permisos, reglas Git compartidas/);
  assert.match(prompt,/vista previa, confirmación interactiva nueva y aprobación del host/);
  assert.match(prompt,/No escribas \.sol\/state\.json, history\.jsonl ni work\.json/);
  assert.match(prompt,/sol_work_close` exige aceptación positiva vigente/);
});

test('el contrato central cubre inventario multiobjetivo y continuidad sin recordatorios',()=>{
  const section=prompt.match(/<multi_objective_continuity>([\s\S]*?)<\/multi_objective_continuity>/)?.[1];
  assert.ok(section,'falta política de continuidad multiobjetivo');
  for(const clause of [
    /TODOS los frentes autorizados/,
    /siguiente acción, dependencias, bloqueos y aceptación/,
    /conserva los demás frentes/,
    /siguiente acción ya autorizada, sin esperar «avanza\/procede»/,
    /Serializa todas las mutaciones del mismo Work/,
    /taskIds existentes/,
    /ID de delegación propio.*no es sessionID/,
    /contratos compartidos.*metadata en paralelo/,
    /petición nueva de administración/,
  ]) assert.match(section,clause);
});

test('recuperación local distingue bloqueos, contrato y escritura documental de metadata',()=>{
  const section=prompt.match(/<local_recovery_and_contracts>([\s\S]*?)<\/local_recovery_and_contracts>/)?.[1];
  assert.ok(section,'falta política local de recovery');
  for(const clause of [
    /solo a las ramas que dependen/,
    /editar documentos Markdown\/producto dentro del writeScope/,
    /retorno «blocked» es un diagnóstico/,
    /no está en PATH/,
    /schema\/API vigente/,
    /inspecciona recibo\/estado antes de repetir/,
    /no cancela frentes sin dependencia/,
    /no autorización para borrar/,
  ]) assert.match(section,clause);
});

test('metadata aplica enums canónicos y evidencia, revisión y cierre requieren aceptación',()=>{
  for(const clause of [
    /documents\[\]\.kind.*`work`, `spec`, `plan`, `research`, `review`, `decision`, `delivery`, `evidence` o `project`/,
    /evidence\[\]\.kind.*`executed`, `manual`, `static` o `not_run`/,
    /Referencias `taskIds` deben existir en el Work/,
    /diferencia evidencia observada de autoinforme/,
    /Registra evidencia real y revisión vigente/,
    /No presentes checks de prompt\/offline como conducta autónoma o aceptación live/,
  ]) assert.match(prompt,clause);
});

test('síntesis final informa por frente hallazgos, ejecución y límites',()=>{
  assert.match(prompt,/sintetiza cada frente con resultado\/hallazgos, qué se ejecutó y qué no, evidencia y bloqueos\/limitaciones/);
  assert.match(prompt,/No presentes checks de prompt\/offline como conducta autónoma o aceptación live de OpenCode/);
});

test('el descubrimiento integrado evita cuotas y conserva un interlocutor con follow-up adaptativo',()=>{
  for(const clause of [
    /qué\/por qué.*cómo\/viabilidad/,
    /Pregunta solo por incertidumbres que cambien materialmente/,
    /Evita cuotas, puntuaciones, rondas fijas y confirmaciones repetidas/,
    /Adapta follow-up a la respuesta/,
    /Sol es el único interlocutor/,
    /research\/exploration\/specification\/planning/,
    /Bloquea solo implementación\/acción dependiente/,
  ]) assert.match(prompt,clause);
});

test('skills de flujo se enrutan como atajos, no como pipeline ni permisos',()=>{
  for(const skill of ['sol-new-project','sol-onboard','sol-discuss','sol-plan','sol-execute','sol-verify','sol-ship','sol-discovery']) assert.ok(prompt.includes(skill),`falta ruta ${skill}`);
  assert.match(prompt,/no encadenes todas por defecto/);
  assert.match(prompt,/Las skills son guías, no estado ni permisos/);
  assert.match(prompt,/Use native `skill` with exact ID/);
  assert.match(prompt,/Neighboring references are not auto-loaded/);
  assert.match(prompt,/Do not auto-load for greeting, a plain read-only\/status query, or every Work/);
  assert.match(prompt,/explicit request to resume\/continue routes to `sol-resume`/);
  assert.match(prompt,/read-only\/Plan mode/);
});
