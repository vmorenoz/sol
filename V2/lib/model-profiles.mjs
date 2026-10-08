export const SOL_AGENT_IDS = Object.freeze([
  'sol', 'sol-researcher', 'sol-explorer', 'sol-planner', 'sol-plan-auditor',
  'sol-executor', 'sol-qa-auditor', 'sol-security-auditor', 'sol-code-reviewer', 'sol-ui-auditor',
]);

export const MODEL_PROFILES = Object.freeze([
  { id: 'inherited', label: 'Heredado', description: 'OpenCode decide los modelos; Sol no fija preferencias.' },
  { id: 'balanced', label: 'Equilibrado', description: 'Asignaciones fijas de Sol para futuras delegaciones.' },
  { id: 'custom', label: 'Personalizado', description: 'Conserva asignaciones actuales y aplica cambios individuales.' },
]);

const high = 'openai/gpt-6.1-sol#high';
const balanced = Object.freeze({
  sol: 'openai/gpt-6.1-sol#medium',
  'sol-explorer': 'openai/gpt-6-luna#medium',
  'sol-executor': 'openai/gpt-6-luna#high',
  'sol-researcher': high, 'sol-planner': high, 'sol-plan-auditor': high,
  'sol-qa-auditor': high, 'sol-code-reviewer': high, 'sol-security-auditor': high, 'sol-ui-auditor': high,
});

export function validateModelSelector(selector, catalog) {
  if (typeof selector !== 'string' || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+(?:#[A-Za-z0-9._-]+)?$/.test(selector))
    throw new Error('Modelo inválido; usa provider/model o provider/model#variant.');
  const [model, variant] = selector.split('#');
  const slash = model.indexOf('/');
  const providerID = model.slice(0, slash), id = model.slice(slash + 1);
  const entry = catalog.find(item => item?.providerID === providerID && item?.id === id);
  if (!entry || entry.enabled !== true || !['alpha', 'beta', 'active'].includes(entry.status))
    throw new Error(`Modelo no habilitado o no disponible: ${providerID}/${id}.`);
  if (variant && !(entry.variants || []).some(item => item?.id === variant))
    throw new Error(`La variante ${variant} no está disponible para ${providerID}/${id}.`);
  return selector;
}

export function resolveModelAssignments({ profile = 'inherited', current = {}, overrides = {}, catalog = [] } = {}) {
  if (!['inherited', 'balanced', 'custom'].includes(profile)) throw new Error(`Perfil desconocido: ${profile}.`);
  for (const id of [...Object.keys(current), ...Object.keys(overrides)])
    if (!SOL_AGENT_IDS.includes(id)) throw new Error(`Agente Sol no reconocido: ${id}.`);
  if (profile === 'inherited') {
    if (Object.keys(overrides).length) throw new Error('El perfil heredado no admite overrides.');
    return Object.fromEntries(SOL_AGENT_IDS.map(id => [id, null]));
  }
  const result = profile === 'balanced' ? { ...balanced } : Object.fromEntries(SOL_AGENT_IDS.map(id => [id, current[id] ?? null]));
  for (const [id, value] of Object.entries(overrides)) {
    if (value !== null) validateModelSelector(value, catalog);
    result[id] = value;
  }
  for (const value of Object.values(result)) if (value !== null) validateModelSelector(value, catalog);
  if (profile === 'custom' && !Object.keys(overrides).length) throw new Error('El perfil personalizado requiere al menos una preferencia individual.');
  return Object.fromEntries(SOL_AGENT_IDS.map(id => [id, result[id] ?? null]));
}

export function detectModelProfile(assignments) {
  if (SOL_AGENT_IDS.every(id => assignments[id] == null)) return 'inherited';
  if (SOL_AGENT_IDS.every(id => assignments[id] === balanced[id])) return 'balanced';
  return 'custom';
}
