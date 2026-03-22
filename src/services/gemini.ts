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
  const ai = getAIClient();
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
    * USE SECOND PERSON ("You just...", "Look at you...", "You're basically...") or EXCLAMATIONS ("Wow!", "Great Scott!", "Avast!").
    * NEVER use first person ("I just...", "I lifted...").
    * NEVER include the weight or numbers in this message.
    * Example: "Holy smokes! You just hoisted a newborn baby elephant like it was a rubber ducky!"
  - "shortDescription": The name of the item ONLY, e.g., "A newborn baby elephant". No extra words like "That's like lifting...". Just the item name.
  - "imagePrompt": A detailed prompt for an image generator showing the item. Ensure the prompt describes a centered, square-composition subject.
  - "objectTag": A single word (lowercase, no spaces) that identifies the object, e.g., "elephant" or "vespa".
  - "items": A list containing only that one item.
  
  7. SAFETY & APPROPRIATENESS: 
     * The item MUST be family-friendly, non-violent, and appropriate for all audiences.
     * AVOID items that could be misinterpreted by image safety filters (e.g., avoid weapons, drug-related items, or suggestive shapes).
     * If a chosen item feels "borderline," pick something more clearly wholesome instead.`;

  const maxRetries = 3;
  let lastError: any = null;

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

      return JSON.parse(response.text || "{}") as ComparisonResult;
    } catch (error: any) {
      lastError = error;
      const errorMessage = error.message || "";
      // If it's a 503 or 429, wait and retry
      if (errorMessage.includes("503") || errorMessage.includes("429") || errorMessage.includes("UNAVAILABLE")) {
        // If it's a quota issue, try fallback
        if (errorMessage.toLowerCase().includes("exhausted") || errorMessage.toLowerCase().includes("daily")) {
          return await getWeightComparisonFallback(weight, unit, category);
        }
        await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
        continue;
      }
      // For other errors, try fallback before giving up
      return await getWeightComparisonFallback(weight, unit, category);
    }
  }

  return await getWeightComparisonFallback(weight, unit, category);
}

async function getWeightComparisonFallback(weight: number, unit: string, category: string): Promise<ComparisonResult> {
  console.warn("Gemini text generation failed or quota exceeded, switching to Pollinations fallback");
  const isSurprise = category === 'surprise me';
  const categoryPrompt = isSurprise 
    ? "ANYTHING AT ALL (the more bizarre, obscure, or unexpected, the better). AVOID generic nature/animals unless they are extremely weird."
    : `the category "${category}"`;

  const prompt = `The user just lifted ${weight} ${unit}. 
  Provide a funny and interesting comparison of ONE SINGLE item that weighs AT MOST ${weight} ${unit} in ${categoryPrompt}.
  
  RULES:
  1. Use ONLY ONE single item.
  2. Weight MUST NOT exceed ${weight} ${unit}.
  3. NEVER mention weights/numbers in "message" or "shortDescription".
  4. Return ONLY a JSON object:
  {
    "message": "Punchy celebratory message TO the user (2nd person)",
    "shortDescription": "The name of the item ONLY (e.g. 'A baby elephant')",
    "imagePrompt": "Detailed prompt for an image generator (centered, square composition)",
    "objectTag": "singlewordtag",
    "items": ["item name"]
  }
  5. Safety: Family-friendly only.
  
  Return ONLY the JSON.`;

  try {
    const response = await fetch('https://text.pollinations.ai/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        model: 'openai',
        json: true
      })
    });

    if (!response.ok) throw new Error("Pollinations text fallback failed");
    const text = await response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Invalid JSON from fallback");
    return JSON.parse(jsonMatch[0]) as ComparisonResult;
  } catch (error) {
    console.error("Pollinations text fallback also failed:", error);
    throw new Error("QUOTA_EXCEEDED_DAY");
  }
}

async function generatePollinationsImage(prompt: string): Promise<string> {
  // Clean the prompt to remove any characters that might break the URL
  const cleanPrompt = prompt.replace(/["']/g, '').trim();
  const enhancedPrompt = `A premium yet playful, high-quality photorealistic studio shot of: ${cleanPrompt}. The image should have a centered, square composition with a subtle gym or weightlifting flavor, using professional lighting and sharp focus. Feel free to be playful with the background, incorporating fitness-themed elements in visually engaging ways to give the subject an athletic presence. No text.`;
  
  // Use a fixed width/height that is known to work well
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(enhancedPrompt)}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 1000000)}`;
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
