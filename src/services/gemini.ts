import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface VocabularyItem {
  word: string;
  reading: string;
  meaning: string;
  example: string;
  distractors: string[];
  contextSentence?: string; 
}

export const VOCAB_PROMPT_TEMPLATE = `
Generate a list of Japanese N5 vocabulary.
Total: 50 words.

PRIORITY: Include {mistakesCount} error words: {mistakesList}.
FILL: Add {newCount} new N5 words to reach 50.

N5 EXAM STYLE REQUIREMENTS:
- SELECT exactly 10 words to provide a "contextSentence".
- NO BLANKS: Do NOT use "____". Provide a complete sentence. The question will ask which word fits.
- EXAMPLE for "銀行": "お金を　出したり　入れたり　したいです。どこに　行きますか。"

CORE PROPERTIES:
1. word: The Kanji/Kana.
2. reading: Hiragana only.
3. meaning: Traditional Chinese meaning.
4. example: Simple N5 sentence.
5. distractors: 3 Hiragana-only distractors (similar sound/visual).
6. contextSentence: string (ONLY for the 10 exam-style words, otherwise empty).

Ensure all Japanese is N5 level.
`;

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
              contextSentence: { type: Type.STRING },
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
