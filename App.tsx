import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, FileText, Trash2, Edit2, Layers, 
  Download, Split, Sparkles, Globe, ArrowLeft, ArrowRight, X, CheckCircle2, Circle,
  Eraser, Type, Save, Highlighter, Image as ImageIcon, Undo, MousePointer2,
  RotateCw, Copy, Check, Plus, Maximize2, ZoomIn, ZoomOut
} from 'lucide-react';
import { PDFDocumentData, Language, ViewMode, AIAnalysisResult, PageEditOperation, EditTool } from './types';
import { STRINGS } from './constants';
import * as db from './services/db';
import * as pdfService from './services/pdfService';
import * as geminiService from './services/geminiService';
import LoadingSpinner from './components/LoadingSpinner';

interface ResizeState {
  index: number;
  handle: 'se' | 'sw' | 'ne' | 'nw';
  startX: number;
  startY: number;
  initialX: number;
  initialY: number;
  initialWidth: number;
  initialHeight: number;
  initialSize?: number;
}

export default function App() {
  const [pdfs, setPdfs] = useState<PDFDocumentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState<Language>('ar');
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.DASHBOARD);
  const [activePdfId, setActivePdfId] = useState<string | null>(null);
  
  const [selectedPdfIds, setSelectedPdfIds] = useState<string[]>([]);
  
  // Editor State
  const [editorPages, setEditorPages] = useState<string[]>([]);
  const [processingAI, setProcessingAI] = useState(false);
  const [aiResult, setAiResult] = useState<AIAnalysisResult | null>(null);
  const [splitRange, setSplitRange] = useState('');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [editingDocTitle, setEditingDocTitle] = useState(false);
  const [docTitleInput, setDocTitleInput] = useState('');
  
  // Advanced Page Editor State
  const [editingPageIndex, setEditingPageIndex] = useState<number | null>(null);
  const [cleanPageUrl, setCleanPageUrl] = useState<string | null>(null);
  const [editTool, setEditTool] = useState<EditTool>('move');
  const [pendingEdits, setPendingEdits] = useState<PageEditOperation[]>([]);
  const [textColor, setTextColor] = useState('#000000');
  const [textSize, setTextSize] = useState<number>(14);
  
  // Visual Feedback & Drag State
  const imageRef = useRef<HTMLImageElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentDragRect, setCurrentDragRect] = useState<{x: number, y: number, w: number, h: number} | null>(null);
  
  // Selection & Resize State
  const [selectedEditIndex, setSelectedEditIndex] = useState<number | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isMovingElement, setIsMovingElement] = useState(false);
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);

  // Live Inline Text Editing State
  const [editingTextIndex, setEditingTextIndex] = useState<number | null>(null);
  const [editingTextValue, setEditingTextValue] = useState<string>('');

  // Page Elements Unlocking State
  const [isUnlockingElements, setIsUnlockingElements] = useState(false);
  const [unlockNotification, setUnlockNotification] = useState<string | null>(null);

  // Text Input State
  const [textInputState, setTextInputState] = useState<{visible: boolean, x: number, y: number, value: string} | null>(null);

  // Initialize Language
  useEffect(() => {
    const browserLang = navigator.language.startsWith('ar') ? 'ar' : 'en';
    setLang(browserLang);
  }, []);

  // Initialize Session & Load Files safely
  useEffect(() => {
    const initData = async () => {
      try {
        const storedPdfs = await db.getAllPDFs();
        if (storedPdfs && storedPdfs.length > 0) {
          setPdfs(storedPdfs.sort((a, b) => b.lastModified - a.lastModified));
        }
      } catch (err) {
        console.error("Error loading documents:", err);
      } finally {
        setLoading(false);
      }
    };
    initData();
  }, []);

  // Keyboard shortcut to delete selected element
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedEditIndex !== null && !textInputState && editingTextIndex === null) {
        setPendingEdits(prev => prev.filter((_, idx) => idx !== selectedEditIndex));
        setSelectedEditIndex(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedEditIndex, textInputState, editingTextIndex]);

  // Global MouseUp Listener to fix "Sticky" drag/resize issue
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isMovingElement || isDrawing || resizeState) {
        setIsMovingElement(false);
        setIsDrawing(false);
        setResizeState(null);
        
        // Commit drawing or click-to-erase if needed
        if (isDrawing && (editTool === 'eraser' || editTool === 'highlight')) {
          if (currentDragRect && currentDragRect.w > 0.008 && currentDragRect.h > 0.008) {
            setPendingEdits(prev => [...prev, {
              type: editTool === 'eraser' ? 'redact' : 'highlight',
              x: currentDragRect.x,
              y: currentDragRect.y,
              width: currentDragRect.w,
              height: currentDragRect.h
            }]);
          } else if (isDrawing && editTool === 'eraser' && currentDragRect) {
            // Click-to-erase: place a comfortable eraser patch at the clicked location
            setPendingEdits(prev => [...prev, {
              type: 'redact',
              x: Math.max(0, currentDragRect.x - 0.04),
              y: Math.max(0, currentDragRect.y - 0.018),
              width: 0.08,
              height: 0.036
            }]);
          }
        }
        setCurrentDragRect(null);
      }
    };

    if (isMovingElement || isDrawing || resizeState) {
      window.addEventListener('mouseup', handleGlobalMouseUp);
      window.addEventListener('blur', handleGlobalMouseUp);
    }

    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('blur', handleGlobalMouseUp);
    };
  }, [isMovingElement, isDrawing, editTool, currentDragRect, resizeState]);

  const refreshPdfs = async () => {
    const storedPdfs = await db.getAllPDFs();
    setPdfs(storedPdfs.sort((a, b) => b.lastModified - a.lastModified));
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setLoading(true);
      const files: File[] = Array.from(e.target.files);
      
      for (const file of files) {
        if (file.type !== 'application/pdf') continue;
        
        try {
          const previewUrl = await pdfService.generateThumbnail(file);
          const { pageCount } = await pdfService.createPDFFromBlob(file);

          const newPdf: PDFDocumentData = {
            id: crypto.randomUUID(),
            name: file.name,
            blob: file,
            baseBlob: file,
            pageEdits: {},
            previewUrl,
            pageCount,
            lastModified: Date.now(),
          };
          
          await db.savePDF(newPdf);
        } catch (err) {
          console.error("Error processing file", file.name, err);
        }
      }
      await refreshPdfs();
      setLoading(false);
      e.target.value = '';
    }
  };

  const handleLoadSample = async () => {
    setLoading(true);
    try {
      const sampleBlob = await pdfService.createSamplePDF();
      const previewUrl = await pdfService.generateThumbnail(sampleBlob);
      const { pageCount } = await pdfService.createPDFFromBlob(sampleBlob as File);

      const sampleDoc: PDFDocumentData = {
        id: crypto.randomUUID(),
        name: lang === 'ar' ? 'نموذج_مستند_تجريبي.pdf' : 'Sample_Demo_Document.pdf',
        blob: sampleBlob,
        baseBlob: sampleBlob,
        pageEdits: {},
        previewUrl,
        pageCount,
        lastModified: Date.now(),
      };

      await db.savePDF(sampleDoc);
      await refreshPdfs();
    } catch (err) {
      console.error("Error loading sample PDF:", err);
      alert(STRINGS.error[lang]);
    }
    setLoading(false);
  };

  const handleDelete = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (confirm(STRINGS.confirmDeleteDoc[lang])) {
      await db.deletePDF(id);
      setSelectedPdfIds(prev => prev.filter(pid => pid !== id));
      await refreshPdfs();
      if (activePdfId === id) {
        setViewMode(ViewMode.DASHBOARD);
        setActivePdfId(null);
      }
    }
  };

  const toggleSelection = (id: string) => {
    setSelectedPdfIds(prev => {
      if (prev.includes(id)) {
        return prev.filter(pid => pid !== id);
      } else {
        return [...prev, id];
      }
    });
  };

  const handleMerge = async () => {
    if (selectedPdfIds.length < 2) return;
    setLoading(true);
    
    try {
      const selectedDocs = selectedPdfIds
        .map(id => pdfs.find(p => p.id === id))
        .filter((p): p is PDFDocumentData => !!p);

      if (selectedDocs.length < 2) return;
      
      // Export each selected doc with its live edits applied
      const mergedBlobs: Blob[] = [];
      for (const doc of selectedDocs) {
        const base = doc.baseBlob || doc.blob;
        const finalBlob = await pdfService.applyAllDocumentEdits(base, doc.pageEdits);
        mergedBlobs.push(finalBlob);
      }
      
      const mergedBlob = await pdfService.mergePDFs(mergedBlobs);
      const previewUrl = await pdfService.generateThumbnail(mergedBlob);
      const { pageCount } = await pdfService.createPDFFromBlob(mergedBlob as File); 

      const newPdf: PDFDocumentData = {
        id: crypto.randomUUID(),
        name: `Merged_${Date.now()}.pdf`,
        blob: mergedBlob,
        baseBlob: mergedBlob,
        pageEdits: {},
        previewUrl,
        pageCount,
        lastModified: Date.now(),
      };
      
      await db.savePDF(newPdf);
      await refreshPdfs();
      setSelectedPdfIds([]);
    } catch (e) {
      console.error(e);
      alert(STRINGS.error[lang]);
    }
    setLoading(false);
  };

  const openEditor = async (pdf: PDFDocumentData, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setLoading(true);
    setActivePdfId(pdf.id);
    setViewMode(ViewMode.EDITOR);
    setAiResult(null);
    setEditingPageIndex(null);
    setDocTitleInput(pdf.name);
    setEditingDocTitle(false);
    
    const pages: string[] = [];
    const basePdf = pdf.baseBlob || pdf.blob;
    const limit = Math.min(pdf.pageCount, 50); 
    for (let i = 1; i <= limit; i++) {
      try {
        const pageEdits = pdf.pageEdits?.[i - 1];
        let b64: string;
        if (pageEdits && pageEdits.length > 0) {
          const pageBlob = await pdfService.applyPageEdits(basePdf, i - 1, pageEdits);
          b64 = await pdfService.renderPageToBase64(pageBlob, i);
        } else {
          b64 = await pdfService.renderPageToBase64(basePdf, i);
        }
        pages.push(`data:image/png;base64,${b64}`);
      } catch (err) {
        console.error("Error rendering page", i, err);
      }
    }
    setEditorPages(pages);
    setLoading(false);
  };

  // Export / Download PDF with all live edits burned into the exported file
  const handleDownload = async (pdf: PDFDocumentData, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setLoading(true);
    try {
      const basePdf = pdf.baseBlob || pdf.blob;
      const finalExportedBlob = await pdfService.applyAllDocumentEdits(basePdf, pdf.pageEdits);

      const url = URL.createObjectURL(finalExportedBlob);
      const a = document.createElement('a');
      a.href = url;
      const downloadName = pdf.name.endsWith('.pdf') ? pdf.name : `${pdf.name}.pdf`;
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export error:", err);
      alert(STRINGS.error[lang]);
    }
    setLoading(false);
  };

  const handleSaveRename = async () => {
    if (!activePdfId || !docTitleInput.trim()) return;
    const currentPdf = pdfs.find(p => p.id === activePdfId);
    if (!currentPdf) return;

    let finalName = docTitleInput.trim();
    if (!finalName.toLowerCase().endsWith('.pdf')) {
      finalName += '.pdf';
    }

    const updatedPdf: PDFDocumentData = {
      ...currentPdf,
      name: finalName,
      lastModified: Date.now()
    };

    await db.savePDF(updatedPdf);
    await refreshPdfs();
    setEditingDocTitle(false);
  };

  const handleSplit = async () => {
    if (!activePdfId || !splitRange.trim()) return;
    const currentPdf = pdfs.find(p => p.id === activePdfId);
    if (!currentPdf) return;

    setLoading(true);
    try {
      const parts = splitRange.split('-').map(s => Number(s.trim()));
      if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1]) || parts[0] <= 0 || parts[1] < parts[0] || parts[1] > currentPdf.pageCount) {
        alert(lang === 'ar' ? `يرجى إدخال نطاق صالح بين 1 و ${currentPdf.pageCount} (مثال: 1-2)` : `Please enter a valid range between 1 and ${currentPdf.pageCount} (e.g. 1-2)`);
        setLoading(false);
        return;
      }

      const [start, end] = parts;
      const basePdf = currentPdf.baseBlob || currentPdf.blob;
      const splitBlob = await pdfService.splitPDF(basePdf, start, end);
      const previewUrl = await pdfService.generateThumbnail(splitBlob);
      const { pageCount } = await pdfService.createPDFFromBlob(splitBlob as File);

      // Map relevant page edits for split pages
      const splitPageEdits: Record<number, PageEditOperation[]> = {};
      for (let p = start; p <= end; p++) {
        if (currentPdf.pageEdits?.[p - 1]) {
          splitPageEdits[p - start] = currentPdf.pageEdits[p - 1];
        }
      }

      const cleanBaseName = currentPdf.name.replace(/\.pdf$/i, '');
      const newPdf: PDFDocumentData = {
        id: crypto.randomUUID(),
        name: `${cleanBaseName}_pages_${start}-${end}.pdf`,
        blob: splitBlob,
        baseBlob: splitBlob,
        pageEdits: splitPageEdits,
        previewUrl,
        pageCount,
        lastModified: Date.now(),
      };

      await db.savePDF(newPdf);
      await refreshPdfs();
      alert(STRINGS.fileSaved[lang]);
      setSplitRange('');
    } catch (e) {
      alert(STRINGS.error[lang]);
    }
    setLoading(false);
  };

  const handleRotatePage = async (pageIdx: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!activePdfId) return;
    const currentPdf = pdfs.find(p => p.id === activePdfId);
    if (!currentPdf) return;

    setLoading(true);
    try {
      const basePdf = currentPdf.baseBlob || currentPdf.blob;
      const rotatedBlob = await pdfService.rotatePage(basePdf, pageIdx, 90);
      
      const updatedPdf: PDFDocumentData = {
        ...currentPdf,
        blob: rotatedBlob,
        baseBlob: rotatedBlob,
        lastModified: Date.now()
      };
      await db.savePDF(updatedPdf);
      await refreshPdfs();
      await openEditor(updatedPdf);
    } catch (err) {
      console.error("Error rotating page:", err);
      alert(STRINGS.error[lang]);
    }
    setLoading(false);
  };

  const handleMovePage = async (index: number, direction: 'left' | 'right', e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!activePdfId) return;
    const currentPdf = pdfs.find(p => p.id === activePdfId);
    if (!currentPdf) return;

    const targetIndex = direction === 'left' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= currentPdf.pageCount) return;

    setLoading(true);
    try {
      const order = Array.from({ length: currentPdf.pageCount }, (_, i) => i);
      const temp = order[index];
      order[index] = order[targetIndex];
      order[targetIndex] = temp;

      const basePdf = currentPdf.baseBlob || currentPdf.blob;
      const newBlob = await pdfService.reorderPages(basePdf, order);

      // Reorder pageEdits map
      const reorderedEdits: Record<number, PageEditOperation[]> = {};
      Object.keys(currentPdf.pageEdits || {}).forEach(k => {
        const oldIdx = Number(k);
        const newIdx = order.indexOf(oldIdx);
        if (newIdx !== -1 && currentPdf.pageEdits?.[oldIdx]) {
          reorderedEdits[newIdx] = currentPdf.pageEdits[oldIdx];
        }
      });

      const updatedPdf: PDFDocumentData = { 
        ...currentPdf, 
        blob: newBlob, 
        baseBlob: newBlob, 
        pageEdits: reorderedEdits,
        lastModified: Date.now() 
      };
      await db.savePDF(updatedPdf);
      await refreshPdfs();
      await openEditor(updatedPdf);
    } catch (err) {
      console.error("Error moving page:", err);
      alert(STRINGS.error[lang]);
    }
    setLoading(false);
  };

  const handleRemovePage = async (index: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!activePdfId) return;
    const currentPdf = pdfs.find(p => p.id === activePdfId);
    if (!currentPdf) return;

    if (currentPdf.pageCount <= 1) {
      alert(lang === 'ar' ? 'لا يمكن حذف الصفحة الوحيدة في المستند.' : 'Cannot delete the only page in the document.');
      return;
    }

    if (!confirm(STRINGS.confirmDeletePage[lang])) return;
    setLoading(true);
    
    try {
      const basePdf = currentPdf.baseBlob || currentPdf.blob;
      const newBlob = await pdfService.removePage(basePdf, index);
      const { pageCount } = await pdfService.createPDFFromBlob(newBlob as File);

      // Shift page edits down
      const shiftedEdits: Record<number, PageEditOperation[]> = {};
      Object.keys(currentPdf.pageEdits || {}).forEach(k => {
        const idx = Number(k);
        if (idx < index && currentPdf.pageEdits?.[idx]) {
          shiftedEdits[idx] = currentPdf.pageEdits[idx];
        } else if (idx > index && currentPdf.pageEdits?.[idx]) {
          shiftedEdits[idx - 1] = currentPdf.pageEdits[idx];
        }
      });

      const updatedPdf: PDFDocumentData = { 
        ...currentPdf, 
        blob: newBlob, 
        baseBlob: newBlob, 
        pageCount, 
        pageEdits: shiftedEdits,
        lastModified: Date.now() 
      };
      await db.savePDF(updatedPdf);
      await refreshPdfs();
      await openEditor(updatedPdf);
    } catch (e) {
      console.error(e);
      alert(STRINGS.error[lang]);
    }
    setLoading(false);
  };

  const handleAISummarize = async () => {
    if (!activePdfId) return;
    const currentPdf = pdfs.find(p => p.id === activePdfId);
    if (!currentPdf) return;

    setProcessingAI(true);
    try {
      const basePdf = currentPdf.baseBlob || currentPdf.blob;
      const text = await pdfService.extractTextFromPage(basePdf, 1);
      const summary = await geminiService.summarizeText(text || currentPdf.name);
      setAiResult(prev => ({ ...prev, summary }));
    } catch (e) {
      console.error(e);
    }
    setProcessingAI(false);
  };

  const handleAITitle = async () => {
    if (!activePdfId) return;
    const currentPdf = pdfs.find(p => p.id === activePdfId);
    if (!currentPdf) return;

    setProcessingAI(true);
    try {
      const basePdf = currentPdf.baseBlob || currentPdf.blob;
      const text = await pdfService.extractTextFromPage(basePdf, 1);
      const title = await geminiService.suggestTitle(text || currentPdf.name);
      setAiResult(prev => ({ ...prev, suggestedTitle: title }));
    } catch (e) {
      console.error(e);
    }
    setProcessingAI(false);
  };

  const handleAIOCR = async () => {
    if (!activePdfId || editorPages.length === 0) return;
    setProcessingAI(true);
    try {
      const base64Img = editorPages[0].split(',')[1];
      const text = await geminiService.performOCR(base64Img);
      setAiResult(prev => ({ ...prev, translatedText: text }));
    } catch (e) {
      console.error(e);
    }
    setProcessingAI(false);
  };

  const handleAITranslate = async () => {
    if (!aiResult) return;
    const textToTranslate = aiResult.summary || aiResult.translatedText;
    if (!textToTranslate) return;

    setProcessingAI(true);
    try {
      const target = lang === 'ar' ? 'ar' : 'en';
      const translated = await geminiService.translateText(textToTranslate, target);
      if (aiResult.summary) {
        setAiResult(prev => ({ ...prev, summary: translated }));
      } else {
        setAiResult(prev => ({ ...prev, translatedText: translated }));
      }
    } catch (e) {
      console.error(e);
    }
    setProcessingAI(false);
  };

  const applySuggestedTitle = async () => {
    if (!aiResult?.suggestedTitle || !activePdfId) return;
    const currentPdf = pdfs.find(p => p.id === activePdfId);
    if (!currentPdf) return;

    const newName = `${aiResult.suggestedTitle.replace(/[\\/:*?"<>|]/g, '')}.pdf`;
    const updatedPdf = { ...currentPdf, name: newName, lastModified: Date.now() };
    await db.savePDF(updatedPdf);
    await refreshPdfs();
    setDocTitleInput(newName);
    alert(STRINGS.fileSaved[lang]);
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // --- Visual Page Editor: Non-Destructive Live Elements & Resizing ---

  const handlePageClick = async (index: number) => {
    const currentPdf = pdfs.find(p => p.id === activePdfId);
    if (!currentPdf) return;

    setLoading(true);
    setEditingPageIndex(index);

    // Load clean unburned base page background so elements remain free overlays
    try {
      const basePdf = currentPdf.baseBlob || currentPdf.blob;
      const cleanB64 = await pdfService.renderPageToBase64(basePdf, index + 1);
      setCleanPageUrl(`data:image/png;base64,${cleanB64}`);
    } catch (err) {
      console.error("Failed to render clean page:", err);
      setCleanPageUrl(editorPages[index]);
    }

    // Load previously added live elements for this page
    const existingEdits = currentPdf.pageEdits?.[index] || [];
    setPendingEdits([...existingEdits]);
    setEditTool('move');
    setTextInputState(null);
    setSelectedEditIndex(existingEdits.length > 0 ? 0 : null);
    setLoading(false);
  };

  const closePageEditor = () => {
    setEditingPageIndex(null);
    setCleanPageUrl(null);
    setPendingEdits([]);
    setTextInputState(null);
    setSelectedEditIndex(null);
    setResizeState(null);
    setEditingTextIndex(null);
    setEditingTextValue('');
  };

  const startEditingText = (idx: number) => {
    const item = pendingEdits[idx];
    if (!item || item.type !== 'text') return;
    setSelectedEditIndex(idx);
    setEditingTextIndex(idx);
    setEditingTextValue(item.text || '');
    setIsMovingElement(false);
    setResizeState(null);
  };

  const saveEditingText = () => {
    if (editingTextIndex === null) return;
    const val = editingTextValue.trim();
    if (!val) {
      // If user completely cleared the text, remove the element
      setPendingEdits(prev => prev.filter((_, i) => i !== editingTextIndex));
      setSelectedEditIndex(null);
    } else {
      setPendingEdits(prev => {
        const next = [...prev];
        if (next[editingTextIndex]) {
          next[editingTextIndex] = {
            ...next[editingTextIndex],
            text: val,
            width: undefined, // Clear fixed width so text naturally fits its content
            height: undefined,
          };
        }
        return next;
      });
    }
    setEditingTextIndex(null);
    setEditingTextValue('');
  };

  const cancelEditingText = () => {
    setEditingTextIndex(null);
    setEditingTextValue('');
  };

  const handleUnlockPageElements = async () => {
    if (editingPageIndex === null || !activePdfId) return;
    const currentPdf = pdfs.find(p => p.id === activePdfId);
    if (!currentPdf) return;

    setIsUnlockingElements(true);
    try {
      const basePdf = currentPdf.baseBlob || currentPdf.blob;
      const items = await pdfService.extractNativePageItems(basePdf, editingPageIndex + 1);

      if (!items || items.length === 0) {
        setUnlockNotification(STRINGS.noElementsFound[lang]);
        setTimeout(() => setUnlockNotification(null), 5000);
        setIsUnlockingElements(false);
        return;
      }

      // Check existing unlocked items to prevent duplicate overlays
      const existingCoverIds = new Set(
        pendingEdits
          .map(e => e.originalCoverId)
          .filter(Boolean)
      );

      const newEdits: PageEditOperation[] = [];

      for (const item of items) {
        if (existingCoverIds.has(item.id)) continue;

        // 1. Redaction cover to cleanly mask original static text from background
        newEdits.push({
          type: 'redact',
          x: Math.max(0, item.x - 0.003),
          y: Math.max(0, item.y - (item.height * 0.88)),
          width: Math.min(1, item.width + 0.006),
          height: Math.min(1, item.height * 1.18),
          originalCoverId: item.id,
          isNativeUnlocked: true,
        });

        // 2. Interactive text element placed on top
        newEdits.push({
          type: 'text',
          text: item.text,
          x: item.x,
          y: item.y,
          size: item.size,
          color: '#000000',
          originalCoverId: item.id,
          isNativeUnlocked: true,
        });
      }

      setPendingEdits(prev => [...prev, ...newEdits]);
      setEditTool('move');
      setSelectedEditIndex(newEdits.length > 1 ? pendingEdits.length + 1 : null);
      setUnlockNotification(STRINGS.elementsUnlockedNotice[lang]);
      setTimeout(() => setUnlockNotification(null), 6000);
    } catch (err) {
      console.error('Failed to unlock elements:', err);
      alert(STRINGS.error[lang]);
    }
    setIsUnlockingElements(false);
  };

  const handleResizeHandleMouseDown = (
    e: React.MouseEvent,
    index: number,
    handle: 'se' | 'sw' | 'ne' | 'nw'
  ) => {
    e.stopPropagation();
    e.preventDefault();
    if (!imageRef.current) return;
    
    const rect = imageRef.current.getBoundingClientRect();
    const currentX = (e.clientX - rect.left) / rect.width;
    const currentY = (e.clientY - rect.top) / rect.height;
    const edit = pendingEdits[index];

    const defaultWidth = edit.width || (edit.type === 'text' ? Math.max(0.1, ((edit.text?.length || 5) * (edit.size || 14) * 0.6) / rect.width) : 0.2);
    const defaultHeight = edit.height || (edit.type === 'text' ? ((edit.size || 14) * 1.5) / rect.height : 0.1);

    setSelectedEditIndex(index);
    setResizeState({
      index,
      handle,
      startX: currentX,
      startY: currentY,
      initialX: edit.x,
      initialY: edit.y,
      initialWidth: defaultWidth,
      initialHeight: defaultHeight,
      initialSize: edit.size || 14,
    });
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!imageRef.current) return;
    
    const rect = imageRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    // Handle MOVE Tool (Hit Detection fallback)
    if (editTool === 'move') {
      let foundIndex = -1;
      for (let i = pendingEdits.length - 1; i >= 0; i--) {
        const edit = pendingEdits[i];
        let editW = edit.width || 0.15;
        let editH = edit.height || 0.05;
        let editY = edit.y;

        if (edit.type === 'text') {
          const padding = 0.02;
          editH = ((edit.size || 14) * 1.5 / rect.height) + padding;
          editW = ((edit.text?.length || 5) * (edit.size || 14) * 0.65 / rect.width) + padding;
          editY = edit.y - (editH * 0.8);
        }

        if (x >= edit.x && x <= edit.x + editW && y >= editY && y <= editY + editH) {
          foundIndex = i;
          break;
        }
      }

      if (foundIndex !== -1) {
        setSelectedEditIndex(foundIndex);
        setIsMovingElement(true);
        setDragOffset({ x: x - pendingEdits[foundIndex].x, y: y - pendingEdits[foundIndex].y });
      } else {
        setSelectedEditIndex(null);
      }
      return;
    }

    // Handle Drawing Tools (Eraser or Highlight)
    if (editTool === 'eraser' || editTool === 'highlight') {
      setIsDrawing(true);
      setStartPos({ x, y });
      setCurrentDragRect({ x, y, w: 0, h: 0 });
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (!imageRef.current) return;

    const rect = imageRef.current.getBoundingClientRect();
    const currentX = (e.clientX - rect.left) / rect.width;
    const currentY = (e.clientY - rect.top) / rect.height;

    // 1. Resizing in progress
    if (resizeState) {
      const deltaX = currentX - resizeState.startX;
      const deltaY = currentY - resizeState.startY;

      setPendingEdits(prev => {
        if (!prev[resizeState.index]) return prev;
        const next = [...prev];
        const item = { ...next[resizeState.index] };

        if (resizeState.handle === 'se') {
          const newW = Math.max(0.02, resizeState.initialWidth + deltaX);
          const newH = Math.max(0.02, resizeState.initialHeight + deltaY);
          item.width = newW;
          item.height = newH;
          if (item.type === 'text') {
            const scaleFactor = newW / resizeState.initialWidth;
            item.size = Math.max(8, Math.min(72, Math.round((resizeState.initialSize || 14) * scaleFactor)));
          }
        } else if (resizeState.handle === 'sw') {
          const newW = Math.max(0.02, resizeState.initialWidth - deltaX);
          const newH = Math.max(0.02, resizeState.initialHeight + deltaY);
          item.x = Math.max(0, resizeState.initialX + (resizeState.initialWidth - newW));
          item.width = newW;
          item.height = newH;
          if (item.type === 'text') {
            const scaleFactor = newW / resizeState.initialWidth;
            item.size = Math.max(8, Math.min(72, Math.round((resizeState.initialSize || 14) * scaleFactor)));
          }
        } else if (resizeState.handle === 'ne') {
          const newW = Math.max(0.02, resizeState.initialWidth + deltaX);
          const newH = Math.max(0.02, resizeState.initialHeight - deltaY);
          item.y = Math.max(0, resizeState.initialY + (resizeState.initialHeight - newH));
          item.width = newW;
          item.height = newH;
          if (item.type === 'text') {
            const scaleFactor = newW / resizeState.initialWidth;
            item.size = Math.max(8, Math.min(72, Math.round((resizeState.initialSize || 14) * scaleFactor)));
          }
        } else if (resizeState.handle === 'nw') {
          const newW = Math.max(0.02, resizeState.initialWidth - deltaX);
          const newH = Math.max(0.02, resizeState.initialHeight - deltaY);
          item.x = Math.max(0, resizeState.initialX + (resizeState.initialWidth - newW));
          item.y = Math.max(0, resizeState.initialY + (resizeState.initialHeight - newH));
          item.width = newW;
          item.height = newH;
          if (item.type === 'text') {
            const scaleFactor = newW / resizeState.initialWidth;
            item.size = Math.max(8, Math.min(72, Math.round((resizeState.initialSize || 14) * scaleFactor)));
          }
        }

        next[resizeState.index] = item;
        return next;
      });
      return;
    }

    // 2. Moving element in progress
    if (isMovingElement && selectedEditIndex !== null && editTool === 'move') {
      setPendingEdits(prev => {
        const newEdits = [...prev];
        newEdits[selectedEditIndex] = {
          ...newEdits[selectedEditIndex],
          x: Math.max(0, Math.min(0.95, currentX - dragOffset.x)),
          y: Math.max(0, Math.min(0.95, currentY - dragOffset.y))
        };
        return newEdits;
      });
      return;
    }

    // 3. Drawing box in progress
    if (isDrawing) {
      const x = Math.min(startPos.x, currentX);
      const y = Math.min(startPos.y, currentY);
      const w = Math.abs(currentX - startPos.x);
      const h = Math.abs(currentY - startPos.y);
      setCurrentDragRect({ x, y, w, h });
    }
  };

  const handleCanvasMouseUp = () => {
    if (isMovingElement) {
      setIsMovingElement(false);
    }
    if (resizeState) {
      setResizeState(null);
    }
  };

  const handleCanvasClick = (e: React.MouseEvent) => {
    if (!imageRef.current || editTool !== 'text') return;
    
    const rect = imageRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    setTextInputState({ visible: true, x, y, value: '' });
  };

  const confirmTextInput = () => {
    if (textInputState && textInputState.value.trim()) {
      const newIndex = pendingEdits.length;
      setPendingEdits(prev => [...prev, {
        type: 'text',
        text: textInputState.value,
        x: textInputState.x,
        y: textInputState.y,
        size: textSize,
        color: textColor
      }]);
      setSelectedEditIndex(newIndex);
    }
    setTextInputState(null);
    setEditTool('move');
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (evt.target?.result) {
          const img = new Image();
          img.onload = () => {
            const aspectRatio = img.height / img.width;
            const initialWidth = 0.35;
            const initialHeight = initialWidth * aspectRatio;

            setPendingEdits(prev => {
              const newIndex = prev.length;
              setSelectedEditIndex(newIndex);
              return [...prev, {
                type: 'image',
                imageData: evt.target!.result as string,
                x: 0.3, 
                y: 0.3,
                width: initialWidth,
                height: initialHeight
              }];
            });
            setEditTool('move');
          };
          img.src = evt.target.result as string;
        }
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    }
  };

  const undoLastEdit = () => {
    setPendingEdits(prev => prev.slice(0, -1));
    setSelectedEditIndex(null);
  };

  const handleDeleteSelectedElement = (index: number) => {
    setPendingEdits(prev => prev.filter((_, idx) => idx !== index));
    setSelectedEditIndex(null);
  };

  const handleAdjustTextSize = (index: number, delta: number) => {
    setPendingEdits(prev => {
      const next = [...prev];
      if (next[index] && next[index].type === 'text') {
        const curSize = next[index].size || 14;
        next[index] = {
          ...next[index],
          size: Math.max(8, Math.min(72, curSize + delta))
        };
      }
      return next;
    });
  };

  // Save changes non-destructively: keep base PDF clean, store editable pageEdits, update thumbnail
  const savePageEdits = async () => {
    if (editingPageIndex === null || !activePdfId) return;
    const currentPdf = pdfs.find(p => p.id === activePdfId);
    if (!currentPdf) return;

    setLoading(true);
    try {
      const basePdf = currentPdf.baseBlob || currentPdf.blob;
      const updatedPageEdits = {
        ...(currentPdf.pageEdits || {}),
        [editingPageIndex]: pendingEdits
      };

      // Generate rendered thumbnail of this page with edits for document view
      let newPageB64: string;
      if (pendingEdits.length > 0) {
        const pageWithEditsBlob = await pdfService.applyPageEdits(basePdf, editingPageIndex, pendingEdits);
        newPageB64 = await pdfService.renderPageToBase64(pageWithEditsBlob, editingPageIndex + 1);
      } else {
        newPageB64 = await pdfService.renderPageToBase64(basePdf, editingPageIndex + 1);
      }
      
      setEditorPages(prev => {
        const copy = [...prev];
        copy[editingPageIndex] = `data:image/png;base64,${newPageB64}`;
        return copy;
      });

      // Update in state & IndexedDB, preserving baseBlob & live pageEdits
      const updatedPdf: PDFDocumentData = {
        ...currentPdf,
        baseBlob: basePdf,
        pageEdits: updatedPageEdits,
        lastModified: Date.now()
      };

      await db.savePDF(updatedPdf);
      await refreshPdfs();
      
      closePageEditor();
    } catch (e) {
      console.error(e);
      alert(STRINGS.error[lang]);
    }
    setLoading(false);
  };

  const activePdf = pdfs.find(p => p.id === activePdfId);

  return (
    <div className={`min-h-screen bg-slate-50 text-slate-900 ${lang === 'ar' ? 'rtl' : 'ltr'}`} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      {/* Top Application Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3 rtl:space-x-reverse cursor-pointer" onClick={() => setViewMode(ViewMode.DASHBOARD)}>
            <div className="bg-blue-600 text-white p-2 rounded-xl shadow-xs">
              <FileText className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 leading-tight">{STRINGS.appTitle[lang]}</h1>
              <p className="text-xs text-slate-500 hidden sm:block">
                {lang === 'ar' ? 'أدوات متكاملة لإدارة وتعديل ملفات PDF مع عناصر حرة غير مدمرة' : 'Full-featured non-destructive PDF editor & AI intelligence'}
              </p>
            </div>
          </div>
          
          <div className="flex items-center space-x-3 rtl:space-x-reverse">
            {viewMode === ViewMode.EDITOR && (
              <button 
                onClick={() => setViewMode(ViewMode.DASHBOARD)} 
                className="flex items-center text-sm font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <ArrowLeft className={`h-4 w-4 ${lang === 'ar' ? 'rotate-180' : ''} mx-1`} />
                <span>{STRINGS.back[lang]}</span>
              </button>
            )}

            <button 
              onClick={() => setLang(lang === 'en' ? 'ar' : 'en')} 
              className="flex items-center space-x-1.5 rtl:space-x-reverse px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 text-sm font-medium transition-colors"
              title="Toggle Language"
            >
              <Globe className="h-4 w-4 text-blue-600" />
              <span>{lang === 'en' ? 'العربية' : 'English'}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center">
            <div className="bg-white p-6 rounded-2xl shadow-xl flex flex-col items-center">
              <LoadingSpinner />
              <p className="mt-3 text-sm font-medium text-slate-700">{STRINGS.processing[lang]}</p>
            </div>
          </div>
        )}

        {/* DASHBOARD VIEW */}
        {viewMode === ViewMode.DASHBOARD && (
          <div className="space-y-8">
            {/* Upload Area & Quick Starter */}
            <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-xs">
              <div className="relative border-2 border-dashed border-slate-300 rounded-xl p-8 text-center transition-all hover:border-blue-500 hover:bg-blue-50/40 group">
                <input 
                  type="file" 
                  multiple 
                  accept="application/pdf" 
                  onChange={handleUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-blue-100 text-blue-600 mb-3 group-hover:scale-105 transition-transform">
                  <Upload className="h-7 w-7" />
                </div>
                <h3 className="text-base font-semibold text-slate-800">{STRINGS.uploadTitle[lang]}</h3>
                <p className="mt-1 text-sm text-slate-500">{STRINGS.uploadDesc[lang]}</p>
              </div>

              {/* Quick load sample button */}
              <div className="mt-4 flex items-center justify-center">
                <button
                  onClick={handleLoadSample}
                  className="inline-flex items-center text-xs font-medium text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors"
                >
                  <Plus className="h-3.5 w-3.5 mx-1" />
                  {STRINGS.loadSample[lang]}
                </button>
              </div>
            </div>

            {/* Selection Actions Bar (Merge & Clear) */}
            {selectedPdfIds.length > 0 && (
              <div className="bg-white p-4 rounded-xl shadow-md border border-blue-200 flex items-center justify-between sticky top-20 z-30 animate-fade-in">
                <div className="flex items-center space-x-3 rtl:space-x-reverse">
                  <span className="text-sm font-semibold text-slate-800">
                    {selectedPdfIds.length} {STRINGS.selected[lang]}
                  </span>
                  <button 
                    onClick={() => setSelectedPdfIds([])} 
                    className="text-xs text-slate-500 hover:text-red-600 underline flex items-center"
                  >
                    <X className="h-3 w-3 mr-1 rtl:ml-1" /> {STRINGS.clearAll[lang]}
                  </button>
                </div>

                <button 
                  onClick={handleMerge}
                  disabled={selectedPdfIds.length < 2}
                  className="flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-xs"
                >
                  <Layers className="h-4 w-4 mx-1.5" />
                  {STRINGS.merge[lang]} ({selectedPdfIds.length})
                </button>
              </div>
            )}

            {/* Document Grid */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-slate-800">
                  {lang === 'ar' ? 'مستنداتك المحفوظة' : 'Your Documents'} ({pdfs.length})
                </h2>
              </div>

              {pdfs.length === 0 && !loading && (
                <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
                  <FileText className="h-12 w-12 mx-auto mb-3 opacity-40" />
                  <p className="text-sm font-medium">{STRINGS.noFiles[lang]}</p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {pdfs.map(pdf => {
                  const selectionIndex = selectedPdfIds.indexOf(pdf.id);
                  const isSelected = selectionIndex >= 0;
                  const editsMap = pdf.pageEdits || {};
                  const totalEditsCount = Object.keys(editsMap).reduce((acc, k) => acc + (editsMap[Number(k)]?.length || 0), 0);
                  
                  return (
                    <div 
                      key={pdf.id} 
                      className={`bg-white rounded-2xl shadow-xs hover:shadow-md transition-all border overflow-hidden flex flex-col ${isSelected ? 'border-blue-600 ring-2 ring-blue-500/20' : 'border-slate-200'}`}
                    >
                      <div 
                        className="aspect-[4/5] bg-slate-100 relative group cursor-pointer overflow-hidden" 
                        onClick={() => toggleSelection(pdf.id)}
                      >
                        {/* Selection Badge */}
                        <div className="absolute top-3 left-3 rtl:right-3 rtl:left-auto z-20 transition-transform duration-200 hover:scale-110">
                          {isSelected ? (
                            <div className="bg-blue-600 text-white h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold shadow-md ring-2 ring-white">
                              {selectionIndex + 1}
                            </div>
                          ) : (
                            <div className="bg-white/90 text-slate-400 h-7 w-7 rounded-full flex items-center justify-center shadow-xs backdrop-blur-xs border border-slate-300 hover:bg-white hover:text-blue-600">
                              <Circle className="h-4 w-4" />
                            </div>
                          )}
                        </div>

                        {/* Live Edits Badge */}
                        {totalEditsCount > 0 && (
                          <div className="absolute bottom-3 left-3 rtl:right-3 rtl:left-auto z-20 bg-blue-600/90 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full shadow-xs backdrop-blur-xs flex items-center">
                            <span>{totalEditsCount} {lang === 'ar' ? 'عنصر حر' : 'live items'}</span>
                          </div>
                        )}

                        {/* Page Preview */}
                        {pdf.previewUrl ? (
                          <img 
                            src={pdf.previewUrl} 
                            alt={pdf.name} 
                            className="w-full h-full object-contain p-3 group-hover:scale-102 transition-transform duration-200" 
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-300">
                            <FileText className="h-16 w-16" />
                          </div>
                        )}
                        
                        {/* Hover Overlay Actions */}
                        <div className="absolute inset-0 bg-slate-900/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center space-x-2 rtl:space-x-reverse pointer-events-none">
                          <button 
                            onClick={(e) => openEditor(pdf, e)} 
                            className="p-2.5 bg-white rounded-full hover:bg-blue-50 text-blue-600 pointer-events-auto transform hover:scale-110 transition-transform shadow-md" 
                            title={STRINGS.edit[lang]}
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button 
                            onClick={(e) => handleDownload(pdf, e)} 
                            className="p-2.5 bg-white rounded-full hover:bg-slate-100 text-slate-700 pointer-events-auto transform hover:scale-110 transition-transform shadow-md" 
                            title={STRINGS.exportPdf[lang]}
                          >
                            <Download className="h-4 w-4" />
                          </button>
                          <button 
                            onClick={(e) => handleDelete(pdf.id, e)} 
                            className="p-2.5 bg-white rounded-full hover:bg-red-50 text-red-600 pointer-events-auto transform hover:scale-110 transition-transform shadow-md" 
                            title={STRINGS.delete[lang]}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      {/* Card Footer Info */}
                      <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-white">
                        <div className="min-w-0 flex-1 pr-2 rtl:pr-0 rtl:pl-2">
                          <h4 className="text-sm font-semibold text-slate-800 truncate" title={pdf.name}>
                            {pdf.name}
                          </h4>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {pdf.pageCount} {STRINGS.pages[lang]}
                          </p>
                        </div>

                        <button 
                          onClick={(e) => openEditor(pdf, e)}
                          className="px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                        >
                          {STRINGS.edit[lang]}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* FULL DOCUMENT EDITOR VIEW */}
        {viewMode === ViewMode.EDITOR && activePdf && (
          <div className="space-y-6">
            {/* Editor Header Info & Action Strip */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                {/* Title and stats */}
                <div className="flex-1">
                  <div className="flex items-center space-x-2 rtl:space-x-reverse">
                    {editingDocTitle ? (
                      <div className="flex items-center space-x-2 rtl:space-x-reverse max-w-md w-full">
                        <input
                          type="text"
                          value={docTitleInput}
                          onChange={(e) => setDocTitleInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleSaveRename()}
                          className="px-3 py-1.5 text-sm border border-blue-500 rounded-lg outline-none w-full focus:ring-2 focus:ring-blue-500/20"
                          autoFocus
                        />
                        <button
                          onClick={handleSaveRename}
                          className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700"
                        >
                          {STRINGS.save[lang]}
                        </button>
                        <button
                          onClick={() => { setEditingDocTitle(false); setDocTitleInput(activePdf.name); }}
                          className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-600 hover:bg-slate-50"
                        >
                          {STRINGS.cancel[lang]}
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center space-x-2 rtl:space-x-reverse">
                        <h2 className="text-xl font-bold text-slate-900 truncate max-w-md" title={activePdf.name}>
                          {activePdf.name}
                        </h2>
                        <button 
                          onClick={() => setEditingDocTitle(true)}
                          className="p-1 text-slate-400 hover:text-blue-600 transition-colors"
                          title={STRINGS.rename[lang]}
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {activePdf.pageCount} {STRINGS.pages[lang]} • {STRINGS.liveNotice[lang]}
                  </p>
                </div>

                {/* Header Action Buttons */}
                <div className="flex items-center space-x-2 rtl:space-x-reverse flex-wrap gap-y-2">
                  <button
                    onClick={(e) => handleDownload(activePdf, e)}
                    className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-semibold hover:bg-blue-700 transition-colors shadow-sm"
                    title={STRINGS.exportPdf[lang]}
                  >
                    <Download className="h-4 w-4 mx-1" />
                    {STRINGS.exportPdf[lang]}
                  </button>
                </div>
              </div>

              {/* Tools Strip: Split Document & AI Tools */}
              <div className="mt-6 pt-6 border-t border-slate-100 grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* AI Tools Bar */}
                <div className="bg-blue-50/70 border border-blue-100 rounded-xl p-4">
                  <div className="flex items-center space-x-2 rtl:space-x-reverse mb-3 text-blue-900 font-semibold text-xs uppercase tracking-wider">
                    <Sparkles className="h-4 w-4 text-blue-600" />
                    <span>{STRINGS.aiTools[lang]}</span>
                  </div>
                  <div className="flex items-center flex-wrap gap-2">
                    <button
                      onClick={handleAISummarize}
                      disabled={processingAI}
                      className="px-3 py-1.5 bg-white border border-blue-200 text-blue-700 hover:bg-blue-600 hover:text-white rounded-lg text-xs font-medium transition-colors shadow-2xs disabled:opacity-50"
                    >
                      {STRINGS.summary[lang]}
                    </button>
                    <button
                      onClick={handleAITitle}
                      disabled={processingAI}
                      className="px-3 py-1.5 bg-white border border-blue-200 text-blue-700 hover:bg-blue-600 hover:text-white rounded-lg text-xs font-medium transition-colors shadow-2xs disabled:opacity-50"
                    >
                      {STRINGS.suggestTitle[lang]}
                    </button>
                    <button
                      onClick={handleAIOCR}
                      disabled={processingAI}
                      className="px-3 py-1.5 bg-white border border-blue-200 text-blue-700 hover:bg-blue-600 hover:text-white rounded-lg text-xs font-medium transition-colors shadow-2xs disabled:opacity-50"
                    >
                      {STRINGS.ocr[lang]}
                    </button>
                    {processingAI && (
                      <span className="text-xs text-blue-600 flex items-center ml-2 rtl:ml-0 rtl:mr-2">
                        <LoadingSpinner />
                        <span className="mx-1">{STRINGS.processing[lang]}</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Split Document Box */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                  <div className="flex items-center space-x-2 rtl:space-x-reverse mb-3 text-slate-800 font-semibold text-xs uppercase tracking-wider">
                    <Split className="h-4 w-4 text-slate-600" />
                    <span>{STRINGS.splitPages[lang]}</span>
                  </div>
                  <div className="flex items-center space-x-2 rtl:space-x-reverse">
                    <input
                      type="text"
                      placeholder={STRINGS.splitInstruction[lang]}
                      value={splitRange}
                      onChange={(e) => setSplitRange(e.target.value)}
                      className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                    <button
                      onClick={handleSplit}
                      disabled={!splitRange.trim()}
                      className="px-4 py-1.5 bg-slate-800 text-white rounded-lg text-xs font-medium hover:bg-slate-900 disabled:opacity-40 transition-colors"
                    >
                      {STRINGS.split[lang]}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* AI Result Card */}
            {aiResult && (
              <div className="bg-white rounded-2xl border border-blue-200 p-6 shadow-sm animate-fade-in relative">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center space-x-2 rtl:space-x-reverse">
                    <Sparkles className="h-5 w-5 text-blue-600" />
                    <h3 className="text-sm font-bold text-slate-900">{STRINGS.aiInsights[lang]}</h3>
                  </div>
                  <div className="flex items-center space-x-2 rtl:space-x-reverse">
                    <button
                      onClick={handleAITranslate}
                      className="px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                    >
                      {STRINGS.translate[lang]}
                    </button>
                    <button
                      onClick={() => setAiResult(null)}
                      className="p-1 text-slate-400 hover:text-slate-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="mt-4 space-y-4">
                  {aiResult.suggestedTitle && (
                    <div className="p-3 bg-blue-50/50 rounded-xl border border-blue-100 flex items-center justify-between">
                      <div>
                        <span className="text-xs font-medium text-blue-600 block">{STRINGS.suggestTitle[lang]}:</span>
                        <span className="text-sm font-semibold text-slate-800">{aiResult.suggestedTitle}</span>
                      </div>
                      <div className="flex items-center space-x-2 rtl:space-x-reverse">
                        <button
                          onClick={applySuggestedTitle}
                          className="px-3 py-1 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors"
                        >
                          {STRINGS.applyTitle[lang]}
                        </button>
                        <button
                          onClick={() => copyToClipboard(aiResult.suggestedTitle || '', 'title')}
                          className="p-1.5 text-slate-500 hover:text-slate-800 rounded-md"
                          title={STRINGS.copy[lang]}
                        >
                          {copiedField === 'title' ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                  )}

                  {aiResult.summary && (
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-slate-600">{STRINGS.summary[lang]}</span>
                        <button
                          onClick={() => copyToClipboard(aiResult.summary || '', 'summary')}
                          className="flex items-center text-xs text-blue-600 hover:text-blue-800"
                        >
                          {copiedField === 'summary' ? (
                            <>
                              <Check className="h-3.5 w-3.5 mx-1 text-green-600" />
                              <span>{STRINGS.copied[lang]}</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5 mx-1" />
                              <span>{STRINGS.copy[lang]}</span>
                            </>
                          )}
                        </button>
                      </div>
                      <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{aiResult.summary}</p>
                    </div>
                  )}

                  {aiResult.translatedText && (
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-slate-600">{STRINGS.ocr[lang]}</span>
                        <button
                          onClick={() => copyToClipboard(aiResult.translatedText || '', 'ocr')}
                          className="flex items-center text-xs text-blue-600 hover:text-blue-800"
                        >
                          {copiedField === 'ocr' ? (
                            <>
                              <Check className="h-3.5 w-3.5 mx-1 text-green-600" />
                              <span>{STRINGS.copied[lang]}</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5 mx-1" />
                              <span>{STRINGS.copy[lang]}</span>
                            </>
                          )}
                        </button>
                      </div>
                      <p className="text-sm font-mono text-slate-700 max-h-60 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                        {aiResult.translatedText}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Document Pages Grid */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-800">
                  {STRINGS.documentPages[lang]} ({editorPages.length})
                </h3>
                <span className="text-xs text-slate-500">
                  {STRINGS.clickToEdit[lang]}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {editorPages.map((pageSrc, idx) => {
                  const pageEditsCount = (activePdf.pageEdits?.[idx] || []).length;
                  return (
                    <div 
                      key={idx} 
                      className="bg-white rounded-2xl border border-slate-200 shadow-xs hover:shadow-md transition-all overflow-hidden flex flex-col group"
                    >
                      {/* Header with page number */}
                      <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-xs text-slate-600 font-medium">
                        <div className="flex items-center space-x-1.5 rtl:space-x-reverse">
                          <span>{STRINGS.page[lang]} {idx + 1}</span>
                          {pageEditsCount > 0 && (
                            <span className="bg-blue-100 text-blue-700 text-[10px] px-1.5 py-0.2 rounded-full font-semibold">
                              {pageEditsCount}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center space-x-1 rtl:space-x-reverse">
                          {/* Move Left */}
                          <button
                            onClick={(e) => handleMovePage(idx, 'left', e)}
                            disabled={idx === 0}
                            className="p-1 hover:bg-slate-200 rounded disabled:opacity-20 text-slate-500 hover:text-slate-900"
                            title={STRINGS.moveUp[lang]}
                          >
                            <ArrowLeft className={`h-3.5 w-3.5 ${lang === 'ar' ? 'rotate-180' : ''}`} />
                          </button>
                          {/* Move Right */}
                          <button
                            onClick={(e) => handleMovePage(idx, 'right', e)}
                            disabled={idx === editorPages.length - 1}
                            className="p-1 hover:bg-slate-200 rounded disabled:opacity-20 text-slate-500 hover:text-slate-900"
                            title={STRINGS.moveDown[lang]}
                          >
                            <ArrowRight className={`h-3.5 w-3.5 ${lang === 'ar' ? 'rotate-180' : ''}`} />
                          </button>
                          {/* Rotate 90 deg */}
                          <button
                            onClick={(e) => handleRotatePage(idx, e)}
                            className="p-1 hover:bg-slate-200 rounded text-slate-500 hover:text-blue-600"
                            title={STRINGS.rotate[lang]}
                          >
                            <RotateCw className="h-3.5 w-3.5" />
                          </button>
                          {/* Remove page */}
                          <button
                            onClick={(e) => handleRemovePage(idx, e)}
                            className="p-1 hover:bg-red-50 rounded text-slate-500 hover:text-red-600"
                            title={STRINGS.removePage[lang]}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Page Canvas Image */}
                      <div 
                        className="aspect-[3/4] bg-slate-100 relative cursor-pointer overflow-hidden flex items-center justify-center p-2"
                        onClick={() => handlePageClick(idx)}
                      >
                        <img 
                          src={pageSrc} 
                          alt={`Page ${idx + 1}`} 
                          className="w-full h-full object-contain shadow-2xs group-hover:scale-102 transition-transform duration-200" 
                        />
                        
                        <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                          <span className="px-3 py-1.5 bg-white text-slate-900 font-semibold rounded-lg text-xs shadow-md flex items-center space-x-1.5 rtl:space-x-reverse pointer-events-auto">
                            <Edit2 className="h-3.5 w-3.5 text-blue-600" />
                            <span>{STRINGS.edit[lang]}</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ADVANCED SINGLE PAGE CANVAS EDITOR MODAL WITH LIVE MOVABLE & RESIZABLE ELEMENTS */}
        {editingPageIndex !== null && (cleanPageUrl || editorPages[editingPageIndex]) && (
          <div className="fixed inset-0 z-50 bg-slate-950/95 flex flex-col animate-fade-in select-none">
            {/* Modal Top Header */}
            <div className="h-16 bg-slate-900 flex items-center justify-between px-6 border-b border-slate-800">
              <div className="text-white font-medium flex items-center">
                <span className="text-sm font-bold text-white mr-3 rtl:mr-0 rtl:ml-3">
                  {STRINGS.pageEditorTitle[lang]} - {STRINGS.page[lang]} {editingPageIndex + 1}
                </span>
                <span className="text-blue-400 text-xs hidden lg:inline border-l border-slate-700 pl-3 rtl:border-l-0 rtl:border-r rtl:pl-0 rtl:pr-3">
                  {STRINGS.liveNotice[lang]}
                </span>
              </div>

              <div className="flex items-center space-x-3 rtl:space-x-reverse">
                <button 
                  onClick={handleUnlockPageElements}
                  disabled={isUnlockingElements}
                  className="px-3 py-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white rounded-xl text-xs font-semibold flex items-center shadow-md shadow-amber-500/20 transition-all disabled:opacity-50"
                  title={STRINGS.unlockPageElements[lang]}
                >
                  <Sparkles className={`h-4 w-4 mx-1.5 ${isUnlockingElements ? 'animate-spin' : 'animate-pulse text-yellow-200'}`} />
                  <span>{isUnlockingElements ? STRINGS.unlocking[lang] : STRINGS.unlockPageElements[lang]}</span>
                </button>

                <div className="h-6 w-px bg-slate-800"></div>

                <button 
                  onClick={undoLastEdit}
                  disabled={pendingEdits.length === 0}
                  className="px-3 py-2 text-slate-400 hover:text-white disabled:opacity-30 disabled:hover:text-slate-400 transition-colors flex items-center text-xs"
                  title={STRINGS.undo[lang]}
                >
                  <Undo className="h-4 w-4 mx-1" />
                  <span className="hidden sm:inline">{STRINGS.undo[lang]}</span>
                </button>

                <div className="h-6 w-px bg-slate-800"></div>

                <button 
                  onClick={savePageEdits} 
                  className="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 text-xs font-semibold flex items-center shadow-lg shadow-blue-500/20 transition-colors"
                >
                  <Save className="h-4 w-4 mx-1.5" />
                  {STRINGS.saveChanges[lang]}
                </button>

                <button 
                  onClick={closePageEditor} 
                  className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Modal Interactive Tools Palette */}
            <div className="h-16 bg-slate-900/90 border-b border-slate-800 flex items-center justify-center px-4 space-x-2 rtl:space-x-reverse overflow-x-auto">
              <button 
                onClick={() => { setEditTool('move'); }}
                className={`flex items-center px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${editTool === 'move' ? 'bg-white text-slate-900 shadow-md' : 'text-slate-300 hover:bg-slate-800'}`}
              >
                <MousePointer2 className="h-3.5 w-3.5 mx-1" />
                {STRINGS.moveTool[lang]}
              </button>

              <div className="w-px h-6 bg-slate-800 mx-1"></div>

              <button 
                onClick={() => { setEditTool('text'); setSelectedEditIndex(null); }}
                className={`flex items-center px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${editTool === 'text' ? 'bg-white text-slate-900 shadow-md' : 'text-slate-300 hover:bg-slate-800'}`}
              >
                <Type className="h-3.5 w-3.5 mx-1" />
                {STRINGS.textTool[lang]}
              </button>

              <button 
                onClick={() => { setEditTool('highlight'); setSelectedEditIndex(null); }}
                className={`flex items-center px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${editTool === 'highlight' ? 'bg-white text-slate-900 shadow-md' : 'text-slate-300 hover:bg-slate-800'}`}
              >
                <Highlighter className="h-3.5 w-3.5 mx-1" />
                {STRINGS.highlight[lang]}
              </button>

              <button 
                onClick={() => { setEditTool('eraser'); setSelectedEditIndex(null); }}
                className={`flex items-center px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${editTool === 'eraser' ? 'bg-white text-slate-900 shadow-md' : 'text-slate-300 hover:bg-slate-800'}`}
              >
                <Eraser className="h-3.5 w-3.5 mx-1" />
                {STRINGS.eraser[lang]}
              </button>

              <div className="w-px h-6 bg-slate-800 mx-1"></div>

              <button 
                onClick={() => imageInputRef.current?.click()}
                className="flex items-center px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-800 transition-all"
              >
                <ImageIcon className="h-3.5 w-3.5 mx-1" />
                {STRINGS.imageTool[lang]}
              </button>

              <input 
                type="file" 
                accept="image/png, image/jpeg" 
                ref={imageInputRef} 
                className="hidden" 
                onChange={handleImageUpload} 
              />

              {editTool === 'text' && (
                <div className="flex items-center space-x-2 rtl:space-x-reverse ml-4 rtl:ml-0 rtl:mr-4 bg-slate-800 px-3 py-1 rounded-lg">
                  <span className="text-xs text-slate-400">{STRINGS.color[lang]}:</span>
                  <input
                    type="color"
                    value={textColor}
                    onChange={(e) => setTextColor(e.target.value)}
                    className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent"
                  />
                  <span className="text-xs text-slate-400 ml-2 rtl:ml-0 rtl:mr-2">Size:</span>
                  <select
                    value={textSize}
                    onChange={(e) => setTextSize(Number(e.target.value))}
                    className="bg-slate-700 text-white text-xs rounded px-1 py-0.5 outline-none"
                  >
                    <option value={10}>10px</option>
                    <option value={12}>12px</option>
                    <option value={14}>14px</option>
                    <option value={18}>18px</option>
                    <option value={24}>24px</option>
                    <option value={32}>32px</option>
                    <option value={48}>48px</option>
                  </select>
                </div>
              )}
            </div>

            {/* Elements Unlocked Notification Banner */}
            {unlockNotification && (
              <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2.5 text-center text-xs font-medium text-amber-200 flex items-center justify-center gap-2 shrink-0">
                <Sparkles className="h-4 w-4 text-amber-400 shrink-0" />
                <span>{unlockNotification}</span>
                <button 
                  onClick={() => setUnlockNotification(null)} 
                  className="ml-2 rtl:ml-0 rtl:mr-2 text-amber-400 hover:text-white p-0.5 rounded"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Modal Canvas Area */}
            <div className="flex-1 overflow-auto p-8 flex items-start justify-center bg-slate-950">
              <div 
                className={`relative shadow-2xl transition-cursor select-none ${editTool === 'move' ? 'cursor-default' : 'cursor-crosshair'}`}
                style={{ maxWidth: '900px', width: '100%' }}
                onClick={handleCanvasClick}
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
              >
                <img 
                  ref={imageRef}
                  src={cleanPageUrl || editorPages[editingPageIndex]} 
                  alt="Editing Page Canvas" 
                  className="block w-full h-auto select-none rounded shadow-md pointer-events-none"
                  draggable={false}
                />

                {/* Render Live Movable & Resizable Element Overlays */}
                {pendingEdits.map((edit, idx) => {
                  const isSelected = idx === selectedEditIndex;
                  const isEditingThisText = idx === editingTextIndex && edit.type === 'text';

                  return (
                    <div 
                      key={idx}
                      title={edit.type === 'text' && !isEditingThisText ? STRINGS.doubleClickToEdit[lang] : undefined}
                      onDoubleClick={(e) => {
                        if (edit.type === 'text') {
                          e.stopPropagation();
                          startEditingText(idx);
                        }
                      }}
                      onMouseDown={(e) => {
                        if (isEditingThisText) return;
                        e.stopPropagation();
                        setSelectedEditIndex(idx);
                        setEditTool('move');
                        setIsMovingElement(true);
                        if (imageRef.current) {
                          const rect = imageRef.current.getBoundingClientRect();
                          const curX = (e.clientX - rect.left) / rect.width;
                          const curY = (e.clientY - rect.top) / rect.height;
                          setDragOffset({ x: curX - edit.x, y: curY - edit.y });
                        }
                      }}
                      className={`absolute select-none transition-shadow ${editTool === 'move' && !isEditingThisText ? 'cursor-move' : ''}`}
                      style={{
                        left: `${edit.x * 100}%`,
                        top: `${edit.y * 100}%`,
                        width: isEditingThisText ? 'max-content' : (edit.width ? `${edit.width * 100}%` : 'auto'),
                        height: isEditingThisText ? 'auto' : (edit.height ? `${edit.height * 100}%` : 'auto'),
                        maxWidth: isEditingThisText ? '95vw' : 'none',
                        backgroundColor: edit.type === 'redact' ? 'white' : edit.type === 'highlight' ? 'rgba(255, 255, 0, 0.4)' : 'transparent',
                        color: edit.color || '#000000',
                        fontSize: `${edit.size || 14}px`,
                        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", "Noto Sans Arabic", Tahoma, Arial, sans-serif',
                        whiteSpace: 'nowrap',
                        transform: edit.type === 'text' ? 'translateY(-80%)' : 'none',
                        border: isSelected && !isEditingThisText 
                          ? '2px dashed #2563eb' 
                          : edit.isNativeUnlocked && edit.type === 'text' 
                            ? '1px dashed rgba(59, 130, 246, 0.45)' 
                            : '1px dashed transparent',
                        zIndex: isSelected || isEditingThisText ? 35 : edit.type === 'redact' ? 10 : 15
                      }}
                    >
                      {edit.type === 'text' && (
                        isEditingThisText ? (
                          <div 
                            className="inline-flex items-center gap-1.5 bg-white/98 backdrop-blur-md p-1.5 rounded-xl shadow-2xl border-2 border-blue-600 z-50 pointer-events-auto max-w-[92vw]"
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            <div className="relative inline-grid items-center min-w-[70px] max-w-[min(65vw,700px)]">
                              {/* Invisible mirror span measuring exact width of text + comfortable margin */}
                              <span 
                                className="invisible col-start-1 row-start-1 px-2.5 py-1 font-medium whitespace-pre border border-transparent select-none pointer-events-none"
                                style={{
                                  fontSize: `${Math.max(12, edit.size || 14)}px`,
                                  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", "Noto Sans Arabic", Tahoma, Arial, sans-serif'
                                }}
                                aria-hidden="true"
                              >
                                {(editingTextValue || STRINGS.enterText[lang] || ' ') + '  '}
                              </span>

                              <input
                                type="text"
                                autoFocus
                                value={editingTextValue}
                                onChange={(e) => setEditingTextValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') saveEditingText();
                                  if (e.key === 'Escape') cancelEditingText();
                                }}
                                className="col-start-1 row-start-1 w-full bg-white px-2.5 py-1 rounded-lg border border-slate-300 outline-none focus:border-blue-500 font-medium text-slate-900 shadow-xs"
                                style={{
                                  fontSize: `${Math.max(12, edit.size || 14)}px`,
                                  color: edit.color || '#000000',
                                  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", "Noto Sans Arabic", Tahoma, Arial, sans-serif'
                                }}
                                placeholder={STRINGS.enterText[lang]}
                              />
                            </div>
                            <button
                              onClick={saveEditingText}
                              className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shadow-xs flex items-center gap-1 text-xs font-semibold shrink-0 cursor-pointer"
                              title={STRINGS.updateText[lang]}
                            >
                              <Check className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline whitespace-nowrap">{STRINGS.updateText[lang]}</span>
                            </button>
                            <button
                              onClick={cancelEditingText}
                              className="p-1.5 bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-800 rounded-lg transition-colors shrink-0 cursor-pointer"
                              title={STRINGS.cancel[lang]}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          edit.text
                        )
                      )}

                      {edit.type === 'image' && edit.imageData && (
                        <img src={edit.imageData} className="w-full h-full object-contain pointer-events-none" alt="inserted" />
                      )}

                      {/* Interactive Selection & Resize Handles */}
                      {isSelected && !isEditingThisText && (
                        <>
                          {/* Top-Left Resize Handle */}
                          <div
                            onMouseDown={(e) => handleResizeHandleMouseDown(e, idx, 'nw')}
                            className="absolute -top-2 -left-2 w-3.5 h-3.5 bg-white border-2 border-blue-600 rounded-xs cursor-nwse-resize z-40 shadow-xs hover:scale-125 transition-transform"
                            title={STRINGS.resize[lang]}
                          />
                          {/* Top-Right Resize Handle */}
                          <div
                            onMouseDown={(e) => handleResizeHandleMouseDown(e, idx, 'ne')}
                            className="absolute -top-2 -right-2 w-3.5 h-3.5 bg-white border-2 border-blue-600 rounded-xs cursor-nesw-resize z-40 shadow-xs hover:scale-125 transition-transform"
                            title={STRINGS.resize[lang]}
                          />
                          {/* Bottom-Left Resize Handle */}
                          <div
                            onMouseDown={(e) => handleResizeHandleMouseDown(e, idx, 'sw')}
                            className="absolute -bottom-2 -left-2 w-3.5 h-3.5 bg-white border-2 border-blue-600 rounded-xs cursor-nesw-resize z-40 shadow-xs hover:scale-125 transition-transform"
                            title={STRINGS.resize[lang]}
                          />
                          {/* Bottom-Right Resize Handle */}
                          <div
                            onMouseDown={(e) => handleResizeHandleMouseDown(e, idx, 'se')}
                            className="absolute -bottom-2 -right-2 w-3.5 h-3.5 bg-white border-2 border-blue-600 rounded-xs cursor-nwse-resize z-40 shadow-xs hover:scale-125 transition-transform"
                            title={STRINGS.resize[lang]}
                          />

                          {/* Floating Element Action Bar */}
                          <div 
                            className="absolute -top-10 left-1/2 -translate-x-1/2 flex items-center space-x-1 rtl:space-x-reverse bg-slate-900/95 backdrop-blur-xs text-white px-2.5 py-1 rounded-lg shadow-xl text-[11px] pointer-events-auto z-50 whitespace-nowrap border border-slate-700"
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            {edit.isNativeUnlocked && (
                              <span className="text-[9px] px-1.5 py-0.5 bg-amber-500/30 text-amber-300 font-semibold rounded mr-1 rtl:mr-0 rtl:ml-1 flex items-center gap-0.5">
                                <Sparkles className="h-2.5 w-2.5" />
                                {STRINGS.unlockedBadge[lang]}
                              </span>
                            )}

                            {edit.type === 'redact' && (
                              <span className="text-[10px] text-slate-300 font-medium px-1">
                                {STRINGS.eraser[lang]}
                              </span>
                            )}

                            {edit.type === 'text' && (
                              <>
                                <button
                                  onClick={() => startEditingText(idx)}
                                  className="px-1.5 py-0.5 text-blue-400 hover:text-blue-300 hover:bg-slate-800 rounded transition-colors flex items-center font-medium"
                                  title={STRINGS.editText[lang]}
                                >
                                  <Edit2 className="h-3 w-3 mr-1 rtl:ml-1" />
                                  <span>{STRINGS.editText[lang]}</span>
                                </button>

                                <div className="w-px h-3.5 bg-slate-700 mx-1" />

                                <input 
                                  type="color" 
                                  value={edit.color || '#000000'}
                                  onChange={(e) => {
                                    const newColor = e.target.value;
                                    setPendingEdits(prev => {
                                      const next = [...prev];
                                      if (next[idx]) next[idx] = { ...next[idx], color: newColor };
                                      return next;
                                    });
                                  }}
                                  className="w-4 h-4 rounded cursor-pointer border-0 bg-transparent"
                                  title={STRINGS.color[lang]}
                                />

                                <button
                                  onClick={() => handleAdjustTextSize(idx, -2)}
                                  className="px-1.5 py-0.5 hover:bg-slate-700 rounded font-bold text-slate-300 hover:text-white"
                                  title="Decrease size"
                                >
                                  A-
                                </button>
                                <span className="text-[10px] text-slate-300 font-mono px-0.5">{edit.size || 14}px</span>
                                <button
                                  onClick={() => handleAdjustTextSize(idx, 2)}
                                  className="px-1.5 py-0.5 hover:bg-slate-700 rounded font-bold text-slate-300 hover:text-white"
                                  title="Increase size"
                                >
                                  A+
                                </button>
                                <div className="w-px h-3.5 bg-slate-700 mx-1" />
                              </>
                            )}

                            <button
                              onClick={() => handleDeleteSelectedElement(idx)}
                              className="p-1 text-red-400 hover:text-red-300 hover:bg-red-950/50 rounded transition-colors flex items-center"
                              title={STRINGS.deleteElement[lang]}
                            >
                              <Trash2 className="h-3 w-3 mr-0.5 rtl:ml-0.5" />
                              <span className="text-[10px]">{STRINGS.deleteElement[lang]}</span>
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}

                {/* Drawing Feedback Overlay */}
                {currentDragRect && (
                  <div 
                    className="absolute pointer-events-none border border-blue-400"
                    style={{
                      left: `${currentDragRect.x * 100}%`,
                      top: `${currentDragRect.y * 100}%`,
                      width: `${currentDragRect.w * 100}%`,
                      height: `${currentDragRect.h * 100}%`,
                      backgroundColor: editTool === 'highlight' ? 'rgba(255, 255, 0, 0.4)' : 'rgba(255, 255, 255, 0.8)',
                    }}
                  />
                )}

                {/* Text Input Floating Popup */}
                {textInputState && (
                  <div 
                    className="absolute bg-white p-3 rounded-xl shadow-2xl border border-slate-300 flex flex-col gap-2 min-w-[220px] z-50 animate-fade-in"
                    style={{
                      left: `${Math.min(textInputState.x * 100, 75)}%`,
                      top: `${Math.min(textInputState.y * 100, 85)}%`,
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input 
                      autoFocus
                      type="text" 
                      placeholder={STRINGS.enterText[lang]}
                      value={textInputState.value}
                      onChange={(e) => setTextInputState(prev => ({ ...prev!, value: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && confirmTextInput()}
                      className="w-full border-b border-slate-300 focus:border-blue-600 outline-none px-1 py-1 text-sm text-slate-900"
                    />
                    <div className="flex justify-end space-x-2 rtl:space-x-reverse pt-1">
                      <button 
                        onClick={() => setTextInputState(null)} 
                        className="text-xs text-slate-500 hover:text-slate-800 px-2 py-1 rounded"
                      >
                        {STRINGS.cancel[lang]}
                      </button>
                      <button 
                        onClick={confirmTextInput} 
                        className="text-xs bg-blue-600 text-white px-3 py-1 rounded-lg hover:bg-blue-700 font-medium"
                      >
                        {STRINGS.add[lang]}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
