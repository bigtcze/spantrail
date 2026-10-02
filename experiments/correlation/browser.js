import { createTraceContext, injectContext } from './context.js';

const origin = location.origin;
const endpoint = '/api/action';
const actionButton = document.querySelector('#run-action');
const result = document.querySelector('#result');
let count = 0;

if (!actionButton || !result) throw new Error('Fixture contract elements are missing');

actionButton.addEventListener('click', async () => {
  actionButton.disabled = true;
  try {
    const context = createTraceContext();
    const target = injectContext(endpoint, origin, endpoint);
    if (!target) throw new Error('Action URL is outside the instrumentation scope');
    const response = await fetch(target, {
      headers: { traceparent: `00-${context.traceId}-${context.spanId}-01` },
    });
    if (!response.ok) throw new Error(`Action failed: ${response.status}`);
    const body = await response.json();
    const control = await fetch('/api/control');
    if (!control.ok) throw new Error(`Control failed: ${control.status}`);
    count += 1;
    const countNode = document.querySelector('#action-count');
    if (countNode) countNode.textContent = String(count);
    result.textContent = `Action ${count} complete`;
    window.dispatchEvent(new CustomEvent('spantrail:action', { detail: { ...context, count, serverTraceId: body.traceId } }));
  } catch (error) {
    result.textContent = `Action failed: ${error.message}`;
  } finally {
    actionButton.disabled = false;
  }
});
