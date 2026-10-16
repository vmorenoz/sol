import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {composeNativeFiles} from '../lib/composition.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const native=composeNativeFiles({root});
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('cada especialista conserva entregas históricas, base acotada y scope',()=>{
 for(const id of ['sol-explorer','sol-executor','sol-code-reviewer','sol-qa-auditor','sol-planner','sol-researcher','sol-security-auditor','sol-plan-auditor','sol-ui-auditor']){
  const prompt=native.get(`.opencode/agents/${id}.md`);
  for(const clause of [/entrega histórica.*no la sobrescribas/,/ruta nueva acordada con Sol/,/base suficiente en las rutas autorizadas/,/Escribe solo el output\/writeScope asignado/,/Markdown normal con esta estructura de mensaje/,/estado declarado/])assert.match(prompt,clause,id);
 }
});

test('persistencia es independiente del formato Markdown y de la autorización',()=>{
 const central=read('agents/sol.md'),common=read('agents/common.md'),docs=read('docs/ORCHESTRATION.md');
 assert.match(central,/autorización de acciones y los permisos del host son independientes de la persistencia/);
 assert.match(central,/No conviertas un encargo persistente incompleto en efímero/);
 assert.match(common,/no fabriques metadata ni reclasifiques un trabajo para evitar su registro/);
 assert.match(docs,/Contrato Markdown de mensajes/);
 assert.match(docs,/cinco encabezados en ese orden/);
 assert.match(docs,/schemas JSON.*estado\/tools/);
 assert.match(docs,/legacy.*no el transporte obligatorio/);
});

test('evidencia preserva cobertura, resultado histórico y límites de ejecución',()=>{
 const common=read('agents/common.md');
 for(const clause of [/todos los criterios\/tareas del encargo/,/parcial, no cubierto, bloqueado o no verificable/,/executed, manual, static y not_run/,/no es PASS/,/no prueba por sí solo ejecución/,/ni sumes PASS aislados/,/conserva el resultado histórico/])assert.match(common,clause);
 assert.match(read('agents/sol-explorer.md'),/búsqueda acotada sin resultado no demuestra ausencia global/);
 assert.match(read('agents/sol-code-reviewer.md'),/no tomes documentación antigua.*sin contraste/);
});

test('plantillas preservan historia y fuentes sin exigir dos reportes o parser',()=>{
 const template=read('templates/delegation.md'),catalog=read('templates/README.md');
 assert.match(template,/ruta única.*corrección enlaza la anterior/);
 assert.match(template,/No exigir result\.json, reporte duplicado/);
 assert.match(catalog,/Retirar conocimiento o archivos exige alcance autorizado/);
 assert.match(catalog,/no maximices borrados ni pierdas fuentes únicas/);
 const schema=JSON.parse(read('schemas/result.schema.json'));
 assert.equal(schema.additionalProperties,false,'lectura legacy conserva contrato estricto');
 assert.equal(schema.properties.schemaVersion.const,1);
 assert.equal(Object.hasOwn(schema.properties,'supersedes'),false);
});

test('seis conversaciones son ejemplos no ejecutados, no aceptación nativa',()=>{
 const examples=read('docs/ORCHESTRATION-EXAMPLES.md');
 assert.equal((examples.match(/^## [1-6]\. /gm)||[]).length,6);
 for(const clause of [/ejemplos diseñados, no ejecutados/,/no son evidencia de pruebas/,/No se invocaron modelos/,/no se instalaron herramientas/,/plan-only/,/permiso denegado/,/cambios disjuntos/])assert.match(examples,clause);
 assert.match(read('docs/ORCHESTRATION.md'),/calidad de diálogo.*evaluación conductual posterior/);
});

test('shipping conserva autorización explícita, preview exacta y recibos observados',()=>{
 const ship=read('skills/sol-ship/SKILL.md'),reference=read('skills/sol-ship/references/preflight-and-authorization.md');
 for(const phrase of ['Push y creación de PR solo con autorización explícita','además de permisos/aprobaciones del runtime','commits ajenos pendientes sin consentimiento explícito','si cambia contenido, destino o alcance de acciones','No hagas merge, tag, release, deploy, force push','URL real del PR si existe','no prometas que el host bloquea otras vías'])assert.ok(ship.includes(phrase),phrase);
 for(const event of ['shipping.intent.record','shipping.approval.record','shipping.intent.invalidate','shipping.receipt.record'])assert.ok(reference.includes(event));
 assert.match(reference,/No usa `gh pr create --dry-run`/);
 assert.match(reference,/preflight no autentica al usuario ni autoriza/);
 assert.match(reference,/merge\/tag\/release\/deploy\/force-push/);
});
