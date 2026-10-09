import { createHash, randomBytes } from 'node:crypto'

const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false })
const text = { type: 'string', minLength: 1 }
const reference = { sessionID: text, requestID: text, nonce: text }
export const permissionBridgeDefinition = {
  id: 'sol.permission',
  methods: {
    describe: { input: object(reference), output: { anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] } },
    cancel: { input: object({ ...reference, reason: text }), output: { type: 'boolean' } },
  },
  events: { requested: { schema: object(reference) } },
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
const equal = (left, right) => stable(left) === stable(right)
const denied = reason => new Error(`Permiso nativo Sol no acreditado: ${reason}. No se inició el cambio.`)

/** No approval endpoint: only authenticated host permission events may settle a grant. */
export async function createPermissionBridge(ctx, { connectionTimeoutMs = 10000 } = {}) {
  if (!ctx.rpc?.register || !ctx.event?.subscribe || !ctx.permission?.hook) {
    let disposed = false
    return { authorize: async () => { throw denied('host sin RPC/eventos de permisos compatibles') }, assertActive() { if (disposed) throw denied('puente recargado') }, dispose() { disposed = true } }
  }
  const pending = new Map()
  const controller = new AbortController()
  let closed = false
  const lookup = ref => {
    const item = pending.get(ref?.requestID)
    return item && item.descriptor.sessionID === ref.sessionID && item.nonce === ref.nonce ? item : undefined
  }
  const finish = (item, error) => {
    if (pending.get(item.descriptor.id) !== item) return
    pending.delete(item.descriptor.id)
    clearTimeout(item.timer)
    item.signal.removeEventListener('abort', item.abort)
    if (error) item.reject(error)
    else item.resolve()
  }
  const dispose = () => {
    if (closed) return
    closed = true
    controller.abort()
    for (const item of [...pending.values()]) finish(item, denied('puente recargado o desconectado'))
  }
  const matches = (item, request) => request?.sessionID === item.descriptor.sessionID &&
    request?.action === item.descriptor.action && equal(request.resources, item.descriptor.resources) &&
    equal(request.metadata, item.descriptor.metadata) && equal(request.source, item.descriptor.source)

  await ctx.permission.hook('evaluate', async event => {
    const item = [...pending.values()].find(item => matches(item, event))
    if (!item || !item.claimed || closed) return
    if (event.effect === 'allow') event.effect = 'ask'
    if (event.effect === 'ask') item.evaluated = true
    // Preserve a configured or earlier-hook deny without weakening it.
    if (event.effect === 'deny') finish(item, denied('política del host denegó la operación'))
  })
  // Start listening before publishing requests. A lost or malformed event never grants.
  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (closed) break
        const request = event.data
        if (event.type === 'permission.asked') {
          const item = pending.get(request?.id)
          if (!item) continue
          if (!item.claimed || !item.evaluated || !matches(item, request) || !equal(request.save, [])) {
            finish(item, denied('la solicitud del host no coincide con la invocación'))
            continue
          }
          item.asked = true
        }
        if (event.type === 'permission.replied') {
          const item = pending.get(request?.requestID)
          if (!item || request.sessionID !== item.descriptor.sessionID) continue
          if (!item.asked || !['once', 'always'].includes(request.reply)) finish(item, denied('solicitud rechazada o sin pregunta nativa coincidente'))
          else finish(item)
        }
      }
    } catch { /* A disconnected stream invalidates every pending operation. */ }
    finally { dispose() }
  })()
  let registration
  try {
    registration = await ctx.rpc.register(permissionBridgeDefinition, {
      describe: async ref => {
        const item = lookup(ref)
        if (!item || closed || item.claimed) return null
        item.claimed = true
        clearTimeout(item.timer) // Only connection discovery is timed, never user deliberation.
        return item.descriptor
      },
      cancel: async ref => {
        const item = lookup(ref)
        if (!item) return false
        finish(item, denied('el cliente no pudo solicitar el permiso nativo'))
        return true
      },
    })
  } catch (error) { dispose(); throw error }
  return {
    async authorize({ action, input, resources, context }) {
      if (closed || context?.signal?.aborted) throw denied('operación cancelada o puente cerrado')
      if (context?.agent !== 'sol' || !context.sessionID || !context.id || !context.messageID || !context.signal) throw denied('identidad de invocación incompleta')
      const snapshot = JSON.parse(JSON.stringify(input))
      const nonce = randomBytes(24).toString('hex')
      const requestID = `per_${randomBytes(20).toString('hex')}`
      const descriptor = freeze({
        sessionID: context.sessionID, id: requestID, agent: 'sol', action,
        resources: [...resources], save: [],
        source: { type: 'tool', messageID: context.messageID, id: context.id },
        metadata: { solPermission: { nonce, inputSha256: createHash('sha256').update(stable(snapshot)).digest('hex'), callID: context.id }, input: snapshot },
      })
      await new Promise((resolve, reject) => {
        const item = { descriptor, nonce, resolve, reject, signal: context.signal, claimed: false, evaluated: false, asked: false }
        item.abort = () => finish(item, denied('operación cancelada'))
        pending.set(requestID, item)
        item.timer = setTimeout(() => finish(item, denied('ningún cliente TUI recogió la solicitud')), connectionTimeoutMs)
        context.signal.addEventListener('abort', item.abort, { once: true })
        if (context.signal.aborted) return item.abort()
        void registration.events.emit('requested', { sessionID: context.sessionID, requestID, nonce }).catch(() => finish(item, denied('no se pudo notificar al cliente TUI')))
      })
      if (closed || context.signal.aborted || !equal(input, snapshot)) throw denied('invocación cancelada o modificada después de la aprobación')
    },
    assertActive() { if (closed) throw denied('puente recargado o desconectado') },
    dispose,
  }
}
