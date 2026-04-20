import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface VocabularyItem {
  word: string;
  reading: string;
  meaning: string;
  example: string;
  distractors: string[];
  isExamStyle?: boolean;
  examQuestionText?: string; 
}

export const VOCAB_PROMPT_TEMPLATE = `
Generate a list of Japanese N5 level vocabulary for a JLPT study app.
Total words: 50.

PRIORITY: Include these {mistakesCount} recent error words: {mistakesList}.
FILL: Add {newCount} new N5 level words to reach 50.

SPECIAL REQUIREMENT: 
Pick 10 words (instead of 5) and set "isExamStyle" to true. 
For these 10 words, provide an "examQuestionText" mimicking the JLPT N5 "Vocabulary in Context" section. 
The sentence should have a blank (____) where the word fits. 
Example: 「あしたは (____) へ いきます。」 (Options would be ぎんこう, etc.)

For each word:
1. word: The Kanji/Kana (e.g., 銀行)
2. reading: The Hiragana only (e.g., ぎんこう)
3. meaning: Traditional Chinese meaning (e.g., 銀行)
4. example: A simple N5-level sentence.
5. distractors: 3 high-quality distractors. 
   - If it's a reading quiz, distractors should be similar-sounding Hiragana (e.g., きんこう, ぎんこ).
   - If it's a meaning quiz, distractors should be words from the same category (e.g., for "bank", use "post office", "station").
6. isExamStyle: boolean.
7. examQuestionText: string (only if isExamStyle is true).

Ensure all vocabulary and grammar in sentences are strictly N5.
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
              isExamStyle: { type: Type.BOOLEAN },
              examQuestionText: { type: Type.STRING },
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
