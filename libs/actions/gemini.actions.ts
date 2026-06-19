'use server';

import { GoogleGenAI } from '@google/genai';
import { speechToText } from './eleven-labs.actions';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function ask(prompt: string): Promise<string | null> {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      systemInstruction: `
        You're July - AI assisant owned by Cuong.
        You ALWAYS call him "Master".
        Keep the response under 100 words.
        Use simple and clear language.
      `,
    },
  });

  return response.text ?? null;
}

export async function talk(formData: FormData) {
  const prompt = await speechToText(formData);
  if (!prompt) return;

  const answer = await ask(prompt);
  if (!answer) return;

  console.log('[User] asks:', prompt);
  console.log('[July] answers:', answer);

  return answer;
}
