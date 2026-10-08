import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {listFiles,safePath,sha256,readJSON,writeJSON,atomicWrite,exists} from './fs.mjs';
import {composeNativeFiles,solRuntimeModuleNames,solSkillNames} from './composition.mjs';
import {discoverLegacy} from './legacy-install.mjs';
import {planModelConfig,readModelConfig} from './model-config.mjs';
import {VERSION,createSolBuildInfo} from './version.mjs';

const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export {VERSION};
const manifestPath='.sol/installation.json';
const runtimeName='opencode-v2';

// Only runtime payloads are distributed; installer and migration helpers stay local.
function workspaceFiles(){
  const result=new Map();
  for(const d of ['templates','schemas','docs'])for(const f of listFiles(path.join(source,d)))
    result.set(`.sol/${d}/${f}`,fs.readFileSync(path.join(source,d,f)));
  for(const f of solRuntimeModuleNames)
    result.set(`.sol/lib/${f}`,fs.readFileSync(path.join(source,'lib',f)));
  const artifactTracking=path.join(source,'lib','artifact-tracking.mjs');
  if(fs.existsSync(artifactTracking)&&fs.statSync(artifactTracking).isFile())
    result.set('.sol/lib/artifact-tracking.mjs',fs.readFileSync(artifactTracking));
  result.set('.sol/version.mjs',fs.readFileSync(path.join(source,'version.mjs')));
  result.set('.sol/catalog.json',fs.readFileSync(path.join(source,'agents/catalog.json')));
  return result;
}
function ensurePlainTarget(target){
  const requested=path.resolve(target);
  let leaf;
  try{leaf=fs.lstatSync(requested);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(leaf?.isSymbolicLink())throw new Error(`La raíz de instalación no puede ser un symlink: ${requested}`);
  if(leaf&&!leaf.isDirectory())throw new Error(`No es directorio: ${requested}`);
  let ancestor=requested;const missing=[];
  while(true){
    let entry;try{entry=fs.lstatSync(ancestor);}catch(e){if(e.code!=='ENOENT')throw e;}
    if(entry)break;
    const parent=path.dirname(ancestor);if(parent===ancestor)throw new Error(`No existe un ancestro accesible: ${requested}`);
    missing.unshift(path.basename(ancestor));ancestor=parent;
  }
  if(!fs.statSync(ancestor).isDirectory())throw new Error(`No es directorio: ${ancestor}`);
  const root=path.join(fs.realpathSync(ancestor),...missing);
  const relative=path.relative(fs.realpathSync(source),root);
  if(relative===''||(!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep)))
    throw new Error('El proyecto actual es la distribución de Sol. Entra en tu proyecto y ejecuta el instalador de Sol, o elige Global.');
  return root;
}
function globalOpenCodeDir(root,env){
  const absolute=path.resolve(env.OPENCODE_CONFIG_DIR||path.join(env.XDG_CONFIG_HOME||path.join(root,'.config'),'opencode'));
  const relative=path.relative(root,absolute).split(path.sep).join('/');
  // Never broaden the deletion boundary to / merely to reach external config.
  if(!relative||relative==='..'||relative.startsWith('../')||path.isAbsolute(relative))
    throw new Error(`La configuración OpenCode está fuera de tu carpeta de usuario: ${absolute}. La instalación global no administra rutas externas. Usa una ubicación de configuración dentro de tu carpeta de usuario.`);
  safePath(root,relative);return relative;
}
function nativeOwner(relative,opencodeDir){
  if(relative.startsWith(`${opencodeDir}/`)||relative.startsWith('.agents/skills/'))return runtimeName;
  if(relative.startsWith('.copilot/agents/'))return 'legacy-vscode';
  return null;
}
function permittedManagedPath(relative,oc){
  if(/^\.sol\/(?:templates|schemas|lib|bin|docs)\/.+/.test(relative)||['.sol/catalog.json','.sol/release.json','.sol/version.mjs'].includes(relative))return true;
  if(solSkillNames.some(n=>['.agents/skills','.copilot/skills','.claude/skills',`${oc}/skills`].some(dir=>relative.startsWith(`${dir}/${n}/`))))return true;
  if(relative.startsWith(`${oc}/plugins/sol/`))return true;
  if(relative.startsWith(`${oc}/agents/`)||relative.startsWith(`${oc}/commands/`)||relative.startsWith('.copilot/agents/'))
    return /^sol(?:-[a-z0-9-]+)?(?:\.agent)?\.md$/.test(path.posix.basename(relative));
  return false;
}
function getPrior(root,oc){
  if(!exists(root,manifestPath))return null;
  const p=readJSON(root,manifestPath);
  if(p.schemaVersion!==1||!p.files||typeof p.files!=='object'||Array.isArray(p.files)||!Array.isArray(p.runtimes)||p.runtimes.some(x=>!['opencode','vscode','both',runtimeName].includes(x))||typeof p.version!=='string')
    throw new Error(`Manifest de instalación no reconocido: ${path.join(root,manifestPath)}`);
  if(p.borrowed&&(!Array.isArray(p.borrowed)||p.borrowed.some(f=>!Object.hasOwn(p.files,f))))throw new Error('Manifest de archivos compartidos no reconocido');
  if(p.scope&&p.scope!=='global')throw new Error('Se encontró una instalación local anterior. Sol ahora se instala solo globalmente; no se modificará esa instalación automáticamente.');
  const oldOC=p.opencodeDir||oc;
  safePath(root,oldOC);
  for(const [f,h] of Object.entries(p.files)){
    safePath(root,f);
    if(!permittedManagedPath(f,oldOC)||!/^([a-f0-9]{64})$/.test(h))
      throw new Error(`Entrada no administrable en manifest: ${f}. No se borrará ningún archivo.`);
  }
  if(p.modelConfig!==undefined){
    const m=p.modelConfig;
    if(!m||typeof m.path!=='string'||path.posix.isAbsolute(m.path)||m.path.split('/').some(x=>!x||x==='.'||x==='..')||!/^.+\/opencode\.jsonc?$/.test(m.path)||!Array.isArray(m.agentIds)||m.agentIds.some(id=>typeof id!=='string'||!/^sol(?:-[a-z0-9-]+)?$/.test(id)))throw new Error('Metadatos de preferencias Sol no reconocidos; no se limpiará ninguna configuración.');
    if(m.path!==`${oc}/opencode.json`&&m.path!==`${oc}/opencode.jsonc`)throw new Error('Ruta de preferencias fuera de la configuración OpenCode global; no se limpiará ninguna configuración.');
  }
  return {...p,legacyRuntimes:p.runtimes,runtimes:[runtimeName]};
}
function installationFiles(root,runtimes,oc){
  const files=workspaceFiles();
  const native=composeNativeFiles({root:source});
  // Hash canonical payload names before installation-specific paths are embedded.
  const buildInfo=createSolBuildInfo(new Map([...files,...native]));
  files.set('.sol/release.json',JSON.stringify(buildInfo,null,2)+'\n');
  for(const [key,value] of native){
    const dest=key.replace(/^\.opencode\//,`${oc}/`);
    let text=value;
    if(/\/sol(?:\.agent)?\.md$/.test(key)){
      const resources={globalRoot:path.join(root,'.sol'),projectTemplate:path.join(root,'.sol/templates/project.md'),delegationTemplate:path.join(root,'.sol/templates/delegation.md'),stateSchema:path.join(root,'.sol/schemas/state.schema.json'),resultSchema:path.join(root,'.sol/schemas/result.schema.json'),skill:path.join(root,oc,'skills/sol-init/SKILL.md')};
      text+=`\n<global_installation>\nRecursos globales de Sol: ${JSON.stringify(resources)}. El workspace activo se obtiene del contexto de OpenCode; nunca uses HOME como raíz del proyecto ni aceptes root de texto/argumentos. Usa sol_workspace_prepare solo ante /sol-init o petición explícita de inicializar/preparar contexto Sol; un encargo ordinario nunca autoriza auto-init, tampoco un saludo o consulta de estado. El plugin administra metadata de forma síncrona; no uses shell/write/edit para state/work/history ni ejecutes scripts de Sol.\n</global_installation>\n`;
    }
    files.set(dest,text);
  }
  return files;
}
function checkFiles(root,files,prior,managedConfig=new Set()){
  const actions=[],conflicts=[];
  for(const [relative,data] of files){
    const dest=safePath(root,relative),hash=sha256(data);
    if(fs.existsSync(dest)){
      if(!fs.statSync(dest).isFile()){conflicts.push(`${relative}: no es archivo`);continue;}
      const current=sha256(fs.readFileSync(dest));
      if(current===hash)actions.push({path:relative,action:'unchanged',hash,expectedHash:current});
      else if(managedConfig.has(relative)||prior?.files?.[relative]===current&&!prior?.borrowed?.includes(relative))actions.push({path:relative,action:'update',hash,expectedHash:current});
      else conflicts.push(`${relative}: archivo ajeno o modificado. Renómbralo o conserva tus cambios antes de instalar.`);
    }else actions.push({path:relative,action:'create',hash,expectedHash:null});
  }
  return {actions,conflicts};
}
function assertNoUnregisteredAgents(root,oc,runtimes,prior,expected=new Map()){
  const dirs=[];
  if(runtimes.includes(runtimeName))dirs.push(`${oc}/agents`,`${oc}/commands`,`${oc}/plugins`,`${oc}/skills`);
  if(runtimes.includes('legacy-vscode'))dirs.push('.copilot/agents');
  for(const dir of dirs){
    if(!exists(root,dir))continue;
    for(const name of fs.readdirSync(safePath(root,dir))){
      const f=`${dir}/${name}`;
      if(/^sol(?:-[a-z0-9-]+)?(?:\.agent)?\.md$/.test(name)&&!prior?.files?.[f]&&!expected.has(f))
        throw new Error(`Integración anterior no registrada: ${path.join(root,f)}. No se puede comprobar su propiedad; conserva o retira ese archivo antes de continuar. No se borró nada.`);
    }
  }
  if(runtimes.includes(runtimeName)){
    for(const name of ['sol.js','sol.mjs','sol.ts']){
      const loader=`${oc}/plugins/${name}`;
      if(exists(root,loader)&&!prior?.files?.[loader])throw new Error(`Integración anterior no registrada: ${path.join(root,loader)}. No se puede comprobar su propiedad; revisa ese loader antes de instalar. No se borró nada.`);
    }
    const plugin=`${oc}/plugins/sol`;
    if(exists(root,plugin))for(const relative of listFiles(safePath(root,plugin),plugin))
      if(!prior?.files?.[relative]&&!expected.has(relative))throw new Error(`Colisión con plugin no administrado: ${path.join(root,relative)}. No se modificó ningún archivo.`);
  }
}
function checkRemovals(root,files,prior){
  for(const file of files){
    const dest=safePath(root,file);
    if(fs.existsSync(dest)&&(!fs.statSync(dest).isFile()||sha256(fs.readFileSync(dest))!==prior.files[file]))
      throw new Error(`Archivo de Sol modificado: ${dest}. No se borró nada. Conserva tu edición fuera de esta ruta o restáurala antes de continuar.`);
  }
}
// Private durable recovery copy; migration configuration may contain credentials.
function makeRecoveryBackup(root,files){
  if(!files.length)return null;
  const id=`${new Date().toISOString().replace(/[:.]/g,'-')}-${process.pid}-${process.hrtime.bigint()}`;
  const directory=`.sol/backups/${id}`,records=[];
  const backupRoot=safePath(root,directory);fs.mkdirSync(backupRoot,{recursive:true,mode:0o700});
  try{fs.chmodSync(backupRoot,0o700);}catch(e){throw new Error(`No se pudo proteger el directorio privado del respaldo: ${path.join(root,directory)} (${e.code||'error de permisos'}). No se modificaron los archivos de Sol.`);}
  for(const file of files){
    const source=safePath(root,file);
    if(!fs.existsSync(source)||!fs.statSync(source).isFile())continue;
    const data=fs.readFileSync(source),backup=`${directory}/files/${file}`;
    atomicWrite(root,backup,data);records.push({path:file,backup,sha256:sha256(data)});
  }
  if(!records.length)return null;
  const manifest={schemaVersion:1,createdAt:new Date().toISOString(),purpose:'Sol installer recovery',files:records};
  atomicWrite(root,`${directory}/recovery.json`,JSON.stringify(manifest,null,2)+'\n');
  try{fs.chmodSync(safePath(root,`${directory}/recovery.json`),0o600);}catch(e){throw new Error(`No se pudo proteger el índice del respaldo privado: ${path.join(root,directory,'recovery.json')} (${e.code||'error de permisos'}). No se modificaron los archivos de Sol.`);}
  for(const item of records)try{fs.chmodSync(safePath(root,item.backup),0o600);}catch(e){throw new Error(`No se pudo proteger un archivo del respaldo privado en ${directory} (${e.code||'error de permisos'}). No se modificaron los archivos de Sol.`);}
  return path.join(root,directory);
}
function checkOpenCodeV2(env,probeVersion=()=>spawnSync(env.OPENCODE_BIN||'opencode',['--version'],{encoding:'utf8',timeout:8000,env:{...process.env,...env}}).stdout){
  let result;try{result=probeVersion();}catch{result='';}
  const version=String(result||'').trim(),match=/\b(?:v)?(\d+)\.\d+\.\d+\b/.exec(version);
  if(!match)throw new Error('No se pudo detectar OpenCode en PATH. Sol requiere OpenCode v2; instala OpenCode v2 y vuelve a intentar.');
  if(Number(match[1])!==2)throw new Error(`Sol requiere OpenCode v2. Detectado: ${version}. Actualiza OpenCode antes de instalar Sol.`);
  return version;
}
function nativeModelCatalog(env,probeModels){
  let output;
  try{output=probeModels?probeModels():spawnSync(env.OPENCODE_BIN||'opencode',['api','get','/api/model'],{encoding:'utf8',timeout:12000,env:{...process.env,...env}}).stdout;}
  catch{throw new Error('No se pudo consultar el catálogo nativo de OpenCode para validar modelos. Verifica el servicio OpenCode y vuelve a intentar.');}
  try{const parsed=typeof output==='string'?JSON.parse(output):output;const data=Array.isArray(parsed)?parsed:parsed?.data;if(!Array.isArray(data)||data.some(x=>!x||typeof x.id!=='string'||typeof x.providerID!=='string'))throw new Error();return data;}
  catch{throw new Error('El catálogo nativo de modelos de OpenCode no está disponible o tiene un formato desconocido; no se aplicaron cambios. Verifica OpenCode y vuelve a intentar.');}
}
function priorCleanupIds(prior,legacy,desired,oc){
  const ids=new Set(prior?.modelConfig?.agentIds||[]);
  for(const file of Object.keys({...prior?.files,...legacy.files})){
    if(desired.has(file))continue;
    const prefix=`${oc}/agents/`;
    if(!file.startsWith(prefix))continue;
    const m=/^(sol(?:-[a-z0-9-]+)?)\.md$/.exec(file.slice(prefix.length));
    if(m)ids.add(m[1]);
  }
  return [...ids];
}
export function planInstall({runtime,scope='global',target,homeDir=os.homedir(),env=process.env,probeVersion,profile,overrides={},catalog:providedCatalog,probeModels}={}){
  if(scope!=='global')throw new Error('Sol solo admite instalación global. Los datos de trabajo siguen separados por proyecto.');
  if(target)throw new Error('La opción target ya no está admitida: Sol se instala globalmente en la carpeta del usuario.');
  if(runtime&&runtime!=='opencode-v2')throw new Error('Sol admite únicamente OpenCode v2.');
  const runtimeVersion=checkOpenCodeV2(env,probeVersion);
  const root=ensurePlainTarget(homeDir);
  const requested=[runtimeName];
  const oc=globalOpenCodeDir(root,env);
  const prior=getPrior(root,oc);
  const legacy=discoverLegacy(root,oc);
  const effectivePrior={...(prior||{}),files:{...(prior?.files||{}),...legacy.files},borrowed:prior?.borrowed||[]};
  // Ownership manifests authorize replacement/removal, not preservation of the drifted bytes.
  for(const file of Object.keys(prior?.files||{})){const p=safePath(root,file);if(fs.existsSync(p)&&fs.statSync(p).isFile())effectivePrior.files[file]=sha256(fs.readFileSync(p));}
  const runtimes=[runtimeName];
  const productFiles=installationFiles(root,runtimes,oc), files=new Map(productFiles);
  assertNoUnregisteredAgents(root,oc,requested,effectivePrior,productFiles);
  const assetPreflight=checkFiles(root,productFiles,effectivePrior);
  if(assetPreflight.conflicts.length)throw new Error(`Instalación cancelada antes de escribir:\n${assetPreflight.conflicts.join('\n')}`);
  const cleanupAgentIds=priorCleanupIds(prior,legacy,productFiles,oc);
  const cfgState=readModelConfig({homeDir:root,env,mergeComplementary:true,sourceTexts:legacy.edits});
  const needsCatalog=profile==='balanced'||profile==='custom';
  const catalog=needsCatalog?(providedCatalog??nativeModelCatalog(env,probeModels)):[];
  const sourceTexts=new Map(legacy.edits);
  const jsonRel=`${oc}/opencode.json`,jsoncRel=`${oc}/opencode.jsonc`;
  const modelPlan=planModelConfig({homeDir:root,env,profile,overrides,catalog,expectedRevision:cfgState.revision,cleanupAgentIds,sourceTexts,mergeComplementary:true,preserveAssignments:profile===undefined});
  for(const rel of modelPlan.removals)if(modelPlan.expectedHashes[rel]!==undefined)effectivePrior.files[rel]=modelPlan.expectedHashes[rel];
  // JSON-only configs always migrate intact, even when there are no model edits.
  if(modelPlan.migration&&!modelPlan.files.has(jsoncRel))modelPlan.files.set(jsoncRel,sourceTexts.get(jsoncRel)??fs.readFileSync(path.join(root,jsonRel),'utf8'));
  for(const [file,text] of legacy.edits)if(file!==jsonRel&&file!==jsoncRel)files.set(file,text);
  for(const [file,text] of modelPlan.files)files.set(file,text);
  // Migration owns only explicitly discovered legacy files/config references.
  for(const [file] of legacy.edits){const p=safePath(root,file);if(fs.existsSync(p)&&fs.statSync(p).isFile())effectivePrior.files[file]=sha256(fs.readFileSync(p));}
  const {actions,conflicts}=checkFiles(root,files,effectivePrior,new Set(modelPlan.files.keys()));
  assertNoUnregisteredAgents(root,oc,requested,effectivePrior,files);
  for(const name of solSkillNames)for(const dir of ['.copilot/skills','.claude/skills','.agents/skills']){
    const p=`${dir}/${name}/SKILL.md`;
    if(exists(root,p)&&!prior?.files?.[p])conflicts.push(`Skill duplicada ${p}; conserva una única ubicación antes de instalar.`);
  }
  if(conflicts.length)throw new Error(`Instalación cancelada antes de escribir:\n${conflicts.join('\n')}`);
  const replacing=!!prior&&prior.version!==VERSION;
  const borrowed=actions.filter(a=>productFiles.has(a.path)&&a.action==='unchanged'&&(!effectivePrior.files[a.path]||effectivePrior.borrowed.includes(a.path))).map(a=>a.path);
  const removals=[...new Set([...Object.keys(effectivePrior.files).filter(f=>!effectivePrior.borrowed.includes(f)&&!files.has(f)),...modelPlan.removals])].filter(f=>!files.has(f));
  checkRemovals(root,removals,effectivePrior);
  const expectedHashes={...modelPlan.expectedHashes,...Object.fromEntries(actions.map(a=>[a.path,a.expectedHash]))};
  for(const relative of removals)expectedHashes[relative]=exists(root,relative)?effectivePrior.files[relative]:null;
  const buildInfo=JSON.parse(productFiles.get('.sol/release.json'));
  return {root,buildInfo,expectedHashes,scope:'global',opencodeDir:oc,runtimes,runtimeVersion,prior,effectivePrior,legacy,productFiles,files,actions,removals,replacing,borrowed,configChanges:legacy.edits.size,modelPlan,profile:modelPlan.profile,preservedModels:modelPlan.preservedModels};
}
// In-process rollback only; not a transaction across crashes or concurrent writers.
function applyFiles(root,files,actions,removals,prior,finish,expectedHashes={},deferredRemovals=[]){
  const undo=new Map();
  const remember=f=>{if(!undo.has(f)){const p=safePath(root,f);undo.set(f,fs.existsSync(p)?fs.readFileSync(p):null);}};
  fs.mkdirSync(root,{recursive:true});
  try{
    for(const [relative,expected] of Object.entries(expectedHashes)){
      const full=safePath(root,relative),actual=fs.existsSync(full)?sha256(fs.readFileSync(full)):null;
      if(actual!==expected)throw new Error(`La configuración cambió durante la planificación: ${relative}. No se escribió ningún cambio.`);
    }
    const deferred=new Set(deferredRemovals);
    checkRemovals(root,removals,prior);
    for(const f of removals)if(!deferred.has(f)){remember(f);const p=safePath(root,f);if(fs.existsSync(p))fs.unlinkSync(p);}
    for(const a of actions){
      if(a.action==='unchanged'&&!removals.includes(a.path))continue;
      const p=safePath(root,a.path),original=fs.existsSync(p)?fs.readFileSync(p):null;
       if(original&&sha256(original)!==a.hash&&sha256(original)!==prior?.files?.[a.path]&&expectedHashes[a.path]!==sha256(original))throw new Error(`Archivo cambió durante instalación: ${a.path}`);
      remember(a.path);atomicWrite(root,a.path,files.get(a.path));
    }
    checkRemovals(root,deferredRemovals,prior);
    for(const f of deferredRemovals){remember(f);const p=safePath(root,f);if(fs.existsSync(p))fs.unlinkSync(p);}
    remember(manifestPath);finish();
  }catch(e){
    const rollbackErrors=[];
    for(const [f,original] of [...undo].reverse())try{
      if(original===null){const p=safePath(root,f);if(fs.existsSync(p))fs.unlinkSync(p);}
      else atomicWrite(root,f,original);
    }catch(error){rollbackErrors.push(`${f}: ${error.message}`);}
    throw new Error(`Operación no completada; ${rollbackErrors.length?'hay archivos que no se pudieron restaurar: '+rollbackErrors.join('; '):'archivos gestionados restaurados'}${prior?.recovery?`. Respaldo disponible: ${prior.recovery}`:''}. ${e.message}`,{cause:e});
  }
}
export function install(options={}){
  const p=planInstall(options);
  if(options.dryRun)return {dryRun:true,version:VERSION,buildInfo:p.buildInfo,target:p.root,scope:p.scope,runtimes:p.runtimes,opencodeVersion:p.runtimeVersion,actions:p.actions,removals:p.removals.filter(f=>!p.modelPlan.removals.includes(f)),legacy:p.legacy.recognized,configChanges:p.configChanges,configPaths:[...new Set([...p.legacy.edits.keys(),...p.modelPlan.files.keys()])],profile:p.profile,preservedModels:p.preservedModels,modelChanges:p.modelPlan.changes,configPath:p.modelPlan.configRelativePath,migration:p.modelPlan.migration};
  const manifest={schemaVersion:1,...p.buildInfo,scope:'global',runtimes:p.runtimes,opencodeDir:p.opencodeDir,files:Object.fromEntries(p.actions.filter(x=>p.productFiles.has(x.path)).map(x=>[x.path,x.hash])),borrowed:p.borrowed,modelConfig:p.modelPlan.modelConfig};
  const updates=p.actions.filter(a=>a.action==='update').map(a=>a.path);
  const manifestBytes=JSON.stringify(manifest,null,2)+'\n';
  const manifestChanged=!exists(p.root,manifestPath)||!fs.readFileSync(safePath(p.root,manifestPath)).equals(Buffer.from(manifestBytes));
  const mutation=manifestChanged||p.removals.length>0||updates.length>0||p.actions.some(a=>a.action==='create');
  const recovery=mutation?makeRecoveryBackup(p.root,[...new Set([...p.removals,...updates,...Object.keys(p.modelPlan.expectedHashes).filter(f=>p.modelPlan.expectedHashes[f]!==null),...(exists(p.root,manifestPath)?[manifestPath]:[]),...p.legacy.recognized.length&&exists(p.root,`${p.opencodeDir}/sol-install.json`)?[`${p.opencodeDir}/sol-install.json`]:[],...p.legacy.edits.keys()])]):null;
  p.effectivePrior.recovery=recovery;
  applyFiles(p.root,p.files,p.actions,p.removals,p.effectivePrior,()=>{
    if(manifestChanged)atomicWrite(p.root,manifestPath,manifestBytes);
  },p.expectedHashes,p.modelPlan.removals);
  return {installed:true,target:p.root,scope:p.scope,runtimes:p.runtimes,opencodeVersion:p.runtimeVersion,version:VERSION,buildInfo:p.buildInfo,replacedVersion:p.replacing?p.prior.version:null,removed:p.removals.filter(f=>!p.modelPlan.removals.includes(f)).length,created:p.actions.filter(x=>x.action==='create'&&p.productFiles.has(x.path)).length,updated:p.actions.filter(x=>x.action==='update'&&p.productFiles.has(x.path)).length,unchanged:p.actions.filter(x=>x.action==='unchanged'&&p.productFiles.has(x.path)).length,configChanges:p.configChanges,modelChanges:p.modelPlan.changes,profile:p.profile,preservedModels:p.preservedModels,configPath:p.modelPlan.configRelativePath,recovery,legacy:p.legacy.recognized,nativeSession:'NOT_RUN'};
}

export function uninstall({runtime,homeDir=os.homedir(),env=process.env,dryRun=false}={}){
  if(runtime&&runtime!=='opencode-v2')throw new Error('Sol admite únicamente OpenCode v2.');
  runtime=runtimeName;
  const root=ensurePlainTarget(homeDir);
  if(!fs.existsSync(path.join(root,manifestPath))){
    const oc=globalOpenCodeDir(root,env),legacy=discoverLegacy(root,oc);
    if(!Object.keys(legacy.files).length&&!legacy.edits.size)return {uninstalled:false,runtime,targets:[],workPreserved:true,note:'No se encontró una instalación global registrada de ese runtime. No se eliminó nada.'};
    const prior={files:{...legacy.files},borrowed:[],runtimes:[runtime],opencodeDir:oc};
    for(const f of Object.keys(prior.files)){const p=safePath(root,f);if(fs.existsSync(p)&&fs.statSync(p).isFile())prior.files[f]=sha256(fs.readFileSync(p));}
    for(const f of legacy.edits.keys()){const p=safePath(root,f);if(fs.existsSync(p)&&fs.statSync(p).isFile())prior.files[f]=sha256(fs.readFileSync(p));}
    const actions=[...legacy.edits].map(([f,text])=>({path:f,action:'update',hash:sha256(text)}));
    const removals=Object.keys(legacy.files),all=new Map(legacy.edits);
    if(dryRun)return {dryRun:true,uninstall:true,runtime,targets:[{target:root,scope:'global',removals}],legacy:legacy.recognized,configPaths:[...legacy.edits.keys()]};
    const recovery=makeRecoveryBackup(root,[...removals,...legacy.edits.keys()]);
    prior.recovery=recovery;
    applyFiles(root,all,actions,removals,prior,()=>{});
    return {uninstalled:true,runtime,targets:[{target:root,scope:'global',removed:removals.length,remainingRuntimes:[]}],recovery,workPreserved:true,legacy:legacy.recognized,configChanges:legacy.edits.size,note:'La instalación legacy fue retirada; la configuración se limpió y los datos de trabajo se conservaron.'};
  }
  const raw=readJSON(root,manifestPath),oc=raw.opencodeDir||globalOpenCodeDir(root,env);
  const prior=getPrior(root,oc);assertNoUnregisteredAgents(root,oc,[runtime],prior);
  if(!prior.runtimes.includes(runtime))return {uninstalled:false,runtime,targets:[],workPreserved:true,note:'El runtime no está registrado en la instalación global. No se eliminó nada.'};
  const remaining=prior.runtimes.filter(x=>x!==runtime);
  const modelPlan=remaining.length?null:planModelConfig({homeDir:root,env,profile:'inherited',cleanupAgentIds:prior.modelConfig?.agentIds||[]});
  if(modelPlan?.migration&&!modelPlan.changes.length){modelPlan.files.clear();modelPlan.removals.length=0;}
  const configWrites=new Map(),configFiles=modelPlan?.files||new Map();
  for(const [f,text] of configFiles)configWrites.set(f,text);
  const removals=[...new Set([...Object.keys(prior.files).filter(f=>!prior.borrowed?.includes(f)&&(!remaining.length||nativeOwner(f,oc)===runtime)),...(modelPlan?.removals||[])])].filter(f=>!configWrites.has(f));
  const uninstallPrior={...prior,files:{...prior.files}};
  for(const rel of modelPlan?.removals||[])if(modelPlan.expectedHashes[rel]!==undefined)uninstallPrior.files[rel]=modelPlan.expectedHashes[rel];
  for(const f of removals){const p=safePath(root,f);if(fs.existsSync(p)&&fs.statSync(p).isFile())uninstallPrior.files[f]=sha256(fs.readFileSync(p));}
  checkRemovals(root,removals,uninstallPrior);
  const configActions=[...configWrites].map(([f,text])=>({path:f,action:'update',hash:sha256(text)}));
  if(dryRun)return {dryRun:true,uninstall:true,runtime,targets:[{target:root,scope:'global',removals}],profile:modelPlan?.profile,modelChanges:modelPlan?.changes||[],configPath:modelPlan?.configRelativePath};
  const configBackupPaths=[...configActions.map(a=>a.path),...(modelPlan?.removals||[])].filter(f=>modelPlan?.expectedHashes?.[f]!==null);
  const recovery=makeRecoveryBackup(root,[...new Set([...removals,manifestPath,...configBackupPaths])]);
  uninstallPrior.recovery=recovery;
  const files=Object.fromEntries(Object.entries(prior.files).filter(([f])=>!removals.includes(f)));
  applyFiles(root,configWrites,configActions,removals,uninstallPrior,()=>{
    if(remaining.length)writeJSON(root,manifestPath,{...prior,runtimes:remaining,files});
    else fs.unlinkSync(safePath(root,manifestPath));
  },modelPlan?.expectedHashes||{},modelPlan?.removals||[]);
  return {uninstalled:true,runtime,targets:[{target:root,scope:'global',removed:removals.length,remainingRuntimes:remaining}],recovery,profile:modelPlan?.profile,modelChanges:modelPlan?.changes||[],configPath:modelPlan?.configRelativePath,configChanges:configActions.length,workPreserved:true,note:'La instalación global fue actualizada. Las preferencias de modelos de Sol se retiraron; otras configuraciones y datos de los proyectos se conservaron.'};
}
