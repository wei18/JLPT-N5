# Proposal: Weekly Leaderboard Logic ("Current" Champion/Bottom)

## Status: PENDING ⏳
*Last Discussed: 2026-04-16*

## Context
The current dashboard displays "Weekly Champion" and "Weekly Bottom". However, the internal logic currently retrieves the last 10 quiz forms regardless of time, which doesn't strictly adhere to a "weekly" definition. The user requested a more precise "Current" (當前) calculation.

## Discussion Points & Proposed Solutions

### 1. Definition of "Current"
*   **Proposed Logic**: Strictly filter records by the current calendar week (Monday 00:00 to Sunday 23:59).
*   **Behavior**: On every Monday, the leaderboard should reset to "No Data" until a new quiz is generated and taken.

### 2. Handling Multiple Entries by One User
If a user takes multiple quizzes in a single week:
*   **Option A (Best Score)**: Track the highest score achieved by that user within the week.
*   **Option B (Weighted Average)**: Calculate the average performance to reflect stability.
*   **Option C (Latest Only)**: Only look at the most recent quiz state.
*   *Pending Decision*: Needs user confirmation on which metric better represents "Current Mastery".

### 3. UI Enhancements
*   **Time Range Label**: Add a label like `(2026.04.13 - 2026.04.19)` to the leaderboard cards.
*   **Zero-State**: Design a clean "New Week, New Start" placeholder for Monday mornings.

## Implementation Notes
*   **Backend**: Update the `/api/analyze` endpoint to calculate the date range of the current week and filter `registryRows` before processing.
*   **Frontend**: Add a subtitle to the leaderboard cards in `App.tsx` to show the active date range.

---
*Refer to this file when resuming the "Leaderboard Precision" discussion.*
