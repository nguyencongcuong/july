'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { talk, talkText } from '../actions/gemini.actions';

// ─── Types ────────────────────────────────────────────────────────────────────

type MicStatus = 'idle' | 'requesting' | 'active' | 'denied';

interface AudioFrame {
  timestamp: number;
  volume: number;
  peak: number;
  isSpeaking: boolean;
}

interface GroundingSource {
  title: string;
  uri: string;
}

interface Message {
  role: 'user' | 'july';
  text: string;
  sources?: GroundingSource[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SPEAKING_THRESHOLD = 10;
const FFT_SIZE = 256;
const STOP_DEBOUNCE_MS = 2000;
const MIN_RECORDING_MS = 300;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function typedArrayMax(arr: Uint8Array): number {
  let max = 0;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > max) max = arr[i];
  }
  return max;
}

// ─── July Component ───────────────────────────────────────────────────────────

export default function July() {
  const [micStatus, setMicStatus] = useState<MicStatus>('idle');
  const [volume, setVolume] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [inputText, setInputText] = useState('');

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;

  const playbackSpeedRef = useRef(playbackSpeed);
  playbackSpeedRef.current = playbackSpeed;

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const prevSpeakingRef = useRef<boolean>(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const stopDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingStartRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // ── Teardown ───────────────────────────────────────────────────────────────

  const teardown = useCallback(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (stopDebounceRef.current !== null) {
      clearTimeout(stopDebounceRef.current);
      stopDebounceRef.current = null;
    }
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    recordingStartRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => {
      t.stop();
    });
    streamRef.current = null;
  }, []);

  // ── Recording ──────────────────────────────────────────────────────────────

  const startRecording = useCallback(() => {
    if (!streamRef.current || mediaRecorderRef.current?.state === 'recording') return;

    if (stopDebounceRef.current !== null) {
      clearTimeout(stopDebounceRef.current);
      stopDebounceRef.current = null;
    }

    audioChunksRef.current = [];
    recordingStartRef.current = Date.now();

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    const recorder = new MediaRecorder(streamRef.current, { mimeType });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };
    mediaRecorderRef.current = recorder;
    recorder.start(100);
  }, []);

  const stopRecordingAndTranscribe = useCallback(() => {
    if (stopDebounceRef.current !== null) clearTimeout(stopDebounceRef.current);

    stopDebounceRef.current = setTimeout(async () => {
      stopDebounceRef.current = null;
      const recorder = mediaRecorderRef.current;
      // biome-ignore lint/complexity/useOptionalChain: explicit null guard is intentional for clarity
      if (!recorder || recorder.state !== 'recording') return;

      const elapsed = recordingStartRef.current ? Date.now() - recordingStartRef.current : 0;
      if (elapsed < MIN_RECORDING_MS) return;

      await new Promise<void>((resolve) => {
        let stopFired = false;
        let dataFired = false;
        const maybeResolve = () => {
          if (stopFired && dataFired) resolve();
        };
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
          dataFired = true;
          maybeResolve();
        };
        recorder.onstop = () => {
          stopFired = true;
          maybeResolve();
        };
        recorder.stop();
      });

      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      audioChunksRef.current = [];
      recordingStartRef.current = null;
      if (blob.size === 0) return;

      const formData = new FormData();
      formData.append('audio', blob, 'speech.webm');
      formData.append('muteSpeech', isMutedRef.current ? 'true' : 'false');
      formData.append('history', JSON.stringify(messagesRef.current));

      setIsProcessing(true);
      const result = await talk(formData);
      setIsProcessing(false);

      if (result) {
        console.log('[User] asks:', result.transcript);
        console.log('[July] answers:', result.answer);

        setMessages((prev) => [
          ...prev,
          { role: 'user', text: result.transcript },
          { role: 'july', text: result.answer, sources: result.sources },
        ]);

        if (!isMutedRef.current && result.audioDataUrl && audioCtxRef.current) {
          const ctx = audioCtxRef.current;
          const base64 = result.audioDataUrl.split(',')[1];
          const binaryStr = atob(base64);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }

          const audioBuffer = await ctx.decodeAudioData(bytes.buffer as ArrayBuffer);
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.playbackRate.value = playbackSpeedRef.current;
          source.connect(ctx.destination);

          setIsResponding(true);
          source.onended = () => setIsResponding(false);
          source.start();
        }
      }
    }, STOP_DEBOUNCE_MS);
  }, []);

  const handlePrompt = useCallback(
    async (promptText: string) => {
      if (isProcessing || isResponding) return;

      setMessages((prev) => [...prev, { role: 'user', text: promptText }]);

      setIsProcessing(true);
      const result = await talkText(promptText, messagesRef.current, isMutedRef.current);
      setIsProcessing(false);

      if (result) {
        setMessages((prev) => [
          ...prev,
          { role: 'july', text: result.answer, sources: result.sources },
        ]);

        if (!isMutedRef.current && result.audioDataUrl) {
          try {
            if (!audioCtxRef.current) {
              audioCtxRef.current = new AudioContext();
            }
            const ctx = audioCtxRef.current;
            if (ctx.state === 'suspended') {
              await ctx.resume();
            }
            const base64 = result.audioDataUrl.split(',')[1];
            const binaryStr = atob(base64);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
              bytes[i] = binaryStr.charCodeAt(i);
            }

            const audioBuffer = await ctx.decodeAudioData(bytes.buffer as ArrayBuffer);
            const source = ctx.createBufferSource();
            source.buffer = audioBuffer;
            source.playbackRate.value = playbackSpeedRef.current;
            source.connect(ctx.destination);

            setIsResponding(true);
            source.onended = () => setIsResponding(false);
            source.start();
          } catch (err) {
            console.error('[july] audio playback error:', err);
          }
        }
      }
    },
    [isProcessing, isResponding]
  );

  // ── Audio loop ─────────────────────────────────────────────────────────────

  const startAudioLoop = useCallback(
    (ctx: AudioContext, stream: MediaStream) => {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteTimeDomainData(dataArray);

        let sumOfSquares = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const normalized = (dataArray[i] - 128) / 128;
          sumOfSquares += normalized * normalized;
        }
        const rms = Math.sqrt(sumOfSquares / dataArray.length);
        const vol = Math.round(rms * 100);
        const peak = typedArrayMax(dataArray);
        const speaking = vol > SPEAKING_THRESHOLD;

        if (speaking !== prevSpeakingRef.current) {
          prevSpeakingRef.current = speaking;
          const frame: AudioFrame = {
            timestamp: Date.now(),
            volume: vol,
            peak,
            isSpeaking: speaking,
          };
          console.log('[july] audio frame:', frame);
          if (speaking) startRecording();
          else stopRecordingAndTranscribe();
        }

        setVolume(vol);
        setIsSpeaking(speaking);
        animFrameRef.current = requestAnimationFrame(tick);
      };

      animFrameRef.current = requestAnimationFrame(tick);
    },
    [startRecording, stopRecordingAndTranscribe]
  );

  // ── Mic request ────────────────────────────────────────────────────────────

  const requestMic = useCallback(async () => {
    teardown();
    setMicStatus('requesting');
    try {
      const ctx = new AudioContext();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      audioCtxRef.current = ctx;
      streamRef.current = stream;
      setMicStatus('active');
      startAudioLoop(ctx, stream);
    } catch {
      setMicStatus('denied');
    }
  }, [teardown, startAudioLoop]);

  useEffect(() => {
    return teardown;
  }, [teardown]);

  // ── Derived state ──────────────────────────────────────────────────────────

  const ringScale = 1 + (volume / 100) * 0.55;
  const orbMode = isProcessing
    ? 'processing'
    : isResponding
      ? 'responding'
      : isSpeaking
        ? 'speaking'
        : micStatus === 'active'
          ? 'standby'
          : micStatus;

  const taglines: Record<string, string> = {
    idle: 'Tap to wake me up',
    requesting: 'Requesting microphone…',
    standby: 'Standby — say something',
    speaking: "I'm listening…",
    processing: 'Thinking',
    responding: 'Speaking…',
    denied: 'Microphone access denied',
    active: 'Standby — say something',
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@200;300;400&display=swap');

        /* ── aurora background ── */
        @keyframes aurora-1 {
          0%,100% { transform: translate(0,0) scale(1);   opacity:.18; }
          50%      { transform: translate(80px,60px) scale(1.15); opacity:.28; }
        }
        @keyframes aurora-2 {
          0%,100% { transform: translate(0,0) scale(1.1); opacity:.14; }
          50%      { transform: translate(-60px,80px) scale(.9); opacity:.22; }
        }
        @keyframes aurora-3 {
          0%,100% { transform: translate(0,0) scale(.95); opacity:.12; }
          50%      { transform: translate(40px,-70px) scale(1.1); opacity:.2; }
        }

        /* ── orb breathing ── */
        @keyframes orb-breathe {
          0%,100% { transform:scale(1);    filter:brightness(1); }
          50%      { transform:scale(1.06); filter:brightness(1.2); }
        }
        @keyframes orb-breathe-amber {
          0%,100% { transform:scale(1);    filter:brightness(1); }
          50%      { transform:scale(1.08); filter:brightness(1.25); }
        }
        @keyframes orb-breathe-green {
          0%,100% { transform:scale(1);    filter:brightness(1); }
          50%      { transform:scale(1.07); filter:brightness(1.2); }
        }

        /* ── rings ── */
        @keyframes ring-breathe {
          0%,100% { transform:scale(1.05); opacity:.1; }
          50%      { transform:scale(1.25); opacity:.32; }
        }
        @keyframes ring-breathe-amber {
          0%,100% { transform:scale(1.05); opacity:.12; }
          50%      { transform:scale(1.32); opacity:.42; }
        }
        @keyframes ring-breathe-green {
          0%,100% { transform:scale(1.05); opacity:.12; }
          50%      { transform:scale(1.28); opacity:.38; }
        }

        /* ── thinking dots ── */
        @keyframes thinking-dot {
          0%,80%,100% { opacity:.2; transform:translateY(0); }
          40%         { opacity:1;  transform:translateY(-4px); }
        }

        /* ── speaking bars ── */
        @keyframes speaking-bar {
          0%,100% { transform:scaleY(.4); opacity:.6; }
          50%     { transform:scaleY(1);  opacity:1; }
        }

        /* ── message fade ── */
        @keyframes msg-in {
          from { opacity:0; transform:translateY(8px); }
          to   { opacity:1; transform:translateY(0); }
        }

        .july-root { font-family:'Inter',sans-serif; }
        .msg-in { animation: msg-in .35s ease forwards; }

        .suggestion-chip:hover {
          background: rgba(255, 255, 255, 0.05) !important;
          border-color: rgba(0, 180, 255, 0.2) !important;
          color: rgba(200, 235, 255, 1) !important;
          transform: translateY(-2px);
          box-shadow: 0 6px 24px rgba(0, 180, 255, 0.15) !important;
        }
        .suggestion-chip:active {
          transform: translateY(0);
        }

        .july-text-input:focus {
          border-color: rgba(0, 180, 255, 0.3) !important;
          box-shadow: 0 0 15px rgba(0, 180, 255, 0.15), inset 0 0 10px rgba(0, 180, 255, 0.02) !important;
          background: rgba(255, 255, 255, 0.04) !important;
        }

        .source-link:hover {
          background: rgba(255, 255, 255, 0.1) !important;
          border-color: rgba(0, 180, 255, 0.3) !important;
          color: rgba(255, 255, 255, 1) !important;
          box-shadow: 0 0 10px rgba(0, 180, 255, 0.1) !important;
        }

        .copy-button:hover {
          background: rgba(255, 255, 255, 0.08) !important;
          border-color: rgba(0, 180, 255, 0.25) !important;
          color: rgba(255, 255, 255, 1) !important;
          box-shadow: 0 0 8px rgba(0, 180, 255, 0.1) !important;
        }
      `}</style>

      <div className='july-root relative flex flex-col items-center justify-center min-h-screen w-full overflow-hidden bg-[#03050c]'>
        {/* ── Clear Chat Button ── */}
        {messages.length > 0 && (
          <button
            type='button'
            onClick={() => setMessages([])}
            style={{
              position: 'absolute',
              top: 24,
              right: 136,
              zIndex: 100,
              width: 44,
              height: 44,
              borderRadius: '50%',
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'rgba(255,255,255,0.03)',
              backdropFilter: 'blur(8px)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'rgba(160,220,255,0.85)',
              boxShadow: '0 0 15px rgba(0,180,255,0.1), inset 0 0 10px rgba(0,180,255,0.02)',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
            aria-label='Clear conversation history'
            title='Clear conversation history'
          >
            <IconTrash />
          </button>
        )}

        {/* ── Speed Selector Button ── */}
        <button
          type='button'
          onClick={() => {
            setPlaybackSpeed((s) => {
              if (s === 1) return 1.2;
              if (s === 1.2) return 1.5;
              return 1.0;
            });
          }}
          style={{
            position: 'absolute',
            top: 24,
            right: 80,
            zIndex: 100,
            width: 44,
            height: 44,
            borderRadius: '50%',
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(255,255,255,0.03)',
            backdropFilter: 'blur(8px)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 400,
            color: 'rgba(160,220,255,0.85)',
            boxShadow: '0 0 15px rgba(0,180,255,0.1), inset 0 0 10px rgba(0,180,255,0.02)',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
          aria-label={`Playback speed: ${playbackSpeed}x`}
          title={`Cycle speed: currently ${playbackSpeed}x`}
        >
          {playbackSpeed.toFixed(1)}x
        </button>

        {/* ── Mute Toggle Button ── */}
        <button
          type='button'
          onClick={() => setIsMuted((m) => !m)}
          style={{
            position: 'absolute',
            top: 24,
            right: 24,
            zIndex: 100,
            width: 44,
            height: 44,
            borderRadius: '50%',
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(255,255,255,0.03)',
            backdropFilter: 'blur(8px)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: isMuted ? 'rgba(255,70,70,0.85)' : 'rgba(160,220,255,0.85)',
            boxShadow: isMuted
              ? '0 0 15px rgba(255,70,70,0.15), inset 0 0 10px rgba(255,70,70,0.05)'
              : '0 0 15px rgba(0,180,255,0.1), inset 0 0 10px rgba(0,180,255,0.02)',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
          aria-label={isMuted ? 'Unmute voice response' : 'Mute voice response'}
          title={isMuted ? 'Unmute voice' : 'Mute voice'}
        >
          {isMuted ? <IconVolumeX /> : <IconVolume2 />}
        </button>

        {/* ── aurora blobs ── */}
        <div aria-hidden='true' className='pointer-events-none absolute inset-0 overflow-hidden'>
          <div
            style={{
              position: 'absolute',
              width: 700,
              height: 700,
              borderRadius: '50%',
              filter: 'blur(120px)',
              background: 'radial-gradient(circle,rgba(0,100,255,0.55),transparent 70%)',
              top: '-20%',
              left: '-15%',
              animation: 'aurora-1 12s ease-in-out infinite',
            }}
          />
          <div
            style={{
              position: 'absolute',
              width: 600,
              height: 600,
              borderRadius: '50%',
              filter: 'blur(100px)',
              background: 'radial-gradient(circle,rgba(80,0,220,0.4),transparent 70%)',
              bottom: '-10%',
              right: '-10%',
              animation: 'aurora-2 15s ease-in-out infinite',
            }}
          />
          <div
            style={{
              position: 'absolute',
              width: 500,
              height: 500,
              borderRadius: '50%',
              filter: 'blur(90px)',
              background: 'radial-gradient(circle,rgba(0,180,255,0.35),transparent 70%)',
              top: '40%',
              right: '20%',
              animation: 'aurora-3 10s ease-in-out infinite',
            }}
          />
        </div>

        {/* ── dot-grid overlay ── */}
        <div
          aria-hidden='true'
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            backgroundImage: 'radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />

        {/* ── scene ── */}
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 280,
            height: 280,
          }}
        >
          {/* pulse / breathe rings */}
          {[0, 1, 2].map((i) => {
            const delay = `${i * 300}ms`;
            if (orbMode === 'speaking')
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: '50%',
                    border: `1px solid rgba(0,180,255,${Math.max(0, 0.45 - i * 0.12)})`,
                    transform: `scale(${ringScale + i * 0.22})`,
                    transition: 'transform 80ms ease-out, opacity 80ms ease-out',
                    transitionDelay: `${i * 40}ms`,
                  }}
                  aria-hidden='true'
                />
              );
            if (orbMode === 'processing')
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: '50%',
                    border: '1px solid rgba(255,150,40,0.45)',
                    animation: `ring-breathe-amber ${2.6 + i * 0.5}s ease-in-out ${delay} infinite`,
                  }}
                  aria-hidden='true'
                />
              );
            if (orbMode === 'responding')
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: '50%',
                    border: '1px solid rgba(0,220,140,0.45)',
                    animation: `ring-breathe-green ${2.2 + i * 0.45}s ease-in-out ${delay} infinite`,
                  }}
                  aria-hidden='true'
                />
              );
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '50%',
                  border: '1px solid rgba(0,150,255,0.25)',
                  animation:
                    micStatus === 'active'
                      ? `ring-breathe ${3.8 + i * 0.7}s ease-in-out ${delay} infinite`
                      : 'none',
                  opacity: micStatus !== 'active' ? 0.06 - i * 0.015 : undefined,
                  transform: micStatus !== 'active' ? `scale(${1 + i * 0.13})` : undefined,
                }}
                aria-hidden='true'
              />
            );
          })}

          {/* ── main orb button ── */}
          <button
            type='button'
            id='july-orb'
            onClick={micStatus === 'idle' || micStatus === 'denied' ? requestMic : undefined}
            disabled={micStatus === 'requesting'}
            aria-label={
              micStatus === 'idle'
                ? 'Activate July'
                : micStatus === 'active'
                  ? 'July is listening'
                  : micStatus === 'denied'
                    ? 'Microphone denied — retry'
                    : 'Requesting microphone…'
            }
            style={{
              position: 'relative',
              zIndex: 10,
              width: 148,
              height: 148,
              borderRadius: '50%',
              border: 'none',
              outline: 'none',
              cursor:
                micStatus === 'requesting'
                  ? 'wait'
                  : micStatus === 'active'
                    ? 'default'
                    : 'pointer',
              background:
                orbMode === 'processing'
                  ? 'radial-gradient(circle at 35% 35%, rgba(255,140,30,0.3), rgba(120,50,0,0.85) 60%, rgba(15,5,0,0.98))'
                  : orbMode === 'responding'
                    ? 'radial-gradient(circle at 35% 35%, rgba(0,220,140,0.28), rgba(0,80,60,0.85) 60%, rgba(0,12,8,0.98))'
                    : 'radial-gradient(circle at 35% 35%, rgba(0,200,255,0.28), rgba(0,50,120,0.88) 60%, rgba(0,8,28,0.98))',
              boxShadow:
                orbMode === 'processing'
                  ? '0 0 50px rgba(255,140,30,0.45), 0 0 100px rgba(180,80,0,0.22), inset 0 0 40px rgba(255,160,40,0.1)'
                  : orbMode === 'responding'
                    ? '0 0 50px rgba(0,220,140,0.45), 0 0 100px rgba(0,160,80,0.22), inset 0 0 40px rgba(0,230,160,0.1)'
                    : '0 0 50px rgba(0,160,255,0.42), 0 0 100px rgba(0,80,200,0.2), inset 0 0 35px rgba(0,190,255,0.1)',
              animation:
                orbMode === 'processing'
                  ? 'orb-breathe-amber 2.4s ease-in-out infinite'
                  : orbMode === 'responding'
                    ? 'orb-breathe-green 2.2s ease-in-out infinite'
                    : micStatus === 'active'
                      ? 'orb-breathe 3.5s ease-in-out infinite'
                      : 'none',
              transition: 'background 0.6s ease, box-shadow 0.6s ease',
            }}
          >
            {/* inner highlight */}
            <span
              style={{
                position: 'absolute',
                inset: 10,
                borderRadius: '50%',
                background:
                  orbMode === 'processing'
                    ? 'radial-gradient(circle at 38% 28%, rgba(255,200,80,0.18), transparent 58%)'
                    : orbMode === 'responding'
                      ? 'radial-gradient(circle at 38% 28%, rgba(80,255,180,0.18), transparent 58%)'
                      : 'radial-gradient(circle at 38% 28%, rgba(120,220,255,0.18), transparent 58%)',
                animation: 'orb-breathe 3s ease-in-out infinite',
              }}
              aria-hidden='true'
            />

            {/* icon */}
            <span
              style={{
                position: 'relative',
                zIndex: 10,
                color:
                  orbMode === 'processing'
                    ? 'rgba(255,170,60,0.95)'
                    : orbMode === 'responding'
                      ? 'rgba(60,230,160,0.95)'
                      : 'rgba(160,220,255,0.92)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              aria-hidden='true'
            >
              {micStatus === 'idle' && <IconMic />}
              {micStatus === 'requesting' && <IconSpinner />}
              {micStatus === 'active' && !isProcessing && !isResponding && (
                <IconWave active={isSpeaking} />
              )}
              {isProcessing && <IconThinking />}
              {isResponding && <IconSpeaking />}
              {micStatus === 'denied' && <IconMicOff />}
            </span>
          </button>

          {/* volume bar — only while user is speaking */}
          {micStatus === 'active' && isSpeaking && (
            // biome-ignore lint/a11y/useSemanticElements: animated fill bar requires div children; <meter> cannot render them
            <div
              role='meter'
              aria-valuenow={volume}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label='Microphone volume'
              style={{
                position: 'absolute',
                right: -8,
                top: '50%',
                transform: 'translateY(-50%) translateX(100%)',
                width: 3,
                height: 88,
                borderRadius: 4,
                overflow: 'hidden',
                background: 'rgba(0,150,255,0.1)',
                border: '1px solid rgba(0,150,255,0.2)',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  borderRadius: 4,
                  height: `${volume}%`,
                  background: 'linear-gradient(to top, rgba(0,210,255,0.9), rgba(0,100,255,0.5))',
                  boxShadow: '0 0 6px rgba(0,200,255,0.7)',
                  transition: 'height 60ms linear',
                }}
              />
            </div>
          )}
        </div>

        {/* ── name + status ── */}
        <div style={{ marginTop: 36, textAlign: 'center', userSelect: 'none' }}>
          <p
            style={{
              fontSize: 28,
              fontWeight: 200,
              letterSpacing: '0.55em',
              color: 'rgba(170,215,255,0.92)',
              textShadow: '0 0 18px rgba(0,170,255,0.55)',
              marginBottom: 10,
            }}
          >
            J U L Y
          </p>

          <div
            style={{
              height: 22,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              fontSize: 11,
              fontWeight: 300,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color:
                orbMode === 'processing'
                  ? 'rgba(255,155,45,0.9)'
                  : orbMode === 'responding'
                    ? 'rgba(40,220,140,0.9)'
                    : orbMode === 'speaking'
                      ? 'rgba(60,195,255,0.9)'
                      : 'rgba(90,160,220,0.6)',
              transition: 'color 0.5s ease',
            }}
          >
            {taglines[orbMode] ?? taglines.standby}
            {orbMode === 'processing' && (
              <span style={{ display: 'inline-flex', gap: 3, marginLeft: 2 }} aria-hidden='true'>
                {[0, 180, 360].map((ms) => (
                  <span
                    key={ms}
                    style={{
                      animation: `thinking-dot 1.3s ease-in-out ${ms}ms infinite`,
                      display: 'inline-block',
                    }}
                  >
                    •
                  </span>
                ))}
              </span>
            )}
          </div>
        </div>

        {/* ── suggestion chips ── */}
        {messages.length === 0 && (
          <div
            style={{
              marginTop: 40,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
              width: '100%',
              maxWidth: 380,
              padding: '0 20px',
            }}
          >
            {[
              {
                text: 'Ask about Euro 2024 results ⚽',
                prompt:
                  'Who won the match between Germany and Hungary in Euro 2024? What was the score?',
              },
              {
                text: 'Tell me a short joke 🎭',
                prompt: 'Tell me a short, clean, funny software developer joke.',
              },
              {
                text: 'Search recent AI news 📰',
                prompt:
                  'What are the latest updates about Gemini models from Google? Search for the news.',
              },
            ].map((chip) => (
              <button
                key={chip.text}
                type='button'
                onClick={() => handlePrompt(chip.prompt)}
                disabled={isProcessing || isResponding}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  borderRadius: 16,
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  background: 'rgba(255, 255, 255, 0.02)',
                  backdropFilter: 'blur(10px)',
                  color: 'rgba(160, 220, 255, 0.85)',
                  fontSize: 12,
                  fontWeight: 300,
                  textAlign: 'left',
                  cursor: isProcessing || isResponding ? 'not-allowed' : 'pointer',
                  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
                  transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                  opacity: isProcessing || isResponding ? 0.5 : 1,
                }}
                className='suggestion-chip'
              >
                {chip.text}
              </button>
            ))}
          </div>
        )}

        {/* ── conversation feed ── */}
        {messages.length > 0 && (
          <div
            style={{
              marginTop: 40,
              width: '100%',
              maxWidth: 520,
              maxHeight: 260,
              overflowY: 'auto',
              padding: '0 24px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              scrollbarWidth: 'none',
            }}
          >
            {messages.map((msg, idx) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: message feed is strictly append-only
                key={idx}
                className='msg-in'
                style={{
                  display: 'flex',
                  justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                <div
                  style={{
                    maxWidth: '78%',
                    padding: '10px 15px',
                    borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                    fontSize: 13,
                    fontWeight: 300,
                    lineHeight: 1.55,
                    backdropFilter: 'blur(12px)',
                    background:
                      msg.role === 'user' ? 'rgba(0,130,255,0.14)' : 'rgba(0,220,140,0.1)',
                    border:
                      msg.role === 'user'
                        ? '1px solid rgba(0,150,255,0.22)'
                        : '1px solid rgba(0,220,140,0.2)',
                    color: msg.role === 'user' ? 'rgba(160,215,255,0.9)' : 'rgba(100,240,180,0.9)',
                    boxShadow:
                      msg.role === 'user'
                        ? '0 2px 16px rgba(0,120,255,0.08)'
                        : '0 2px 16px rgba(0,200,120,0.08)',
                  }}
                >
                  {msg.text}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      marginTop: 8,
                    }}
                  >
                    {msg.sources && msg.sources.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {msg.sources.map((src) => (
                          <a
                            key={src.uri}
                            href={src.uri}
                            target='_blank'
                            rel='noopener noreferrer'
                            style={{
                              fontSize: 10,
                              padding: '3px 8px',
                              borderRadius: 8,
                              background: 'rgba(255, 255, 255, 0.05)',
                              border: '1px solid rgba(255, 255, 255, 0.08)',
                              color: 'rgba(160, 220, 255, 0.8)',
                              textDecoration: 'none',
                              transition: 'all 0.2s',
                            }}
                            className='source-link'
                          >
                            🌐 {src.title}
                          </a>
                        ))}
                      </div>
                    ) : (
                      <div />
                    )}
                    <CopyButton text={msg.text} />
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}

        {/* ── bottom input box ── */}
        {micStatus === 'active' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!inputText.trim()) return;
              handlePrompt(inputText.trim());
              setInputText('');
            }}
            style={{
              marginTop: 24,
              width: '100%',
              maxWidth: 520,
              display: 'flex',
              gap: 8,
              padding: '0 24px',
            }}
          >
            <input
              type='text'
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={isProcessing || isResponding}
              placeholder='Type a message...'
              style={{
                flex: 1,
                padding: '12px 18px',
                borderRadius: 22,
                border: '1px solid rgba(255, 255, 255, 0.08)',
                background: 'rgba(255, 255, 255, 0.02)',
                color: 'rgba(255, 255, 255, 0.9)',
                fontSize: 13,
                fontWeight: 300,
                outline: 'none',
                backdropFilter: 'blur(10px)',
                transition: 'all 0.3s ease',
              }}
              className='july-text-input'
            />
            <button
              type='submit'
              disabled={isProcessing || isResponding || !inputText.trim()}
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                background: 'rgba(255, 255, 255, 0.03)',
                backdropFilter: 'blur(8px)',
                cursor:
                  isProcessing || isResponding || !inputText.trim() ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color:
                  isProcessing || isResponding || !inputText.trim()
                    ? 'rgba(255,255,255,0.2)'
                    : 'rgba(160,220,255,0.85)',
                transition: 'all 0.3s ease',
              }}
              aria-label='Send message'
            >
              <IconSend />
            </button>
          </form>
        )}
      </div>
    </>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconMic() {
  return (
    <svg
      width='34'
      height='34'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.4'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
    >
      <rect x='9' y='2' width='6' height='11' rx='3' />
      <path d='M5 10a7 7 0 0 0 14 0' />
      <line x1='12' y1='19' x2='12' y2='22' />
      <line x1='8' y1='22' x2='16' y2='22' />
    </svg>
  );
}

function IconMicOff() {
  return (
    <svg
      width='34'
      height='34'
      viewBox='0 0 24 24'
      fill='none'
      stroke='rgba(255,70,70,0.85)'
      strokeWidth='1.4'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
    >
      <line x1='2' y1='2' x2='22' y2='22' />
      <path d='M18.89 13.23A7 7 0 0 0 19 12' />
      <path d='M5 10a7 7 0 0 0 11.17 5.7' />
      <path d='M15 9.34V5a3 3 0 0 0-5.68-1.33' />
      <path d='M9 9v3a3 3 0 0 0 5.12 2.12' />
      <line x1='12' y1='19' x2='12' y2='22' />
      <line x1='8' y1='22' x2='16' y2='22' />
    </svg>
  );
}

function IconSpinner() {
  return (
    <svg
      width='34'
      height='34'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.4'
      strokeLinecap='round'
      aria-hidden='true'
    >
      <path d='M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83'>
        <animateTransform
          attributeName='transform'
          type='rotate'
          from='0 12 12'
          to='360 12 12'
          dur='1s'
          repeatCount='indefinite'
        />
      </path>
    </svg>
  );
}

function IconWave({ active }: { active: boolean }) {
  const heights = active ? [10, 18, 22, 16, 8] : [4, 8, 6, 8, 4];
  return (
    <svg
      width='38'
      height='26'
      viewBox='0 0 38 26'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.6'
      strokeLinecap='round'
      aria-hidden='true'
    >
      {[4, 11, 19, 27, 34].map((x, i) => {
        const h = heights[i];
        return (
          <line
            key={x}
            x1={x}
            y1={13 - h / 2}
            x2={x}
            y2={13 + h / 2}
            style={{ transition: 'all 0.12s ease' }}
          />
        );
      })}
    </svg>
  );
}

function IconThinking() {
  return (
    <svg
      width='34'
      height='34'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.4'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
    >
      {/* sparkle / star */}
      <path d='M12 2l1.8 5.5H20l-4.7 3.4 1.8 5.5L12 13l-5.1 3.4 1.8-5.5L4 7.5h6.2z' />
    </svg>
  );
}

function IconSpeaking() {
  const heights = [7, 15, 20, 13, 6];
  return (
    <svg
      width='38'
      height='26'
      viewBox='0 0 38 26'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.6'
      strokeLinecap='round'
      aria-hidden='true'
    >
      {[4, 11, 19, 27, 34].map((x, i) => {
        const h = heights[i];
        return (
          <line
            key={x}
            x1={x}
            y1={13 - h / 2}
            x2={x}
            y2={13 + h / 2}
            style={{ animation: `speaking-bar 0.7s ease-in-out ${i * 100}ms infinite` }}
          />
        );
      })}
    </svg>
  );
}

function IconVolume2() {
  return (
    <svg
      width='20'
      height='20'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.6'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
    >
      <polygon points='11 5 6 9 2 9 2 15 6 15 11 19 11 5' />
      <path d='M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14' />
    </svg>
  );
}

function IconVolumeX() {
  return (
    <svg
      width='20'
      height='20'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.6'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
    >
      <polygon points='11 5 6 9 2 9 2 15 6 15 11 19 11 5' />
      <line x1='22' y1='9' x2='16' y2='15' />
      <line x1='16' y1='9' x2='22' y2='15' />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg
      width='18'
      height='18'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.6'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
    >
      <polyline points='3 6 5 6 21 6' />
      <path d='M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' />
      <line x1='10' y1='11' x2='10' y2='17' />
      <line x1='14' y1='11' x2='14' y2='17' />
    </svg>
  );
}

function IconSend() {
  return (
    <svg
      width='18'
      height='18'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.6'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
    >
      <line x1='22' y1='2' x2='11' y2='13' />
      <polygon points='22 2 15 22 11 13 2 9 22 2' />
    </svg>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  return (
    <button
      type='button'
      onClick={handleCopy}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '4px',
        borderRadius: '6px',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        background: 'rgba(255, 255, 255, 0.02)',
        color: copied ? 'rgba(0, 220, 140, 0.8)' : 'rgba(160, 220, 255, 0.7)',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        marginLeft: 'auto',
      }}
      className='copy-button'
      aria-label={copied ? 'Copied' : 'Copy message text'}
      title={copied ? 'Copied!' : 'Copy message'}
    >
      {copied ? <IconCheck /> : <IconCopy />}
    </button>
  );
}

function IconCopy() {
  return (
    <svg
      width='12'
      height='12'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.6'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
    >
      <rect x='9' y='9' width='13' height='13' rx='2' ry='2' />
      <path d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg
      width='12'
      height='12'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.8'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
    >
      <polyline points='20 6 9 17 4 12' />
    </svg>
  );
}
