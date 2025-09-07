import { openaiChat } from './providers/openai.mjs';
import { ollamaGenerate } from './providers/ollama.mjs';

const KEY = 'dw:ai:settings';

export function loadAISettings() {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : { provider: 'none' }; }
  catch { return { provider: 'none' }; }
}

export function saveAISettings(cfg) {
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch {}
}

export async function askAI(cfg, { mode, text }) {
  // mode: 'instructions' | 'commands'
  if (!cfg || cfg.provider === 'none') throw new Error('AI provider not configured');
  if (cfg.provider === 'ollama') {
    // Default to Shadax generation: English -> Shadax DSL
    const shadaxSpec = `You are Shadax Writer, producing only Shadax (Shield & Axe) scripts.
Shadax is a line-oriented build language for a dwarven barrow. Allowed commands:
BARROW name "<name>"
CAVERN <id> NAME "<name>" [ROLE central] [SIZE small|medium|large] [AT <DIR> OF <anchorId>]
LINK <fromId> <toId> [DIR <DIR>] [TYPE tunnel|door]
CARDDON "<name>" [IN <cavernId>]
RENAME CAVERN <fromId> TO <toId>
RENAME CARDDON "<from>" TO "<to>"
DIR is one of: N S E W NE NW SE SW UP DOWN
Rules:
- Output only Shadax lines, no prose, no JSON.
- Derive ids by slugging names (lowercase, dashes).
- Favor concise commands; one logical action per line.`;
    const model = (cfg.model || '').trim();
    const resolvedModel = (!model || /^gpt/i.test(model)) ? 'llama3.1:8b' : model;
    const resp = await ollamaGenerate({
      baseUrl: cfg.baseUrl || 'http://localhost:11434',
      model: resolvedModel,
      prompt: String(text || ''),
      system: shadaxSpec
    });
    return resp;
  }
  if (cfg.provider === 'local') {
    const base = (cfg.baseUrl || 'http://localhost:8787').replace(/\/$/, '');
    const path = mode === 'commands' ? '/parse-commands' : '/parse-instructions';
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    if (!res.ok) throw new Error(`Local assistant error ${res.status}`);
    const data = await res.json();
    return JSON.stringify(data, null, 2);
  }
  if (cfg.provider === 'openai') {
    const sys = mode === 'commands'
      ? `You are an assistant for a dungeon builder. Translate the user's imperative instructions into a JSON array of commands. Use this JSON schema:
[
  { "type": "createBarrow", "name": string? },
  { "type": "renameBarrow", "name": string },
  { "type": "addCavern", "name": string, "role"?: "central", "size"?: "small"|"medium"|"large", "direction"?: "N"|"S"|"E"|"W"|"NE"|"NW"|"SE"|"SW"|"UP"|"DOWN", "anchor"?: string },
  { "type": "renameCavern", "from": string, "to": string },
  { "type": "addLink", "from": string, "to": string, "direction"?: string, "linkType"?: "tunnel"|"door" },
  { "type": "addCarddon", "name": string, "cavern"?: string },
  { "type": "renameCarddon", "from": string, "to": string },
  { "type": "listCaverns" }, { "type": "listCarddons" }, { "type": "showBarrow" }
]
Respond ONLY with valid JSON array.`
      : `You are an assistant for a dungeon builder. Convert the user's description into instructions JSON with this shape:
{
  "caverns": [{ "id"?: string, "name"?: string, "role"?: "central"|string, "tags"?: string[], "size"?: "small"|"medium"|"large" }...],
  "links": [{ "from": string, "to": string, "direction"?: "N"|"S"|"E"|"W"|"NE"|"NW"|"SE"|"SW"|"UP"|"DOWN", "type"?: "tunnel"|"door" }...],
  "meta"?: object
}
Respond ONLY with a JSON object.`;

    const user = text;
    const content = await openaiChat({
      baseUrl: cfg.baseUrl || 'https://api.openai.com',
      apiKey: cfg.apiKey,
      model: cfg.model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user }
      ],
      responseFormat: 'json'
    });
    return content;
  }
  throw new Error(`Unsupported provider: ${cfg.provider}`);
}
