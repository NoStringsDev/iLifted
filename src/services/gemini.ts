import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

const getAIClient = () => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || "";
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing. Please set it in your environment variables.");
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
    ? "ANYTHING AT ALL (the more bizarre, obscure, or unexpected, the better). AVOID generic nature/animals unless they are extremely weird. Think: obscure tech, specific food items, pop culture props, weird museum artifacts, or abstract but weighable things."
    : `the category "${category}"`;

  const prompt = `The user just lifted ${weight} ${unit}. 
  Provide a funny and interesting comparison of ONE SINGLE item that weighs AT MOST ${weight} ${unit} in ${categoryPrompt}.
  
  CRITICAL RULES:
  1. You MUST only use ONE single item. Do not add multiple items or fractions.
  2. The item's weight MUST NOT exceed ${weight} ${unit}. It should be as close as possible but under or equal to the limit.
  3. NEVER mention the weight (kg, lbs, etc.) or any numbers in the "message" or "shortDescription". The comparison should be purely descriptive. (e.g., "a giant sack of potatoes" NOT "120 lbs of potatoes").
  4. Be creative and funny with the object choice.
  5. ${isSurprise ? "For 'Surprise Me', lean into the weird and wonderful. ACTIVELY AVOID common animals or nature. Think: 'a vintage 1980s arcade cabinet', 'a giant wheel of aged parmesan', 'a full-sized replica of a sci-fi helmet', etc." : "Be fast and concise."}
  6. Return a JSON object with:
  - "message": A punchy, celebratory message talking TO the user. 
  - "shortDescription": The name of the item ONLY.
  - "imagePrompt": A detailed prompt for an image generator showing the item.
  - "objectTag": A single word (lowercase, no spaces) that identifies the object.
  - "items": A list containing only that one item.
  
  7. SAFETY: Family-friendly only.`;

  try {
    const ai = getAIClient();
    const maxRetries = 2;

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
        const errorMessage = (error.message || "").toLowerCase();
        // If it's a quota issue, break and go to fallback immediately
        if (errorMessage.includes("exhausted") || errorMessage.includes("daily") || errorMessage.includes("429")) {
          break;
        }
        // For other errors, wait a bit and retry once
        if (i < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
      }
    }
  } catch (initError) {
    console.warn("Gemini initialization failed, jumping to fallback:", initError);
  }

  // If we reach here, Gemini failed or was skipped
  return await getWeightComparisonFallback(weight, unit, category);
}

async function getWeightComparisonFallback(weight: number, unit: string, category: string): Promise<ComparisonResult> {
  console.warn("Gemini text generation failed, switching to Pollinations fallback chain...");
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

  // Try multiple models in sequence if one fails
  const models = ['openai', 'mistral', 'searchgpt'];
  
  for (const model of models) {
    try {
      const response = await fetch('https://text.pollinations.ai/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: 'You are a JSON-only response bot. No conversational text.' },
            { role: 'user', content: prompt }
          ],
          model: model,
          json: true,
          seed: Math.floor(Math.random() * 1000000)
        })
      });

      if (!response.ok) continue;
      const text = await response.text();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;
      
      const parsed = JSON.parse(jsonMatch[0]) as ComparisonResult;
      if (parsed.message && parsed.shortDescription) return parsed;
    } catch (error) {
      console.warn(`Pollinations model ${model} failed, trying next...`);
    }
  }
  
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
  const ai = getAIClient();
  const maxRetries = 1; 
  let lastError: any = null;

  // Try Gemini first (Higher quality)
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
