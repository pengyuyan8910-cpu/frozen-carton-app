import { generateReplanDraft } from "./product-pool-replan-service.mjs";

self.onmessage = event => {
  const request = event.data || {};
  try {
    const draft = generateReplanDraft(request);
    self.postMessage({ ok: true, draft });
  } catch (error) {
    self.postMessage({ ok: false, error: String(error?.stack || error) });
  }
};
