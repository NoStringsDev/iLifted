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
  const prompt = `The user just lifted ${weight} ${unit}. 
  Provide a funny and interesting comparison of ONE SINGLE item that weighs AT MOST ${weight} ${unit} in the category "${category}".
  
  CRITICAL RULES:
  1. You MUST only use ONE single item. Do not add multiple items or fractions.
  2. The item's weight MUST NOT exceed ${weight} ${unit}. It should be as close as possible but under or equal to the limit.
  3. Be creative and funny with the object choice.
  4. Be fast and concise.
  
  Return a JSON object with:
  - "message": A punchy, celebratory message talking TO the user. 
    * USE SECOND PERSON ("You just...", "Look at you...", "You're basically...") or EXCLAMATIONS ("Wow!", "Great Scott!", "Avast!").
    * NEVER use first person ("I just...", "I lifted...").
    * Example: "Holy smokes! You just hoisted a newborn baby elephant like it was a rubber ducky!"
  - "shortDescription": A very short summary, e.g., "a newborn baby elephant".
  - "imagePrompt": A detailed prompt for an image generator showing the item.
  - "objectTag": A single word (lowercase, no spaces) that identifies the object, e.g., "elephant" or "vespa".
  - "items": A list containing only that one item.`;

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
      // If it's a 503 or 429, wait and retry
      if (error.message?.includes("503") || error.message?.includes("429") || error.message?.includes("UNAVAILABLE")) {
        await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error("Failed to get comparison after retries");
}

export async function generateComparisonImage(prompt: string): Promise<string> {
  const ai = getAIClient();
  const maxRetries = 2;
  let lastError: any = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents: {
          parts: [{ text: `A high-quality, photorealistic studio shot of: ${prompt}. Professional product photography, clean solid light gray background, sharp focus, natural lighting, highly detailed, 8k resolution, no text.` }]
        },
        config: {
          imageConfig: {
            aspectRatio: "1:1",
          }
        }
      });

      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          return `data:image/png;base64,${part.inlineData.data}`;
        }
      }
    } catch (error: any) {
      lastError = error;
      if (error.message?.includes("503") || error.message?.includes("UNAVAILABLE")) {
        await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
        continue;
      }
      throw error;
    }
  }
  
  throw lastError || new Error("Failed to generate image");
}
