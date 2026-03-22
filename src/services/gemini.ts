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
  - "shortDescription": A very short summary, e.g., "a newborn baby elephant". NEVER include weights or numbers here.
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
      const errorMessage = error.message || "";
      // If it's a 503 or 429, wait and retry
      if (errorMessage.includes("503") || errorMessage.includes("429") || errorMessage.includes("UNAVAILABLE")) {
        // If it's a quota issue, we might want to throw immediately if it's the daily one, 
        // but for RPM we should retry.
        if (errorMessage.toLowerCase().includes("exhausted") || errorMessage.toLowerCase().includes("daily")) {
          throw new Error("QUOTA_EXCEEDED_DAY");
        }
        await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error("Failed to get comparison after retries");
}

async function generatePollinationsImage(prompt: string): Promise<string> {
  const enhancedPrompt = `${prompt}, high quality, photorealistic, studio shot, clean gray background, sharp focus`;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(enhancedPrompt)}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 1000000)}`;
  
  const response = await fetch(url);
  if (!response.ok) throw new Error("Pollinations fallback failed");
  
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function generateComparisonImage(prompt: string): Promise<string> {
  const ai = getAIClient();
  const maxRetries = 2;
  let lastError: any = null;

  // Try Gemini first (Higher quality)
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents: {
          parts: [{ text: `A high-quality, photorealistic studio shot of: ${prompt}. The subject should have a subtle athletic or powerful stance, professional product photography, clean solid light gray background, sharp focus, natural lighting, highly detailed, 8k resolution, no text.` }]
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
      
      throw new Error("No image data found in response");
    } catch (error: any) {
      lastError = error;
      const errorMessage = error.message || "";
      
      // If it's a quota issue, break the loop and try the fallback immediately
      if (errorMessage.includes("429") || errorMessage.includes("quota") || errorMessage.includes("Too Many Requests") || errorMessage.includes("exhausted")) {
        console.warn("Gemini quota hit, switching to Pollinations fallback...");
        break; 
      }

      if (errorMessage.includes("503") || errorMessage.includes("UNAVAILABLE")) {
        await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
        continue;
      }
      throw error;
    }
  }
  
  // Fallback to Pollinations (High availability)
  try {
    return await generatePollinationsImage(prompt);
  } catch (fallbackError) {
    // If fallback also fails, throw the original quota error so the UI shows the gym message
    const errorMessage = lastError?.message || "";
    if (errorMessage.toLowerCase().includes("exhausted") || errorMessage.toLowerCase().includes("daily")) {
      throw new Error("QUOTA_EXCEEDED_DAY");
    }
    throw new Error("QUOTA_EXCEEDED_MINUTE");
  }
}
