# on air — Voice Interview Practice

A realistic mock interview in your browser: spoken aloud, adaptive to your answers, and scored by a blunt coach. Speak or type; get feedback on pacing, filler words and structure.

**Live app:** deploy this repo to Vercel (or any static host) — it's a single `index.html` with no build step.

## Features

- Adaptive interviewer (friendly HR / skeptical tech lead / rapid-fire panel) powered by Claude
- Voice input (Web Speech API) and spoken questions with a woman/man voice choice
- Per-answer timing and filler-word tracking
- Blunt coach feedback with per-question scores and a rewritten model answer
- Session history, stored locally in your browser
- Optional: paste a real job posting and questions will target it

## Usage

Each user brings their own Anthropic API key (created at [platform.claude.com](https://platform.claude.com)). The key is sent only to `api.anthropic.com` and is stored in the browser's localStorage only if "Remember key" is ticked. No server, no backend — the page calls the Anthropic API directly.

## Run locally

Voice input needs a proper origin (browsers block the mic on `file://` pages):

```
node serve.js
```

then open http://localhost:8321 — or on Windows, double-click `Start On Air.cmd`.

## Browser support

- **Chrome:** everything works out of the box.
- **Edge:** works; voice input additionally requires Windows' "Online speech recognition" (Settings > Privacy & security > Speech).
- **Firefox:** no speech recognition — typing fallback is used automatically.

## Files

| File | Purpose |
|---|---|
| `index.html` | The entire app (markup, styles, logic) |
| `serve.js` / `Start On Air.cmd` | Local development server (not needed on Vercel) |
| `on-air.jsx` | React variant for the claude.ai artifact runtime |
