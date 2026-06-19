'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { talk } from '../actions/gemini.actions';

// ─── Types ────────────────────────────────────────────────────────────────────

type MicStatus = 'idle' | 'requesting' | 'active' | 'denied';

interface AudioFrame {
  timestamp: number;
  volume: number; // 0–100 RMS-normalised
  peak: number; // 0–255 raw peak byte
  isSpeaking: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SPEAKING_THRESHOLD = 15; // volume level that counts as speech
const FFT_SIZE = 256;
/** How long after silence before we stop recording and send to STT (ms). */
const STOP_DEBOUNCE_MS = 2000;
/** Minimum recording length ElevenLabs accepts (100ms) plus a safety margin. */
const MIN_RECORDING_MS = 300;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Bug 1 fix: safe typed-array max — Math.max(...largeTypedArray) can overflow
 * the JS call stack when FFT_SIZE grows. A loop is O(n) and stack-safe.
 */
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

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);
  // Track previous speaking state for throttled logging and recording trigger
  const prevSpeakingRef = useRef<boolean>(false);
  // MediaRecorder refs for capturing audio segments while speaking
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  // Debounce timer: wait STOP_DEBOUNCE_MS after silence before stopping
  const stopDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track when recording started to enforce minimum duration
  const recordingStartRef = useRef<number | null>(null);

  // ── Teardown helper ────────────────────────────────────────────────────────

  /**
   * Bug 5 fix: centralised teardown — calling requestMic a second time (after
   * a denied retry) no longer leaks the old AudioContext + rAF loop.
   */
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

  // ── Recording helpers ──────────────────────────────────────────────────────

  const startRecording = useCallback(() => {
    if (!streamRef.current || mediaRecorderRef.current?.state === 'recording') return;

    // Cancel any pending stop timer — user started speaking again
    if (stopDebounceRef.current !== null) {
      clearTimeout(stopDebounceRef.current);
      stopDebounceRef.current = null;
    }

    audioChunksRef.current = [];
    recordingStartRef.current = Date.now();

    // Prefer Opus inside WebM — best quality/size ratio for speech APIs
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    const recorder = new MediaRecorder(streamRef.current, { mimeType });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };
    mediaRecorderRef.current = recorder;
    // Timeslice of 100ms: ondataavailable fires regularly instead of only on stop,
    // preventing data loss from a single large buffer flush.
    recorder.start(100);
  }, []);

  const stopRecordingAndTranscribe = useCallback(() => {
    // Debounce: wait STOP_DEBOUNCE_MS after silence before actually stopping.
    // This prevents clipping short words like "hello" that briefly dip below threshold.
    if (stopDebounceRef.current !== null) clearTimeout(stopDebounceRef.current);

    stopDebounceRef.current = setTimeout(async () => {
      stopDebounceRef.current = null;
      const recorder = mediaRecorderRef.current;
      // biome-ignore lint/complexity/useOptionalChain: explicit null guard is intentional for clarity
      if (!recorder || recorder.state !== 'recording') return;

      // Enforce minimum recording duration to satisfy ElevenLabs 100ms minimum
      const elapsed = recordingStartRef.current ? Date.now() - recordingStartRef.current : 0;
      if (elapsed < MIN_RECORDING_MS) return;

      // Wait for both onstop AND the last ondataavailable chunk.
      // In some browsers onstop fires before the final ondataavailable,
      // so we must listen to both and resolve after both have fired.
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

      const transcript = await talk(formData);
      if (transcript) {
        console.log('[july] transcript:', transcript);
      }
    }, STOP_DEBOUNCE_MS);
  }, []);

  // ── Audio loop ─────────────────────────────────────────────────────────────

  /**
   * Bug 3 fix: AudioContext is created by the caller (requestMic) inside the
   * click gesture handler, then passed in — avoids Safari auto-suspend.
   * Bug 4 fix: analyser and dataArray live in this closure; no dangling refs.
   */
  const startAudioLoop = useCallback(
    (ctx: AudioContext, stream: MediaStream) => {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;

      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteTimeDomainData(dataArray);

        // RMS volume calculation
        let sumOfSquares = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const normalized = (dataArray[i] - 128) / 128; // centre around 0
          sumOfSquares += normalized * normalized;
        }
        const rms = Math.sqrt(sumOfSquares / dataArray.length);
        const vol = Math.round(rms * 100);

        // Bug 1 fix: loop-based max instead of spread
        const peak = typedArrayMax(dataArray);
        const speaking = vol > SPEAKING_THRESHOLD;

        // Only act on speaking state transitions (not every ~60fps frame)
        if (speaking !== prevSpeakingRef.current) {
          prevSpeakingRef.current = speaking;
          const frame: AudioFrame = {
            timestamp: Date.now(),
            volume: vol,
            peak,
            isSpeaking: speaking,
          };
          console.log('[july] audio frame:', frame);

          if (speaking) {
            startRecording();
          } else {
            stopRecordingAndTranscribe();
          }
        }

        setVolume(vol);
        setIsSpeaking(speaking);

        animFrameRef.current = requestAnimationFrame(tick);
      };

      animFrameRef.current = requestAnimationFrame(tick);
    },
    [startRecording, stopRecordingAndTranscribe]
  );

  // ── Request microphone ─────────────────────────────────────────────────────

  const requestMic = useCallback(async () => {
    // Bug 5 fix: always tear down any previous session before starting a new one
    teardown();

    setMicStatus('requesting');
    try {
      // Bug 3 fix: AudioContext created here, inside the click gesture, so
      // browsers (especially Safari) do not auto-suspend it.
      const ctx = new AudioContext();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

      audioCtxRef.current = ctx;
      streamRef.current = stream;

      setMicStatus('active');
      startAudioLoop(ctx, stream);
    } catch {
      setMicStatus('denied');
    }
  }, [teardown, startAudioLoop]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────────

  useEffect(() => {
    return teardown;
  }, [teardown]);

  // ── Derived visuals ────────────────────────────────────────────────────────

  const ringScale = 1 + (volume / 100) * 0.6; // 1.0 → 1.6
  const pulseRings = [0, 1, 2]; // three concentric rings

  return (
    <div className={styles.root}>
      {/* ── background grid ── */}
      <div className={styles.grid} aria-hidden='true' />

      {/* ── core presence orb ── */}
      <div className={styles.scene}>
        {/* pulse rings – animate when speaking */}
        {pulseRings.map((i) => (
          <div
            key={i}
            className={styles.ring}
            style={{
              transform: `scale(${isSpeaking ? ringScale + i * 0.25 : 1 + i * 0.12})`,
              opacity: isSpeaking ? Math.max(0, 0.35 - i * 0.1) : 0.08 - i * 0.02,
              transitionDelay: `${i * 40}ms`,
            }}
            aria-hidden='true'
          />
        ))}

        {/* main orb */}
        <button
          type='button'
          id='july-orb'
          className={`${styles.orb} ${isSpeaking ? styles.orbActive : ''}`}
          onClick={micStatus === 'idle' || micStatus === 'denied' ? requestMic : undefined}
          aria-label={
            micStatus === 'idle'
              ? 'Activate July – click to grant microphone access'
              : micStatus === 'active'
                ? 'July is listening'
                : micStatus === 'denied'
                  ? 'Microphone access denied – click to retry'
                  : 'Requesting microphone access…'
          }
          disabled={micStatus === 'requesting'}
        >
          {/* inner glow core */}
          <span className={styles.orbCore} aria-hidden='true' />

          {/* status icon */}
          <span className={styles.orbIcon} aria-hidden='true'>
            {micStatus === 'idle' && <IconMic />}
            {micStatus === 'requesting' && <IconSpinner />}
            {micStatus === 'active' && <IconWave active={isSpeaking} />}
            {micStatus === 'denied' && <IconMicOff />}
          </span>
        </button>

        {/* Bug 2 fix: <meter> cannot render child elements visually — the spec
            defines its content as fallback text only, never painted. Use a
            styled div container with a fill div for the animated bar instead. */}
        {micStatus === 'active' && (
          // biome-ignore lint/a11y/useSemanticElements: animated fill bar requires div children; <meter> cannot render them
          <div
            role='meter'
            className={styles.volumeBar}
            aria-valuenow={volume}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label='Microphone volume'
          >
            <div className={styles.volumeFill} style={{ height: `${volume}%` }} />
          </div>
        )}
      </div>

      {/* ── text status ── */}
      <div className={styles.statusBlock}>
        <p className={styles.name}>J U L Y</p>
        <p className={styles.tagline}>
          {micStatus === 'idle' && 'Tap to wake me up'}
          {micStatus === 'requesting' && 'Requesting microphone…'}
          {micStatus === 'active' && (isSpeaking ? "I'm listening…" : 'Standby — say something')}
          {micStatus === 'denied' && 'Microphone access denied'}
        </p>

        {micStatus === 'active' && (
          <p className={styles.volumeLabel}>
            Volume <span className={styles.volumeValue}>{volume}</span>
            {isSpeaking && <span className={styles.speakingBadge}>● speaking</span>}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Inline style tokens ──────────────────────────────────────────────────────

const styles: Record<string, string> = {
  root: [
    'relative flex flex-col items-center justify-center',
    'min-h-screen w-full overflow-hidden',
    'bg-[#020408]',
    "font-['Inter',sans-serif]",
  ].join(' '),

  grid: [
    'pointer-events-none absolute inset-0',
    'bg-[linear-gradient(rgba(0,180,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(0,180,255,0.04)_1px,transparent_1px)]',
    'bg-[size:48px_48px]',
  ].join(' '),

  scene: 'relative flex items-center justify-center w-64 h-64',

  ring: [
    'absolute inset-0 rounded-full',
    'border border-[rgba(0,180,255,0.3)]',
    'transition-all duration-200 ease-out',
  ].join(' '),

  orb: [
    'relative z-10 w-36 h-36 rounded-full',
    'flex items-center justify-center',
    'cursor-pointer border-0 outline-none',
    'bg-[radial-gradient(circle_at_35%_35%,rgba(0,220,255,0.25),rgba(0,60,120,0.9)_60%,rgba(0,10,30,0.98))]',
    'shadow-[0_0_40px_rgba(0,180,255,0.4),0_0_80px_rgba(0,100,200,0.2),inset_0_0_30px_rgba(0,200,255,0.1)]',
    'transition-all duration-150 ease-out',
    'hover:shadow-[0_0_60px_rgba(0,200,255,0.6),0_0_100px_rgba(0,120,220,0.3),inset_0_0_40px_rgba(0,220,255,0.15)]',
    'disabled:cursor-wait',
  ].join(' '),

  orbActive: [
    'shadow-[0_0_70px_rgba(0,220,255,0.7),0_0_120px_rgba(0,150,255,0.4),inset_0_0_50px_rgba(0,230,255,0.2)]',
  ].join(' '),

  orbCore: [
    'absolute inset-3 rounded-full',
    'bg-[radial-gradient(circle_at_40%_30%,rgba(150,230,255,0.15),transparent_60%)]',
    'animate-pulse',
  ].join(' '),

  orbIcon: 'relative z-10 text-[rgba(180,230,255,0.9)]',

  volumeBar: [
    'absolute right-0 top-1/2 -translate-y-1/2 translate-x-12',
    'w-2 h-24 rounded-full overflow-hidden',
    'bg-[rgba(0,180,255,0.1)] border border-[rgba(0,180,255,0.2)]',
  ].join(' '),

  volumeFill: [
    'absolute bottom-0 left-0 right-0 rounded-full',
    'bg-[linear-gradient(to_top,rgba(0,220,255,0.9),rgba(0,120,255,0.6))]',
    'transition-all duration-75 ease-linear',
    'shadow-[0_0_8px_rgba(0,200,255,0.8)]',
  ].join(' '),

  statusBlock: 'mt-12 text-center select-none',

  name: [
    'text-3xl font-thin tracking-[0.5em]',
    'text-[rgba(180,220,255,0.9)]',
    'drop-shadow-[0_0_12px_rgba(0,180,255,0.6)]',
    'mb-3',
  ].join(' '),

  tagline: [
    'text-sm font-light tracking-widest uppercase',
    'text-[rgba(100,180,230,0.6)]',
    'h-5',
  ].join(' '),

  volumeLabel: 'mt-4 text-xs text-[rgba(0,180,255,0.5)] flex items-center gap-2',

  volumeValue: 'font-mono text-[rgba(0,210,255,0.8)] w-5',

  speakingBadge: ['text-[rgba(0,230,180,0.8)] animate-pulse ml-1'].join(' '),
};

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconMic() {
  return (
    <svg
      width='32'
      height='32'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.5'
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
      width='32'
      height='32'
      viewBox='0 0 24 24'
      fill='none'
      stroke='rgba(255,80,80,0.8)'
      strokeWidth='1.5'
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
      width='32'
      height='32'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.5'
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
  return (
    <svg
      width='36'
      height='24'
      viewBox='0 0 36 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.5'
      strokeLinecap='round'
      aria-hidden='true'
    >
      {/* 5 bars that grow when active */}
      {[4, 10, 18, 26, 32].map((x, i) => {
        const heights = active ? [10, 18, 22, 16, 8] : [4, 8, 6, 8, 4];
        const h = heights[i];
        return (
          <line
            key={x}
            x1={x}
            y1={12 - h / 2}
            x2={x}
            y2={12 + h / 2}
            style={{ transition: 'all 0.1s ease' }}
          />
        );
      })}
    </svg>
  );
}
