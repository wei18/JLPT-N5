# Gemini Project Instructions - N5 Vocabulary Master

This file contains project-specific context, rules, and conventions for the N5 Vocabulary Master application.

## Project Overview
A full-stack application (Express + Vite) that helps users study JLPT N5 vocabulary using AI-generated lists and Google Forms quizzes.

## Tech Stack
- **Frontend**: React (Vite), Tailwind CSS, Framer Motion, Lucide-React.
- **Backend**: Express.js, Google APIs Node.js Client (`googleapis`).
- **AI**: Gemini API via `@google/genai` (Service: `src/services/gemini.ts`, Prompts: `src/services/prompts.ts`).
- **Auth**: Google OAuth 2.0. Tokens are stored in a secure, httpOnly cookie named `google_tokens`.

## Google Integration Architecture
- **Distributed Data Model**:
    - **Master Registry Spreadsheet**: A single spreadsheet titled `N5 Vocabulary Master - Master Registry`.
        - Sheet `Forms List`: Tracks `[Form ID, Title, URL, Session Sheet ID, Date]`.
        - Sheet `Vocabulary Registry`: Tracks `[Word, Reading, Meaning, Example, Form ID]` for centralized duplicate exclusion and reference.
    - **Per-Session Storage**: No separate spreadsheets are created for individual quizzes to keep Google Drive clean. All data is centralized in the Master Registry.
- **Exclusion Logic**: 
    - The system tracks all "Used Vocabulary" with full details in the Master Registry.
    - Before generating new words, the system verifies Form existence in Google Drive.
    - If a Form is deleted, its associated words are purged from the Registry and become eligible for selection again.
- **Analysis Logic**:
    - Performance analysis (Mistakes/Leaderboards) is done via **direct Forms API calls** (reading all responses) combined with the Master Registry to identify recent forms.
    - Test data detection: Responses from "anonymous" or missing emails are filtered out.

## Google Forms Details
- **Creation Rule**: Must be a two-step process. First `forms.create` with only the `title`, then `forms.batchUpdate` for description, settings, and items.
- **Settings**:
    - `Verified Email Collection` (REQUIRED).
    - `Always Send Response Copy` (REQUIRED).
- **Question Logic**: 100% Multiple Choice (RADIO), contextualized according to JLPT N5 patterns (Kanji Reading, Contextual Usage, Kanji Selection).
- **UI Constraints**: Question `title` must NOT contain newlines; use `description` for multi-line context if needed.

## Coding Conventions
- **Styling**: Use Tailwind CSS utility classes exclusively.
- **Icons**: Use `lucide-react`.
- **Animations**: Use `motion` from `motion/react`.
- **API Routes**: Prefix all backend API routes with `/api/`.

## Development Rules
1. **Spec Synchronization**: Always update `Spec.md` when adding or changing core features.
2. **Error Handling**: 
    - Handle `404 NOT_FOUND` for Google files gracefully. 
    - If Master Registry is missing, return `REGISTRY_NOT_FOUND` to trigger frontend reset.
3. **UI Polish**: Modern Minimalist (Stone/Amber/Blue color palette, rounded-3xl corners).
4. **Auth Flow**: Popup flow for Google Login.
5. **Proposal Flow**: For any complex discussions or features that are put on hold (Pending), document the context, options, and decisions in `proposals/xxx_proposal.md`. Always refer to these files when resuming a specific topic.

## File Structure
- `server.ts`: Express server, OAuth handling, Google API integrations, and analytics.
- `src/App.tsx`: Main dashboard, history table, and UI logic.
- `src/services/gemini.ts`: AI generation service.
- `src/services/prompts.ts`: AI prompt templates.
- `Spec.md`: Product requirements and feature list.
- `proposals/`: Directory for documenting pending discussions and architecture proposals.
