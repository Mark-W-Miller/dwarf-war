// Minimal Ollama REST client (local LLM)
// Docs: https://github.com/ollama/ollama/blob/main/docs/api.md

export async function ollamaGenerate({ baseUrl = 'http://localhost:11434', model = 'llama3.1:8b', prompt, system }) {
  const url = baseUrl.replace(/\/$/, '') + '/api/generate';
  const body = {
    model,
    prompt: (system ? system + "\n\n" : '') + prompt,
    stream: false,
    options: { temperature: 0.2 }
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama error ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.response || '';
}

