import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {composeNativeFiles} from '../lib/composition.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const catalog=JSON.parse(await import('node:fs').then(({readFileSync})=>readFileSync(path.join(root,'agents/catalog.json'),'utf8')));
const composed=composeNativeFiles({root});
const agentText=id=>composed.get(`.opencode/agents/${id}.md`);

test('las preferencias aplicables se conservan en el prompt primary de Sol',()=>{
  const prompt=agentText('sol');
  assert.match(prompt,/<applicable_preferences>/);
  assert.match(prompt,/AGENTS\.md` aplicables/);
  assert.match(prompt,/Antes de cada delegación/);
  assert.match(prompt,/pregunta al usuario mediante la herramienta interactiva nativa `question`/);
});

test('el contrato común de preferencias se compone en todos los especialistas',()=>{
  for(const specialist of catalog.specialists){
    const prompt=agentText(specialist.id);
    assert.match(prompt,/<applicable_preferences>/,specialist.id);
    assert.match(prompt,/preferencias explícitas del encargo/,specialist.id);
    assert.match(prompt,/Una preferencia no eleva permisos/,specialist.id);
    assert.match(prompt,/repórtala a Sol/,specialist.id);
  }
});

test('la plantilla de delegación captura preferencias sin alterar su contrato existente',async()=>{
  const {readFileSync}=await import('node:fs');
  const template=readFileSync(path.join(root,'templates/delegation.md'),'utf8');
  assert.match(template,/<!-- template: delegation\.md@1\.0 -->/);
  assert.ok(template.includes('<applicable_preferences>{{Preferencias relevantes, origen/ruta si se conoce e impacto concreto en el encargo; si ninguna aplica, indícalo brevemente.}}</applicable_preferences>'));
  for(const field of ['<context>','<write_scope>','<acceptance>','<constraints>','<return>']) assert.ok(template.includes(field),`falta campo existente ${field}`);
});
