# N5 Vocabulary Master - Specification

## Overview
An AI-powered JLPT N5 vocabulary study tool that generates weekly vocabulary lists based on past performance and creates Google Forms for testing.

## Core Features

### 1. Vocabulary Generation
- Generates 50 N5-level vocabulary words per session.
- AI-driven: Analyzes all past mistakes from the Google Spreadsheet to prioritize the most recent 50 weak words. If fewer than 50 mistakes exist, it fills the remainder with new N5 words.

### 2. Google Form Integration
- **Automatic Creation**: Generates a Google Form quiz with a single click.
- **Question Types**:
    - 80% Multiple Choice (Choice of readings or meanings).
    - 10% Short Answer (Fill-in-the-blank for readings).
    - 10% (5 questions) JLPT N5 Exam Style: Contextual questions where the word is used in a sentence with a blank (____).
- **Pre-test Study**: The form description contains the full vocabulary list for last-minute review.
- **Grading**: Automatically sets up as a quiz with correct answers and point values.
- **Security**: Enforces **Verified Email Collection** and **Always Send Response Copy** to ensure data integrity and user feedback.

### 3. Data Management (Google Sheets)
- **Study Log**: A central Google Spreadsheet stores all data.
- **Sheets Structure**:
    - `Vocabulary`: Stores the generated word lists.
    - `Form Responses 1`: Standard Google Forms response sheet.
    - `Forms List`: Stores metadata of generated forms (ID, Title, URL, Date).
- **Leaderboard**: Displays champions (highest score) and lowests (lowest score) based on spreadsheet data.

### 4. Dashboard Features
- **Form History**: A list of all previously generated forms.
- **Management**: Ability to delete form records from the list.
- **Results**: View scores and performance directly on the dashboard.

## Technical Stack
- **Frontend**: React (Vite), Tailwind CSS, Framer Motion, Lucide Icons.
- **Backend**: Express.js (Node.js).
- **APIs**:
    - Google Forms API (Form creation and management).
    - Google Sheets API (Data storage and analysis).
    - Gemini API (AI vocabulary generation).
- **Auth**: Google OAuth 2.0 (Popup flow).
