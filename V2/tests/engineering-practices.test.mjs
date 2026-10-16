import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {composeNativeFiles,solSkillNames} from '../lib/composition.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const skillRoot=path.join(root,'skills/sol-engineering-practices');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
function metadata(text){const match=/^---\n([\s\S]*?)\n---/.exec(text);assert.ok(match);return Object.fromEntries(match[1].split('\n').map(line=>{const i=line.indexOf(':');return [line.slice(0,i),JSON.parse(line.slice(i+1).trim())]}));}

test('mapa fija exactamente 25 fuentes y cada decisión identifica destino/práctica retenida y excluida',()=>{
  const map=JSON.parse(read('skills/sol-engineering-practices/references/upstream-map.json'));
  assert.equal(map.commit,'aeac41d4d005999432bb7312f7ff06383a91d59d');assert.equal(map.destinationBase,'skill-root');assert.ok(map.destinationResolution);
  assert.equal(map.skills.length,25);assert.equal(new Set(map.skills.map(x=>x.source)).size,25);
  for(const item of map.skills){
    assert.ok(item.source&&item.destinations.length&&item.retained&&item.excluded,item.source);
    assert.ok(['adapt','existing','research-owned','reject'].includes(item.decision));
    for(const destination of item.destinations){
      const absolute=path.resolve(skillRoot,destination);assert.ok(absolute.startsWith(root+path.sep));
      if(!fs.existsSync(absolute))assert.ok(item.decision==='research-owned'&&destination==='../../skills/sol-discovery/references/research-method.md',`${item.source} destino ausente: ${destination}`);
    }
  }
});

test('composición lleva aviso MIT y referencias reales al payload sin symlinks',()=>{
  const files=composeNativeFiles({root}),relative=fs.readdirSync(path.join(skillRoot,'references')).filter(x=>fs.statSync(path.join(skillRoot,'references',x)).isFile()).map(x=>`references/${x}`);
  for(const file of ['SKILL.md',...relative])assert.ok(files.has(`.opencode/skills/sol-engineering-practices/${file}`),file);
  for(const [key,bytes] of files){if(key.startsWith('.opencode/skills/sol-engineering-practices/')){const source=path.join(root,'skills',key.slice('.opencode/skills/'.length));assert.deepEqual(Buffer.from(bytes),fs.readFileSync(source),`payload no coincide byte-a-byte: ${key}`);}}
  const notice=String(files.get('.opencode/skills/sol-engineering-practices/references/UPSTREAM-NOTICE.md'));
  assert.match(notice,/Copyright \(c\) 2025 Addy Osmani/);assert.match(notice,/Permission is hereby granted/);assert.match(notice,/THE SOFTWARE IS PROVIDED "AS IS"/);
  assert.ok(solSkillNames.includes('sol-engineering-practices'));
});

test('rutas de skills y roles conectan prácticas sin alterar router, workflows ni límites de autoridad',()=>{
  const skill=read('skills/sol-engineering-practices/SKILL.md');assert.match(skill,/omítela para saludos, status, respuestas simples/);assert.match(skill,/Carga \*\*solo\*\*/);
  for(const file of ['agents/sol.md','agents/common.md','agents/sol-executor.md','agents/sol-planner.md','agents/sol-plan-auditor.md','agents/sol-code-reviewer.md','agents/sol-qa-auditor.md','agents/sol-security-auditor.md','agents/sol-ui-auditor.md','agents/sol-explorer.md','skills/sol-plan/SKILL.md','skills/sol-execute/SKILL.md','skills/sol-verify/SKILL.md'])assert.match(read(file),/sol-engineering-practices/);
  const files=composeNativeFiles({root});
  for(const id of ['sol-executor','sol-planner','sol-plan-auditor','sol-code-reviewer','sol-qa-auditor','sol-security-auditor','sol-ui-auditor','sol-explorer']){
    const body=String(files.get(`.opencode/agents/${id}.md`)),meta=metadata(body);assert.equal(meta.mode,'subagent');assert.ok(meta.permissions.some(rule=>rule.action==='subagent'&&rule.resource==='*'&&rule.effect==='deny'));assert.ok(body.includes('sol-engineering-practices'));
  }
  const sol=String(files.get('.opencode/agents/sol.md')),meta=metadata(sol);assert.ok(sol.includes('sol-engineering-practices'));assert.ok(meta.permissions.some(rule=>rule.action==='subagent'&&rule.resource==='sol-executor'&&rule.effect==='allow'));
  assert.match(read('agents/common.md'),/No invoques otros agentes/);assert.match(read('agents/sol-security-auditor.md'),/No certifiques cumplimiento/);assert.match(read('skills/sol-ship/SKILL.md'),/sol_ship_preflight/);
});
