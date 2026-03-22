import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

let runtimeApiKey: string | null = null;

const getAIClient = async () => {
  // 1. Try environment variables (bundled at build time)
  let apiKey = import.meta.env.VITE_GEMINI_API_KEY || (typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : "") || "";
  
  // 2. If not found, try the runtime key we fetched
  if (!apiKey && runtimeApiKey) {
    apiKey = runtimeApiKey;
  }

  // 3. If still not found, try to fetch it from the server (runtime)
  if (!apiKey) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout for config
      
      const response = await fetch('/api/config', { signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.ok) {
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const config = await response.json();
          if (config.geminiApiKey) {
            runtimeApiKey = config.geminiApiKey;
            apiKey = runtimeApiKey;
          }
        } else {
          console.warn("Config endpoint returned non-JSON response. Server might not be running in full-stack mode.");
        }
      }
    } catch (e) {
      console.warn("Failed to fetch runtime config:", e);
    }
  }
  
  if (!apiKey) {
    console.warn("Gemini API key is missing. App will run in Fallback Mode.");
    return null;
  }
  return new GoogleGenAI({ apiKey });
};

export interface ComparisonResult {
  message: string;
  shortDescription: string;
  imagePrompt: string;
  objectTag: string;
  items: string[];
}

export async function getWeightComparison(weight: number, unit: string, category: string): Promise<ComparisonResult> {
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

  try {
    const ai = await getAIClient();
    if (ai) {
      const maxRetries = 1; // Fast retry for Gemini
      for (let i = 0; i < maxRetries; i++) {
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
                  items: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                  }
                },
                required: ["message", "shortDescription", "imagePrompt", "objectTag", "items"]
              }
            }
          });

          const parsed = JSON.parse(response.text || "{}") as ComparisonResult;
          if (parsed.message && parsed.shortDescription) return parsed;
        } catch (error: any) {
          console.warn("Gemini attempt failed:", error.message);
          break; // Go to fallback immediately on any Gemini error
        }
      }
    }
  } catch (err) {
    console.warn("Gemini system error, jumping to fallback");
  }

  return await getWeightComparisonFallback(weight, unit, category);
}

async function getWeightComparisonFallback(weight: number, unit: string, category: string): Promise<ComparisonResult> {
  console.warn("Entering Fallback Mode...");
  
  const prompt = `The user lifted ${weight} ${unit}. Provide a funny comparison of ONE item weighing AT MOST ${weight} ${unit} in category ${category}. Return ONLY JSON: {"message": "msg", "shortDescription": "item", "imagePrompt": "prompt", "objectTag": "tag", "items": ["item"]}`;

  // Try multiple models via GET (more robust for CORS/Vercel)
  const models = ['openai', 'mistral', 'searchgpt'];
  
  for (const model of models) {
    try {
      const url = `https://text.pollinations.ai/${encodeURIComponent(prompt)}?model=${model}&json=true&seed=${Math.floor(Math.random() * 1000000)}`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout per model
      
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) continue;
      const text = await response.text();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;
      
      const parsed = JSON.parse(jsonMatch[0]) as ComparisonResult;
      if (parsed.message && parsed.shortDescription) return parsed;
    } catch (error) {
      console.warn(`Fallback model ${model} failed:`, error);
    }
  }
  
  // If we reach here, all AI models (Gemini + Fallbacks) have failed
  console.error("All AI models failed to respond.");
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
  const ai = await getAIClient();
  const maxRetries = 1; 
  let lastError: any = null;

  // Try Gemini first (Higher quality)
  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents: {
          parts: [{ text: `A premium yet playful, high-quality photorealistic studio shot of: ${prompt}. The image should have a centered, square composition with a subtle gym or weightlifting flavor, using professional lighting and sharp focus. Feel free to be playful with the background, incorporating fitness-themed elements in visually engaging ways to give the subject an athletic presence. No text.` }]
        },
        config: {
          imageConfig: {
            aspectRatio: "1:1",
          }
        }
      });

      const candidate = response.candidates?.[0];
      if (candidate?.finishReason === 'SAFETY') {
        console.warn("Gemini image generation blocked by safety filters, falling back to Pollinations");
      } else {
        for (const part of candidate?.content?.parts || []) {
          if (part.inlineData) {
            return `data:image/png;base64,${part.inlineData.data}`;
          }
        }
      }
      
      throw new Error("No image data found or blocked by safety");
    } catch (error: any) {
      console.warn("Gemini image generation failed or blocked, switching to Pollinations fallback:", error.message);
      lastError = error;
    }
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
