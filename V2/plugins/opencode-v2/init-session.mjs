import fs from 'node:fs';

/** Resolve the session for an explicit /sol-init invocation. */
export function createInitSessionResolver({client,router,location}) {
  let homeCreation,candidate;
  const stillAt=route=>{
    const current=router?.current?.();
    return route?.type==='home' ? current?.type==='home' : route?.type==='session'&&current?.type==='session'&&current.sessionID===route.sessionID;
  };
  const assertStillAt=route=>{if(!stillAt(route))throw new Error('La navegación cambió durante /sol-init; no se redirigió ni se inició el despacho.');};
  return async function resolve(route) {
    if(route?.type==='session'&&typeof route.sessionID==='string'){
      assertStillAt(route);
      if(candidate?.id===route.sessionID)candidate=undefined;
      return route.sessionID;
    }
    if(route?.type!=='home')throw new Error('Abre una sesión Sol o ejecuta /sol-init desde Inicio.');
    if(!client?.session?.create||!client?.session?.get||!router?.navigate)throw new Error('Este host no permite crear y verificar una sesión Sol desde Inicio.');
    assertStillAt(route);
    if(!homeCreation) {
      homeCreation=(async()=>{
        const resolvedLocation=typeof location==='function'?await location():location;
        const configuredDirectory=resolvedLocation?.directory;
        if(typeof configuredDirectory!=='string'||!configuredDirectory)throw new Error('No se pudo determinar el workspace activo para crear la sesión Sol.');
        const directory=fs.realpathSync(configuredDirectory);
        assertStillAt(route);
        let id=candidate?.directory===directory?candidate.id:undefined;
        if(!id){const created=await client.session.create({agent:'sol',location:{directory}});if(typeof created?.id!=='string'||!created.id)throw new Error('OpenCode no devolvió el ID de la sesión Sol creada.');id=created.id;candidate={id,directory};}
        const session=await client.session.get({sessionID:id});
        if(session.id!==id||session.agent!=='sol'||typeof session.location?.directory!=='string'||fs.realpathSync(session.location.directory)!==directory)throw new Error('La sesión creada no coincide con el agente Sol y workspace solicitados.');
        assertStillAt(route);
        router.navigate({type:'session',sessionID:session.id});
        const navigated=router.current?.();
        if(navigated?.type==='session'&&navigated.sessionID===session.id)candidate=undefined;
        return session.id;
      })().finally(()=>{homeCreation=undefined;});
    }
    return homeCreation;
  };
}
