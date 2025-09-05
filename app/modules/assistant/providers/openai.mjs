export async function openaiChat({ baseUrl = 'https://api.openai.com', apiKey, model = 'gpt-4o-mini', messages, responseFormat = 'json' }) {
  if (!apiKey) throw new Error('Missing OpenAI API key');
  const url = baseUrl.replace(/\/$/, '') + '/v1/chat/completions';
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };
  const body = {
    model,
    messages,
    temperature: 0.2,
    response_format: responseFormat === 'json' ? { type: 'json_object' } : undefined,
  };
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenAI error ${res.status}: ${text}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? '';
  return content;
}

