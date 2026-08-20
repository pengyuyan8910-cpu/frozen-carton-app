function signature(value) {
  return JSON.stringify(value == null ? null : value);
}

export function createCloudBaseline(state, cloudRevision = 0) {
  return {
    version: 1,
    initialized: cloudRevision > 0,
    cloudRevision: Math.max(0, Math.trunc(Number(cloudRevision) || 0)),
    payloadSignature: signature(state),
  };
}

export function shouldInitializeCloud(baseline) {
  return !baseline || baseline.initialized !== true;
}

export function evaluateCloudPull({ baseline, remote }) {
  if (!remote) return { action: 'unavailable' };
  if (shouldInitializeCloud(baseline)) return { action: 'first-pull' };
  const revision = Math.max(0, Math.trunc(Number(remote.doc_revision) || 0));
  const currentRevision = Math.max(0, Math.trunc(Number(baseline.cloudRevision) || 0));
  if (revision < currentRevision) return { action: 'stale-rejected' };
  if (revision === currentRevision && signature(remote.payload) === baseline.payloadSignature) {
    return { action: 'unchanged' };
  }
  return { action: 'confirm-required' };
}

