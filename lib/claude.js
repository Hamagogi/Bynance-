import Anthropic from '@anthropic-ai/sdk';

export const CLAUDE_MODEL =
  process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';

let client;
export function getClaude() {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export const SYSTEM_PROMPT = `You are ContentShift, an expert content repurposing engine.
Given one piece of source content, produce five platform-native outputs that feel native to each channel — not copy-paste.

Rules:
- Keep the original ideas, examples, and facts intact. Never invent data.
- Write in the same language as the source content.
- No emojis unless the platform genuinely benefits (Instagram/X can use a few; LinkedIn/newsletter should stay clean).
- Hashtags only where specified.
- Return STRICT JSON matching the schema — no prose, no markdown fences.`;

export const OUTPUT_SCHEMA = `{
  "instagram": { "caption": string, "hashtags": string[] },
  "twitter":   { "tweets": string[] },               // 5-7 tweets, each <= 275 chars
  "linkedin":  { "post": string },                   // 150-300 words, hook + value + CTA
  "youtube_shorts": { "hook": string, "script": string, "cta": string }, // script <= 45s spoken
  "newsletter": { "subject": string, "summary": string } // summary 120-200 words
}`;

export function buildUserPrompt({ title, content, sourceType }) {
  const trimmed = content.length > 18000 ? content.slice(0, 18000) + '…' : content;
  return `Source type: ${sourceType}
Source title: ${title || '(untitled)'}

Source content:
"""
${trimmed}
"""

Produce the five outputs strictly matching this JSON schema (no extra keys, no markdown):
${OUTPUT_SCHEMA}`;
}

function stripJsonFence(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  return text.trim();
}

export async function generateRepurposedContent({ title, content, sourceType }) {
  const anthropic = getClaude();
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt({ title, content, sourceType }) }]
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('Claude returned no text.');

  let parsed;
  try {
    parsed = JSON.parse(stripJsonFence(textBlock.text));
  } catch {
    throw new Error('Model output was not valid JSON.');
  }

  const required = ['instagram', 'twitter', 'linkedin', 'youtube_shorts', 'newsletter'];
  for (const k of required) {
    if (!parsed[k]) throw new Error(`Model output missing key: ${k}`);
  }

  return {
    outputs: parsed,
    usage: {
      input_tokens: response.usage?.input_tokens ?? 0,
      output_tokens: response.usage?.output_tokens ?? 0
    }
  };
}
