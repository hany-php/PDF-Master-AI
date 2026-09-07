import { GoogleGenAI } from "@google/genai";

const getAIClient = (): GoogleGenAI => {
  const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY || '';
  return new GoogleGenAI({ apiKey });
};

// Use Gemini 3.8 Flash for text and multimodal tasks
const DEFAULT_MODEL = 'gemini-3.8-flash';

export const summarizeText = async (text: string): Promise<string> => {
  if (!text || text.trim().length === 0) return "No text to summarize.";
  
  try {
    const ai = getAIClient();
    const response = await ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: `Please summarize the following document content in a clear, well-structured overview:\n\n${text.substring(0, 30000)}`,
    });
    return response.text || "Could not generate summary.";
  } catch (error) {
    console.error("Gemini Summarize Error:", error);
    return "Error generating summary. Please check your Gemini API key.";
  }
};

export const suggestTitle = async (text: string): Promise<string> => {
  if (!text || text.trim().length === 0) return "Untitled PDF";
  
  try {
    const ai = getAIClient();
    const response = await ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: `Based on the following text from the first page of a document, suggest a short, concise, professional title (maximum 5 words):\n\n${text.substring(0, 5000)}`,
    });
    return response.text?.replace(/['"]+/g, '').trim() || "Untitled Document";
  } catch (error) {
    console.error("Gemini Title Error:", error);
    return "Untitled Document";
  }
};

export const translateText = async (text: string, targetLang: 'en' | 'ar'): Promise<string> => {
  if (!text || text.trim().length === 0) return "";
  const target = targetLang === 'ar' ? 'Arabic' : 'English';
  
  try {
    const ai = getAIClient();
    const response = await ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: `Translate the following text to ${target}. Maintain clear formatting and professional tone:\n\n${text}`,
    });
    return response.text || "Translation failed.";
  } catch (error) {
    console.error("Gemini Translate Error:", error);
    return "Translation failed.";
  }
};

export const performOCR = async (base64Image: string): Promise<string> => {
  try {
    const ai = getAIClient();
    const response = await ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/png', data: base64Image } },
          { text: "Extract all visible text from this page image accurately, preserving paragraph layout and structure." }
        ]
      }
    });
    return response.text || "No text found in page.";
  } catch (error) {
    console.error("Gemini OCR Error:", error);
    return "OCR processing failed. Please check your API key.";
  }
};
