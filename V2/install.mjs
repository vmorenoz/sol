#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {install,uninstall} from './lib/install.mjs';
import {getSolVersionInfo} from './lib/version.mjs';

export const HELP=`Sol · instalador global para OpenCode v2

Uso:
  node install.mjs [--dry-run] [--profile inherited|balanced|custom] [--model <agente>=<provider/model#variante>]
  node install.mjs uninstall [--dry-run]
  node version.mjs

Opciones:
  --dry-run   Comprueba y muestra el plan sin escribir archivos
  --profile   Preferencias de modelos: inherited, balanced o custom; sin opción conserva preferencias existentes
  --model     Asignación repetible; custom requiere al menos una. Usa "inherit" para quitarla.
  --version   Muestra la versión de esta distribución, sin instalar
  --help      Muestra esta ayuda (no requiere OpenCode)

Ejemplo: node install.mjs --profile balanced
Ejemplo: node install.mjs --profile custom --model sol=openai/gpt-6.1-sol#medium

Después, /sol-config permite ajustar preferencias individuales; /models cambia el modelo principal de OpenCode.

Instala solo recursos globales de Sol. No recorre ni modifica datos de proyectos.
Instalar requiere Node.js 22+ y OpenCode v2 disponible en PATH. Desinstalar usa el registro y no requiere detectar OpenCode. Sin preguntas interactivas.`;

function summary(result,{remove,dryRun}){
  const counts=actions=>actions.reduce((c,a)=>(c[a.action]=(c[a.action]||0)+1,c),{});
  if(dryRun){
    const plan=result.actions?counts(result.actions):{};
    const removals=result.removals||result.targets?.flatMap(x=>x.removals)||[];
    return [
      ...(result.version?[`Distribución Sol: ${result.version}${result.buildInfo?.buildHash?` · build ${result.buildInfo.buildHash}`:''}.`]:[]),
      `Vista previa · no se escribió ni modificó ningún archivo.`,
      ...(result.opencodeVersion?[`OpenCode detectado: ${result.opencodeVersion}`]:[]),
      ...(result.target?[`Destino: ${result.target}`]:[]),
      `Archivos: ${plan.create||0} nuevos, ${plan.update||0} actualizados, ${plan.unchanged||0} sin cambios.`,
      `Limpieza prevista: ${removals.length} archivo(s).`,
      ...(result.legacy?.length?[`Integración legacy detectada: ${result.legacy.join(', ')}.`]:[]),
      ...(result.configPaths?.length?[`Se ajustarán configuraciones en: ${result.configPaths.join(', ')} (sin mostrar contenido).`]:[]),
      ...(result.profile?[`Perfil de modelos: ${result.profile}; ${result.preservedModels?'se conservan las preferencias existentes; ':''}cambios previstos: ${result.modelChanges?.length||0}.`]:[]),
      ...(result.configPath?[`Configuración global: ${result.configPath}. La migración .json → .jsonc conservará un respaldo privado.`]:[]),
      'Los respaldos usarán permisos 0700/0600; los controles ACL/cifrado del sistema anfitrión siguen aplicando.',
      'Siguiente paso: ejecuta el mismo comando sin --dry-run para aplicar el plan.'].join('\n');
  }
  if(remove)return result.uninstalled
      ? `Sol se retiró de OpenCode v2 (${result.targets?.[0]?.removed??0} archivo(s)).${result.configChanges?` Configuraciones legacy ajustadas: ${result.configChanges}.`:''}${result.recovery?`\nRespaldo protegido por permisos 0700/0600 (no se restaura automáticamente): ${result.recovery}\nPara recuperar un archivo, cópialo desde files/<ruta-original> usando recovery.json como índice.`:''}\nLos datos de tus proyectos se conservaron.`
    : result.note||'No había una instalación registrada; no se cambió nada.';
  return [`Sol${result.version?` ${result.version}`:''} quedó instalado para OpenCode v2.`,
     ...(result.buildInfo?.buildHash?[`Build instalado: ${result.buildInfo.buildHash}.`]:[]),
     `Resumen: ${result.created} nuevos, ${result.updated} actualizados, ${result.unchanged} sin cambios; ${result.removed} retirados.`,
      ...(result.legacy?.length?[`Integración legacy migrada: ${result.legacy.join(', ')}.`]:[]),
      ...(result.profile?[`Perfil de modelos: ${result.profile}; ${result.preservedModels?'se conservaron las preferencias existentes; ':''}cambios en preferencias de Sol: ${result.modelChanges?.length||0}.`]:[]),
     ...(result.configChanges?[`Referencias de configuración legacy actualizadas: ${result.configChanges}.`]:[]),
     ...(result.recovery?[`Respaldo protegido por permisos 0700/0600 (no se restaura automáticamente): ${result.recovery}`,'Índice recovery.json; conserva esta carpeta para recuperación manual. Los controles ACL/cifrado del sistema anfitrión siguen aplicando.']:[]),
     'Siguiente paso: reinicia OpenCode y consulta /sol-version para contrastar el plugin cargado con la instalación; /sol-config ajusta preferencias de Sol. El modelo principal de OpenCode se cambia aparte con /models.'].join('\n');
}
function guidance(message){
  if(/No se pudo detectar OpenCode/.test(message))return `${message}\nQué hacer: instala OpenCode v2 o asegúrate de que «opencode» esté disponible en PATH.`;
  if(/requiere OpenCode v2|Detectado:/.test(message))return `${message}\nQué hacer: actualiza a OpenCode v2 y vuelve a ejecutar el instalador.`;
  if(/archivo ajeno o modificado|Integración anterior|Colisión|no se puede comprobar su propiedad/i.test(message))return `${message}\nQué hacer: conserva esos archivos; revisa el conflicto y respáldalo o muévelo manualmente antes de reintentar.`;
  if(/JSON|configuración/i.test(message))return `${message}\nQué hacer: valida el archivo indicado y conserva una copia antes de corregirlo.`;
  return `${message}\nNo se completó la operación. Revisa el mensaje y corrige la causa antes de reintentar.`;
}
export function main(args=process.argv.slice(2),io={}){
  const out=io.out||console.log,err=io.err||console.error,nodeVersion=io.nodeVersion||process.versions.node;
  // Help and syntax are handled before version/runtime probes.
  if(args.includes('--help')){out(HELP);return;}
  if(args.length===1&&args[0]==='--version'){const info=getSolVersionInfo();out(`Sol ${info.version} · distribución${info.buildHash?` · build ${info.buildHash}`:''}`);return info;}
  const remove=args[0]==='uninstall';if(remove)args=args.slice(1);
  let dryRun=false,profile;const overrides={};
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(arg==='--dry-run')dryRun=true;
    else if(arg==='--profile'){
      const value=args[++i];if(!['inherited','balanced','custom'].includes(value))throw new Error('--profile requiere inherited, balanced o custom.');profile=value;
    }else if(arg==='--model'){
      const value=args[++i],match=/^([a-z0-9-]+)=(.+)$/i.exec(value||'');if(!match)throw new Error('--model requiere <agente>=<provider/model#variante>; usa "inherit" para quitar la asignación.');
      if(Object.hasOwn(overrides,match[1]))throw new Error(`Asignación repetida para ${match[1]}.`);
      overrides[match[1]]=match[2]==='inherit'?null:match[2];
    }else throw new Error(`Opción desconocida: ${arg}. Ejecuta node install.mjs --help para ver las opciones.`);
  }
  if(Object.keys(overrides).length&&profile!=='custom')throw new Error('--model solo se admite con --profile custom.');
  if(profile==='custom'&&!Object.keys(overrides).length)throw new Error('--profile custom requiere al menos una opción --model <agente>=<provider/model#variante>.');
  if(Number(nodeVersion.split('.')[0])<22)throw new Error('Sol requiere Node.js 22 o superior. Actualiza Node.js y vuelve a ejecutar el comando.');
  out(remove?'Comprobación · instalación global…':'Comprobación · requisitos y conflictos…');
  const result=remove?(io.uninstallFn||uninstall)({dryRun}):(io.installFn||install)({dryRun,profile,overrides,...io.installOptions});
  if(dryRun)out('Vista previa lista');
  else if(remove)out('Limpieza completada');
  else if(!dryRun)out('Instalación completada');
  out(summary(result,{remove,dryRun}));
  return result;
}
export function reportError(error){console.error(`[ERROR] ${guidance(error.message)}`);process.exitCode=1;}
if(process.argv[1]&&import.meta.url===pathToFileURL(fs.realpathSync(path.resolve(process.argv[1]))).href)try{main();}catch(error){reportError(error);}
