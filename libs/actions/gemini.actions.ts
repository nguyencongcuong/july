'use server';

import { GoogleGenAI } from '@google/genai';
import { speechToText, textToSpeech } from './eleven-labs.actions';

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

interface TalkResult {
  transcript: string;
  answer: string;
  audioDataUrl: string;
}

export async function talk(formData: FormData): Promise<TalkResult | null> {
  const transcript = await speechToText(formData);
  if (!transcript) return null;

  const answer = await ask(transcript);
  if (!answer) return null;

  const audioDataUrl = await textToSpeech(answer);
  if (!audioDataUrl) return null;

  console.log('[User] asks:', transcript);
  console.log('[July] answers:', answer);

  return { transcript, answer, audioDataUrl };
}
