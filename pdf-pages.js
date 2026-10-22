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
  return { pages: slices.length, canvasWidth, canvasHeight, area: canvasWidth * canvasHeight, slices, oversized };
}

// offsetTop/offsetHeight stay in layout pixels even while the preview uses CSS zoom.
export function reportBreakPoints(container) {
  const top = element => {
    let value = 0;
    for (let node = element; node && node !== container; node = node.offsetParent) value += node.offsetTop;
    return value;
  };
  const label = element => {
    const index = [...container.querySelectorAll(element.tagName)].indexOf(element) + 1;
    return `${element.tagName.toLowerCase()}${element.className ? '.' + String(element.className).trim().replace(/\s+/g, '.') : ''}[${index}] ${element.textContent.trim().replace(/\s+/g, ' ').slice(0, 90)}`;
  };
  return [...container.querySelectorAll('h2, h3, tr, .print-photo, .photo-card, .print-alert, .print-map, .point-print-table, .analysis-panel, footer')].flatMap(element => {
    const following = element.matches('h2, h3') ? element.nextElementSibling : null;
    const block = { start: top(element), end: top(element) + element.offsetHeight, label: label(element) };
    return following ? [block, { ...block, end: Math.max(block.end, top(following) + following.offsetHeight), label: `${block.label} + 首區塊` }] : [block];
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
    const plan = pageCanvasPlan(width, container.scrollHeight, pageHeight, options.html2canvas.scale, blocks);
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
