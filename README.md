# AI Meeting Summarizer

A React component that turns meeting transcripts into structured, actionable summaries using Claude.

## What It Does

Paste any meeting transcript and get back:

- **TL;DR** — Executive summary in 2-3 sentences
- **Decisions** — What was decided and why
- **Action Items** — Tasks with owners and deadlines
- **Topics Discussed** — Key subjects covered
- **Open Questions** — Unresolved items and parking lot topics

## How It Works

1. User pastes a transcript (or loads the built-in sample)
2. The app sends it to the Anthropic API with a structured system prompt
3. Claude returns JSON with decisions, action items, open questions, etc.
4. Results render in a clean, dark-themed UI with copy-to-clipboard support

## Tech Stack

- **React** (JSX component with hooks)
- **Anthropic API** (Claude Sonnet) for summarization
- **Inline CSS** — no external dependencies

## Key Files

- `meeting-summarizer.jsx` — Full component (input, API call, structured output display)
- `meeting_summarizer_scope.docx` — Purpose & Scope document defining the product vision, user segments, success metrics, and v1 constraints

## API Details

The component calls the Anthropic Messages API directly. The system prompt enforces strict JSON output with the following structure:

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

## Portfolio Context

This was built as a PM portfolio project to demonstrate product definition, scope management, and translating a product spec into a working implementation. See the scope document for the full product thinking behind it — including user segments, success metrics, and v1 constraints.
