import test from 'node:test'
import assert from 'node:assert/strict'
import { createPermissionBridge } from '../plugins/opencode-v2/permission-bridge.mjs'

function host() {
  let hook, handlers, wake
  const queue = [], published = []
  const ctx = {
    permission: { hook: async (_name, fn) => { hook = fn } },
    event: { subscribe: ({ signal }) => ({ async *[Symbol.asyncIterator]() {
      while (!signal.aborted) {
        if (!queue.length) await new Promise(resolve => { wake = resolve; signal.addEventListener('abort', resolve, { once: true }) })
        while (queue.length) yield queue.shift()
      }
    } }) },
    rpc: { register: async (_definition, value) => { handlers = value; return { events: { emit: async (_name, data) => { published.push(data) } } } } },
  }
  return { ctx, published, get handlers() { return handlers }, evaluate: event => hook(event), emit(type, data) { queue.push({ type, data }); wake?.() } }
}
const turn = () => new Promise(resolve => setImmediate(resolve))
const invocation = () => ({ action: 'sol_artifacts_set', input: { dryRun: false, mode: 'local' }, resources: ['/workspace'], context: { agent: 'sol', sessionID: 'ses_test', id: 'call_test', messageID: 'msg_test', signal: new AbortController().signal } })
async function present(h, ref) {
  const descriptor = await h.handlers.describe(ref)
  const event = { ...descriptor, effect: 'allow' }
  await h.evaluate(event)
  assert.equal(event.effect, 'ask')
  h.emit('permission.asked', descriptor)
  await turn()
  return descriptor
}

test('native asked and once authorize exactly one immutable invocation', async () => {
  const h = host(), bridge = await createPermissionBridge(h.ctx)
  const input = invocation(), done = bridge.authorize(input)
  const ref = h.published[0], descriptor = await present(h, ref)
  assert.equal(await h.handlers.describe(ref), null)
  assert.ok(Object.isFrozen(descriptor.metadata.input))
  h.emit('permission.replied', { sessionID: descriptor.sessionID, requestID: descriptor.id, reply: 'once' })
  await done
  assert.equal(await h.handlers.cancel({ ...ref, reason: 'replay' }), false)
  bridge.dispose()
})

test('reply alone, rejection, cancellation and reload cannot grant', async () => {
  for (const mode of ['reply-alone', 'reject', 'abort', 'reload', 'rpc-cancel']) {
    const h = host(), bridge = await createPermissionBridge(h.ctx)
    const controller = new AbortController(), input = invocation(); input.context.signal = controller.signal
    const done = bridge.authorize(input), rejected = assert.rejects(done, /no acreditado/)
    const ref = h.published[0]
    if (mode === 'reply-alone') h.emit('permission.replied', { sessionID: ref.sessionID, requestID: ref.requestID, reply: 'once' })
    if (mode === 'reject') { await present(h, ref); h.emit('permission.replied', { sessionID: ref.sessionID, requestID: ref.requestID, reply: 'reject' }) }
    if (mode === 'abort') controller.abort()
    if (mode === 'reload') bridge.dispose()
    if (mode === 'rpc-cancel') await h.handlers.cancel({ ...ref, reason: 'host error' })
    await rejected
    bridge.dispose()
  }
})

test('deny preserved; mismatched asked fails closed; connection timeout ends at claim', async () => {
  const h = host(), bridge = await createPermissionBridge(h.ctx, { connectionTimeoutMs: 15 })
  const first = bridge.authorize(invocation()), rejected = assert.rejects(first)
  const descriptor = await h.handlers.describe(h.published[0])
  const event = { ...descriptor, effect: 'deny' }; await h.evaluate(event)
  assert.equal(event.effect, 'deny'); await rejected
  const second = bridge.authorize(invocation()), mismatch = assert.rejects(second)
  const next = await h.handlers.describe(h.published[1]); await h.evaluate({ ...next, effect: 'allow' })
  h.emit('permission.asked', { ...next, resources: ['/different'] }); await mismatch
  const third = bridge.authorize(invocation())
  const final = await present(h, h.published[2])
  await new Promise(resolve => setTimeout(resolve, 30))
  h.emit('permission.replied', { sessionID: final.sessionID, requestID: final.id, reply: 'always' }); await third
  bridge.dispose()
})
