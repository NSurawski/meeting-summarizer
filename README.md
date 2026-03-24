# AI Meeting Summarizer

A React app that turns meeting transcripts into structured, actionable summaries using Claude. Try the [live demo](https://nicolesurawski.github.io/meeting-summarizer/) — no API key needed.

## What It Does

Paste any meeting transcript and get back:

- **TL;DR** — Executive summary in 2-3 sentences
- **Decisions** — What was decided and why
- **Action Items** — Tasks with owners and deadlines
- **Topics Discussed** — Key subjects covered
- **Open Questions** — Unresolved items and parking lot topics

## Features

- **Demo mode** — View a pre-built sample summary instantly, no API key required
- **Follow-up tracker** — Action items and open questions persist across sessions with resolve/unresolve toggles
- **Copy to clipboard** — Export the full summary as formatted markdown
- **Sample transcript** — Built-in sample to test with your own API key
- **localStorage persistence** — Meeting history and API key are saved locally

## How It Works

1. User pastes a transcript (or loads the built-in sample)
2. The app sends it to the Anthropic API with a structured system prompt
3. Claude returns JSON with decisions, action items, open questions, etc.
4. Results render in a dark-themed UI with copy-to-clipboard support
5. Action items and open questions are saved to the follow-up tracker

## Tech Stack

- **React 18** with hooks
- **Vite** for dev server and production builds
- **Anthropic API** (Claude Sonnet) for summarization
- **Inline CSS** — no external styling dependencies

## Project Structure

```
src/
  MeetingSummarizer.jsx   — Main component (input, API call, summary display, follow-up tracker)
  demoSummary.js          — Pre-computed summary for demo mode
  main.jsx                — App entry point
index.html                — HTML shell
vite.config.js            — Vite configuration
meeting_summarizer_scope.docx — Product scope document
```

## Getting Started

```bash
npm install
npm run dev       # Start dev server at localhost:5173
npm run build     # Production build to dist/
npm run preview   # Preview the production build locally
```

## API Details

The component calls the Anthropic Messages API directly from the browser. The system prompt enforces strict JSON output:

```json
{
  "title": "...",
  "tldr": "...",
  "topics": [{ "title": "...", "summary": "..." }],
  "decisions": [{ "decision": "...", "context": "..." }],
  "actionItems": [{ "task": "...", "owner": "...", "due": "..." }],
  "openQuestions": [{ "question": "..." }]
}
```

Users provide their own Anthropic API key, which is stored in localStorage only — never sent to any server besides the Anthropic API.

## Portfolio Context

This was built as a PM portfolio project to demonstrate product definition, scope management, and translating a product spec into a working implementation. See the scope document for the full product thinking behind it — including user segments, success metrics, and v1 constraints.
