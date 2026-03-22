import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { weight, unit, category } = req.body;
  let retryDelaySec: number | null = null;
  const customKey = process.env.CUSTOM_GEMINI_KEY;
  const defaultKey = process.env.GEMINI_API_KEY;
  const apiKey = customKey || defaultKey;

  console.log(`Comparison Request: ${weight}${unit} - Key Source: ${customKey ? 'CUSTOM_SECRET' : 'DEFAULT_MANAGED'}`);

  if (!apiKey) {
    return res.status(200).json({ error: 'No API key configured', fallback: true });
  }

  const ai = new GoogleGenAI({ apiKey });
  const isSurprise = category === 'surprise me';
  const categoryPrompt = isSurprise
    ? "ANYTHING AT ALL (weird, obscure, unexpected). AVOID generic animals."
    : `the category "${category}"`;

  const prompt = `The user lifted ${weight} ${unit}. 
  Provide a funny comparison of ONE item weighing AT MOST ${weight} ${unit} in ${categoryPrompt}.
  Return ONLY a JSON object:
  {
    "message": "Celebratory message to user",
    "shortDescription": "Item name only",
    "imagePrompt": "Detailed visual prompt",
    "objectTag": "tag",
    "items": ["item"]
  }`;

  let retryDelaySec: number | null = null;

  // --- Attempt 1: Gemini ---
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            message: { type: Type.STRING },
            shortDescription: { type: Type.STRING },
            imagePrompt: { type: Type.STRING },
            objectTag: { type: Type.STRING },
            items: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["message", "shortDescription", "imagePrompt", "objectTag", "items"]
        }
      }
    });

    const result = JSON.parse(response.text || "{}");
    return res.status(200).json(result);
  } catch (error: any) {
    let errorMessage = error.message;
    try {
      const parsed = JSON.parse(error.message);
      errorMessage = parsed.error?.message || error.message;
    } catch (e) {}

    console.error("Gemini Error:", errorMessage);

    const isInvalidKey = errorMessage?.toLowerCase().includes('api key not valid') ||
                         errorMessage?.toLowerCase().includes('invalid_argument') ||
                         errorMessage?.toLowerCase().includes('400');
    const isQuota = errorMessage?.toLowerCase().includes('quota') ||
                    errorMessage?.toLowerCase().includes('exhausted') ||
                    errorMessage?.toLowerCase().includes('429');

    // If it's an invalid key, bail immediately — OpenRouter won't help
    if (isInvalidKey) {
      return res.status(200).json({ error: 'INVALID_KEY', fallback: true });
    }

    // Extract retry delay if Gemini told us how long to wait
    const retryDelayMatch = errorMessage?.match(/retry in (\d+(?:\.\d+)?)s/i);
    retryDelaySec = retryDelayMatch ? Math.ceil(parseFloat(retryDelayMatch[1])) : null;
    console.warn(`Gemini quota/error hit (retry in ${retryDelaySec}s), trying OpenRouter fallback...`);
  }

  // --- Attempt 2: OpenRouter (server-side, uses Vercel IP but with a proper API key so no rate limit) ---
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (openRouterKey) {
    try {
      const openRouterPrompt = `The user lifted ${weight} ${unit}. Provide a funny comparison of ONE item weighing AT MOST ${weight} ${unit} in category ${isSurprise ? 'anything weird or unexpected' : category}. Return ONLY valid JSON with no markdown, no explanation: {"message": "Celebratory message", "shortDescription": "Item name only", "imagePrompt": "Detailed visual prompt", "objectTag": "tag", "items": ["item"]}`;

      const orResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://ilifted.vercel.app',
          'X-Title': 'iLifted'
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-3.3-70b-instruct:free',
          messages: [{ role: 'user', content: openRouterPrompt }],
          response_format: { type: 'json_object' }
        })
      });

      if (orResponse.ok) {
        const orData = await orResponse.json();
        const content = orData.choices?.[0]?.message?.content;
        if (content) {
          const firstBrace = content.indexOf('{');
          const lastBrace = content.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace !== -1) {
            const parsed = JSON.parse(content.substring(firstBrace, lastBrace + 1));
            if (parsed.message && parsed.shortDescription) {
              console.log("OpenRouter fallback succeeded.");
              return res.status(200).json({ ...parsed, fallbackProvider: 'openrouter' });
            }
          }
        }
      } else {
        console.warn(`OpenRouter returned ${orResponse.status}`);
      }
    } catch (orError: any) {
      console.warn("OpenRouter fallback failed:", orError.message);
    }
  } else {
    console.warn("OPENROUTER_API_KEY not set, skipping OpenRouter fallback.");
  }

  // --- All server-side attempts exhausted, tell client to try its own fallback ---
  return res.status(200).json({
    error: 'QUOTA_EXCEEDED',
    fallback: true,
    retryDelay: retryDelaySec ? retryDelaySec * 1000 : null
  });
}
