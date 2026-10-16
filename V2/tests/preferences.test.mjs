import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {composeNativeFiles} from '../lib/composition.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'agents/catalog.json'),'utf8'));
const native=composeNativeFiles({root});
test('principal transmite preferencias pertinentes sin inventarlas ni elevar permisos',()=>{
 const prompt=native.get('.opencode/agents/sol.md');
 for(const clause of [/Respeta AGENTS\.md aplicable y preferencias vigentes/,/Incluye en cada encargo.*origen conocido/,/No inventes preferencias/,/conflicto material.*interacción nativa/,/no pidas saltarse instrucciones superiores/])assert.match(prompt,clause);
});
test('los nueve especialistas reciben preferencias, jerarquía y prohibición de escalación',()=>{
 assert.equal(catalog.specialists.length,9);
 for(const {id} of catalog.specialists){
  const prompt=native.get(`.opencode/agents/${id}.md`);
  for(const clause of [/instrucciones aplicables de AGENTS\.md/,/preferencias pertinentes del encargo dentro de su jerarquía/,/Comunica a Sol cualquier conflicto material/,/no cambies configuración, credenciales ni aprobaciones/])assert.match(prompt,clause,id);
 }
});
test('delegación expresa preferencias pertinentes dentro del contrato Markdown',()=>{
 const template=fs.readFileSync(path.join(root,'templates/delegation.md'),'utf8');
 for(const clause of [/template: delegation\.md@1\.0/,/preferencias aplicables con su origen conocido/,/rutas\/fuentes.*hallazgos previos/,/Lecturas.*escrituras autorizadas por separado/,/Conducta observable/,/Usa estos encabezados y orden/])assert.match(template,clause);
});
