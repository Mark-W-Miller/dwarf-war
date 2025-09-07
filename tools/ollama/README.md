# Dwarf War • Ollama preset (Shadax Assistant)

This preset makes a local model behave as the in‑game assistant:
- Natural language by default (advise, clarify, propose).
- Emit Shadax (Shield & Axe) script only when asked.
- Bakes the Shadax quick reference into the system prompt.

## Files
- `tools/ollama/Modelfile` — baseline role + Shadax spec

## Build the preset
1) Ensure Ollama is installed and running

   ```bash
   ollama serve
   ```

2) Create the preset model (named `shadax-dev`)

   ```bash
   ollama create shadax-dev -f tools/ollama/Modelfile
   ```

3) Pull a base model if prompted (e.g. `llama3.2:3b`)

   ```bash
   ollama pull llama3.2:3b
   ```

4) Verify it exists

   ```bash
   ollama list
   # or
   curl http://localhost:11434/api/tags
   ```

## Use in the app
1) Serve the app (example)

   ```bash
   npx http-server app -p 8080 -c-1
   ```

2) Allow browser origin (optional; needed if you hit CORS)

   ```bash
   export OLLAMA_ORIGINS="http://localhost:8080"
   ollama serve
   ```

3) In the app (gear icon → Settings)
- Provider: `Ollama (local LLM)`
- Model: `shadax-dev`
- Base URL: `http://localhost:11434`

## Workflow
- Talk naturally in the Edit tab.
- When ready, ask: “Generate Shadax for that plan.”
- Paste/confirm the Shadax in the output box and click Apply.

## Notes
- The Modelfile is a preset, not training. For “memory,” keep facts in the app
  (local DB) and the app injects them into each request.
- Switch back to the local parser (Provider: None) if you want zero‑terminal,
  fully offline parsing without LLMs.

