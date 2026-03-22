import { GoogleGenAI } from "@google/genai";
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt } = req.body;
  const customKey = process.env.CUSTOM_GEMINI_KEY;
  const defaultKey = process.env.GEMINI_API_KEY;
  const apiKey = customKey || defaultKey;

  console.log(`Image Request - Key Source: ${customKey ? 'CUSTOM_SECRET' : 'DEFAULT_MANAGED'}`);

  if (!apiKey) {
    return res.status(200).json({ error: 'No API key configured', fallback: true });
  }

  const ai = new GoogleGenAI({ apiKey });

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
      return res.status(200).json({ error: 'SAFETY_BLOCKED', fallback: true });
    }

    for (const part of candidate?.content?.parts || []) {
      if (part.inlineData) {
        return res.status(200).json({ image: `data:image/png;base64,${part.inlineData.data}` });
      }
    }
    
    return res.status(200).json({ error: 'No image data generated', fallback: true });
  } catch (error: any) {
    let errorMessage = error.message;
    try {
      // If error.message is a JSON string (common with GenAI SDK)
      const parsed = JSON.parse(error.message);
      errorMessage = parsed.error?.message || error.message;
    } catch (e) {
      // Not JSON, use as is
    }

    console.error("Gemini Image Error:", errorMessage);
    
    const isQuota = errorMessage?.toLowerCase().includes('quota') || 
                    errorMessage?.toLowerCase().includes('exhausted') ||
                    errorMessage?.toLowerCase().includes('429');
    
    return res.status(200).json({ 
      error: isQuota ? 'QUOTA_EXCEEDED' : errorMessage, 
      fallback: true 
    });
  }
}
