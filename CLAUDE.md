# Meeting Summarizer

## Overview
A single-page React app that turns meeting transcripts into structured, actionable summaries using the Anthropic API (Claude Sonnet). Includes a follow-up tracker that persists unresolved items across meetings via localStorage.

## Tech Stack
- **React 18** with Vite 6
- **Node 22** (via nvm)
- **Inline CSS** — no external styling libraries
- **No backend** — direct browser-to-Anthropic API calls
- **localStorage** for persistence (key: `meetingSummaries`)

## Getting Started
```bash
# Load nvm and use Node 22
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 22

npm install
npm run dev      # http://localhost:5173
npm run build    # production build → dist/
```

## Project Structure
```
src/
  main.jsx                  # Entry point — renders MeetingSummarizer
  MeetingSummarizer.jsx     # Entire app in one component (~680 lines)
meeting-summarizer.jsx      # Original standalone component (pre-Vite)
meeting_summarizer_scope.docx  # Product scope document
```

## Architecture
- **Single component** — `MeetingSummarizer.jsx` contains all state, API logic, and UI
- **All styling is inline** via React `style` objects. Dark theme with `#0A0E1A` background
- **API call** goes directly to `https://api.anthropic.com/v1/messages` with user-provided API key
- **System prompt** enforces strict JSON output: `title`, `tldr`, `topics`, `decisions`, `actionItems`, `openQuestions`
- **Follow-up tracker** saves `actionItems` and `openQuestions` with `resolved` flags to localStorage, grouped by meeting

## Git
- **Remote**: https://github.com/NSurawski/meeting-summarizer
- **Branches**: `source` (working branch) and `main` (kept in sync)
- Push to both: `git push origin source && git push origin source:main`
