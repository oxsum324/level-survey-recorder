export const CANVAS_LIMITS = { edge: 16384, area: 16777216 };

export function pageCanvasPlan(width, height, pageHeight, scale = 2, breakPoints = []) {
  if (![width, height, pageHeight, scale].every(value => Number.isFinite(value) && value > 0)) throw new Error('報告頁面尺寸無效');
  const canvasWidth = Math.ceil(Math.ceil(width) * scale), canvasHeight = Math.ceil(Math.ceil(pageHeight) * scale);
  if (canvasWidth > CANVAS_LIMITS.edge || canvasHeight > CANVAS_LIMITS.edge || canvasWidth * canvasHeight > CANVAS_LIMITS.area) {
    throw new Error('頁面尺寸超出直接下載範圍，可使用系統列印／另存 PDF');
  }
  const blocks = breakPoints.filter(block => Number.isFinite(block.start) && Number.isFinite(block.end) && block.start >= 0 && block.end > block.start)
    .map(block => ({ ...block, start: Math.floor(block.start), end: Math.ceil(block.end) }));
  const oversized = blocks.filter(block => block.end - block.start > pageHeight);
  const keepTogether = blocks.filter(block => block.end - block.start <= pageHeight);
  const slices = [];
  for (let start = 0; start < height;) {
    const limit = Math.min(start + pageHeight, height);
    let end = limit;
    // Recheck after each move: a heading group may overlap its first table row/photo.
    while (true) {
      const crossing = keepTogether.filter(block => block.start < end && block.end > end && block.start > start);
      if (!crossing.length) break;
      end = Math.min(...crossing.map(block => block.start));
    }
    const hardCuts = blocks.filter(block => block.start < end && block.end > end);
    slices.push({ start, end, next: blocks.filter(block => block.start === end).map(block => block.label), hardCuts });
    start = end;
  }
  let shortLastPage = null;
  if (slices.length > 1) {
    const tail = slices.at(-1), previous = slices.at(-2);
    const remaining = height - tail.start;
    if (remaining <= pageHeight * 0.08) {
      const fits = height - previous.start <= pageHeight;
      const crossesProtected = keepTogether.some(block => block.start < previous.start && block.end > previous.start);
      const merged = fits && !crossesProtected;
      shortLastPage = { height: remaining, merged, reason: merged ? '可容納於前頁' : !fits ? '合併後超過頁高' : '會跨越保護區塊' };
      if (merged) {
        previous.end = height;
        previous.next = blocks.filter(block => block.start === height).map(block => block.label);
        previous.hardCuts = blocks.filter(block => block.start < previous.start && block.end > previous.start);
        slices.pop();
      }
    }
  }
  return { pages: slices.length, canvasWidth, canvasHeight, area: canvasWidth * canvasHeight, slices, oversized, shortLastPage };
}

// offsetTop/offsetHeight stay in layout pixels even while the preview uses CSS zoom.
export function reportBreakPoints(container) {
  const elements = [...container.querySelectorAll('h2, h3, tr, .print-photo, .photo-card, .print-alert, .print-map, .point-print-table, .analysis-panel, footer')];
  let ancestor = elements[0];
  while (ancestor && ancestor !== container) ancestor = ancestor.offsetParent;
  const useRect = elements.length > 0 && ancestor !== container;
  let origin, zoom = 1;
  if (useRect) {
    console.warn('報告區塊的 offsetParent 鏈不含轉檔容器；改用相對 DOMRect 與 CSS zoom 量測。');
    origin = container.getBoundingClientRect();
    const view = container.ownerDocument?.defaultView;
    for (let node = container; node; node = node.parentElement) {
      const value = parseFloat(view?.getComputedStyle(node).zoom);
      if (Number.isFinite(value) && value > 0) zoom *= value;
    }
  }
  const bounds = element => {
    if (useRect) {
      const rect = element.getBoundingClientRect();
      return { top: (rect.top - origin.top) / zoom, height: rect.height / zoom };
    }
    let value = 0;
    for (let node = element; node && node !== container; node = node.offsetParent) value += node.offsetTop;
    return { top: value, height: element.offsetHeight };
  };
  const label = element => {
    const index = [...container.querySelectorAll(element.tagName)].indexOf(element) + 1;
    return `${element.tagName.toLowerCase()}${element.className ? '.' + String(element.className).trim().replace(/\s+/g, '.') : ''}[${index}] ${element.textContent.trim().replace(/\s+/g, ' ').slice(0, 90)}`;
  };
  return elements.flatMap(element => {
    let following = element.matches('h2, h3') ? element.nextElementSibling : null;
    if (following) {
      let substantive = following;
      while (substantive && substantive.offsetHeight < 60) substantive = substantive.nextElementSibling;
      following = substantive || following;
    }
    const measured = bounds(element);
    const block = { start: measured.top, end: measured.top + measured.height, label: label(element) };
    const next = following ? bounds(following) : null;
    return next ? [block, { ...block, end: Math.max(block.end, next.top + next.height), label: `${block.label} + 首區塊` }] : [block];
  });
}

// Measure the unpaginated DOM, then rasterize one clipped A4 page at a time.
export async function renderPagedPdf(report, options, { onProgress = () => {}, isCurrent = () => true } = {}) {
  let layoutOverlay;
  try {
    const layout = window.html2pdf().set({ ...options, pagebreak: { mode: [] } }).from(report).toContainer();
    const container = await layout.get('container');
    layoutOverlay = await layout.get('overlay');
    const pageSize = await layout.get('pageSize');
    await Promise.all([...container.querySelectorAll('img')].map(img => img.decode().catch(() => {})));
    const width = container.getBoundingClientRect().width;
    const pageHeight = pageSize.inner.px.height;
    const blocks = reportBreakPoints(container);
    // Rounded offset geometry can extend one pixel beyond scrollHeight. Include the whole last block.
    const height = Math.ceil(Math.max(container.scrollHeight, ...blocks.map(block => block.end)));
    const plan = pageCanvasPlan(width, height, pageHeight, options.html2canvas.scale, blocks);
    const laidOut = container.firstElementChild.cloneNode(true);
    layoutOverlay.remove(); layoutOverlay = null;
    const seed = document.createElement('canvas'); seed.width = 1; seed.height = 1;
    const seedContext = seed.getContext('2d'); seedContext.fillStyle = 'white'; seedContext.fillRect(0, 0, 1, 1);
    const pdf = await window.html2pdf().set({ ...options, enableLinks: false }).from(seed, 'canvas').toPdf().get('pdf');
    for (let index = 0; index < plan.pages; index++) {
      if (!isCurrent()) throw new Error('預覽已關閉');
      onProgress(index + 1, plan.pages);
      const page = document.createElement('div');
      Object.assign(page.style, { position: 'relative', width: `${pageSize.inner.width}mm`, height: `${pageHeight}px`, overflow: 'hidden', background: 'white' });
      const slice = plan.slices[index];
      const clip = document.createElement('div');
      Object.assign(clip.style, { position: 'relative', width: '100%', height: `${slice.end - slice.start}px`, overflow: 'hidden' });
      const content = laidOut.cloneNode(true);
      Object.assign(content.style, { position: 'absolute', left: '0', top: `${-slice.start}px`, margin: '0' });
      clip.append(content); page.append(clip);
      const worker = window.html2pdf().set({ ...options, pagebreak: { mode: [] }, enableLinks: false }).from(page).toContainer();
      const overlay = await worker.get('overlay');
      let canvas;
      try {
        canvas = await worker.toCanvas().get('canvas');
        if (canvas.width > CANVAS_LIMITS.edge || canvas.height > CANVAS_LIMITS.edge || canvas.width * canvas.height > CANVAS_LIMITS.area) {
          throw new Error('頁面尺寸超出直接下載範圍，可使用系統列印／另存 PDF');
        }
        if (index) pdf.addPage();
        pdf.addImage(canvas.toDataURL('image/jpeg', options.image.quality), 'JPEG', 15, 15, pageSize.inner.width, pageSize.inner.height);
      } finally {
        if (canvas) { canvas.width = 0; canvas.height = 0; }
        overlay.remove(); page.remove();
      }
    }
    return pdf.output('blob');
  } finally {
    layoutOverlay?.remove();
  }
}
