# Gemini Project Instructions - N5 Vocabulary Master

This file contains project-specific context, rules, and conventions for the N5 Vocabulary Master application.

## Project Overview
A full-stack application (Express + Vite) that helps users study JLPT N5 vocabulary using AI-generated lists and Google Forms quizzes.

## Tech Stack
- **Frontend**: React (Vite), Tailwind CSS, Framer Motion, Lucide-React.
- **Backend**: Express.js, Google APIs Node.js Client (`googleapis`).
- **AI**: Gemini API via `@google/genai` (used in `src/services/gemini.ts`).
- **Auth**: Google OAuth 2.0. Tokens are stored in a secure, httpOnly cookie named `google_tokens`.

## Google Integration Details
- **Google Sheets**: Acts as the primary database.
    - `Vocabulary`: Stores the current week's word list.
    - `Forms List`: Metadata for generated forms (ID, Title, URL, Date).
    - `Form Responses 1`: Default sheet for form submissions.
- **Google Forms**: Used for the quiz interface.
    - **Creation Rule**: Must be a two-step process. First `forms.create` with only the `title`, then `forms.batchUpdate` for description, settings, and items.
    - **Question Logic**: 90% Multiple Choice (RADIO), 10% Short Answer (TEXT).

## Coding Conventions
- **Styling**: Use Tailwind CSS utility classes exclusively.
- **Icons**: Use `lucide-react`.
- **Animations**: Use `motion` from `motion/react`.
- **API Routes**: Prefix all backend API routes with `/api/`.
- **Environment Variables**:
    - `GEMINI_API_KEY`: For AI generation.
    - `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET`: For OAuth.
    - `APP_URL`: For redirect URIs.

## Development Rules
1. **Spec Synchronization**: Always update `Spec.md` when adding or changing core features.
2. **Error Handling**: Use descriptive error messages. For Google API failures, log the error and return a JSON error response to the frontend.
3. **UI Polish**: Maintain the "Modern Minimalist" aesthetic (Stone/Amber/Blue color palette, rounded-3xl corners, subtle shadows).
4. **Auth Flow**: The app uses a popup flow for Google Login. Ensure `window.postMessage` is used correctly in the callback to notify the opener.

## File Structure
- `server.ts`: Express server, OAuth handling, and Google API integrations.
- `src/App.tsx`: Main dashboard and UI logic.
- `src/services/gemini.ts`: AI vocabulary generation logic.
- `Spec.md`: Product requirements and feature list.
- `firebase-blueprint.json`: (If Firebase is added later) IR for database structure.
