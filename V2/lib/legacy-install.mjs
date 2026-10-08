import fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {safePath, sha256} from './fs.mjs';
import {parseJSONC, editJSONC} from './jsonc.mjs';

const empty=()=>({files:{},edits:new Map(),recognized:[]});
const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function relativeFor(root,absolute){
  const r=path.relative(root,absolute).split(path.sep).join('/');
  if(!r||r==='..'||r.startsWith('../')||path.isAbsolute(r))throw new Error(`Ruta legacy fuera de HOME: ${absolute}`);
  safePath(root,r);return r;
}
function allowedFile(p,oc){return p===`${oc}/sol-install.json`||p.startsWith(`${oc}/agents/`)&&/^sol[^/]*\.md$/.test(p.slice(`${oc}/agents/`.length))||p.startsWith(`${oc}/commands/`)&&/^sol[^/]*\.md$/.test(p.slice(`${oc}/commands/`.length))||p===`${oc}/plugins/sol.js`||p.startsWith(`${oc}/plugins/sol/`)||p.startsWith(`${oc}/skills/`)&&/^sol-[^/]+\/.+/.test(p.slice(`${oc}/skills/`.length));}
function existingFile(root,relative){
  const p=safePath(root,relative);let st;
  try{st=fs.lstatSync(p);}catch(e){if(e.code==='ENOENT')return null;throw e;}
  if(st.isSymbolicLink()||!st.isFile())throw new Error(`Archivo legacy no regular o symlink: ${relative}`);
  return fs.readFileSync(p);
}
function configRel(root,oc,absolute,allowed){
  if(typeof absolute!=='string'||!path.isAbsolute(absolute))throw new Error('Ruta de configuración legacy inválida');
  const rel=relativeFor(root,path.resolve(absolute));
  if(!allowed(rel))throw new Error(`Configuración legacy fuera de ubicaciones permitidas: ${rel}`);
  return rel;
}
function pluginMatches(v,spec){return v===spec||(isObject(v)&&v.package===spec);}
function ownedMcp(v,installed,packageRoot){
  if(installed!==undefined&&isDeepStrictEqual(v,installed))return true;
  const node=typeof v?.command?.[0]==='string'?path.basename(v.command[0]).toLowerCase():'';
  return isObject(v)&&Array.isArray(v.command)&&v.command.length===2&&(node==='node'||node==='node.exe'||v.command[0]===process.execPath)&&v.command[1]===path.join(packageRoot,'dist/v2/mcp.js');
}
function cleanConfig(text,{spec,packageRoot,previousDefaultAgent,installedMcp,previousMcp}){
  const data=parseJSONC(text), edits=[];
  if(!isObject(data))throw new Error('Configuración legacy debe ser objeto');
  if(data.default_agent==='sol')
    edits.push({path:['default_agent'],value:typeof previousDefaultAgent==='string'&&previousDefaultAgent!=='sol'?previousDefaultAgent:undefined});
  for(const root of [['plugin'],['plugins']]){
    const key=root[0],v=data[key];
    if(Array.isArray(v)){for(let i=v.length-1;i>=0;i--)if(pluginMatches(v[i],spec))edits.push({path:[key,i],value:undefined});}
    else if(pluginMatches(v,spec))edits.push({path:[key],value:undefined});
  }
  const mcp=data.mcp;
  if(isObject(mcp)&&own(mcp,'sol')&&ownedMcp(mcp.sol,installedMcp,packageRoot))
    edits.push({path:['mcp','sol'],value:previousMcp===undefined?undefined:previousMcp});
  if(isObject(data.mcp)&&isObject(data.mcp.servers)&&own(data.mcp.servers,'sol')&&ownedMcp(data.mcp.servers.sol,installedMcp,packageRoot))
    edits.push({path:['mcp','servers','sol'],value:previousMcp===undefined?undefined:previousMcp});
  return edits.length?editJSONC(text,edits):null;
}
function register(root,result,rel){
  if(!allowedFile(rel,result._oc))throw new Error(`Archivo no administrable en manifest: ${rel}`);
  const bytes=existingFile(root,rel);if(bytes)result.files[rel]=sha256(bytes);
}
function manifestPlan(root,oc,manifest){
  if(!isObject(manifest)||manifest.version!==2||!Array.isArray(manifest.files)||!manifest.files.every(f=>isObject(f)&&typeof f.path==='string'&&path.isAbsolute(f.path)&&typeof f.installedHash==='string'&&/^[a-f0-9]{64}$/.test(f.installedHash)))throw new Error('Manifest legacy Sol no reconocido');
  if(typeof manifest.packageRoot!=='string'||!path.isAbsolute(manifest.packageRoot))throw new Error('packageRoot legacy inválido');
  const packageRoot=path.resolve(manifest.packageRoot),expected=pathToFileURL(path.join(packageRoot,'dist/v2/plugin.js')).href;
  if(manifest.pluginSpec!==expected)throw new Error('pluginSpec legacy no reconocido');
  const result=empty();result._oc=oc;
  for(const f of manifest.files){const rel=relativeFor(root,f.path);register(root,result,rel);}
  const manifestRel=`${oc}/sol-install.json`;register(root,result,manifestRel);
  const config=configRel(root,oc,manifest.configPath,r=>r===`${oc}/opencode.json`||r===`${oc}/opencode.jsonc`);
  const bytes=existingFile(root,config);
  if(bytes){const output=cleanConfig(bytes.toString('utf8'),{spec:manifest.pluginSpec,packageRoot,previousDefaultAgent:manifest.previousDefaultAgent,installedMcp:manifest.mcp?.installed,previousMcp:manifest.mcp?.previous});if(output!==null)result.edits.set(config,output);}
  if(manifest.tui){
    const tui=manifest.tui;
    if(!isObject(tui)||typeof tui.configPath!=='string'||typeof tui.previousText!=='string'||typeof tui.installedPluginSpec!=='string'||typeof tui.installedHash!=='string'||!/^[a-f0-9]{64}$/.test(tui.installedHash)||typeof tui.fileExisted!=='boolean'||typeof tui.pluginArrayExisted!=='boolean'||typeof tui.owned!=='boolean'||(tui.previousPluginSpec!==undefined&&typeof tui.previousPluginSpec!=='string'))throw new Error('Metadata TUI legacy inválida');
    const tuiPath=configRel(root,oc,tui.configPath,r=>[`${oc}/tui.json`,`${oc}/tui.jsonc`,`${oc}/cli.json`,`${oc}/cli.jsonc`].includes(r));
    const b=existingFile(root,tuiPath);
    if(b){const text=b.toString('utf8'),d=parseJSONC(text);if(!isObject(d))throw new Error('Configuración TUI legacy debe ser objeto');const entries=d.plugin;if(entries!==undefined&&!Array.isArray(entries))throw new Error('TUI plugin legacy debe ser array');if(tui.owned&&Array.isArray(entries)&&entries.filter(x=>x===tui.installedPluginSpec).length===1){const ix=entries.indexOf(tui.installedPluginSpec),edits=[{path:['plugin',ix],value:tui.previousPluginSpec}];if(!tui.pluginArrayExisted&&entries.length===1&&tui.previousPluginSpec===undefined)edits.push({path:['plugin'],value:undefined});result.edits.set(tuiPath,editJSONC(text,edits));}}
  }
  delete result._oc;result.recognized.push('manifest-v2');return result;
}
const importSpec=/import\s*\(\s*(['"])(file:\/\/[^'"\r\n]+\/dist\/v2\/plugin\.js)\1\s*\)/;
function fallback(root,oc){
  const rel=`${oc}/plugins/sol.js`,bytes=existingFile(root,rel);if(!bytes)return empty();
  const text=bytes.toString('utf8');
  if(!/id\s*:\s*(['"])sol\1/.test(text)||! /async\s+server\s*\(/.test(text)||! /plugin\.SolPlugin\s*\(/.test(text))return empty();
  const m=importSpec.exec(text);if(!m)return empty();
  let url;try{url=new URL(m[2]);}catch{throw new Error('Loader legacy con URL inválida');}
  const plugin=path.resolve(fileURLToPath(url));if(path.basename(plugin)!=='plugin.js'||path.basename(path.dirname(plugin))!=='v2'||path.basename(path.dirname(path.dirname(plugin)))!=='dist')throw new Error('Loader legacy fuera de forma reconocida');
  const packageRoot=path.resolve(plugin,'../../..');
  if(path.join(packageRoot,'dist/v2/plugin.js')!==plugin)throw new Error('packageRoot legacy inválido');
  const result=empty();result.files[rel]=sha256(bytes);
  const spec=pathToFileURL(plugin).href,config=`${oc}/opencode.json`;
  for(const c of [config,`${oc}/opencode.jsonc`]){const b=existingFile(root,c);if(!b)continue;const out=cleanConfig(b.toString('utf8'),{spec,packageRoot});if(out!==null)result.edits.set(c,out);}
  result.recognized.push('loader-v1');return result;
}
export function discoverLegacy(root,opencodeDir){
  if(typeof root!=='string'||typeof opencodeDir!=='string'||path.isAbsolute(opencodeDir)||opencodeDir.split('/').some(x=>!x||x==='.'||x==='..'))throw new Error('Raíz o directorio OpenCode inválido');
  root=path.resolve(root);safePath(root,opencodeDir);
  const manifest=`${opencodeDir}/sol-install.json`,manifestPath=safePath(root,manifest);
  const manifestBytes=existingFile(root,manifest);
  if(manifestBytes)return manifestPlan(root,opencodeDir,JSON.parse(manifestBytes.toString('utf8')));
  return fallback(root,opencodeDir);
}
