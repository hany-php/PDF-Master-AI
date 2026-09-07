import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { PageEditOperation } from '../types';

// Handle ESM import structure differences (default vs named exports)
const pdfjs = (pdfjsLib as any).default || pdfjsLib;

// IMPORTANT: Set worker source safely via Blob URL or CDN fallback
if (typeof window !== 'undefined' && pdfjs.GlobalWorkerOptions) {
    try {
        const workerBlob = new Blob(
            [`importScripts('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js');`],
            { type: 'application/javascript' }
        );
        pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(workerBlob);
    } catch {
        pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;
    }
} else if (!pdfjs.GlobalWorkerOptions) {
    console.error("PDF.js GlobalWorkerOptions not found");
}

export const createPDFFromBlob = async (file: File): Promise<{ doc: PDFDocument; pageCount: number }> => {
  const arrayBuffer = await file.arrayBuffer();
  const doc = await PDFDocument.load(arrayBuffer);
  return { doc, pageCount: doc.getPageCount() };
};

export const generateThumbnail = async (blob: Blob): Promise<string> => {
  const arrayBuffer = await blob.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);
  
  const scale = 0.5;
  const viewport = page.getViewport({ scale });
  
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.height = viewport.height;
  canvas.width = viewport.width;

  if (!context) throw new Error("Canvas context not available");

  await page.render({
    canvasContext: context,
    viewport: viewport,
  }).promise;

  return canvas.toDataURL();
};

export const mergePDFs = async (blobs: Blob[]): Promise<Blob> => {
  const mergedPdf = await PDFDocument.create();
  
  for (const blob of blobs) {
    const arrayBuffer = await blob.arrayBuffer();
    const pdf = await PDFDocument.load(arrayBuffer);
    const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
    copiedPages.forEach((page) => mergedPdf.addPage(page));
  }
  
  const savedBytes = await mergedPdf.save();
  return new Blob([savedBytes], { type: 'application/pdf' });
};

export const splitPDF = async (blob: Blob, fromPage: number, toPage: number): Promise<Blob> => {
  const arrayBuffer = await blob.arrayBuffer();
  const pdf = await PDFDocument.load(arrayBuffer);
  const subPdf = await PDFDocument.create();
  
  const start = Math.max(0, fromPage - 1);
  const end = Math.min(pdf.getPageCount() - 1, toPage - 1);
  
  const pageIndices: number[] = [];
  for (let i = start; i <= end; i++) pageIndices.push(i);
  
  const copiedPages = await subPdf.copyPages(pdf, pageIndices);
  copiedPages.forEach((page) => subPdf.addPage(page));
  
  const savedBytes = await subPdf.save();
  return new Blob([savedBytes], { type: 'application/pdf' });
};

export const reorderPages = async (blob: Blob, newOrder: number[]): Promise<Blob> => {
    const arrayBuffer = await blob.arrayBuffer();
    const pdf = await PDFDocument.load(arrayBuffer);
    const newPdf = await PDFDocument.create();

    const copiedPages = await newPdf.copyPages(pdf, newOrder);
    copiedPages.forEach(page => newPdf.addPage(page));

    const savedBytes = await newPdf.save();
    return new Blob([savedBytes], { type: 'application/pdf' });
};

export const removePage = async (blob: Blob, pageIndexToRemove: number): Promise<Blob> => {
    const arrayBuffer = await blob.arrayBuffer();
    const pdf = await PDFDocument.load(arrayBuffer);
    pdf.removePage(pageIndexToRemove);
    const savedBytes = await pdf.save();
    return new Blob([savedBytes], { type: 'application/pdf' });
};

export const canWinAnsiEncode = (text: string): boolean => {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Standard ASCII printable characters
    if (code >= 32 && code <= 126) continue;
    // Latin-1 Supplement characters supported by standard WinAnsi
    if (code >= 160 && code <= 255) continue;
    // Allowable whitespace controls: tab, newline, carriage return
    if (code === 9 || code === 10 || code === 13) continue;
    // Non-WinAnsi character (e.g. Arabic 0x0600 - 0x06FF, Cyrillic, Asian, Emojis)
    return false;
  }
  return true;
};

export const renderTextToPngBytes = (
  text: string,
  fontSize: number = 14,
  color: string = '#000000'
): { bytes: Uint8Array; width: number; height: number; bottomOffset: number } => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  // 3x scale factor for crisp vector-like text rendering in PDFs
  const scale = 3;
  const scaledFontSize = Math.max(8, fontSize) * scale;
  const fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", "Noto Sans Arabic", Tahoma, Arial, sans-serif';
  ctx.font = `${scaledFontSize}px ${fontFamily}`;

  // Measure text dimensions
  const metrics = ctx.measureText(text);
  const textWidth = Math.ceil(metrics.width);
  const ascent = metrics.actualBoundingBoxAscent || (scaledFontSize * 0.82);
  const descent = metrics.actualBoundingBoxDescent || (scaledFontSize * 0.22);
  const padding = 4 * scale;

  const canvasWidth = Math.max(textWidth + (padding * 2), 16);
  const canvasHeight = Math.max(Math.ceil(ascent + descent) + (padding * 2), 16);

  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  // Re-apply styles after canvas resize
  ctx.font = `${scaledFontSize}px ${fontFamily}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';

  // Support Arabic RTL text shaping and direction
  const isRtl = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
  ctx.direction = isRtl ? 'rtl' : 'ltr';

  const baselineY = ascent + padding;
  const startX = isRtl ? (canvasWidth - padding) : padding;

  ctx.fillText(text, startX, baselineY);

  const dataUrl = canvas.toDataURL('image/png');
  const base64Data = dataUrl.split(',')[1];
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return {
    bytes,
    width: canvasWidth / scale,
    height: canvasHeight / scale,
    bottomOffset: (descent + padding) / scale,
  };
};

export const addTextAnnotation = async (blob: Blob, pageIndex: number, text: string, x: number, y: number): Promise<Blob> => {
    return applyPageEdits(blob, pageIndex, [{ type: 'text', text, x, y }]);
};

export const applyPageEdits = async (blob: Blob, pageIndex: number, operations: PageEditOperation[]): Promise<Blob> => {
  const arrayBuffer = await blob.arrayBuffer();
  const pdf = await PDFDocument.load(arrayBuffer);
  const pages = pdf.getPages();
  const page = pages[pageIndex];
  const { width: pageWidth, height: pageHeight } = page.getSize();
  
  const helveticaFont = await pdf.embedFont(StandardFonts.Helvetica);

  for (const op of operations) {
      if (op.type === 'redact' && op.width && op.height) {
          page.drawRectangle({
              x: op.x * pageWidth,
              y: pageHeight - (op.y * pageHeight) - (op.height * pageHeight),
              width: op.width * pageWidth,
              height: op.height * pageHeight,
              color: rgb(1, 1, 1), // White
              borderColor: undefined,
              borderWidth: 0,
          });
      } else if (op.type === 'highlight' && op.width && op.height) {
          page.drawRectangle({
              x: op.x * pageWidth,
              y: pageHeight - (op.y * pageHeight) - (op.height * pageHeight),
              width: op.width * pageWidth,
              height: op.height * pageHeight,
              color: rgb(1, 1, 0), // Yellow
              opacity: 0.35,
          });
      } else if (op.type === 'text' && op.text) {
          let textDrawn = false;
          
          // Try standard font only if purely WinAnsi compatible
          if (canWinAnsiEncode(op.text)) {
              try {
                  let textColor = rgb(0, 0, 0);
                  if (op.color && op.color.startsWith('#') && op.color.length === 7) {
                      const r = parseInt(op.color.substring(1, 3), 16) / 255;
                      const g = parseInt(op.color.substring(3, 5), 16) / 255;
                      const b = parseInt(op.color.substring(5, 7), 16) / 255;
                      textColor = rgb(r, g, b);
                  }

                  page.drawText(op.text, {
                      x: op.x * pageWidth,
                      y: pageHeight - (op.y * pageHeight),
                      size: op.size || 14,
                      font: helveticaFont,
                      color: textColor,
                  });
                  textDrawn = true;
              } catch {
                  textDrawn = false;
              }
          }

          // If text contains non-WinAnsi characters (e.g. Arabic) or standard font failed:
          if (!textDrawn) {
              try {
                  const { bytes, width, height, bottomOffset } = renderTextToPngBytes(
                      op.text,
                      op.size || 14,
                      op.color || '#000000'
                  );
                  const embeddedPng = await pdf.embedPng(bytes);
                  const pdfY = pageHeight - (op.y * pageHeight) - bottomOffset;
                  
                  page.drawImage(embeddedPng, {
                      x: op.x * pageWidth,
                      y: pdfY,
                      width: width,
                      height: height,
                  });
              } catch (renderErr) {
                  console.error('Failed to render Unicode text to page:', renderErr);
              }
          }
      } else if (op.type === 'image' && op.imageData) {
          try {
              const base64Data = op.imageData.split(',')[1];
              const imageBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
              
              let embeddedImage;
              if (op.imageData.startsWith('data:image/png')) {
                  embeddedImage = await pdf.embedPng(imageBytes);
              } else {
                  embeddedImage = await pdf.embedJpg(imageBytes);
              }
              
              const imgDims = embeddedImage.scale(1);
              // Default width if not specified, e.g., 20% of page width
              const targetWidth = op.width ? op.width * pageWidth : pageWidth * 0.25;
              const scaleFactor = targetWidth / imgDims.width;
              const targetHeight = imgDims.height * scaleFactor;

              page.drawImage(embeddedImage, {
                  x: op.x * pageWidth,
                  y: pageHeight - (op.y * pageHeight) - targetHeight, // Draw from top-left logic mapping to bottom-left origin
                  width: targetWidth,
                  height: targetHeight,
              });
          } catch (e) {
              console.error("Failed to embed image", e);
          }
      }
  }

  const savedBytes = await pdf.save();
  return new Blob([savedBytes], { type: 'application/pdf' });
};

export const applyAllDocumentEdits = async (
  blob: Blob,
  allEdits?: Record<number, PageEditOperation[]>
): Promise<Blob> => {
  if (!allEdits) return blob;
  const pageIndicesWithEdits = Object.keys(allEdits)
    .map(Number)
    .filter(idx => allEdits[idx] && allEdits[idx].length > 0);

  if (pageIndicesWithEdits.length === 0) return blob;

  let currentBlob = blob;
  for (const pageIndex of pageIndicesWithEdits) {
    currentBlob = await applyPageEdits(currentBlob, pageIndex, allEdits[pageIndex]);
  }
  return currentBlob;
};

export const extractTextFromPage = async (blob: Blob, pageNumber: number): Promise<string> => {
    const arrayBuffer = await blob.arrayBuffer();
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    return textContent.items.map((item: any) => item.str).join(' ');
};

export interface ExtractedNativeItem {
  id: string;
  type: 'text';
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  size: number;
}

export const extractNativePageItems = async (
  blob: Blob,
  pageNumber: number
): Promise<ExtractedNativeItem[]> => {
  const arrayBuffer = await blob.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1.0 });
  const textContent = await page.getTextContent();

  const pageWidth = viewport.width;
  const pageHeight = viewport.height;

  const rawItems: Array<{
    str: string;
    x: number;
    y: number;
    width: number;
    height: number;
    size: number;
    baselineY: number;
  }> = [];

  for (const item of textContent.items as any[]) {
    const str = (item.str || '').trim();
    if (!str) continue;

    const transform = item.transform || [12, 0, 0, 12, 0, 0];
    const tx = transform[4];
    const ty = transform[5];
    const fontHeight = Math.sqrt(transform[0] * transform[0] + transform[1] * transform[1]) || 12;

    const itemWidth = item.width || (str.length * fontHeight * 0.5);
    const itemHeight = fontHeight * 1.15;

    const xPct = Math.max(0, Math.min(0.98, tx / pageWidth));
    const yPct = Math.max(0, Math.min(0.98, (pageHeight - ty) / pageHeight));
    const widthPct = Math.max(0.01, Math.min(0.98, itemWidth / pageWidth));
    const heightPct = Math.max(0.01, Math.min(0.5, itemHeight / pageHeight));

    rawItems.push({
      str,
      x: xPct,
      y: yPct,
      width: widthPct,
      height: heightPct,
      size: Math.max(9, Math.min(72, Math.round(fontHeight))),
      baselineY: ty,
    });
  }

  rawItems.sort((a, b) => {
    if (Math.abs(a.baselineY - b.baselineY) > 6) {
      return b.baselineY - a.baselineY;
    }
    return a.x - b.x;
  });

  const grouped: ExtractedNativeItem[] = [];
  let current: typeof rawItems[0] | null = null;

  for (const item of rawItems) {
    if (!current) {
      current = { ...item };
      continue;
    }

    const sameBaseline = Math.abs(item.baselineY - current.baselineY) <= 4;
    const rightEdge = current.x + current.width;
    const gap = item.x - rightEdge;
    const isAdjacent = gap >= -0.015 && gap <= 0.035;

    if (sameBaseline && isAdjacent) {
      current.str = current.str + ' ' + item.str;
      current.width = Math.min(0.98, (item.x + item.width) - current.x);
      current.height = Math.max(current.height, item.height);
    } else {
      grouped.push({
        id: `native-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        type: 'text',
        text: current.str,
        x: current.x,
        y: current.y,
        width: current.width,
        height: current.height,
        size: current.size,
      });
      current = { ...item };
    }
  }

  if (current && current.str) {
    grouped.push({
      id: `native-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      type: 'text',
      text: current.str,
      x: current.x,
      y: current.y,
      width: current.width,
      height: current.height,
      size: current.size,
    });
  }

  return grouped;
};

export const renderPageToBase64 = async (blob: Blob, pageNumber: number): Promise<string> => {
    const arrayBuffer = await blob.arrayBuffer();
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(pageNumber);
    
    const scale = 1.5;
    const viewport = page.getViewport({ scale });
    
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    
    if (!context) throw new Error("No context");
    
    await page.render({
        canvasContext: context,
        viewport: viewport
    }).promise;
    
    const dataUrl = canvas.toDataURL('image/png');
    return dataUrl.split(',')[1];
};

export const rotatePage = async (blob: Blob, pageIndex: number, rotationDegrees: number = 90): Promise<Blob> => {
    const arrayBuffer = await blob.arrayBuffer();
    const pdf = await PDFDocument.load(arrayBuffer);
    const pages = pdf.getPages();
    if (pageIndex >= 0 && pageIndex < pages.length) {
        const page = pages[pageIndex];
        const currentRotation = page.getRotation().angle;
        page.setRotation(degrees((currentRotation + rotationDegrees) % 360));
    }
    const savedBytes = await pdf.save();
    return new Blob([savedBytes], { type: 'application/pdf' });
};

export const createSamplePDF = async (): Promise<Blob> => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.HelveticaBold);
    const bodyFont = await pdf.embedFont(StandardFonts.Helvetica);

    // Page 1: Introduction
    const page1 = pdf.addPage([600, 800]);
    page1.drawRectangle({
        x: 0,
        y: 720,
        width: 600,
        height: 80,
        color: rgb(0.14, 0.38, 0.92)
    });
    page1.drawText('Sample Document - PDF Master AI', {
        x: 40,
        y: 750,
        size: 22,
        font,
        color: rgb(1, 1, 1)
    });
    page1.drawText('Welcome to your PDF Management & AI Editing Suite!', {
        x: 40,
        y: 670,
        size: 16,
        font,
        color: rgb(0.1, 0.1, 0.1)
    });
    page1.drawText('This sample file demonstrates the powerful features available in the app:', {
        x: 40,
        y: 630,
        size: 12,
        font: bodyFont,
        color: rgb(0.3, 0.3, 0.3)
    });
    const bullets = [
        '1. Visual editing: add text annotations, highlight content, redact, or place images.',
        '2. Document operations: merge multiple PDFs, split page ranges, and reorder pages.',
        '3. AI intelligence: summarize document content, suggest titles, and extract text via OCR.',
        '4. Multilingual support: seamlessly toggle between Arabic and English interfaces.'
    ];
    bullets.forEach((b, i) => {
        page1.drawText(b, {
            x: 50,
            y: 590 - (i * 30),
            size: 11,
            font: bodyFont,
            color: rgb(0.2, 0.2, 0.2)
        });
    });

    // Page 2: Content page
    const page2 = pdf.addPage([600, 800]);
    page2.drawText('Page 2: Executive Summary', {
        x: 40,
        y: 740,
        size: 18,
        font,
        color: rgb(0.14, 0.38, 0.92)
    });
    page2.drawText('AI-assisted PDF editing enables seamless document transformation.', {
        x: 40,
        y: 700,
        size: 12,
        font: bodyFont,
        color: rgb(0.2, 0.2, 0.2)
    });
    page2.drawText('You can click "Edit" to annotate this page or "AI Tools" to summarize it.', {
        x: 40,
        y: 670,
        size: 12,
        font: bodyFont,
        color: rgb(0.3, 0.3, 0.3)
    });

    const savedBytes = await pdf.save();
    return new Blob([savedBytes], { type: 'application/pdf' });
};