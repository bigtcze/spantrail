import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { startViewer } from './server.js';

const proofPath = resolve(process.env.SPANTRAIL_ARTIFACT_PATH ?? 'experiments/correlation/artifacts/proof.json');
const original = JSON.parse(await readFile(proofPath, 'utf8'));
const temp = await mkdtemp(join(tmpdir(), 'spantrail-viewer-e2e-'));
const artifactPath = join(temp, 'artifact.json');
let viewer;
let browser;
const extraViewers = [];
const externalAttempts = [];
const allowedOrigins = new Set();

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function setArtifact(artifact) { return writeFile(artifactPath, JSON.stringify(artifact)); }
function details(page) { return page.getByTestId('span-details'); }
async function textField(page, label) {
  return details(page).locator('.detail-field').filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd').innerText();
}
async function loaded(page) { await page.getByTestId('trail').waitFor(); }

try {
  await setArtifact(original);
  viewer = await startViewer({ artifactPath, port: 0 });
  allowedOrigins.add(viewer.origin);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const allRequests = [];
  const allPageErrors = [];
  context.on('page', observedPage => {
    observedPage.on('request', request => allRequests.push(request.url()));
    observedPage.on('pageerror', error => allPageErrors.push(error.message));
  });
  await context.route('**/*', route => {
    if (!allowedOrigins.has(new URL(route.request().url()).origin)) {
      externalAttempts.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  await page.goto(viewer.origin);
  await loaded(page);

  const actions = page.locator('[data-action-index]');
  assert.equal(await actions.count(), 2, 'the real proof renders exactly two actions');
  const api = await (await context.request.get(`${viewer.origin}/artifact.json`)).json();
  assert.deepEqual(api, { actions: original.actions, spans: original.spans }, 'server sanitizes the real proof without altering its evidence');

  const tree = page.getByTestId('trail').locator(':scope > ul.span-tree');
  assert.equal(await tree.locator(':scope > li').count(), 1);
  const server = tree.locator(':scope > li').first();
  assert.equal(await server.locator(':scope > button .span-path').innerText(), '/api/action');
  const service = server.locator(':scope > ul > li').filter({ has: page.locator('.span-name', { hasText: 'action.service' }) });
  assert.equal(await service.count(), 1, 'service is nested directly under HTTP server');
  const after = service.locator(':scope > ul > li');
  assert.equal(await after.count(), 1, 'after-await is nested directly under service');
  assert.equal(await after.locator(':scope > button .span-name').innerText(), 'action.after-await');
  assert.equal(await page.locator('[data-action-index], [data-span-id]').count(), 5, 'only two action and three evidence selection controls are rendered');

  const proofServer = original.spans.find(span => span.path === '/api/action' && span.kind === 1);
  const proofService = original.spans.find(span => span.name === 'action.service');
  const proofAfter = original.spans.find(span => span.name === 'action.after-await');
  const selectSpan = async span => page.locator(`[data-span-id="${span.spanId}"]`).click();
  await selectSpan(proofService);
  assert.equal(await details(page).locator('.inspector-heading h3').innerText(), proofService.name);
  assert.equal(await textField(page, 'Name'), proofService.name);
  assert.equal(await textField(page, 'Path'), 'Not recorded');
  assert.equal(await textField(page, 'Trace ID'), proofService.traceId);
  assert.equal(await textField(page, 'Span ID'), proofService.spanId);
  assert.equal(await textField(page, 'Parent span ID'), proofService.parentSpanId);
  assert.equal(await page.getByTestId('source-location').innerText(), `${proofService.source.file}:${proofService.source.line}:${proofService.source.column}`);
  assert.equal(await textField(page, 'Observed duration'), `${proofService.durationMs} ms`);
  assert.equal(await details(page).locator('.badge').innerText(), 'OTel Unset');
  assert.match(await details(page).innerText(), /OTel status is not an HTTP response code/);
  assert.doesNotMatch(await details(page).innerText(), /HTTP response (?:code|status):\s*(?:200|success)/i);

  await selectSpan(proofServer);
  assert.equal(await page.getByTestId('source-location').innerText(), 'Unknown source');
  assert.equal(await details(page).locator('.badge').innerText(), 'OTel Unset');
  await selectSpan(proofAfter);
  assert.equal(await page.getByTestId('source-location').innerText(), `${proofAfter.source.file}:${proofAfter.source.line}:${proofAfter.source.column}`);
  await page.locator('[data-action-index="1"]').click();
  const secondRoot = original.spans.find(span => span.traceId === original.actions[1].traceId && span.parentSpanId === original.actions[1].spanId);
  assert.equal(await page.locator('[data-span-id][aria-pressed="true"]').count(), 1, 'action two resets selection to its own root span');
  assert.equal(await page.locator('[data-span-id][aria-pressed="true"]').getAttribute('data-span-id'), secondRoot.spanId);
  assert.equal(await details(page).locator('.inspector-heading h3').innerText(), secondRoot.name);
  assert.equal(await page.getByTestId('source-location').innerText(), 'Unknown source');

  const withSecret = clone(original);
  withSecret.secret = 'discarded-top-level-secret';
  withSecret.actions[0].secret = 'discarded-action-secret';
  withSecret.spans[0].secret = 'discarded-span-secret';
  const hostile = withSecret.spans.find(span => span.name === 'action.service');
  hostile.name = '<img src="https://outside.invalid/x" onerror="window.__injected=1">';
  hostile.path = '/<script>window.__injected=2</script>';
  await setArtifact(withSecret);
  await page.getByTestId('reload').click();
  await loaded(page);
  assert.equal(await page.locator('.span-name').filter({ hasText: hostile.name }).innerText(), hostile.name);
  assert.equal(await page.locator('.span-path').filter({ hasText: hostile.path }).innerText(), hostile.path);
  assert.equal(await page.locator('img, script').count(), 1, 'only the application module script exists; hostile text creates no elements');
  assert.equal(await page.evaluate(() => window.__injected), undefined);
  const apiText = await (await context.request.get(`${viewer.origin}/artifact.json`)).text();
  assert.doesNotMatch(apiText, /discarded-(?:top-level|action|span)-secret/);
  assert.doesNotMatch(await page.locator('body').innerText(), /discarded-(?:top-level|action|span)-secret/);

  const missingPath = join(temp, 'missing.json');
  const retryViewer = await startViewer({ artifactPath: missingPath, port: 0 });
  extraViewers.push(retryViewer);
  allowedOrigins.add(retryViewer.origin);
  const retryPage = await context.newPage();
  await retryPage.goto(retryViewer.origin);
  await retryPage.getByTestId('artifact-error').waitFor();
  await writeFile(missingPath, '{ malformed');
  await retryPage.getByTestId('reload').click();
  await retryPage.getByTestId('artifact-error').waitFor();
  await writeFile(missingPath, JSON.stringify(original));
  await retryPage.getByTestId('reload').click();
  await loaded(retryPage);
  assert.equal(await retryPage.locator('[data-action-index]').count(), 2, 'retry recovers from missing then malformed artifact');

  const emptyPath = join(temp, 'empty.json');
  await writeFile(emptyPath, JSON.stringify({ actions: [], spans: [] }));
  const emptyViewer = await startViewer({ artifactPath: emptyPath, port: 0 });
  extraViewers.push(emptyViewer);
  allowedOrigins.add(emptyViewer.origin);
  const emptyPage = await context.newPage();
  await emptyPage.goto(emptyViewer.origin);
  await emptyPage.getByTestId('artifact-empty').waitFor();
  assert.match(await emptyPage.getByTestId('artifact-empty').innerText(), /No browser actions recorded/);

  await page.setViewportSize({ width: 375, height: 812 });
  await page.locator('[data-action-index="0"]').focus();
  await page.keyboard.press('Enter');
  await loaded(page);
  await page.locator('[data-span-id]').first().focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.spanId), proofService.spanId, 'keyboard arrow moves span selection focus');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'small viewport has no horizontal page overflow');

  // Tripwire negative control: the request listener must see and block an attempted external navigation.
  const negativePage = await context.newPage();
  await negativePage.goto('https://outside.invalid/tripwire').catch(() => undefined);
  assert.equal(externalAttempts.filter(url => url === 'https://outside.invalid/tripwire').length, 1, 'route tripwire detects and blocks its synthetic external-request negative control');
  assert.deepEqual(externalAttempts, ['https://outside.invalid/tripwire'], 'all external attempts are blocked and only the deliberate negative control occurs');

  assert.ok(allRequests.filter(url => new URL(url).origin !== 'https://outside.invalid').every(url => allowedOrigins.has(new URL(url).origin)), 'viewer UI requests stay on their respective viewer origins');
  assert.deepEqual(allPageErrors, [], 'no uncaught browser errors in any page');
  console.log('Viewer Chromium E2E passed: real artifact hierarchy, evidence, selection, privacy, recovery, empty state, safety, keyboard, responsive layout, and network tripwire.');
} finally {
  try { await browser?.close(); } finally {
    try {
      for (const extra of extraViewers) await extra.close();
      await viewer?.close();
    } finally { await rm(temp, { recursive: true, force: true }); }
  }
}
