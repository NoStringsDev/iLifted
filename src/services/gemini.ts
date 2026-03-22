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

  // Expanded list of models to try
  const models = ['openai', 'mistral', 'searchgpt', 'p1', 'llama', 'qwen', 'gemini'];
  
  for (const model of models) {
    try {
      // Try with json=true first
      let url = `https://text.pollinations.ai/${encodeURIComponent(prompt)}?model=${model}&json=true&seed=${Math.floor(Math.random() * 1000000)}`;
      
      let response = await fetch(url);
      
      // If rate limited, wait 1 second and try WITHOUT json=true (often has different limits)
      if (response.status === 429) {
        console.warn(`Model ${model} rate limited. Retrying without JSON flag...`);
        await new Promise(r => setTimeout(r, 1000));
        url = `https://text.pollinations.ai/${encodeURIComponent(prompt)}?model=${model}&seed=${Math.floor(Math.random() * 1000000)}`;
        response = await fetch(url);
      }

      if (!response.ok) {
        console.warn(`Fallback model ${model} failed with status ${response.status}`);
        continue;
      }

      const text = await response.text();
      if (!text || text.length < 10) continue;
      
      // More aggressive JSON extraction
      const firstBrace = text.indexOf('{');
      const lastBrace = text.lastIndexOf('}');
      
      if (firstBrace === -1 || lastBrace === -1) {
        console.warn(`Fallback model ${model} returned no JSON structure`);
        continue;
      }

      const jsonString = text.substring(firstBrace, lastBrace + 1);
      
      try {
        const parsed = JSON.parse(jsonString) as ComparisonResult;
        if (parsed.message && parsed.shortDescription) {
          console.log(`Successfully recovered using ${model} fallback!`);
          return parsed;
        }
      } catch (parseErr) {
        console.warn(`Failed to parse JSON from ${model}`);
      }
    } catch (error) {
      console.warn(`Fallback model ${model} failed`);
    }
  }
  
  console.error("CRITICAL: All AI models (Gemini + 7 Fallbacks) have failed.");
  throw new Error("QUOTA_EXCEEDED_DAY");
}

async function generatePollinationsImage(prompt: string): Promise<string> {
  const cleanPrompt = prompt.replace(/["']/g, '').trim();
  const enhancedPrompt = `A premium photorealistic studio shot of: ${cleanPrompt}. Centered, square composition, professional lighting, sharp focus. No text.`;
  
  // Return the URL directly. The browser's <img> tag is more resilient than fetch() for images.
  // We add a random seed to bypass any cached "error" images.
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(enhancedPrompt)}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 1000000)}&model=flux`;
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
