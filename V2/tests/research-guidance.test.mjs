import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('research-method está enlazado, selectivo y con procedencia instalada por copia recursiva',()=>{
  const skill=read('skills/sol-discovery/SKILL.md');
  const method=read('skills/sol-discovery/references/research-method.md');
  const notice=read('skills/sol-discovery/references/UPSTREAM-NOTICE.md');
  assert.ok(skill.includes('references/research-method.md'));
  assert.ok(skill.includes('references/UPSTREAM-NOTICE.md'));
  assert.match(method,/refs@1/);
  assert.match(method,/suficiencia/i);
  assert.match(notice,/aeac41d4d005999432bb7312f7ff06383a91d59d/);
  assert.match(notice,/source-driven-development[\s\S]*documentation-and-adrs/);
  assert.match(notice,/MIT License[\s\S]*Permission is hereby granted[\s\S]*THE SOFTWARE IS PROVIDED "AS IS"/);
});

test('rol investigador y research@1.0 respetan los límites de decisión, metadata y artefactos',()=>{
  const role=read('agents/sol-researcher.md');
  const template=read('templates/research.md');
  assert.match(role,/research-method\.md/);
  assert.match(role,/no implementa/);
  assert.match(role,/no modifica metadata\/Work/);
  assert.match(role,/no decide por el usuario/);
  assert.match(template,/template: research@1\.0/);
  assert.match(template,/proporcional|flexible/i);
  assert.match(template,/no duplicar estado canónico/i);
  assert.doesNotMatch(template,/schemaVersion|resolutionKind|sol_work_apply/);
});

test('docs distinguen contenido propio de adaptaciones upstream y no convierten ausencia en evidencia',()=>{
  const docs=read('docs/DISCOVERY.md');
  assert.match(docs,/adapt[aá] selectivamente ideas/);
  assert.match(docs,/No se atribuye a upstream el resto de Sol/);
  assert.match(docs,/«no hallado» no prueba ausencia/);
});
