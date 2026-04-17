import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface VocabularyItem {
  word: string;
  reading: string;
  meaning: string;
  example: string;
  distractors: string[];
  isExamStyle?: boolean;
  examQuestionText?: string; // e.g. "あしたは ____ です。" where the answer is "やすみ"
}

export const VOCAB_PROMPT_TEMPLATE = `
Generate a list of Japanese N5 level vocabulary.
Total words needed: 50.

PRIORITY: Include these {mistakesCount} recent error words: {mistakesList}.
FILL: Add {newCount} new N5 level words to reach a total of 50.

SPECIAL REQUIREMENT: 
Pick 5 words from the list and set "isExamStyle" to true. 
For these 5 words, provide an "examQuestionText" which is a complete Japanese sentence with a blank (____) where the word should go, mimicking a JLPT N5 grammar/vocabulary question.

For each word, provide:
1. The word (Kanji/Kana)
2. Reading (Hiragana)
3. Meaning (Traditional Chinese)
4. A simple example sentence (Japanese with reading in brackets and Chinese translation)
5. 3 distractors (incorrect meanings or similar-looking words in Traditional Chinese/Japanese depending on context) for a multiple-choice quiz.

Ensure all words are strictly within the N5 JLPT range.
`;

export async function generateWeeklyVocabulary(previousMistakes: string[] = []): Promise<VocabularyItem[]> {
  const mistakesList = previousMistakes.slice(0, 50);
  const newCount = Math.max(0, 50 - mistakesList.length);
  
  const prompt = VOCAB_PROMPT_TEMPLATE
    .replace('{mistakesCount}', mistakesList.length.toString())
    .replace('{mistakesList}', mistakesList.join(', '))
    .replace('{newCount}', newCount.toString());

  const response = await ai.models.generateContent({
    model: "gemini-1.5-flash",
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

  try {
    return JSON.parse(response.text);
  } catch (e) {
    console.error("Failed to parse Gemini response", e);
    return [];
  }
}
