export const VOCAB_PROMPT_TEMPLATE = `
Generate a list of unique Japanese N5 vocabulary.
Total: 50 words.

PRIORITY: 
- Include {mistakesCount} error words: {mistakesList}. (STRICT: If a mistake looks like an instruction sentence, IGNORE it and pick a real N5 word instead).
- Use vocabulary and context styles from actual N5 past paper questions (考古題) or high-quality realistic ones.
- NO DUPLICATES: Strictly avoid these previously used words: {usedVocab}.
- NO META-TEXT: NEVER use task instructions (e.g., "choose the correct answer", "please fill in") as the "word", "meaning", or "reading".
- For the {newCount} additional words, priority should be given to N5 words that are NOT in the mistakes list or the used list. Try to introduce fresh vocabulary.

FILL: Add {newCount} new N5 words to reach 50.

CORE PROPERTIES:
1. word: The Kanji/Kana. (Actual vocabulary only, e.g., "天気", not instructions).
2. reading: Hiragana only.
3. meaning: Traditional Chinese meaning.
4. example: A high-quality N5 sentence mimicking exam context (Vocabulary in Context style). 
   - **STRONG CONTEXT REQUIRED**: The sentence MUST contain enough information to make the target word the ONLY logical answer. 
   - Avoid generic patterns like "I like [X]" or "This is [X]" unless the preceding or following part of the sentence provides a specific clue that rules out other similar nouns.
   - Example: Instead of "I like [fruits]", use "It is sweet and red, I like [apples]".
   - IMPORTANT: The target "word" MUST appear in the sentence in its EXACT base/dictionary form as provided in the "word" field.
5. contextualDistractors: 3 alternative N5 Japanese words that are grammatically correct but logically/semantically IMPOSSIBLE given the specific context clues provided in the "example".
   - **KANJI USAGE**: For N5 level, prefer Hiragana for these distractors unless the Kanji is very basic (e.g., 人, 日, 大). Avoid using complex Kanji that aren't expected at N5 level.
6. distractors: 3 Hiragana-only distractors (similar sound/visual).
   - **NO ROMAJI**: Never use English alphabet/Romaji (like "konshuu") in questions or answers.
   - SINGLE CORRECT ANSWER: Distractors must be strictly incorrect in the context.
   - NO JUNK: Distractors must be real N5 words/readings, never instruction fragments.

Ensure all Japanese is strictly N5 level, uses Hiragana for pronunciation clues (never Romaji), follows N5 Kanji/Kana balance conventions, and prompts a single, unambiguous correct answer.
`;
