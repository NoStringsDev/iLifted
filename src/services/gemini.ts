export interface ComparisonResult {
  message: string;
  shortDescription: string;
  imagePrompt: string;
  objectTag: string;
  items: string[];
  isFallback?: boolean;
}

export async function getWeightComparison(weight: number, unit: string, category: string): Promise<ComparisonResult> {
  try {
    const response = await fetch('/api/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weight, unit, category })
    });

    if (response.ok) {
      const data = await response.json();
      if (data.fallback) {
        console.warn("Gemini suggested fallback:", data.error);
        throw new Error(data.error || "GEMINI_FALLBACK");
      }
      return { ...data, isFallback: false };
    }
    
    const errorData = await response.json().catch(() => ({ error: "Vercel API error" }));
    console.warn("Vercel API error:", errorData.error);
  } catch (err) {
    console.warn("Vercel API call failed, jumping to fallback");
  }

  const result = await getWeightComparisonFallback(weight, unit, category);
  return { ...result, isFallback: true };
}

async function getWeightComparisonFallback(weight: number, unit: string, category: string): Promise<ComparisonResult> {
  console.warn("Gemini unavailable. Entering Pollinations.ai Fallback Mode...");
  
  const prompt = `The user lifted ${weight} ${unit}. Provide a funny comparison of ONE item weighing AT MOST ${weight} ${unit} in category ${category}. Return ONLY a JSON object: {"message": "msg", "shortDescription": "item", "imagePrompt": "prompt", "objectTag": "tag", "items": ["item"]}`;

  // Use only the most stable models, not all 7 at once
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

      const parsed = JSON.parse(text.substring(firstBrace, lastBrace + 1)) as ComparisonResult;
      if (parsed.message && parsed.shortDescription) {
        return parsed;
      }
    } catch (error) {
      console.warn(`Pollinations model ${model} failed`);
    }
  }

  // Nothing worked - tell the user to wait rather than give them a bad experience
  throw new Error("QUOTA_EXCEEDED_DAY");
}

async function generatePollinationsImage(prompt: string): Promise<string> {
  const cleanPrompt = prompt.replace(/["']/g, '').trim();
  const enhancedPrompt = `A premium photorealistic studio shot of: ${cleanPrompt}. Centered, square composition, professional lighting, sharp focus. No text.`;
  
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(enhancedPrompt)}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 1000000)}&model=flux`;
  
  // Verify the image actually loads before returning the URL
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (response.ok) {
      return url;
    }
    throw new Error("Pollinations image failed to load");
  } catch (err) {
    console.error("Pollinations verification failed:", err);
    throw new Error("IMAGE_TIMEOUT");
  }
}

export async function generateComparisonImage(prompt: string): Promise<string> {
  let lastError: any = null;

  // Try Gemini via Vercel Function first (Higher quality)
  try {
    const response = await fetch('/api/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });

    if (response.ok) {
      const data = await response.json();
      if (data.image) return data.image;
      if (data.fallback) {
        console.warn("Gemini suggested fallback:", data.error);
        throw new Error(data.error || "GEMINI_FALLBACK");
      }
      throw new Error("Invalid response format");
    }
    
    // If response is not ok
    const errorData = await response.json().catch(() => ({ error: "Vercel API error" }));
    throw new Error(errorData.error || "Vercel API error");
  } catch (error: any) {
    console.warn("Gemini image generation failed or blocked, switching to Pollinations fallback:", error.message);
    lastError = error;
  }
  
  // Fallback to Pollinations (Always available)
  try {
    return await generatePollinationsImage(prompt);
  } catch (fallbackError) {
    console.error("Fallback also failed:", fallbackError);
    const errorMessage = (lastError?.message || "").toLowerCase();
    if (errorMessage.includes("exhausted") || errorMessage.includes("daily")) {
      throw new Error("QUOTA_EXCEEDED_DAY");
    }
    throw new Error("QUOTA_EXCEEDED_MINUTE");
  }
}
