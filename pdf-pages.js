export const CANVAS_LIMITS = { edge: 16384, area: 16777216 };

export function pageCanvasPlan(width, height, pageHeight, scale = 2) {
  if (![width, height, pageHeight, scale].every(value => Number.isFinite(value) && value > 0)) throw new Error('報告頁面尺寸無效');
  const canvasWidth = Math.ceil(Math.ceil(width) * scale), canvasHeight = Math.ceil(Math.ceil(pageHeight) * scale);
  if (canvasWidth > CANVAS_LIMITS.edge || canvasHeight > CANVAS_LIMITS.edge || canvasWidth * canvasHeight > CANVAS_LIMITS.area) {
    throw new Error('頁面尺寸超出直接下載範圍，可使用系統列印／另存 PDF');
  }
  return { pages: Math.ceil(height / pageHeight), canvasWidth, canvasHeight, area: canvasWidth * canvasHeight };
}

// Lay out CSS page breaks once, then rasterize only one clipped A4 page at a time.
export async function renderPagedPdf(report, options, { onProgress = () => {}, isCurrent = () => true } = {}) {
  let layoutOverlay;
  try {
    const layout = window.html2pdf().set(options).from(report).toContainer();
    const container = await layout.get('container');
    layoutOverlay = await layout.get('overlay');
    const pageSize = await layout.get('pageSize');
    await Promise.all([...container.querySelectorAll('img')].map(img => img.decode().catch(() => {})));
    const width = container.getBoundingClientRect().width;
    const pageHeight = pageSize.inner.px.height;
    const plan = pageCanvasPlan(width, container.scrollHeight, pageHeight, options.html2canvas.scale);
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
      const content = laidOut.cloneNode(true);
      Object.assign(content.style, { position: 'absolute', left: '0', top: `${-index * pageHeight}px`, margin: '0' });
      page.append(content);
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
