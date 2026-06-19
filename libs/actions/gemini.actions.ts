'use server';

import { GoogleGenAI } from '@google/genai';
import { speechToText, textToSpeech } from './eleven-labs.actions';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface ChatMessage {
  role: string;
  parts: { text: string }[];
}

export async function ask(prompt: string, history: ChatMessage[] = []): Promise<string | null> {
  const chat = ai.chats.create({
    model: 'gemini-2.5-flash',
    history: history,
    config: {
      systemInstruction: `
        **IDENTITY**:
        - You're July - AI assisant owned by Cuong.
        - You ALWAYS call him "Master".

        **ABOUT MASTER**:
        - His name is Cuong.
        - He's your owner.
        - Birthday: Junly 19, 1993
        - Birthsign: Cancer
        - He's working as a software engineer.
        
        **FAMILY**:
        - He has a poodle dog named Nấm (Mushroom). Nấm is a female dog, born in Apirl, 13. 2026.
        
        **PURPOSES**:
        - Make Cuong always feel happy, warm and joyful.
        - Make Cuong always feel respected and valued.
        
        **GUIDELINES**
        - Use simple and clear language.
        - Be a good listener and ask follow-up questions.
        - Be a good friend and companion.
        - Provide insights that are helpful and relevant to the user's needs.
        - Provide information that is accurate and up-to-date.
        - Provide information that is easy to understand and apply.
        
        **LIMITATIONS**
        - Keep the response under 100 words.
        - Don't repeat the same information.
        - Don't repeat the same questions.
        - Don't repeat the same answers.
        - Don't repeat the same insights.
      `,
      thinkingConfig: {
        includeThoughts: true,
      },
      tools: [{ googleSearch: {} }],
    },
  });

  const response = await chat.sendMessage({
    message: prompt,
  });

  const chatHistory = chat.getHistory();

  console.log(chatHistory);

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

  const historyStr = formData.get('history') as string;
  let history: ChatMessage[] = [];
  try {
    if (historyStr) {
      const parsed = JSON.parse(historyStr);
      if (Array.isArray(parsed)) {
        history = parsed.map((msg: { role: string; text: string }) => ({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.text }],
        }));
      }
    }
  } catch (err) {
    console.error('Failed to parse chat history:', err);
  }

  const answer = await ask(transcript, history);
  if (!answer) return null;

  const muteSpeech = formData.get('muteSpeech') === 'true';
  const audioDataUrl = muteSpeech ? '' : ((await textToSpeech(answer)) ?? '');

  console.log('[User] asks:', transcript);
  console.log('[July] answers:', answer);

  return { transcript, answer, audioDataUrl };
}
