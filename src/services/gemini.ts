import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface VocabularyItem {
  word: string;
  reading: string;
  meaning: string;
  example: string;
  distractors: string[];
}

export async function generateWeeklyVocabulary(previousMistakes: string[] = []): Promise<VocabularyItem[]> {
  const newCount = 50 - previousMistakes.length;
  
  const prompt = `
    Generate a list of Japanese N5 level vocabulary.
    Total words needed: 50.
    New words: ${newCount}.
    Review words (based on these mistakes): ${previousMistakes.join(', ')}.
    
    For each word, provide:
    1. The word (Kanji/Kana)
    2. Reading (Hiragana)
    3. Meaning (Traditional Chinese)
    4. A simple example sentence (Japanese with reading in brackets and Chinese translation)
    5. 3 distractors (incorrect meanings in Traditional Chinese) for a multiple-choice quiz.
    
    Ensure all words are strictly within the N5 JLPT range.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            word: { type: Type.STRING },
            reading: { type: Type.STRING },
            meaning: { type: Type.STRING },
            example: { type: Type.STRING },
            distractors: { 
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
          },
          required: ["word", "reading", "meaning", "example", "distractors"],
        },
      },
    },
  });

  try {
    return JSON.parse(response.text);
  } catch (e) {
    console.error("Failed to parse Gemini response", e);
    return [];
  }
}
