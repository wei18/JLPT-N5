export const VOCAB_PROMPT_TEMPLATE = `
Generate a list of Japanese N5 vocabulary.
Total: 50 words.

PRIORITY: 
- Include {mistakesCount} error words: {mistakesList}.
- Use vocabulary and context styles from actual N5 past paper questions (考古題) or high-quality realistic ones.

FILL: Add {newCount} new N5 words to reach 50.

CORE PROPERTIES:
1. word: The Kanji/Kana.
2. reading: Hiragana only.
3. meaning: Traditional Chinese meaning.
4. example: A high-quality N5 sentence mimicking exam context (Vocabulary in Context style).
5. distractors: 3 Hiragana-only distractors (similar sound/visual).
   - SINGLE CORRECT ANSWER: Distractors must be strictly incorrect in the context.

Ensure all Japanese is strictly N5 level.
`;
