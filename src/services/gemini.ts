import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

import { VOCAB_PROMPT_TEMPLATE } from "./prompts";

export interface VocabularyItem {
  word: string;
  reading: string;
  meaning: string;
  example: string;
  distractors: string[];
}

export async function generateWeeklyVocabulary(previousMistakes: string[] = []): Promise<VocabularyItem[]> {
  const mistakesList = previousMistakes.slice(0, 50);
  const newCount = Math.max(0, 50 - mistakesList.length);
  
  const prompt = VOCAB_PROMPT_TEMPLATE
    .replace('{mistakesCount}', mistakesList.length.toString())
    .replace('{mistakesList}', mistakesList.join(', '))
    .replace('{newCount}', newCount.toString());

  try {
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

    const text = response.text;
    if (!text) throw new Error("AI returned empty response");
    return JSON.parse(text);
  } catch (e) {
    console.error("Failed to generate vocabulary via AI", e);
    return [];
  }
}
