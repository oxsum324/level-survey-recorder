import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as calc from '../calc.js';
import * as store from '../store.js';
import * as audit from '../audit.js';
import * as integrity from '../integrity.js';
import * as exif from '../exif.js';
import * as observation from '../observation.js';

// Execute the real application handlers with a small DOM and storage boundary.
export function appHarness(overrides = {}) {
  const nodes = new Map(), events = new Map(), messages = [];
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      value: '', textContent: '', hidden: false, disabled: false, checked: false, dataset: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      setAttribute() {}, addEventListener() {}, focus() {}, close() {}, showModal() {},
    });
    return nodes.get(selector);
  };
  const context = vm.createContext({
    ...calc, ...store, ...audit, ...integrity, ...exif, ...observation,
    crypto, Blob, File, URL, Date, structuredClone, TextEncoder,
    setTimeout: () => 1, clearTimeout() {}, confirm: () => true,
    document: {
      querySelector: node, querySelectorAll: () => [],
      addEventListener: (type, handler) => { if (!events.has(type)) events.set(type, []); events.get(type).push(handler); },
      documentElement: node('html'), body: node('body'),
    },
    window: { addEventListener() {} }, navigator: {}, localStorage: { getItem: () => null, setItem() {} },
    replaceProject: async () => {}, saveProject: async () => {}, ...overrides,
  });
  const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/\bmain\(\);\s*$/, '');
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  context.testMessages = messages;
  run(`renderStations = renderPoints = renderPhotos = renderMap = renderAll = switchTab = () => {};
    notify = message => testMessages.push(message); confirmReplacement = async () => true;`);
  return {
    context, node, run, messages,
    click(dataset) {
      const target = { dataset, closest: () => target };
      for (const handler of events.get('click') || []) handler({ target });
    },
  };
}
