import { parseArtifact, buildTrails } from './model.js';

const workspace = document.querySelector('#workspace');
const announcement = document.querySelector('#announcement');
const reload = document.querySelector('[data-testid="reload"]');
const kinds = ['Internal', 'Server', 'Client', 'Producer', 'Consumer'];
const statuses = ['Unset', 'OK', 'Error'];
let trails = [];
let actionIndex = 0;
let selectedSpan = null;
let excludedCount = 0;
let request;

// Artifact strings only enter the DOM through textContent.
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function countLabel(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function statusBadge(span) {
  return element('span', `badge status-${span.statusCode}`, `OTel ${statuses[span.statusCode] ?? 'Unknown'}`);
}

function spanKey(span) {
  return `${span.traceId}:${span.spanId}`;
}

function walk(nodes, visit) {
  for (const node of nodes) {
    visit(node.span);
    walk(node.children, visit);
  }
}

function defaultSpan(trail) {
  return trail.children.find(node => node.span.kind === 1)?.span ?? trail.children[0]?.span ?? null;
}

function panelHeader(label, extra) {
  const header = element('div', 'panel-header');
  header.append(element('h2', '', label));
  if (extra) header.append(element('span', 'panel-count', extra));
  return header;
}

function addField(list, label, value, mono = false) {
  const group = element('div', 'detail-field');
  group.append(element('dt', '', label), element('dd', mono ? 'mono' : '', value));
  list.append(group);
}

function renderDetails(container) {
  container.replaceChildren(panelHeader('Span evidence', selectedSpan ? 'SELECTED' : null));
  if (!selectedSpan) {
    container.append(element('p', 'panel-placeholder', 'No observed span to inspect for this action.'));
    return;
  }
  const span = selectedSpan;
  const heading = element('div', 'inspector-heading');
  heading.append(element('p', 'eyebrow', `${kinds[span.kind] ?? 'Unknown'} span`), element('h3', '', span.name), statusBadge(span));
  container.append(heading);
  const list = element('dl', 'details');
  addField(list, 'Observed duration', `${span.durationMs} ms`, true);
  addField(list, 'Name', span.name);
  addField(list, 'Path', span.path ?? 'Not recorded', true);
  addField(list, 'Kind', `${kinds[span.kind] ?? 'Unknown'} (${span.kind})`);
  addField(list, 'OpenTelemetry status', `${statuses[span.statusCode] ?? 'Unknown'} (${span.statusCode})`);
  container.append(list);
  const source = element('section', 'source-box');
  source.append(element('h3', 'eyebrow', 'Source location'));
  const location = element('p', 'mono', span.source.status === 'mapped'
    ? `${span.source.file}:${span.source.line}:${span.source.column}` : 'Unknown source');
  location.dataset.testid = 'source-location';
  source.append(location, element('p', 'source-note', span.source.status === 'mapped'
    ? 'Recorded source position. Source content is not loaded.' : 'No source position was recorded for this span.'));
  container.append(source);
  const ids = element('dl', 'details identifiers');
  addField(ids, 'Trace ID', span.traceId, true);
  addField(ids, 'Span ID', span.spanId, true);
  addField(ids, 'Parent span ID', span.parentSpanId ?? 'None (root span)', true);
  container.append(ids, element('p', 'status-note', 'OTel status is not an HTTP response code. Unset does not indicate success.'));
}

function render() {
  workspace.replaceChildren();
  workspace.className = 'workspace';
  const rail = element('section', 'panel action-panel');
  rail.setAttribute('aria-label', 'Browser actions');
  rail.append(panelHeader('Actions', String(trails.length)), element('p', 'rail-note', 'Serialized controlled fixture. Select an action to inspect its linked spans.'));
  const actionList = element('div', 'action-list');
  trails.forEach((trail, index) => {
    const button = element('button', `action-button${index === actionIndex ? ' is-selected' : ''}`);
    button.type = 'button';
    button.dataset.actionIndex = String(index);
    button.setAttribute('aria-pressed', String(index === actionIndex));
    const title = element('span', 'action-title');
    title.append(element('span', 'action-number', String(index + 1).padStart(2, '0')), element('span', '', `Action ${index + 1}`));
    button.append(title, element('span', 'action-subtitle', countLabel(trail.spanCount, 'observed span')));
    button.addEventListener('click', () => {
      actionIndex = index;
      selectedSpan = defaultSpan(trail);
      render();
      workspace.querySelector(`[data-action-index="${index}"]`).focus();
      announcement.textContent = `Action ${index + 1} selected. ${countLabel(trail.spanCount, 'observed span')}.`;
    });
    actionList.append(button);
  });
  rail.append(actionList);
  const exclusion = element('div', 'exclusion-note');
  exclusion.append(element('strong', '', countLabel(excludedCount, 'excluded span')), element('p', '', 'Not linked to these action roots. Kept out of the trails.'));
  rail.append(exclusion);

  const trail = trails[actionIndex];
  const trailPanel = element('section', 'panel trail-panel');
  trailPanel.dataset.testid = 'trail';
  trailPanel.setAttribute('aria-label', `Action ${actionIndex + 1} observed trail`);
  trailPanel.append(panelHeader(`Action ${actionIndex + 1} trail`, countLabel(trail.spanCount, 'span')));
  const root = element('div', 'correlation-root');
  root.append(element('span', 'eyebrow', 'Browser action · correlation context'), element('h3', '', `Action ${actionIndex + 1}`), element('p', '', 'IDs only. No observed browser span or duration.'));
  const context = element('dl', 'context-ids');
  addField(context, 'Trace ID', trail.traceId, true);
  addField(context, 'Correlation span ID', trail.spanId, true);
  root.append(context);
  trailPanel.append(root, element('p', 'tree-caption', 'OBSERVED BACKEND · PARENT-LINKED'));
  const details = element('aside', 'panel inspector');
  details.dataset.testid = 'span-details';
  details.setAttribute('aria-label', 'Selected span details');

  function tree(nodes) {
    const list = element('ul', 'span-tree');
    for (const node of nodes) {
      const item = element('li', 'span-node');
      const span = node.span;
      const button = element('button', 'span-button');
      button.type = 'button';
      button.dataset.spanId = span.spanId;
      button.setAttribute('aria-pressed', String(selectedSpan !== null && spanKey(span) === spanKey(selectedSpan)));
      const main = element('span', 'span-main');
      main.append(element('span', 'span-kind', kinds[span.kind] ?? 'Unknown'), element('span', 'span-name', span.name));
      if (span.path !== null) main.append(element('span', 'span-path mono', span.path));
      const meta = element('span', 'span-meta');
      meta.append(element('span', 'duration mono', `${span.durationMs} ms`), statusBadge(span));
      button.append(main, meta);
      button.addEventListener('click', () => {
        selectedSpan = span;
        trailPanel.querySelectorAll('[data-span-id]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
        renderDetails(details);
        announcement.textContent = `${span.name} selected. Span evidence updated.`;
      });
      item.append(button);
      if (node.children.length) item.append(tree(node.children));
      list.append(item);
    }
    return list;
  }
  if (trail.children.length) trailPanel.append(tree(trail.children));
  else {
    const empty = element('p', 'panel-placeholder', 'No observed backend spans are linked to this action.');
    empty.dataset.testid = 'artifact-empty';
    trailPanel.append(empty);
  }
  trailPanel.append(element('p', 'trail-note', 'Connections follow recorded parent span IDs. Durations may overlap and are not added together.'));
  renderDetails(details);
  workspace.append(rail, trailPanel, details);
}

function showState(type, title, copy) {
  workspace.className = 'state-panel';
  const state = element('section', `state-content ${type}`);
  if (type !== 'loading') state.dataset.testid = `artifact-${type}`;
  if (type === 'error') state.setAttribute('role', 'alert');
  state.append(element('span', 'state-symbol', type === 'error' ? '!' : '↳'), element('h2', '', title), element('p', '', copy));
  workspace.replaceChildren(state);
  announcement.textContent = title;
}

async function loadArtifact() {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  const timer = setTimeout(() => controller.abort(), 15000);
  reload.disabled = true;
  workspace.setAttribute('aria-busy', 'true');
  showState('loading', 'Reading local evidence…', 'Loading the artifact from this viewer’s server.');
  try {
    const response = await fetch('/artifact.json', { signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error' });
    if (!response.ok) throw new Error('Artifact request failed');
    const artifact = parseArtifact(await response.json());
    trails = buildTrails(artifact);
    const included = new Set();
    trails.forEach(trail => walk(trail.children, span => included.add(spanKey(span))));
    excludedCount = artifact.spans.filter(span => !included.has(spanKey(span))).length;
    actionIndex = 0;
    selectedSpan = trails.length ? defaultSpan(trails[0]) : null;
    if (trails.length) {
      render();
      announcement.textContent = `${countLabel(trails.length, 'action')} loaded. Action 1 selected. ${countLabel(excludedCount, 'span')} excluded.`;
    } else {
      showState('empty', 'No browser actions recorded.', `${countLabel(artifact.spans.length, 'span')} in the artifact, but no action context to link a trail. Generate the controlled fixture artifact, then reload.`);
    }
  } catch {
    if (request !== controller) return;
    showState('error', 'The artifact could not be loaded.', 'The local artifact may be unavailable or invalid. Check the viewer server and generated proof artifact, then use Reload artifact to try again.');
  } finally {
    clearTimeout(timer);
    if (request === controller) {
      workspace.setAttribute('aria-busy', 'false');
      reload.disabled = false;
    }
  }
}

// Buttons retain native Tab/Enter/Space behavior; arrows provide fast list browsing.
workspace.addEventListener('keydown', event => {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const button = event.target.closest('button');
  if (!button) return;
  const selector = button.hasAttribute('data-action-index') ? '[data-action-index]' : '[data-span-id]';
  const buttons = [...workspace.querySelectorAll(selector)];
  const current = buttons.indexOf(button);
  if (current < 0) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
    : Math.max(0, Math.min(buttons.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
  buttons[next].focus();
});
reload.addEventListener('click', loadArtifact);
loadArtifact();
