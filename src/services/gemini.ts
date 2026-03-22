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
  console.warn("Server-side AI unavailable. Entering Pollinations.ai client fallback...");

  const prompt = `The user lifted ${weight} ${unit}. Provide a funny comparison of ONE item weighing AT MOST ${weight} ${unit} in category ${category}. Return ONLY a JSON object: {"message": "msg", "shortDescription": "item", "imagePrompt": "prompt", "objectTag": "tag", "items": ["item"]}`;

  const models = ['openai', 'mistral'];

  for (const model of models) {
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
        console.warn(`Failed to parse JSON from ${model}`);
      }
    } catch (error) {
      console.warn(`Pollinations model ${model} failed`);
    }
  }

  throw new Error("QUOTA_EXCEEDED_DAY");
}

// --- Image generation ---

async function generatePollinationsImage(prompt: string): Promise<string> {
  const cleanPrompt = prompt.replace(/["']/g, '').trim();
  const enhancedPrompt = `A premium photorealistic studio shot of: ${cleanPrompt}. Centered, square composition, professional lighting, sharp focus. No text.`;

  // Try turbo first (faster, more available), then fall back to flux
  const models = ['turbo', 'flux'];

  for (const model of models) {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(enhancedPrompt)}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 1000000)}&model=${model}`;

    console.log(`Fetching Pollinations image (model: ${model}):`, url.substring(0, 100) + "...");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      console.log(`Pollinations ${model} response: ${response.status} ${response.headers.get('content-type')}`);

      if (!response.ok) {
        console.warn(`Pollinations ${model} returned ${response.status}, trying next model...`);
        continue;
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) {
        console.warn(`Pollinations ${model} returned non-image content-type: ${contentType}, trying next model...`);
        continue;
      }

      const blob = await response.blob();
      console.log(`Pollinations ${model} succeeded.`);
      return URL.createObjectURL(blob);
    } catch (err: any) {
      clearTimeout(timeout);
      console.warn(`Pollinations ${model} fetch failed:`, err.message);
      // Continue to next model
    }
  }

  throw new Error("Pollinations image failed on all models");
}

async function generateFalImage(prompt: string): Promise<string> {
  const cleanPrompt = prompt.replace(/["']/g, '').trim();
  const enhancedPrompt = `A premium photorealistic studio shot of: ${cleanPrompt}. Centered, square composition, professional lighting, sharp focus. No text.`;

  console.log("Attempting fal.ai image fallback...");

  // Route through our Vercel function so the fal.ai key stays server-side
  const response = await fetch('/api/image-fal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: enhancedPrompt })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'fal.ai API error' }));
    throw new Error(errorData.error || `fal.ai returned ${response.status}`);
  }

  const data = await response.json();
  if (!data.image) throw new Error("fal.ai returned no image");

  console.log("fal.ai image succeeded.");
  return data.image;
}

export async function generateComparisonImage(prompt: string): Promise<string> {
  let lastError: any = null;

  // 1. Try Gemini via Vercel function
  try {
    const response = await fetch('/api/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });

    if (response.ok) {
      const data = await response.json();
      if (data.image) {
        console.log("Gemini image succeeded.");
        return data.image;
      }
      if (data.fallback) {
        console.warn("Gemini image fallback triggered:", data.error);
        throw new Error(data.error || "GEMINI_FALLBACK");
      }
      throw new Error("Invalid response format");
    }

    const errorData = await response.json().catch(() => ({ error: "Vercel API error" }));
    throw new Error(errorData.error || "Vercel API error");
  } catch (error: any) {
    console.warn("Gemini image failed, trying Pollinations:", error.message);
    lastError = error;
  }

  // 2. Try Pollinations (client-side, turbo then flux)
  try {
    return await generatePollinationsImage(prompt);
  } catch (pollinationsError: any) {
    console.warn("Pollinations image failed, trying fal.ai:", pollinationsError.message);
  }

  // 3. Try fal.ai via Vercel function
  try {
    return await generateFalImage(prompt);
  } catch (falError: any) {
    console.error("fal.ai image fallback failed:", falError.message);
    const errorMessage = (lastError?.message || "").toLowerCase();
    if (errorMessage.includes("exhausted") || errorMessage.includes("daily")) {
      throw new Error("QUOTA_EXCEEDED_DAY");
    }
    throw new Error("QUOTA_EXCEEDED_MINUTE");
  }
}
