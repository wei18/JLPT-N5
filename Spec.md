# N5 Vocabulary Master - Specification

## Overview
An AI-powered JLPT N5 vocabulary study tool that generates weekly vocabulary lists based on past performance and creates Google Forms for testing. It uses a centralized data architecture with a Master Registry spreadsheet as the single source of truth for all quiz metadata and vocabulary history.

## Core Features

### 1. AI-Powered Vocabulary Generation
- **Dynamic Selection**: Generates 50 unique N5-level vocabulary words per session.
- **Error-Driven Prioritization**: Analyzes recent form responses to prioritize words that respondents frequently get wrong.
- **Smart Filling**: If fewer than 50 repeat mistakes exist, it fills the remainder with fresh N5 vocabulary words, prioritizing words that haven't appeared recently to avoid duplicates.
- **Native Prompting**: Prompts are managed in a dedicated source file for better version control.

### 2. Google Form Quiz Integration
- **Automatic Creation**: Generates a Google Form quiz with a single click and auto-opens it for verification.
- **Contextualized Questions**: Mimics JLPT N5 style by embedding vocabulary in meaningful context sentences.
- **Dynamic Question Types**:
    - **漢字讀音 (Kanji Reading)**: Identifies the reading of a word within a sentence.
    - **文脈規定 (Contextual Usage)**: Selects the correct meaning/word based on the sentence flow.
    - **漢字表現 (Kanji Selection)**: Matches readings back to their correct Kanji form in context.
- **Pre-test Study**: The form description contains the full vocabulary list for last-minute review.
- **Strict Grading**: Enforces quiz settings with correct answers and point values.
- **Secure Collection**:
    - **Verified Email**: Mandatory Google Login to collect verified email addresses.
    - **Response Copies**: Automatically sends a copy of the results to every respondent.

### 3. Centralized Data Architecture (Google Sheets)
- **Master Registry Spreadsheet**:
    - `Forms List`: Tracks all generated quizzes, metadata, and dates.
    - `Vocabulary Registry`: A comprehensive database of all words ever tested, including readings, meanings, and context sentences.
- **Drive Cleanliness**: No separate session sheets are created, keeping the user's Google Drive organized. Data is analyzed directly from the Google Forms via API.
- **Automatic Cleanup**: Deleting a record from the dashboard automatically deletes the corresponding Google Form and purges its vocabulary from the registry.

### 4. Advanced Dashboard & Analytics
- **Leaderboard**: Displays current top performers and those needing more practice based on filtered non-anonymous data.
- **Weak Words Analysis**: Real-time analysis of historic quizzes to display the "Top 10" most missed words across the entire study group.
- **History Management**: Comprehensive table of previous quizzes including:
    - Average score per session.
    - Response count.
    - Top 10 session-specific weak words.
    - Direct links to both the Form and its Session Spreadsheet.
- **Resilience**: Automatically detects if the "Master Registry" has been manually deleted and provides a one-click re-initialization.

## Technical Stack
- **Frontend**: React (Vite 6), Tailwind CSS 4, Framer Motion, Lucide Icons.
- **Backend**: Express.js (Node.js).
- **AI Engine**: Google Gemini API (`gemini-1.5-flash`).
- **Core Integrations**:
    - **Google Forms API v1**: Form structure and settings management.
    - **Google Sheets API v4**: Data registry and session storage.
    - **Google Drive API v3**: File cleanup and management.
- **Auth**: Google OAuth 2.0 with secure httpOnly cookies.
