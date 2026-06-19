'use server';

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

export async function speechToText(formData: FormData): Promise<string | null> {
  const audioFile = formData.get('audio');

  if (!(audioFile instanceof File) || audioFile.size === 0) {
    console.error('[july] speechToText: no valid audio file received');
    return null;
  }

  try {
    const response = await elevenlabs.speechToText.convert({
      file: audioFile,
      modelId: 'scribe_v2',
      languageCode: 'en', // force English — avoids auto-detect misidentifying the language
      keyterms: ['July'],
    });

    return response.text ?? null;
  } catch (error) {
    console.error('[july] speechToText error:', error);
    return null;
  }
}
