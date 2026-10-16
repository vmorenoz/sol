import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {composeNativeFiles,solCommandNames} from '../lib/composition.mjs';
import {install} from '../lib/install.mjs';
import {sha256} from '../lib/fs.mjs';
import {temp} from './helpers.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const workflow=['new-project','onboard','discuss','plan','execute','verify','ship','status','recap','resume'].map(name=>'sol-'+name);
const options=homeDir=>({homeDir,env:{},probeVersion:()=> 'opencode v2.0.20'});
const oc='.config/opencode';
const put=(home,file,bytes)=>{const target=path.join(home,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);};

test('composition exposes only administrative dispatchers and keeps all workflow skills model-loadable',()=>{
  const files=composeNativeFiles({root});
  assert.deepEqual(solCommandNames,['sol-config']);
  assert.deepEqual([...files.keys()].filter(name=>name.startsWith('.opencode/commands/')).sort(),['.opencode/commands/sol-config.md']);
  for(const name of workflow){
    const skill=String(files.get(`.opencode/skills/${name}/SKILL.md`));
    assert.match(skill,/\nslash: false\n/);
    assert.doesNotMatch(skill,/disable-model-invocation: true|user-invocable: true/);
  }
});

test('conversational happy-path contract routes by intent, state and authority without ritual confirmation',()=>{
  const body=fs.readFileSync(path.join(root,'agents/sol.md'),'utf8');
  for(const clause of [/intención \+ estado \+ autorización/,/usuario no necesita invocar comandos de fase/,/continúa el trabajo ya autorizado/,/plan-only.*espera antes de implementar/,/Un encargo ordinario.*no lo activa/,/pregunta.*residuo/,/No termines con una promesa/])assert.match(body,clause);
  const plan=fs.readFileSync(path.join(root,'skills/sol-plan/SKILL.md'),'utf8');
  assert.match(plan,/implementación ya autorizada.*continuar cuando haya claridad suficiente/);
  const examples=fs.readFileSync(path.join(root,'docs/ORCHESTRATION.md'),'utf8');
  assert.match(examples,/Happy path esperado.*no prueba live/);
});

test('upgrade removes owned workflow dispatchers, preserves foreign and borrowed commands and backs up retired bytes',t=>{
  const home=temp(t);install(options(home));
  const manifestPath=path.join(home,'.sol/installation.json');
  const manifest=JSON.parse(fs.readFileSync(manifestPath));
  for(const name of [...workflow,'sol-init']){
    const file=`${oc}/commands/${name}.md`,bytes=`old owned dispatcher ${name}\n`;
    put(home,file,bytes);manifest.files[file]=sha256(bytes);
  }
  const foreign=`${oc}/commands/team-review.md`,borrowed=`${oc}/commands/sol-shared.md`;
  put(home,foreign,'foreign command');put(home,borrowed,'shared command');
  manifest.files[borrowed]=sha256('shared command');manifest.borrowed=[...(manifest.borrowed||[]),borrowed];
  fs.writeFileSync(manifestPath,JSON.stringify(manifest));
  const preview=install({...options(home),dryRun:true});
  for(const name of [...workflow,'sol-init']){const file=`${oc}/commands/${name}.md`;assert.ok(preview.removals.includes(file));assert.ok(fs.existsSync(path.join(home,file)));}
  const result=install(options(home)),recovery=JSON.parse(fs.readFileSync(path.join(result.recovery,'recovery.json')));
  for(const name of [...workflow,'sol-init']){
    const file=`${oc}/commands/${name}.md`;
    assert.equal(fs.existsSync(path.join(home,file)),false);
    assert.ok(fs.existsSync(path.join(home,oc,'skills',name,'SKILL.md')));
    const saved=recovery.files.find(entry=>entry.path===file);assert.ok(saved);
    assert.equal(fs.readFileSync(path.join(home,saved.backup),'utf8'),`old owned dispatcher ${name}\n`);
  }
  assert.equal(fs.readFileSync(path.join(home,foreign),'utf8'),'foreign command');
  assert.equal(fs.readFileSync(path.join(home,borrowed),'utf8'),'shared command');
  assert.ok(fs.existsSync(path.join(home,oc,'commands/sol-config.md')));
  assert.equal(fs.existsSync(path.join(home,oc,'commands/sol-init.md')),false);
  const tui=fs.readFileSync(path.join(home,oc,'plugins/sol/tui.ts'),'utf8');
  assert.match(tui,/slash: \{ name: "sol-init"/);
  assert.match(tui,/slash: \{ name: "sol-version"/);
  const primary=fs.readFileSync(path.join(home,oc,'agents/sol.md'),'utf8');
  assert.doesNotMatch(primary,/solo al primer encargo concreto/);
  assert.match(primary,/un encargo ordinario nunca autoriza auto-init/);
});

test('unregistered retired-command collision is preserved and blocks upgrade before writes',t=>{
  const home=temp(t);install(options(home));
  const file=`${oc}/commands/sol-plan.md`;put(home,file,'user-owned plan');
  const manifest=fs.readFileSync(path.join(home,'.sol/installation.json'),'utf8');
  assert.throws(()=>install(options(home)),/Integración anterior no registrada/);
  assert.equal(fs.readFileSync(path.join(home,file),'utf8'),'user-owned plan');
  assert.equal(fs.readFileSync(path.join(home,'.sol/installation.json'),'utf8'),manifest);
});
