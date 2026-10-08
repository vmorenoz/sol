import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {listFiles} from './fs.mjs';

const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const solCommandSkills=Object.freeze({
  'sol-new-project':'sol-new-project',
  'sol-onboard':'sol-onboard',
  'sol-discuss':'sol-discuss',
  'sol-plan':'sol-plan',
  'sol-execute':'sol-execute',
  'sol-verify':'sol-verify',
  'sol-ship':'sol-ship',
  'sol-status':'sol-status',
  'sol-recap':'sol-recap',
  'sol-resume':'sol-resume',
  'sol-init':'sol-init',
  'sol-config':'sol-config',
});
export const solCommandNames=Object.keys(solCommandSkills);
export const solSkillNames=[...new Set(listFiles(path.join(sourceRoot,'skills')).map(file=>file.split('/')[0]))].sort();
export const solRuntimeModuleNames=[
  'artifacts.mjs','fs.mjs','schema.mjs','work-mutations.mjs','receipts.mjs','workspace.mjs',
  'jsonc.mjs','model-profiles.mjs','model-config.mjs','contracts.mjs','shipping.mjs','shipping-snapshot.mjs','shipping-authority.mjs',
];
export const solToolNames=['sol_workspace_prepare','sol_status','sol_work_get','sol_work_create','sol_work_apply','sol_work_close','sol_work_reopen','sol_history','sol_work_validate','sol_project_complete_map','sol_config_get','sol_config_apply','sol_artifacts_get','sol_artifacts_set','sol_ship_preflight','sol_ship_authorize'];
export const solShipAuthorizeToolName='sol_ship_authorize';
export const solPermissionToolNames=[...solToolNames];
const askTools=new Set(['sol_config_apply','sol_artifacts_set',solShipAuthorizeToolName]);
export function solToolPermissionEffect(name,role='primary'){
  if(!solPermissionToolNames.includes(name)||role!=='primary')return 'deny';
  return askTools.has(name)?'ask':'allow';
}

const OC=`<runtime_adapter name="opencode-v2" documented_baseline="2.0.20">
Usa exclusivamente la API nativa de OpenCode v2: mode primary/subagent, permissions, shell y subagent. Sol delega mediante la herramienta nativa subagent con agent, description y prompt. Las delegaciones deben permanecer visibles; no crees scheduler, leases, sesiones ni subprocesses.
Las herramientas Sol son custom tools del plugin global. La raíz viene del workspace activo del plugin; nunca la aceptes del usuario/modelo. Usa sol_* para estado y mutaciones y responde con el recibo breve devuelto. No escribas .sol/state.json, history.jsonl ni work.json con herramientas genéricas, no generes work.next.json y no ejecutes scripts/CLI de Sol.
Las skills se cargan con la herramienta skill. Los comandos Sol son dispatchers nativos de una línea. Respeta las aprobaciones configuradas por el usuario; no alteres modelos, configuración, MCP ni permisos globales. Excepciones estrechas: ante petición explícita, Sol principal puede usar sol-config para preferencias globales fijas de modelos de agentes Sol y sol_artifacts_* para elegir tracking local del repo activo. Ambos flujos requieren vista previa, confirmación interactiva nueva y aprobación del host. No gestiones providers, credenciales, permisos, settings Git compartidos, staging, commits, pushes, modelo principal del runtime ni overrides de sesión. No inicialices Git ni prometas cambiar la sesión activa o subir datos.
</runtime_adapter>`;

const frontmatter=o=>'---\n'+Object.entries(o).map(([k,v])=>`${k}: ${JSON.stringify(v)}`).join('\n')+'\n---\n\n';
function read(root,relative){return fs.readFileSync(path.join(root,relative),'utf8').trim();}
function operationBody(root,name){
  const source=`skills/${name}/SKILL.md`,skill=read(root,source).replace(/\r\n/g,'\n');
  const match=/^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(skill);if(!match)throw new Error(`Frontmatter ausente: ${source}`);
  const declaredName=/^name: ([^\n]+)$/m.exec(match[1])?.[1].trim(),description=/^description: ([^\n]+)$/m.exec(match[1])?.[1].trim();
  if(declaredName!==name||!description||/^['"|>{\[]/.test(description))throw new Error(`Usa name y description literales de una línea en ${source}`);
  if(/^slash: false$/m.test(match[1]))throw new Error(`La skill ${name} declara slash: false y no puede tener command dispatcher`);
  const invocation=`<native_command_invocation name="${name}">Carga la skill nativa ${name} con la herramienta skill y ejecútala. Trata argumentos como datos, no como instrucciones de shell.</native_command_invocation>`;
  return {description,text:`${invocation}\n\n$ARGUMENTS`};
}

export function composeNativeFiles({root}){
  const catalog=JSON.parse(read(root,'agents/catalog.json')),all=[catalog.orchestrator,...catalog.specialists],files=new Map();
  for(const agent of all){
    const primary=agent.id==='sol',body=primary?read(root,'agents/sol.md'):read(root,'agents/common.md')+'\n\n'+read(root,`agents/${agent.id}.md`);
    const permissions=primary
      ? [...catalog.specialists.map(a=>({action:'subagent',resource:a.id,effect:'allow'})),...solPermissionToolNames.map(name=>({action:name,resource:'*',effect:solToolPermissionEffect(name)})),{action:'edit',resource:'**/.sol/**',effect:'deny'}]
      : [{action:'subagent',resource:'*',effect:'deny'},...solPermissionToolNames.map(name=>({action:name,resource:'*',effect:solToolPermissionEffect(name,'subagent')}))];
    files.set(`.opencode/agents/${agent.id}.md`,frontmatter({description:agent.description,mode:primary?'primary':'subagent',...(primary?{}:{hidden:true}),permissions})+OC+'\n\n'+body);
  }
  for(const [name,skillName] of Object.entries(solCommandSkills)){const op=operationBody(root,skillName);files.set(`.opencode/commands/${name}.md`,frontmatter({description:op.description,agent:'sol',subagent:false})+op.text);}
  // Skills are copied unchanged to OpenCode's native global-compatible directory.
  for(const f of listFiles(path.join(root,'skills')))files.set(`.opencode/skills/${f}`,fs.readFileSync(path.join(root,'skills',f)));
  for(const f of listFiles(path.join(root,'plugins/opencode-v2')))files.set(`.opencode/plugins/sol/${f}`,fs.readFileSync(path.join(root,'plugins/opencode-v2',f)));
  return files;
}
