import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {discoverLegacy} from '../lib/legacy-install.mjs';
import {sha256} from '../lib/fs.mjs';

function fixture(fn){const root=fs.mkdtempSync(path.join(os.tmpdir(),'sol-legacy-'));try{return fn(root);}finally{fs.rmSync(root,{recursive:true,force:true});}}
function put(root,rel,data){const p=path.join(root,...rel.split('/'));fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data);return p;}

test('plans removal/restoration of a V1 manifest and edits JSONC without losing unrelated data',()=>fixture(root=>{
  const oc='.config/opencode',pkg='/outside/old-sol', plugin=pathToFileURL(`${pkg}/dist/v2/plugin.js`).href;
  const global=put(root,`${oc}/agents/sol.md`,'edited legacy agent');
  const loader=put(root,`${oc}/plugins/sol.js`,'legacy loader');
  const config=`{// keep me\n "default_agent":"sol", "model":"vendor/model", "auth": {"token":"secret"},\n "mcp":{"sol":{"enabled":true,"command":["node","${pkg}/dist/v2/mcp.js"],"type":"local"}},\n "plugin":[{"package":"${plugin}","name":"old"}, "vendor/plugin"], "plugins":["${plugin}"] }`;
  put(root,`${oc}/opencode.jsonc`,config);
  const tui=`{// keep tui comments\n "plugin":["${plugin}","vendor/tui"] }`;
  put(root,`${oc}/tui.json`,tui);
  const manifest={version:2,packageRoot:pkg,configPath:path.join(root,oc,'opencode.jsonc'),pluginSpec:plugin,files:[{path:global,installedHash:'a'.repeat(64)},{path:loader,installedHash:'b'.repeat(64)}],previousDefaultAgent:'assistant',mcp:{previous:{type:'remote',url:'https://example.test'},installed:{type:'local',command:['node',`${pkg}/dist/v2/mcp.js`],enabled:true},parentExisted:true},tui:{configPath:path.join(root,oc,'tui.json'),previousText:'old tui',installedPluginSpec:plugin,installedHash:'c'.repeat(64),fileExisted:true,pluginArrayExisted:true,owned:true,previousPluginSpec:'prior/tui'}};
  put(root,`${oc}/sol-install.json`,JSON.stringify(manifest));
  const plan=discoverLegacy(root,oc);
  assert.deepEqual(plan.recognized,['manifest-v2']);
  assert.equal(plan.files[`${oc}/agents/sol.md`],sha256('edited legacy agent'));
  assert.equal(plan.files[`${oc}/plugins/sol.js`],sha256('legacy loader'));
  assert.ok(plan.files[`${oc}/sol-install.json`]);
  assert.match(plan.edits.get(`${oc}/opencode.jsonc`),/"default_agent":"assistant"/);
  assert.match(plan.edits.get(`${oc}/opencode.jsonc`),/vendor\/model/);
  assert.match(plan.edits.get(`${oc}/opencode.jsonc`),/auth/);
  assert.match(plan.edits.get(`${oc}/opencode.jsonc`),/keep me/);
  assert.match(plan.edits.get(`${oc}/opencode.jsonc`),/"type":"remote"/);
  assert.doesNotMatch(plan.edits.get(`${oc}/opencode.jsonc`),/dist\/v2\/plugin.js/);
  assert.match(plan.edits.get(`${oc}/tui.json`),/prior\/tui/);
  assert.match(plan.edits.get(`${oc}/tui.json`),/keep tui comments/);
  assert.equal(fs.readFileSync(path.join(root,oc,'opencode.jsonc'),'utf8'),config);
  assert.equal(fs.readFileSync(path.join(root,oc,'tui.json'),'utf8'),tui);
}));

test('recognizes only the historical loader signature, and not an unmarked collision',()=>fixture(root=>{
  const oc='.config/opencode',pkg='/tmp/legacy-checkout';
  const plugin=pathToFileURL(`${pkg}/dist/v2/plugin.js`).href;
  put(root,`${oc}/plugins/sol.js`,`module.exports = {\n  id: "sol",\n  async server(input, options) {\n    const plugin = await import(${JSON.stringify(plugin)});\n    options = { nodeExecutable: "node", ...options };\n    return plugin.SolPlugin(input, options);\n  },\n};\n`);
  put(root,`${oc}/opencode.json`,'{"plugin":["'+plugin+'"],"default_agent":"sol"}');
  const result=discoverLegacy(root,oc);
  assert.deepEqual(result.recognized,['loader-v1']);
  assert.ok(result.files[`${oc}/plugins/sol.js`]);
  assert.ok(result.edits.has(`${oc}/opencode.json`));
  assert.doesNotMatch(result.edits.get(`${oc}/opencode.json`),/default_agent/);
  fixture(other=>{
    put(other,`${oc}/plugins/sol.js`,'// unrelated file');
    assert.deepEqual(discoverLegacy(other,oc),{files:{},edits:new Map(),recognized:[]});
  });
}));

test('preserves custom default-agent names and does not touch TUI when ownership is false',()=>fixture(root=>{
  const oc='.config/opencode',pkg='/legacy',plugin=pathToFileURL(`${pkg}/dist/v2/plugin.js`).href;
  put(root,`${oc}/agents/sol.md`,'agent');put(root,`${oc}/opencode.json`,'{"default_agent":"sol-custom"}');
  put(root,`${oc}/tui.json`,'{"plugin":["'+plugin+'","vendor"]}');
  put(root,`${oc}/sol-install.json`,JSON.stringify({version:2,packageRoot:pkg,configPath:path.join(root,oc,'opencode.json'),pluginSpec:plugin,files:[],tui:{configPath:path.join(root,oc,'tui.json'),previousText:'',installedPluginSpec:plugin,installedHash:'a'.repeat(64),fileExisted:true,pluginArrayExisted:true,owned:false}}));
  const p=discoverLegacy(root,oc);assert.equal(p.edits.size,0);
}));

test('rejects unsafe manifest paths, symlinks, and malformed config without writes',()=>fixture(root=>{
  const oc='.config/opencode',pkg='/legacy';const plugin=pathToFileURL(`${pkg}/dist/v2/plugin.js`).href;
  const manifest={version:2,packageRoot:pkg,configPath:path.join(root,oc,'opencode.json'),pluginSpec:plugin,files:[{path:'/etc/passwd',installedHash:'a'.repeat(64)}]};
  put(root,`${oc}/sol-install.json`,JSON.stringify(manifest));
  assert.throws(()=>discoverLegacy(root,oc),/fuera de HOME/);
  manifest.files=[];manifest.configPath=path.join(root,oc,'opencode.json');
  put(root,`${oc}/sol-install.json`,JSON.stringify(manifest));
  put(root,`${oc}/opencode.json`,'{ broken');
  assert.throws(()=>discoverLegacy(root,oc));
  assert.equal(fs.readFileSync(path.join(root,oc,'opencode.json'),'utf8'),'{ broken');
  fs.unlinkSync(path.join(root,oc,'opencode.json'));
  const external=put(root,'external.md','do not follow');
  fs.mkdirSync(path.join(root,oc,'agents'),{recursive:true});
  fs.symlinkSync(external,path.join(root,oc,'agents/sol.md'));
  manifest.files=[{path:path.join(root,oc,'agents/sol.md'),installedHash:'a'.repeat(64)}];
  put(root,`${oc}/sol-install.json`,JSON.stringify(manifest));
  assert.throws(()=>discoverLegacy(root,oc),/Symlink/);
  assert.equal(fs.readFileSync(external,'utf8'),'do not follow');
}));

test('requires absolute manifest file paths and validates TUI metadata shape',()=>fixture(root=>{
  const oc='.config/opencode',pkg='/legacy',plugin=pathToFileURL(`${pkg}/dist/v2/plugin.js`).href;
  const manifest={version:2,packageRoot:pkg,configPath:path.join(root,oc,'opencode.json'),pluginSpec:plugin,files:[{path:`${root}/${oc}/agents/sol.md`,installedHash:'a'.repeat(64)}]};
  put(root,`${oc}/sol-install.json`,JSON.stringify({...manifest,files:[{...manifest.files[0],path:`${oc}/agents/sol.md`}]}));
  assert.throws(()=>discoverLegacy(root,oc),/no reconocido/);
  put(root,`${oc}/sol-install.json`,JSON.stringify({...manifest,tui:{configPath:path.join(root,oc,'tui.json'),owned:true}}));
  assert.throws(()=>discoverLegacy(root,oc),/Metadata TUI/);
}));

test('does not parse unrelated malformed config when no ownership evidence exists',()=>fixture(root=>{
  const oc='.config/opencode';put(root,`${oc}/opencode.json`,'ORIGINAL');
  put(root,`${oc}/plugins/sol.js`,'unmarked');
  assert.deepEqual(discoverLegacy(root,oc),{files:{},edits:new Map(),recognized:[]});
}));
