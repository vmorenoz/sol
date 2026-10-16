import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {listFiles,sha256} from '../lib/fs.mjs';
import {assertSchema,checkSchemaVocabulary} from '../lib/schema.mjs';
import {composeNativeFiles,solCommandNames,solCommandSkills,solPermissionToolNames,solRuntimeModuleNames,solShipAuthorizeToolName,solSkillNames,solToolNames,solToolPermissionEffect} from '../lib/composition.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const checks=[];
const test=(name,fn)=>{fn();checks.push(name);};
function frontmatter(text){
  const match=/^---\n([\s\S]*?)\n---\n/.exec(text);assert.ok(match,'Falta frontmatter');const result={};
  for(const line of match[1].split('\n')){const i=line.indexOf(':');assert.ok(i>0,'Frontmatter emitido inválido');const key=line.slice(0,i);assert.ok(!Object.hasOwn(result,key),'Campo duplicado');result[key]=JSON.parse(line.slice(i+1).trim());}return result;
}
try{
  test('Sintaxis JavaScript de todos los módulos',()=>{for(const p of listFiles(root).filter(f=>f.endsWith('.mjs'))){const r=spawnSync(process.execPath,['--check',path.join(root,p)],{encoding:'utf8'});assert.equal(r.status,0,`${p}: ${r.stderr}`);}});
  test('Sintaxis del plugin TypeScript y frontera nativa explícita',()=>{for(const p of listFiles(path.join(root,'plugins/opencode-v2')).filter(f=>f.endsWith('.ts'))){const r=spawnSync(process.execPath,['--experimental-strip-types','--check',path.join(root,'plugins/opencode-v2',p)],{encoding:'utf8'});assert.equal(r.status,0,`${p}: ${r.stderr}`);}const plugin=read('plugins/opencode-v2/index.ts');assert.match(plugin,/setup\(ctx: OpenCodeV2Context\)/);assert.doesNotMatch(plugin,/ctx: any|editor: any/);});
  test('Schemas y ejemplos de datos',()=>{for(const file of fs.readdirSync(path.join(root,'schemas')))checkSchemaVocabulary(JSON.parse(read('schemas/'+file)));for(const name of ['work','objective','task','delegation','result','evidence','state','history-entry'])assertSchema(name,JSON.parse(read(`templates/${name}.json`)));assertSchema('work-create',{workId:'CHECK-1',title:'Título',objective:'Resultado',criterion:'Criterio',verification:'Verificación'});assertSchema('work-update',{workId:'CHECK-1',expectedRevision:1,actions:[{type:'task.set_status',taskId:'T-1',status:'done'}]});});
  test('No se distribuyen skills o comandos BBVA',()=>{assert.equal(listFiles(path.join(root,'skills')).some(f=>/bbva|apx|cells/i.test(f)),false);assert.equal(listFiles(root).some(f=>/bbva-provenance/i.test(f)),false);});
  test('Composición exclusivamente OpenCode v2',()=>{
    const catalog=JSON.parse(read('agents/catalog.json')),ids=[catalog.orchestrator,...catalog.specialists].map(a=>a.id),files=composeNativeFiles({root});
    assert.equal(ids.length,10);assert.equal(new Set(ids).size,10);assert.equal(fs.existsSync(path.join(root,'adapters')),false);
     for(const agentId of ids){const file=files.get(`.opencode/agents/${agentId}.md`);assert.ok(file);const meta=frontmatter(file),primary=agentId==='sol';assert.equal(meta.mode,primary?'primary':'subagent');assert.ok(Array.isArray(meta.permissions));assert.equal(meta.permission,undefined);if(!primary){assert.notEqual(meta.hidden,true);assert.ok(meta.permissions.some(rule=>rule.action==='subagent'&&rule.effect==='deny'));for(const tool of solPermissionToolNames)assert.ok(meta.permissions.some(rule=>rule.action===tool&&rule.effect==='deny'));}else for(const tool of solPermissionToolNames){const permission=meta.permissions.find(rule=>rule.action===tool);assert.ok(permission);assert.equal(permission.effect,solToolPermissionEffect(tool));}assert.match(file,/opencode_native_capabilities/);assert.doesNotMatch(file,/runtime_adapter/);assert.doesNotMatch(file,/subagent_type|task nativo|permission:/);}
    assert.equal([...files.keys()].some(file=>file.includes('.github/')||file.includes('.copilot/')),false);
    for(const name of solCommandNames){const command=files.get(`.opencode/commands/${name}.md`),meta=frontmatter(command);assert.equal(meta.agent,'sol');assert.equal(meta.subagent,false);assert.ok(command.includes('Carga la skill nativa'));}
    const plugin=read('plugins/opencode-v2/index.ts');for(const tool of solToolNames)assert.ok(plugin.includes(`"${tool}"`));assert.match(plugin,/context\.sessionID/);assert.match(plugin,/ctx\.session\.get\(\{ sessionID: context\.sessionID \}\)/);assert.doesNotMatch(plugin,/properties:.*root/);
    assert.ok(files.has('.opencode/plugins/sol/index.ts'));assert.ok(files.has('.opencode/plugins/sol/package.json'));assert.ok(files.has('.opencode/skills/sol-config/SKILL.md'));assert.ok(files.has('.opencode/skills/sol-init/SKILL.md'));
  });
  test('Catálogo, templates y skills nativas referenciadas existen',()=>{const catalog=JSON.parse(read('agents/catalog.json'));for(const a of catalog.specialists){assert.ok(fs.existsSync(path.join(root,'templates',a.template)));assert.ok(read(`agents/${a.id}.md`).includes(`id="${a.id}"`));}for(const f of listFiles(path.join(root,'templates')).filter(x=>x.endsWith('.md')&&x!=='README.md'))assert.match(read('templates/'+f),/template: .+@1\.0/);for(const dir of fs.readdirSync(path.join(root,'skills'))){const skill=read(`skills/${dir}/SKILL.md`);assert.match(skill,new RegExp(`^---\nname: ${dir}\n`));assert.match(skill,/\ndescription: .+/);}});
  test('No operational Sol CLI remains in distribution',()=>{assert.equal(fs.existsSync(path.join(root,'bin/sol.mjs')),false);assert.equal(fs.existsSync(path.join(root,'bin/prepare.mjs')),false);for(const file of listFiles(root).filter(f=>/\.(mjs|md)$/.test(f)&&f!=='scripts/check.mjs')){const content=read(file);assert.doesNotMatch(content,/node\s+[^\n]*sol\.mjs|prepare\.mjs --root|CLI global con --root/);}});
  test('Core y plugin sin dependencias externas de resolución',()=>{const pkg=JSON.parse(read('package.json'));assert.equal(Object.keys(pkg.dependencies||{}).length,0);assert.equal(Object.keys(pkg.devDependencies||{}).length,0);for(const f of listFiles(path.join(root,'lib')).filter(x=>x.endsWith('.mjs')))for(const line of read('lib/'+f).split('\n').filter(x=>x.startsWith('import ')))assert.match(line,/from ['"](?:node:|\.\/|\.\.\/)/);const plugin=JSON.parse(read('plugins/opencode-v2/package.json'));assert.equal(Object.keys(plugin.dependencies||{}).length,0);assert.equal(plugin.exports['.'],'./index.ts');assert.doesNotMatch(read('plugins/opencode-v2/index.ts'),/from ["']@opencode\/plugin/);});
  test('Composición reproducible en memoria',()=>{const render=()=>Object.fromEntries([...composeNativeFiles({root})].map(([p,text])=>[p,sha256(text)]));assert.deepEqual(render(),render());});
  test('Comandos administrativos y skills conversacionales mantienen catálogos separados',()=>{
    const expected=['sol-config'];
    assert.deepEqual(solCommandNames,expected);assert.deepEqual(Object.keys(solCommandSkills),expected);
    const files=composeNativeFiles({root}),tui=read('plugins/opencode-v2/tui.ts');
    assert.deepEqual([...files.keys()].filter(p=>p.startsWith('.opencode/commands/')).sort(),['.opencode/commands/sol-config.md']);
    const nativeCommands=[...tui.matchAll(/slash:\s*\{\s*name:\s*"([^"]+)"/g)].map(m=>m[1]).sort();
    assert.deepEqual(nativeCommands,['sol-init','sol-version']);
    assert.deepEqual([...solCommandNames,...nativeCommands].sort(),['sol-config','sol-init','sol-version']);
    assert.equal(JSON.parse(read('plugins/opencode-v2/package.json')).exports['./tui'],'./tui.ts');
    assert.ok(files.has('.opencode/plugins/sol/tui.ts'));
    assert.match(read('skills/sol-init/SKILL.md'),/^---\n(?=[\s\S]*?\nslash: false\n)/);
    for(const tool of ['sol_init_get','sol_init_project_publish','sol_init_complete'])assert.ok(solToolNames.includes(tool));
    assert.equal(solToolNames.some(name=>/init.*(?:result|bootstrap|register|dispatch)/.test(name)),false,'bootstrap y resultados son exclusivos del flujo nativo');
    for(const [command,skill] of Object.entries(solCommandSkills)){assert.ok(solSkillNames.includes(skill),`${command} → ${skill}`);assert.ok(fs.existsSync(path.join(root,'skills',skill,'SKILL.md')),skill);}
    assert.ok(solSkillNames.includes('sol-discovery'));assert.ok(solSkillNames.includes('sol-integration-verification'));
    for(const module of solRuntimeModuleNames)assert.ok(fs.existsSync(path.join(root,'lib',module)),module);
    assert.ok(solRuntimeModuleNames.includes('contracts.mjs'));
    assert.equal(solToolNames.includes(solShipAuthorizeToolName),true,'el bridge nativo registra la autorización Ship');
    assert.equal(solToolNames.includes('sol_ship_preflight'),true,'el bridge nativo registra preflight readonly');
    assert.equal(solPermissionToolNames.includes(solShipAuthorizeToolName),true,'autorización incluida en catálogo de permisos');
    assert.equal(solToolPermissionEffect(solShipAuthorizeToolName),'ask');
    assert.equal(solToolPermissionEffect(solShipAuthorizeToolName,'subagent'),'deny');
    for(const name of ['sol-new-project','sol-onboard','sol-discuss','sol-plan','sol-execute','sol-verify','sol-ship','sol-status','sol-recap','sol-resume']){assert.ok(solSkillNames.includes(name));assert.equal(Object.hasOwn(solCommandSkills,name),false);assert.match(read(`skills/${name}/SKILL.md`),/^---\n(?=[\s\S]*?\nslash: false\n)/);}
    assert.match(read('skills/sol-discovery/SKILL.md'),/^---\n(?=[\s\S]*?\nslash: false\n)/);
    assert.equal(Object.hasOwn(solCommandSkills,'sol-discovery'),false);
  });
  test('Engineering Practices: mapa upstream íntegro, destinos existentes y límites de integración',()=>{
    const dir='skills/sol-engineering-practices',map=JSON.parse(read(`${dir}/references/upstream-map.json`)),expected=['api-and-interface-design','browser-testing-with-devtools','ci-cd-and-automation','code-review-and-quality','code-simplification','constraint-driven-development','context-engineering','debugging-and-error-recovery','deprecation-and-migration','documentation-and-adrs','doubt-driven-development','frontend-ui-engineering','git-workflow-and-versioning','idea-refine','incremental-implementation','interview-me','observability-and-instrumentation','performance-optimization','planning-and-task-breakdown','security-and-hardening','shipping-and-launch','source-driven-development','spec-driven-development','test-driven-development','using-agent-skills'];
    assert.equal(map.repository,'https://github.com/addyosmani/agent-skills');assert.equal(map.commit,'aeac41d4d005999432bb7312f7ff06383a91d59d');assert.equal(map.destinationBase,'skill-root');assert.match(map.destinationResolution,/relative to the directory containing this SKILL\.md/);assert.deepEqual(map.skills.map(x=>x.source).sort(),expected.sort());assert.equal(new Set(map.skills.map(x=>x.source)).size,25);
    for(const item of map.skills){assert.ok(['adapt','existing','research-owned','reject'].includes(item.decision));assert.ok(item.destinations.length>0);assert.ok(item.retained.length&&item.excluded.length);for(const destination of item.destinations){const target=path.resolve(root,dir,destination);assert.ok(target.startsWith(root+path.sep),`${item.source} fuera de V2`);if(!fs.existsSync(target)){assert.equal(item.decision,'research-owned');assert.equal(destination,'../../skills/sol-discovery/references/research-method.md');}}}
    const notice=read(`${dir}/references/UPSTREAM-NOTICE.md`);assert.match(notice,/Copyright \(c\) 2025 Addy Osmani/);assert.match(notice,/Permission is hereby granted/);assert.match(notice,/THE SOFTWARE IS PROVIDED "AS IS"/);assert.match(notice,new RegExp(map.commit));
    const skill=read(`${dir}/SKILL.md`);assert.match(skill,/omítela para saludos, status, respuestas simples/);assert.match(skill,/bajo demanda/);assert.match(skill,/Sol es el único coordinador/);
    for(const file of ['agents/sol.md','agents/common.md','agents/sol-executor.md','agents/sol-planner.md','agents/sol-plan-auditor.md','agents/sol-code-reviewer.md','agents/sol-qa-auditor.md','agents/sol-security-auditor.md','agents/sol-ui-auditor.md','agents/sol-explorer.md','skills/sol-plan/SKILL.md','skills/sol-execute/SKILL.md','skills/sol-verify/SKILL.md'])assert.match(read(file),/sol-engineering-practices/);
    assert.match(read('agents/common.md'),/No invoques otros agentes/);assert.match(read(`${dir}/references/delivery.md`),/no hagas commits.*push/i);assert.match(read(`${dir}/references/frontend.md`),/No presupongas Chrome DevTools MCP ni instales nada/);assert.match(read(`${dir}/references/security.md`),/no instales scanners\/MCP/i);
    const files=composeNativeFiles({root});for(const f of listFiles(path.join(root,dir)))assert.ok(files.has(`.opencode/skills/sol-engineering-practices/${f}`),`recurso no compuesto: ${f}`);assert.equal(solSkillNames.includes('sol-engineering-practices'),true);
  });
  console.log(JSON.stringify({status:'PASS',checks,nativeRuntime:'NOT_RUN',note:'Validación estructural de core, schemas, agentes y plugin; no smoke live de OpenCode.'},null,2));
}catch(e){console.error(`CHECK FAIL: ${e.message}`);process.exitCode=1;}
