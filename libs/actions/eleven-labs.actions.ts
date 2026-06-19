'use server';

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

const JULY_VOICE_ID = 'aEO01A4wXwd1O8GPgGlF';

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

export async function textToSpeech(text: string): Promise<string | null> {
  try {
    const audioStream = await elevenlabs.textToSpeech.convert(JULY_VOICE_ID, {
      text,
      modelId: 'eleven_turbo_v2_5', // lowest latency model; good quality for short responses
      outputFormat: 'mp3_44100_128',
      voiceSettings: {
        stability: 0.5,
        similarityBoost: 0.75,
        style: 0.3,
        useSpeakerBoost: true,
      },
    });

    // Collect the ReadableStream<Uint8Array> into a single Buffer.
    // Cannot use for-await-of: DOM's ReadableStream lacks Symbol.asyncIterator in TS types.
    const reader = audioStream.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const buffer = Buffer.concat(chunks);

    // Return as a base64 data URL — safe to pass from server action to client
    return `data:audio/mpeg;base64,${buffer.toString('base64')}`;
  } catch (error) {
    console.error('[july] textToSpeech error:', error);
    return null;
  }
}
