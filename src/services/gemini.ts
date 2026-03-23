export interface ComparisonResult {
  message: string;
  shortDescription: string;
  imagePrompt: string;
  objectTag: string;
  items: string[];
  isFallback?: boolean;
}

function parseRetryDelay(errorMessage: string): number | null {
  const match = errorMessage.match(/retry in (\d+(?:\.\d+)?)s/i);
  if (match) return Math.ceil(parseFloat(match[1])) * 1000;
  return null;
}

export async function getWeightComparison(
  weight: number,
  unit: string,
  category: string,
  retryCount = 0
): Promise<ComparisonResult> {
  try {
    const response = await fetch('/api/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weight, unit, category })
    });

    if (response.ok) {
      const data = await response.json();
      if (data.fallback) {
        const retryDelay = data.retryDelay || null;
        const err = new Error(data.error || "GEMINI_FALLBACK") as any;
        err.retryDelay = retryDelay;
        throw err;
      }
      return { ...data, isFallback: data.fallbackProvider === 'openrouter' };
    }

    const errorData = await response.json().catch(() => ({ error: "Vercel API error" }));
    console.warn("Vercel API error:", errorData.error);
  } catch (err: any) {
    if (
      retryCount === 0 &&
      err.retryDelay &&
      (err.message === 'QUOTA_EXCEEDED' || err.message === 'QUOTA_EXCEEDED_MINUTE')
    ) {
      console.log(`Auto-retrying after ${err.retryDelay}ms...`);
      await new Promise(resolve => setTimeout(resolve, err.retryDelay));
      return getWeightComparison(weight, unit, category, 1);
    }
    console.warn("API call failed, jumping to client-side fallback");
  }

  const result = await getWeightComparisonFallback(weight, unit, category);
  return { ...result, isFallback: true };
}

async function getWeightComparisonFallback(weight: number, unit: string, category: string): Promise<ComparisonResult> {
  console.warn("Server-side AI unavailable. Entering client-side fallback chain...");

  const low = Math.round(Number(weight) * 0.7);
  const high = Math.round(Number(weight) * 1.3);
  const isSurprise = category === 'surprise me';
  const categoryInstruction = isSurprise
    ? `Pick something genuinely surprising or unexpected — obscure, counterintuitive, or the kind of thing that makes someone say "I had no idea that weighed that much". Avoid generic animals or common household objects.`
    : `Pick something from the category "${category}" that feels apt, interesting, or memorable for this weight. Stay on brief — the category was chosen deliberately.`;
  const prompt = `The user lifted ${weight} ${unit}.
Find ONE real-world item that weighs APPROXIMATELY ${weight} ${unit} — it MUST weigh between ${low} ${unit} and ${high} ${unit}. Do not suggest anything that weighs a fraction of this.
${categoryInstruction}
The comparison should be interesting and shareable. It can be funny if that fits naturally, but the primary goal is that it's genuinely surprising or satisfying to learn. Accuracy matters — the weight match must be real.
Return ONLY valid JSON with no markdown or explanation:
{"message": "Celebratory message to the user referencing the comparison", "shortDescription": "Item name only", "imagePrompt": "Detailed visual prompt for image generation", "objectTag": "single word tag", "items": ["item name"]}`;

  const pollinationsModels = ['openai', 'mistral'];

  for (const model of pollinationsModels) {
    try {
      const url = `https://text.pollinations.ai/${encodeURIComponent(prompt)}?model=${model}&json=true&seed=${Math.floor(Math.random() * 1000000)}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (response.status === 429 || response.status === 502 || response.status === 503) {
        console.warn(`Pollinations model ${model} unavailable (${response.status}), trying next...`);
        continue;
      }
      if (!response.ok) continue;

      const text = await response.text();
      const firstBrace = text.indexOf('{');
      const lastBrace = text.lastIndexOf('}');
      if (firstBrace === -1 || lastBrace === -1) continue;

      try {
        const parsed = JSON.parse(text.substring(firstBrace, lastBrace + 1)) as ComparisonResult;
        if (parsed.message && parsed.shortDescription) {
          console.log(`Client fallback succeeded using Pollinations ${model}.`);
          return parsed;
        }
      } catch (parseErr) {
        console.warn(`Failed to parse JSON from Pollinations ${model}`);
      }
    } catch (error) {
      console.warn(`Pollinations model ${model} failed`);
    }
  }

  // Attempt 2: OpenRouter via Vercel function (key stays server-side)
  console.warn("Pollinations unavailable, trying OpenRouter via /api/text-fallback...");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const response = await fetch('/api/text-fallback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ weight, unit, category })
    });

    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json();
      if (!data.fallback && data.message && data.shortDescription) {
        console.log("Client fallback succeeded via /api/text-fallback (OpenRouter).");
        return data as ComparisonResult;
      }
    }
    console.warn("text-fallback endpoint returned no usable result");
  } catch (err: any) {
    console.warn("text-fallback endpoint failed:", err.message);
  }

  throw new Error("QUOTA_EXCEEDED_DAY");
}

// --- Image generation ---

/**
 * Converts a blob: URL to a base64 data URL so the img tag never hits
 * cross-origin issues and onLoad fires reliably.
 */
async function blobUrlToDataUrl(blobUrl: string): Promise<string> {
  const response = await fetch(blobUrl);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function tryGeminiImage(prompt: string): Promise<string | null> {
  try {
    const response = await fetch('/api/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });

    if (!response.ok) {
      console.warn(`Gemini image endpoint returned ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (data.image) {
      console.log("Gemini image succeeded.");
      return data.image;
    }
    if (data.fallback) {
      console.warn("Gemini image flagged as fallback:", data.error);
      return null;
    }
    return null;
  } catch (err: any) {
    console.warn("Gemini image threw:", err.message);
    return null;
  }
}

async function tryPollinationsImage(prompt: string): Promise<string | null> {
  const cleanPrompt = prompt.replace(/["']/g, '').trim();
  const enhancedPrompt = `A premium photorealistic studio shot of: ${cleanPrompt}. Centered, square composition, professional lighting, sharp focus. No text.`;
  const models = ['turbo', 'flux'];

  for (const model of models) {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(enhancedPrompt)}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 1000000)}&model=${model}`;
    console.log(`Trying Pollinations image (model: ${model})...`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        console.warn(`Pollinations ${model} returned ${response.status}`);
        continue;
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) {
        console.warn(`Pollinations ${model} returned non-image content-type: ${contentType}`);
        continue;
      }

      const blob = await response.blob();
      // Convert to data URL immediately so the img tag works reliably everywhere
      const blobUrl = URL.createObjectURL(blob);
      const dataUrl = await blobUrlToDataUrl(blobUrl);
      URL.revokeObjectURL(blobUrl);
      console.log(`Pollinations ${model} succeeded.`);
      return dataUrl;
    } catch (err: any) {
      clearTimeout(timeout);
      console.warn(`Pollinations ${model} failed:`, err.message);
    }
  }

  return null;
}

async function tryFalImage(prompt: string): Promise<string | null> {
  const cleanPrompt = prompt.replace(/["']/g, '').trim();
  const enhancedPrompt = `A premium photorealistic studio shot of: ${cleanPrompt}. Centered, square composition, professional lighting, sharp focus. No text.`;

  console.log("Trying fal.ai image...");

  try {
    const response = await fetch('/api/image-fal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: enhancedPrompt })
    });

    if (!response.ok) {
      console.warn(`fal.ai returned ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (data.image) {
      console.log("fal.ai image succeeded.");
      return data.image;
    }
    return null;
  } catch (err: any) {
    console.warn("fal.ai threw:", err.message);
    return null;
  }
}

export async function generateComparisonImage(prompt: string): Promise<string> {
  // Try each provider in sequence, silently falling through on any failure.
  // The caller only sees an error once everything is exhausted.

  const geminiResult = await tryGeminiImage(prompt);
  if (geminiResult) return geminiResult;

  const pollinationsResult = await tryPollinationsImage(prompt);
  if (pollinationsResult) return pollinationsResult;

  const falResult = await tryFalImage(prompt);
  if (falResult) return falResult;

  // All three providers failed
  console.error("All image providers exhausted.");
  throw new Error("QUOTA_EXCEEDED_DAY");
}
