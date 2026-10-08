import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('recuperación conserva Work/Explorer existente y reconstruye Discovery antes de continuar',()=>{
  const resume=read('skills/sol-resume/SKILL.md');
  const sol=read('agents/sol.md');
  assert.match(resume,/sol_status[\s\S]*sol_work_get[\s\S]*sol_history/);
  assert.match(resume,/Explorador contrastar la base y los cambios reales/);
  for(const concept of ['fuentes','claims','preguntas y respuestas','supuestos','decisiones confirmadas/propuestas/superseded','razón de sustitución'])
    assert.ok(resume.toLowerCase().includes(concept.toLowerCase()),`falta reconstrucción de ${concept}`);
  assert.match(resume,/no vuelvas a preguntar algo respondido salvo evidencia o contexto nuevo material/);
  assert.match(resume,/explica qué comportamiento\/riesgo cambia/);
  assert.match(sol,/Retoma con sol-resume cuando se pida continuar/);
});

test('readiness, frescura y map status se informan conservadoramente con APIs/estados vigentes',()=>{
  const resume=read('skills/sol-resume/SKILL.md');
  const workflow=read('docs/WORKFLOW.md');
  for(const status of ['not_mapped','legacy_unverified','stale','current']) assert.ok(resume.includes(status),`map status ${status}`);
  assert.match(resume,/sol_work_validate\(fresh:true\)/);
  assert.match(resume,/ledger, anclas literales de `project\.md` y fingerprints/);
  assert.match(resume,/readiness de implementación[\s\S]*readiness de completion/);
  assert.match(resume,/contrato cambió o sus archivos están stale/);
  assert.match(resume,/sin crear `implementationReady`, `completionReady`/);
  assert.match(workflow,/No reinicies fases completas/);
  assert.match(workflow,/ni equivale a acceptance actual/);
});

test('recuperación de Ship nunca convierte metadata persistida en autoridad y Plan/readonly no persisten',()=>{
  const resume=read('skills/sol-resume/SKILL.md');
  const workflow=read('docs/WORKFLOW.md');
  assert.match(resume,/sol_ship_preflight/);
  assert.match(resume,/shipping\.approval\.record/);
  assert.match(resume,/sol_ship_authorize/);
  assert.match(resume,/nueva sesión/);
  assert.match(resume,/no reconstruyas “approved”/);
  assert.match(resume,/solo lectura o un plan[\s\S]*no persistas cambios, no reabras ni delegues seguimiento formal/);
  assert.match(workflow,/intención\/preview\/recibos de Ship preservan destino y scope pero no la autorización privada/);
  assert.match(workflow,/readonly o un plan no persiste cambios/);
});

test('esta suite solo verifica presencia de guía, no comportamiento nativo/live',()=>{
  const source=read('skills/sol-resume/SKILL.md');
  assert.match(source,/Sol, no un nuevo agente ni un script autónomo/);
  assert.match(source,/No lances otros runtimes/);
});
