export interface PDFDocumentData {
  id: string;
  name: string;
  blob: Blob;
  baseBlob?: Blob; // Original/base unburned PDF blob
  pageEdits?: Record<number, PageEditOperation[]>; // Persisted editable live elements per page
  previewUrl?: string; // Data URL for thumbnail
  pageCount: number;
  lastModified: number;
}

export type Language = 'en' | 'ar';

export interface Translations {
  [key: string]: {
    en: string;
    ar: string;
  };
}

export interface AIAnalysisResult {
  summary?: string;
  suggestedTitle?: string;
  translatedText?: string;
}

export enum ViewMode {
  DASHBOARD = 'DASHBOARD',
  EDITOR = 'EDITOR',
}

export type EditTool = 'none' | 'text' | 'eraser' | 'highlight' | 'image' | 'move';

export interface PageEditOperation {
  type: 'text' | 'image' | 'redact' | 'highlight';
  x: number; // Percentage 0-1
  y: number; // Percentage 0-1
  width?: number; // Percentage 0-1 (for redact/highlight/image)
  height?: number; // Percentage 0-1 (for redact/highlight/image)
  text?: string;
  imageData?: string; // Base64 data url for images
  color?: string;
  size?: number;
  originalCoverId?: string;
  isNativeUnlocked?: boolean;
}