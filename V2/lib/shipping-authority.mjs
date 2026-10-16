import path from 'node:path';

const approvals=new Map();
const key=(root,sessionID,workId,intentId)=>JSON.stringify([path.resolve(root),sessionID,workId,intentId]);
const copy=value=>JSON.parse(JSON.stringify(value));

/** Process-private, session-bound authorization cache. No model-supplied approval flag is accepted. */
export function rememberNativeShippingApproval({root,sessionID,workId,intent,workContractSha256}){
  if(!root||!sessionID||!workId||!intent?.id||!intent.snapshotSha256||!Array.isArray(intent.actions)||!workContractSha256)throw new TypeError('Autorización nativa incompleta.');
  const record={intent:copy(intent),workContractSha256,approvedAt:intent.approval?.approvedAt};
  approvals.set(key(root,sessionID,workId,intent.id),record);
  return {intentId:intent.id,snapshotSha256:intent.snapshotSha256,actions:[...intent.actions]};
}
export function nativeShippingApproval({root,sessionID,workId,intentId}){
  const record=approvals.get(key(root,sessionID,workId,intentId));
  return record?copy(record):null;
}
export function forgetNativeShippingApproval({root,sessionID,workId,intentId}){
  return approvals.delete(key(root,sessionID,workId,intentId));
}
