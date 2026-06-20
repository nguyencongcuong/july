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
  feedback?: 'like' | 'dislike' | null;
  timestamp?: string;
  latency?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FFT_SIZE = 256;
const STOP_DEBOUNCE_MS = 2000;
const MIN_RECORDING_MS = 300;
const RETRY_DELAYS_MS = [500, 1500] as const;

// ─── Helpers ─ (retry) ────────────────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  onRetry: (attempt: number, total: number) => void
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < RETRY_DELAYS_MS.length) {
        onRetry(attempt + 1, RETRY_DELAYS_MS.length);
        await new Promise<void>((res) => setTimeout(res, RETRY_DELAYS_MS[attempt]));
      }
    }
  }
  throw lastErr;
}

const PLACEHOLDERS = [
  'Type a message...',
  'Ask for a short joke...',
  'Search for recent AI news...',
  'Ask about Euro 2024 results...',
  'Ask about Germany vs Hungary...',
];

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
  const [messages, setMessages] = useState<Message[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('july_chat_history');
        if (saved) {
          const parsed: unknown = JSON.parse(saved);
          if (Array.isArray(parsed)) return parsed as Message[];
        }
      } catch {
        // corrupt data — start fresh
      }
    }
    return [];
  });
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem('july_chat_history', JSON.stringify(messages));
    } catch {
      // storage quota exceeded — silently skip
    }
  }, [messages]);

  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [inputText, setInputText] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [hasNewMessageAlert, setHasNewMessageAlert] = useState(false);
  const [greeting, setGreeting] = useState('Welcome, Master');
  const [isCopyPulseActive, setIsCopyPulseActive] = useState(false);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const [playbackElapsed, setPlaybackElapsed] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [speakingThreshold, setSpeakingThreshold] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('july_speaking_threshold');
      return saved ? Number(saved) : 10;
    }
    return 10;
  });

  const speakingThresholdRef = useRef(speakingThreshold);
  speakingThresholdRef.current = speakingThreshold;

  useEffect(() => {
    localStorage.setItem('july_speaking_threshold', speakingThreshold.toString());
  }, [speakingThreshold]);

  const [showWelcomeGuide, setShowWelcomeGuide] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('july_show_welcome_guide');
      return saved === null ? true : saved === 'true';
    }
    return true;
  });

  useEffect(() => {
    localStorage.setItem('july_show_welcome_guide', showWelcomeGuide.toString());
  }, [showWelcomeGuide]);

  const [userName, setUserName] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('july_user_name') || 'Master';
    }
    return 'Master';
  });

  useEffect(() => {
    localStorage.setItem('july_user_name', userName);
  }, [userName]);

  const [autoScrollEnabled, setAutoScrollEnabled] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('july_auto_scroll');
      return saved === null ? true : saved === 'true';
    }
    return true;
  });

  useEffect(() => {
    localStorage.setItem('july_auto_scroll', autoScrollEnabled.toString());
  }, [autoScrollEnabled]);

  const [soundEffectsEnabled, setSoundEffectsEnabled] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('july_sound_effects');
      return saved === null ? true : saved === 'true';
    }
    return true;
  });

  const soundEffectsEnabledRef = useRef(soundEffectsEnabled);
  soundEffectsEnabledRef.current = soundEffectsEnabled;

  useEffect(() => {
    localStorage.setItem('july_sound_effects', soundEffectsEnabled.toString());
  }, [soundEffectsEnabled]);

  const [responseLength, setResponseLength] = useState<'concise' | 'detailed'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('july_response_length');
      return (saved as 'concise' | 'detailed') || 'detailed';
    }
    return 'detailed';
  });

  useEffect(() => {
    localStorage.setItem('july_response_length', responseLength);
  }, [responseLength]);

  const [counterMode, setCounterMode] = useState<'char' | 'word'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('july_counter_mode');
      return (saved as 'char' | 'word') || 'char';
    }
    return 'char';
  });

  useEffect(() => {
    localStorage.setItem('july_counter_mode', counterMode);
  }, [counterMode]);

  const getCounterText = () => {
    if (counterMode === 'char') {
      return `${inputText.length}/250`;
    }
    const words = inputText.trim() === '' ? 0 : inputText.trim().split(/\s+/).length;
    return `${words} word${words === 1 ? '' : 's'}`;
  };

  const [sessionStartTime] = useState(() => Date.now());
  const [sessionDuration, setSessionDuration] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setSessionDuration(Math.floor((Date.now() - sessionStartTime) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [sessionStartTime]);

  const formatDuration = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
  };

  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const confirmClearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackStartTimeRef = useRef<number | null>(null);
  const queryStartTimeRef = useRef<number>(0);

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;

  const playbackSpeedRef = useRef(playbackSpeed);
  playbackSpeedRef.current = playbackSpeed;

  const responseLengthRef = useRef(responseLength);
  responseLengthRef.current = responseLength;

  // ── Typewriter animation state ─────────────────────────────────────────────
  const [typingMsgIdx, setTypingMsgIdx] = useState<number | null>(null);
  const [typingText, setTypingText] = useState('');
  const typingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasMountedRef = useRef(false);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const prevSpeakingRef = useRef<boolean>(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const stopDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingStartRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestIdRef = useRef(0);
  const prevMessagesCountRef = useRef(messages.length);

  // Typewriter: animate the last July message letter-by-letter on arrival
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      prevMessagesCountRef.current = messages.length;
      return; // skip animation for history loaded from localStorage on mount
    }
    // Only animate when a new message was genuinely appended
    if (messages.length <= prevMessagesCountRef.current) {
      prevMessagesCountRef.current = messages.length;
      return;
    }
    prevMessagesCountRef.current = messages.length;

    const lastIdx = messages.length - 1;
    if (lastIdx < 0 || messages[lastIdx].role !== 'july') return;

    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current);
      typingIntervalRef.current = null;
    }
    const fullText = messages[lastIdx].text;
    let charIdx = 0;
    setTypingMsgIdx(lastIdx);
    setTypingText('');

    typingIntervalRef.current = setInterval(() => {
      charIdx++;
      setTypingText(fullText.slice(0, charIdx));
      if (charIdx >= fullText.length) {
        if (typingIntervalRef.current) clearInterval(typingIntervalRef.current);
        typingIntervalRef.current = null;
        setTypingMsgIdx(null);
      }
    }, 20);

    return () => {
      if (typingIntervalRef.current) clearInterval(typingIntervalRef.current);
    };
  }, [messages]);

  // Auto-scroll to latest message
  useEffect(() => {
    if (autoScrollEnabled && (messages.length > 0 || isProcessing)) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isProcessing, autoScrollEnabled]);

  // Dynamic browser tab title updates
  useEffect(() => {
    const originalTitle = 'July';
    let title = originalTitle;
    if (isProcessing) {
      title = '● July (Thinking...)';
    } else if (isResponding) {
      title = '🔊 July (Speaking...)';
    } else if (isMuted) {
      title = 'July (Muted)';
    }
    document.title = title;
    return () => {
      document.title = originalTitle;
    };
  }, [isProcessing, isResponding, isMuted]);

  // Unread new message alert notification triggers
  useEffect(() => {
    if (messages.length > prevMessagesCountRef.current) {
      if (showScrollBottom) {
        setHasNewMessageAlert(true);
      }
    }
    prevMessagesCountRef.current = messages.length;
  }, [messages.length, showScrollBottom]);

  // Dynamic Welcome Guide greeting based on local time
  useEffect(() => {
    const hours = new Date().getHours();
    const timeGreeting =
      hours < 12
        ? 'Good morning'
        : hours < 18
          ? 'Good afternoon'
          : hours < 22
            ? 'Good evening'
            : 'Good night';
    const emoji = hours < 12 ? '🌅' : hours < 18 ? '☀️' : hours < 22 ? '🌌' : '🌙';
    setGreeting(`${timeGreeting}, ${userName || 'Master'} ${emoji}`);
  }, [userName]);

  // Track playback progress while speaking
  useEffect(() => {
    if (!isResponding) {
      setPlaybackDuration(0);
      setPlaybackElapsed(0);
      playbackStartTimeRef.current = null;
      return;
    }

    let animId: number;
    const updateProgress = () => {
      if (playbackStartTimeRef.current !== null && playbackDuration > 0) {
        const elapsed = (Date.now() - playbackStartTimeRef.current) / 1000;
        setPlaybackElapsed(Math.min(playbackDuration, elapsed));
        if (elapsed < playbackDuration) {
          animId = requestAnimationFrame(updateProgress);
        }
      }
    };
    animId = requestAnimationFrame(updateProgress);
    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [isResponding, playbackDuration]);

  // Rotate placeholders every 4 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIdx((prev) => (prev + 1) % PLACEHOLDERS.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // Return focus to prompt input when the Help Modal is closed
  useEffect(() => {
    if (!showHelpModal && micStatus === 'active') {
      inputRef.current?.focus();
    }
  }, [showHelpModal, micStatus]);

  // Auto-focus prompt input when microphone successfully activates
  useEffect(() => {
    if (micStatus === 'active') {
      inputRef.current?.focus();
    }
  }, [micStatus]);

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const isScrolledUp = el.scrollHeight - el.scrollTop - el.clientHeight > 50;
    setShowScrollBottom(isScrolledUp);
    if (!isScrolledUp) {
      setHasNewMessageAlert(false);
    }
  };

  const stopSpeaking = useCallback(() => {
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
      } catch {}
      currentSourceRef.current = null;
      setIsResponding(false);
    }
  }, []);

  const cancelProcessing = useCallback(() => {
    requestIdRef.current++;
    setIsProcessing(false);
  }, []);

  const playChime = useCallback((type: 'wake' | 'clear' | 'click') => {
    if (isMutedRef.current || !soundEffectsEnabledRef.current) return;
    try {
      let ctx = audioCtxRef.current;
      if (!ctx) {
        ctx = new AudioContext();
        audioCtxRef.current = ctx;
      }
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      const now = ctx.currentTime;
      if (type === 'wake') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(1200, now + 0.15);
        gain.gain.setValueAtTime(0.04, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.15);
      } else if (type === 'clear') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(100, now + 0.3);
        gain.gain.setValueAtTime(0.04, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.3);
      } else if (type === 'click') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1000, now);
        gain.gain.setValueAtTime(0.015, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.05);
      }
    } catch (e) {
      console.warn('Failed to play chime:', e);
    }
  }, []);

  const handleCopyNotification = useCallback(() => {
    playChime('click');
    setIsCopyPulseActive(true);
    setTimeout(() => setIsCopyPulseActive(false), 1000);
  }, [playChime]);

  const handleDeleteMessage = useCallback(
    (index: number) => {
      playChime('click');
      setMessages((prev) => prev.filter((_, i) => i !== index));
    },
    [playChime]
  );

  const handleMessageFeedback = useCallback(
    (index: number, feedbackType: 'like' | 'dislike') => {
      playChime('click');
      setMessages((prev) =>
        prev.map((msg, i) => {
          if (i !== index) return msg;
          return {
            ...msg,
            feedback: msg.feedback === feedbackType ? null : feedbackType,
          };
        })
      );
    },
    [playChime]
  );

  const handleExportChat = useCallback(() => {
    playChime('click');
    if (messages.length === 0) return;

    const content = messages
      .map((msg) => {
        const time = msg.timestamp ? `[${msg.timestamp}] ` : '';
        const role = msg.role === 'user' ? 'User' : 'July (AI)';
        return `${time}${role}: ${msg.text}`;
      })
      .join('\n\n');

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `july_chat_transcript_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [messages, playChime]);

  // Global keydown event listener for custom shortcuts and auto-focus
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // 1. Cmd+K or Ctrl+K -> Clear history
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setMessages([]);
        setConfirmClear(false);
        playChime('clear');
        if (confirmClearTimeoutRef.current) {
          clearTimeout(confirmClearTimeoutRef.current);
          confirmClearTimeoutRef.current = null;
        }
        return;
      }

      // 2. Escape -> Close help modal if open, else Stop speaking / silence July
      if (e.key === 'Escape') {
        if (showHelpModal) {
          setShowHelpModal(false);
          return;
        }
        if (isResponding) {
          stopSpeaking();
          return;
        }
      }

      // Check if user is typing in a text field
      const activeEl = document.activeElement;
      const isTyping =
        activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');

      if (!isTyping) {
        // 3. 'm' or 'M' -> Toggle mute voice response
        if (e.key.toLowerCase() === 'm') {
          e.preventDefault();
          playChime('click');
          setIsMuted((prev) => !prev);
          return;
        }

        // 4. 's' or 'S' -> Cycle playback speed
        if (e.key.toLowerCase() === 's') {
          e.preventDefault();
          playChime('click');
          setPlaybackSpeed((prev) => (prev === 1 ? 1.2 : prev === 1.2 ? 1.5 : 1.0));
          return;
        }

        // 5. 'h' or 'H' -> Toggle help modal
        if (e.key.toLowerCase() === 'h') {
          e.preventDefault();
          playChime('click');
          setShowHelpModal((prev) => !prev);
          return;
        }

        // 5. Any other single character -> Auto-focus input
        if (
          e.key.length === 1 &&
          !e.metaKey &&
          !e.ctrlKey &&
          !e.altKey &&
          inputRef.current &&
          micStatus === 'active'
        ) {
          inputRef.current.focus();
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [micStatus, isResponding, stopSpeaking, showHelpModal, playChime]);

  // ── Teardown ───────────────────────────────────────────────────────────────

  const teardown = useCallback(() => {
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
      } catch {}
      currentSourceRef.current = null;
    }
    if (confirmClearTimeoutRef.current) {
      clearTimeout(confirmClearTimeoutRef.current);
      confirmClearTimeoutRef.current = null;
    }
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

    stopSpeaking();

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
  }, [stopSpeaking]);

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
      formData.append('responseLength', responseLengthRef.current);

      const currentReqId = ++requestIdRef.current;
      setIsProcessing(true);
      queryStartTimeRef.current = Date.now();
      try {
        const result = await withRetry(
          () => talk(formData),
          (attempt, total) => {
            if (currentReqId === requestIdRef.current) {
              setErrorMessage(`Retrying (${attempt}/${total})…`);
            }
          }
        );
        if (currentReqId !== requestIdRef.current) return;
        setErrorMessage(null);
        setIsProcessing(false);

        if (result) {
          console.log('[User] asks:', result.transcript);
          console.log('[July] answers:', result.answer);

          const now = new Date();
          const timestamp = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const latency = ((Date.now() - queryStartTimeRef.current) / 1000).toFixed(1);

          setMessages((prev) => [
            ...prev,
            { role: 'user', text: result.transcript, timestamp },
            {
              role: 'july',
              text: result.answer,
              sources: result.sources,
              timestamp,
              latency: `${latency}s`,
            },
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

            const actualDuration = audioBuffer.duration / playbackSpeedRef.current;
            setPlaybackDuration(actualDuration);
            setPlaybackElapsed(0);
            playbackStartTimeRef.current = Date.now();

            currentSourceRef.current = source;
            setIsResponding(true);
            source.onended = () => {
              setIsResponding(false);
              if (currentSourceRef.current === source) {
                currentSourceRef.current = null;
              }
            };
            source.start();
          }
        }
      } catch (err) {
        console.error('[july] talk error:', err);
        if (currentReqId === requestIdRef.current) {
          setIsProcessing(false);
          setErrorMessage('Connection failed. Please check your mic/network.');
          setTimeout(() => setErrorMessage(null), 4000);
        }
      }
    }, STOP_DEBOUNCE_MS);
  }, []);

  const handlePrompt = useCallback(
    async (promptText: string) => {
      if (isProcessing || isResponding) return;

      stopSpeaking();

      const now = new Date();
      const timestamp = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setMessages((prev) => [...prev, { role: 'user', text: promptText, timestamp }]);

      const currentReqId = ++requestIdRef.current;
      setIsProcessing(true);
      queryStartTimeRef.current = Date.now();
      try {
        const result = await withRetry(
          () =>
            talkText(
              promptText,
              messagesRef.current,
              isMutedRef.current,
              responseLengthRef.current
            ),
          (attempt, total) => {
            if (currentReqId === requestIdRef.current) {
              setErrorMessage(`Retrying (${attempt}/${total})…`);
            }
          }
        );
        if (currentReqId !== requestIdRef.current) return;
        setErrorMessage(null);
        setIsProcessing(false);

        if (result) {
          const latency = ((Date.now() - queryStartTimeRef.current) / 1000).toFixed(1);
          setMessages((prev) => [
            ...prev,
            {
              role: 'july',
              text: result.answer,
              sources: result.sources,
              timestamp,
              latency: `${latency}s`,
            },
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

              const actualDuration = audioBuffer.duration / playbackSpeedRef.current;
              setPlaybackDuration(actualDuration);
              setPlaybackElapsed(0);
              playbackStartTimeRef.current = Date.now();

              currentSourceRef.current = source;
              setIsResponding(true);
              source.onended = () => {
                setIsResponding(false);
                if (currentSourceRef.current === source) {
                  currentSourceRef.current = null;
                }
              };
              source.start();
            } catch (err) {
              console.error('[july] audio playback error:', err);
            }
          }
        }
      } catch (err) {
        console.error('[july] talkText error:', err);
        if (currentReqId === requestIdRef.current) {
          setIsProcessing(false);
          setErrorMessage('Failed to send message. Please try again.');
          setTimeout(() => setErrorMessage(null), 4000);
        }
      }
    },
    [isProcessing, isResponding, stopSpeaking]
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
        const speaking = vol > speakingThresholdRef.current;

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
      playChime('wake');
      startAudioLoop(ctx, stream);
    } catch {
      setMicStatus('denied');
    }
  }, [teardown, startAudioLoop, playChime]);

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

  const formatTime = (time: number) => {
    return `${time.toFixed(1)}s`;
  };

  const taglines: Record<string, string> = {
    idle: 'Tap to wake me up',
    requesting: 'Requesting microphone…',
    standby: isMuted ? 'Standby (Muted) — say something' : 'Standby — say something',
    speaking: "I'm listening…",
    processing: 'Thinking',
    responding: isMuted
      ? `Responding (Muted) — ${formatTime(playbackElapsed)} / ${formatTime(playbackDuration)}`
      : `Speaking — ${formatTime(playbackElapsed)} / ${formatTime(playbackDuration)}`,
    denied: 'Microphone access denied',
    active: isMuted ? 'Standby (Muted) — say something' : 'Standby — say something',
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

        /* ── cursor blink ── */
        @keyframes cursor-blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
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

        .suggestion-chip .chip-arrow {
          opacity: 0;
          transform: translateX(-6px);
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          display: inline-block;
        }
        .suggestion-chip:hover .chip-arrow {
          opacity: 0.85;
          transform: translateX(0);
          color: rgba(160, 220, 255, 0.95);
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

        .delete-msg-button:hover {
          background: rgba(255, 70, 70, 0.08) !important;
          border-color: rgba(255, 70, 70, 0.25) !important;
          color: rgba(255, 100, 100, 0.95) !important;
          box-shadow: 0 0 8px rgba(255, 70, 70, 0.1) !important;
        }

        .feedback-button:hover {
          background: rgba(255, 255, 255, 0.06) !important;
          border-color: rgba(0, 180, 255, 0.25) !important;
          color: rgba(255, 255, 255, 0.95) !important;
          box-shadow: 0 0 6px rgba(0, 180, 255, 0.08) !important;
        }

        @keyframes dot-pulse-green {
          0%, 100% { box-shadow: 0 0 0 0 rgba(0, 220, 140, 0.7); }
          50% { box-shadow: 0 0 8px 3px rgba(0, 220, 140, 0.3); }
        }
        @keyframes dot-pulse-amber {
          0%, 100% { box-shadow: 0 0 0 0 rgba(255, 150, 40, 0.7); }
          50% { box-shadow: 0 0 8px 3px rgba(255, 150, 40, 0.3); }
        }

        .july-scroll-container::-webkit-scrollbar {
          width: 4px;
        }
        .july-scroll-container::-webkit-scrollbar-track {
          background: transparent;
        }
        .july-scroll-container::-webkit-scrollbar-thumb {
          background: rgba(0, 180, 255, 0.15);
          border-radius: 4px;
          transition: background 0.2s ease;
        }
        .july-scroll-container::-webkit-scrollbar-thumb:hover {
          background: rgba(0, 180, 255, 0.35);
        }

        .control-btn {
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }
        .control-btn:hover {
          background: rgba(255, 255, 255, 0.08) !important;
          border-color: rgba(0, 180, 255, 0.25) !important;
          color: #fff !important;
          transform: scale(1.08);
          box-shadow: 0 0 15px rgba(0, 180, 255, 0.15) !important;
        }
        .control-btn:active {
          transform: scale(0.95);
        }

        @keyframes alert-shake {
          0%, 100% { transform: scale(1) translateX(0); }
          25% { transform: scale(1.08) translateX(-2px) rotate(-3deg); }
          75% { transform: scale(1.08) translateX(2px) rotate(3deg); }
        }
        .confirm-shake {
          animation: alert-shake 0.35s ease-in-out infinite;
          border-color: rgba(255, 70, 70, 0.4) !important;
          box-shadow: 0 0 20px rgba(255, 70, 70, 0.3), inset 0 0 10px rgba(255, 70, 70, 0.1) !important;
        }

        @keyframes warning-pulse {
          0%, 100% { transform: translateY(-50%) scale(1); }
          50% { transform: translateY(-50%) scale(1.15); color: rgba(255, 70, 70, 0.95); text-shadow: 0 0 8px rgba(255, 70, 70, 0.45); }
        }
        .warning-pulse {
          animation: warning-pulse 0.8s ease-in-out infinite;
        }
        .input-clear-btn {
          transition: all 0.2s ease !important;
        }
        .input-clear-btn:hover {
          color: rgba(255, 100, 100, 0.85) !important;
          transform: translateY(-50%) scale(1.15) !important;
        }
        .input-clear-btn:active {
          transform: translateY(-50%) scale(0.9) !important;
        }

        .tooltip-bubble {
          position: absolute;
          top: 52px;
          left: 50%;
          transform: translateX(-50%) translateY(-4px);
          background: rgba(3, 5, 12, 0.92);
          border: 1px solid rgba(0, 180, 255, 0.2);
          color: rgba(160, 220, 255, 0.85);
          padding: 4px 8px;
          border-radius: 6px;
          font-size: 10px;
          letter-spacing: 0.04em;
          white-space: nowrap;
          pointer-events: none;
          opacity: 0;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5), 0 0 8px rgba(0, 180, 255, 0.08);
          backdrop-filter: blur(8px);
          z-index: 110;
        }
        .control-btn:hover .tooltip-bubble {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }
        .shortcuts-helper {
          cursor: pointer;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .shortcuts-helper:hover {
          color: rgba(160, 220, 255, 0.75) !important;
          text-shadow: 0 0 8px rgba(0, 180, 255, 0.5);
          transform: translateY(-1px);
        }
        .sensitivity-slider {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 6px;
          border-radius: 3px;
          background: rgba(255, 255, 255, 0.08);
          outline: none;
          transition: background 0.3s;
        }
        .sensitivity-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #00dc8c;
          cursor: pointer;
          box-shadow: 0 0 10px rgba(0, 220, 140, 0.6);
          transition: transform 0.1s, background 0.3s;
        }
        .sensitivity-slider::-webkit-slider-thumb:hover {
          transform: scale(1.2);
          background: #00ffaa;
          box-shadow: 0 0 14px rgba(0, 255, 170, 0.8);
        }
        .sensitivity-slider::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #00dc8c;
          cursor: pointer;
          border: none;
          box-shadow: 0 0 10px rgba(0, 220, 140, 0.6);
          transition: transform 0.1s, background 0.3s;
        }
        .sensitivity-slider::-moz-range-thumb:hover {
          transform: scale(1.2);
          background: #00ffaa;
          box-shadow: 0 0 14px rgba(0, 255, 170, 0.8);
        }
        .settings-text-input {
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .settings-text-input:focus {
          border-color: rgba(0, 180, 255, 0.45) !important;
          box-shadow: 0 0 15px rgba(0, 180, 255, 0.15), inset 0 0 8px rgba(0, 180, 255, 0.05);
          background: rgba(255, 255, 255, 0.06) !important;
        }
      `}</style>

      <div className='july-root relative flex flex-col items-center justify-center min-h-screen w-full overflow-hidden bg-[#03050c]'>
        {/* ── Error Banner ── */}
        {errorMessage && (
          <div
            style={{
              position: 'absolute',
              top: 80,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 200,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 18px',
              borderRadius: 14,
              background: 'rgba(255, 70, 70, 0.08)',
              border: '1px solid rgba(255, 70, 70, 0.25)',
              backdropFilter: 'blur(12px)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35), 0 0 15px rgba(255, 70, 70, 0.12)',
              fontSize: 12,
              fontWeight: 300,
              letterSpacing: '0.04em',
              color: 'rgba(255, 100, 100, 0.95)',
              userSelect: 'none',
              animation: 'msg-in 0.3s ease forwards',
            }}
          >
            <span style={{ fontSize: 13 }}>⚠️</span>
            <span>{errorMessage}</span>
          </div>
        )}

        {/* ── System Status Badge ── */}
        <div
          style={{
            position: 'absolute',
            top: 24,
            left: 24,
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 14px',
            borderRadius: 20,
            background: 'rgba(255, 255, 255, 0.02)',
            border: isCopyPulseActive
              ? '1px solid rgba(0, 220, 140, 0.35)'
              : '1px solid rgba(255, 255, 255, 0.04)',
            backdropFilter: 'blur(10px)',
            boxShadow: isCopyPulseActive
              ? '0 0 18px rgba(0, 220, 140, 0.3), 0 4px 20px rgba(0, 0, 0, 0.2)'
              : '0 4px 20px rgba(0, 0, 0, 0.2)',
            fontSize: 10,
            fontWeight: 400,
            letterSpacing: '0.12em',
            color: isCopyPulseActive ? '#00dc8c' : 'rgba(160, 220, 255, 0.8)',
            userSelect: 'none',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: isCopyPulseActive
                ? '#00dc8c'
                : isProcessing || isResponding
                  ? '#ff9628'
                  : '#00dc8c',
              animation: isCopyPulseActive
                ? 'dot-pulse-green 0.5s infinite ease-in-out'
                : isProcessing || isResponding
                  ? 'dot-pulse-amber 1.8s infinite ease-in-out'
                  : 'dot-pulse-green 2s infinite ease-in-out',
              transition: 'background 0.4s ease',
            }}
          />
          <span>
            JULY v1.0 •{' '}
            {isCopyPulseActive
              ? 'COPIED!'
              : isProcessing || isResponding
                ? 'PROCESSING'
                : isMuted
                  ? `ONLINE (MUTED${messages.length > 0 ? ` • ${messages.length} MSGS` : ''})`
                  : `ONLINE${messages.length > 0 ? ` • ${messages.length} MSGS` : ''}`}
          </span>
        </div>

        {/* ── Export Chat Button ── */}
        {messages.length > 0 && (
          <button
            type='button'
            className='control-btn'
            onClick={handleExportChat}
            style={{
              position: 'absolute',
              top: 24,
              right: 192,
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
              color: 'rgba(160, 220, 255, 0.85)',
              boxShadow: '0 0 15px rgba(0,180,255,0.1), inset 0 0 10px rgba(0,180,255,0.02)',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
            aria-label='Export conversation history'
          >
            <IconDownload />
            <span className='tooltip-bubble'>Export conversation</span>
          </button>
        )}

        {/* ── Clear Chat Button ── */}
        {messages.length > 0 && (
          <button
            type='button'
            className={confirmClear ? 'control-btn confirm-shake' : 'control-btn'}
            onClick={() => {
              if (confirmClear) {
                playChime('clear');
                if (confirmClearTimeoutRef.current) {
                  clearTimeout(confirmClearTimeoutRef.current);
                  confirmClearTimeoutRef.current = null;
                }
                setMessages([]);
                setConfirmClear(false);
              } else {
                playChime('click');
                setConfirmClear(true);
                confirmClearTimeoutRef.current = setTimeout(() => {
                  setConfirmClear(false);
                  confirmClearTimeoutRef.current = null;
                }, 3000);
              }
            }}
            style={{
              position: 'absolute',
              top: 24,
              right: 136,
              zIndex: 100,
              width: 44,
              height: 44,
              borderRadius: '50%',
              border: confirmClear
                ? '1px solid rgba(255,70,70,0.25)'
                : '1px solid rgba(255,255,255,0.08)',
              background: 'rgba(255,255,255,0.03)',
              backdropFilter: 'blur(8px)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: confirmClear ? 'rgba(255,70,70,0.95)' : 'rgba(160,220,255,0.85)',
              boxShadow: confirmClear
                ? '0 0 15px rgba(255,70,70,0.25), inset 0 0 10px rgba(255, 70, 70, 0.05)'
                : '0 0 15px rgba(0,180,255,0.1), inset 0 0 10px rgba(0,180,255,0.02)',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
            aria-label={confirmClear ? 'Confirm clear chat history' : 'Clear conversation history'}
          >
            {confirmClear ? <IconAlertCircle /> : <IconTrash />}
            <span className='tooltip-bubble'>
              {confirmClear ? 'Confirm clear history' : 'Clear conversation'}
            </span>
          </button>
        )}

        {/* ── Speed Selector Button ── */}
        <button
          type='button'
          className='control-btn'
          onClick={() => {
            playChime('click');
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
            border:
              playbackSpeed === 1.2
                ? '1px solid rgba(0, 220, 140, 0.25)'
                : playbackSpeed === 1.5
                  ? '1px solid rgba(255, 150, 40, 0.3)'
                  : '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(255, 255, 255, 0.03)',
            backdropFilter: 'blur(8px)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 400,
            color:
              playbackSpeed === 1.2
                ? 'rgba(0, 220, 140, 0.95)'
                : playbackSpeed === 1.5
                  ? 'rgba(255, 150, 40, 0.95)'
                  : 'rgba(160, 220, 255, 0.85)',
            boxShadow:
              playbackSpeed === 1.2
                ? '0 0 15px rgba(0, 220, 140, 0.15), inset 0 0 10px rgba(0, 220, 140, 0.03)'
                : playbackSpeed === 1.5
                  ? '0 0 15px rgba(255, 150, 40, 0.2), inset 0 0 10px rgba(255, 150, 40, 0.05)'
                  : '0 0 15px rgba(0, 180, 255, 0.1), inset 0 0 10px rgba(0, 180, 255, 0.02)',
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
          className='control-btn'
          onClick={() => {
            playChime('click');
            setIsMuted((m) => !m);
          }}
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
        >
          {isMuted ? <IconVolumeX /> : <IconVolume2 />}
          <span className='tooltip-bubble'>{isMuted ? 'Unmute voice' : 'Mute voice'}</span>
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
                  border: isMuted
                    ? `1px solid rgba(140,160,180,${Math.max(0, 0.15 - i * 0.03)})`
                    : '1px solid rgba(0,150,255,0.25)',
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

          {/* ── playback progress ring ── */}
          {orbMode === 'responding' && playbackDuration > 0 && (
            <svg
              width='160'
              height='160'
              style={{
                position: 'absolute',
                zIndex: 15,
                pointerEvents: 'none',
              }}
              aria-hidden='true'
            >
              {/* Background Track */}
              <circle
                cx='80'
                cy='80'
                r='77'
                fill='transparent'
                stroke='rgba(0, 220, 140, 0.12)'
                strokeWidth='2'
              />
              {/* Progress Ring */}
              <circle
                cx='80'
                cy='80'
                r='77'
                fill='transparent'
                stroke='#00dc8c'
                strokeWidth='2.5'
                strokeDasharray='484'
                strokeDashoffset={484 * (1 - Math.min(1, playbackElapsed / playbackDuration))}
                strokeLinecap='round'
                style={{
                  transition: 'stroke-dashoffset 80ms linear',
                  transform: 'rotate(-90deg)',
                  transformOrigin: '80px 80px',
                  filter: 'drop-shadow(0 0 5px rgba(0, 220, 140, 0.6))',
                }}
              />
            </svg>
          )}

          {/* ── main orb button ── */}
          <button
            type='button'
            id='july-orb'
            onClick={
              isResponding
                ? stopSpeaking
                : isProcessing
                  ? cancelProcessing
                  : micStatus === 'idle' || micStatus === 'denied'
                    ? requestMic
                    : undefined
            }
            disabled={micStatus === 'requesting'}
            aria-label={
              micStatus === 'idle'
                ? 'Activate July'
                : isProcessing
                  ? 'Cancel request'
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
                  : isResponding || isProcessing
                    ? 'pointer'
                    : micStatus === 'active'
                      ? 'default'
                      : 'pointer',
              background:
                orbMode === 'processing'
                  ? 'radial-gradient(circle at 35% 35%, rgba(255,140,30,0.3), rgba(120,50,0,0.85) 60%, rgba(15,5,0,0.98))'
                  : orbMode === 'responding'
                    ? 'radial-gradient(circle at 35% 35%, rgba(0,220,140,0.28), rgba(0,80,60,0.85) 60%, rgba(0,12,8,0.98))'
                    : isMuted
                      ? 'radial-gradient(circle at 35% 35%, rgba(140,160,180,0.2), rgba(60,70,80,0.8) 60%, rgba(5,8,12,0.98))'
                      : 'radial-gradient(circle at 35% 35%, rgba(0,200,255,0.28), rgba(0,50,120,0.88) 60%, rgba(0,8,28,0.98))',
              boxShadow:
                orbMode === 'processing'
                  ? '0 0 50px rgba(255,140,30,0.45), 0 0 100px rgba(180,80,0,0.22), inset 0 0 40px rgba(255,160,40,0.1)'
                  : orbMode === 'responding'
                    ? '0 0 50px rgba(0,220,140,0.45), 0 0 100px rgba(0,160,80,0.22), inset 0 0 40px rgba(0,230,160,0.1)'
                    : isMuted
                      ? '0 0 45px rgba(140,160,180,0.25), 0 0 90px rgba(60,70,80,0.12), inset 0 0 30px rgba(140,160,180,0.08)'
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
                      : isMuted
                        ? 'radial-gradient(circle at 38% 28%, rgba(160,180,200,0.12), transparent 58%)'
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
                      : isMuted
                        ? 'rgba(160,180,200,0.75)'
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
                <IconWave active={isSpeaking} volume={volume} />
              )}
              {isProcessing && <IconThinking />}
              {isResponding && <IconSpeaking playbackSpeed={playbackSpeed} />}
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
            {/* ── Welcome Guide Panel ── */}
            {showWelcomeGuide && (
              <div
                style={{
                  width: '100%',
                  padding: '20px',
                  borderRadius: 20,
                  background: 'rgba(255, 255, 255, 0.01)',
                  border: '1px solid rgba(255, 255, 255, 0.04)',
                  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.25)',
                  backdropFilter: 'blur(10px)',
                  textAlign: 'center',
                  marginBottom: 8,
                  animation: 'msg-in 0.4s ease forwards',
                  position: 'relative',
                }}
              >
                <button
                  type='button'
                  onClick={() => {
                    playChime('click');
                    setShowWelcomeGuide(false);
                  }}
                  style={{
                    position: 'absolute',
                    top: 12,
                    right: 12,
                    background: 'none',
                    border: 'none',
                    outline: 'none',
                    cursor: 'pointer',
                    color: 'rgba(160, 220, 255, 0.4)',
                    padding: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '50%',
                    transition: 'all 0.2s',
                  }}
                  className='control-btn'
                  aria-label='Dismiss welcome guide'
                  title='Dismiss guide'
                >
                  <IconX size={12} />
                </button>
                <h2
                  style={{
                    fontSize: 14,
                    fontWeight: 400,
                    color: 'rgba(255, 255, 255, 0.95)',
                    margin: '0 0 6px 0',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    textShadow: '0 0 8px rgba(0, 180, 255, 0.2)',
                  }}
                >
                  {greeting}
                </h2>
                <p
                  style={{
                    fontSize: 12,
                    fontWeight: 300,
                    color: 'rgba(160, 220, 255, 0.72)',
                    margin: 0,
                    lineHeight: 1.55,
                  }}
                >
                  July is fully synchronized and at your service. Choose a target prompt below,
                  start typing, or activate the orb to interact.
                </p>
              </div>
            )}

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
                onClick={() => {
                  playChime('click');
                  handlePrompt(chip.prompt);
                }}
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
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                  }}
                >
                  <span>{chip.text}</span>
                  <span className='chip-arrow'>↗</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {/* ── conversation feed ── */}
        {messages.length > 0 && (
          <div style={{ position: 'relative', width: '100%', maxWidth: 520 }}>
            {/* Top Fade Overlay */}
            <div
              style={{
                position: 'absolute',
                top: 40,
                left: 24,
                right: 24,
                height: 20,
                background: 'linear-gradient(to bottom, #03050c 20%, transparent)',
                pointerEvents: 'none',
                zIndex: 5,
              }}
            />
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className='july-scroll-container'
              style={{
                marginTop: 40,
                width: '100%',
                maxHeight: 260,
                overflowY: 'auto',
                padding: '0 24px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              {messages.map((msg, idx) => {
                const isSpeakingThis =
                  msg.role === 'july' && idx === messages.length - 1 && isResponding;
                return (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: message feed is strictly append-only
                    key={idx}
                    className='msg-in'
                    style={{
                      display: 'flex',
                      justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    }}
                  >
                    {/* biome-ignore lint/a11y/noStaticElementInteractions: message bubbles are static, but double-click to copy is a custom convenience gesture */}
                    <div
                      onDoubleClick={async () => {
                        try {
                          await navigator.clipboard.writeText(msg.text);
                          handleCopyNotification();
                        } catch (err) {
                          console.error('Failed to copy: ', err);
                        }
                      }}
                      title='Double-click to copy message'
                      style={{
                        maxWidth: '78%',
                        padding: '10px 15px',
                        borderRadius:
                          msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
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
                        color:
                          msg.role === 'user' ? 'rgba(160,215,255,0.9)' : 'rgba(100,240,180,0.9)',
                        boxShadow:
                          msg.role === 'user'
                            ? '0 2px 16px rgba(0,120,255,0.08)'
                            : '0 2px 16px rgba(0,200,120,0.08)',
                      }}
                    >
                      {typingMsgIdx === idx ? (
                        <>
                          {typingText}
                          <span
                            style={{
                              display: 'inline-block',
                              width: '0.55em',
                              height: '1em',
                              background: 'rgba(0, 220, 140, 0.75)',
                              marginLeft: 2,
                              verticalAlign: 'text-bottom',
                              borderRadius: 1,
                              animation: 'cursor-blink 0.7s step-end infinite',
                            }}
                            aria-hidden='true'
                          />
                        </>
                      ) : (
                        msg.text
                      )}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                          marginTop: 8,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: 8,
                          }}
                        >
                          {msg.sources && msg.sources.length > 0 && (
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
                          )}
                          {isSpeakingThis && (
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '3px 8px',
                                borderRadius: 8,
                                background: 'rgba(0, 220, 140, 0.08)',
                                border: '1px solid rgba(0, 220, 140, 0.15)',
                                backdropFilter: 'blur(8px)',
                              }}
                            >
                              <IconSpeakerWave />
                              <span
                                style={{
                                  fontSize: 9,
                                  color: 'rgba(100, 240, 180, 0.95)',
                                  letterSpacing: '0.05em',
                                  fontWeight: 400,
                                }}
                              >
                                PLAYING AUDIO
                              </span>
                            </div>
                          )}
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            marginLeft: 'auto',
                          }}
                        >
                          {msg.latency && (
                            <span
                              style={{
                                fontSize: 9,
                                color: 'rgba(0, 220, 140, 0.45)',
                                marginRight: 4,
                                letterSpacing: '0.04em',
                                userSelect: 'none',
                              }}
                              title='Response Generation Latency'
                            >
                              ⚡ {msg.latency}
                            </span>
                          )}
                          {msg.timestamp && (
                            <span
                              style={{
                                fontSize: 9,
                                color: 'rgba(160, 220, 255, 0.35)',
                                marginRight: 8,
                                letterSpacing: '0.02em',
                                userSelect: 'none',
                              }}
                            >
                              {msg.timestamp}
                            </span>
                          )}
                          {msg.role === 'july' && (
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                                marginRight: 4,
                              }}
                            >
                              <button
                                type='button'
                                onClick={() => handleMessageFeedback(idx, 'like')}
                                className='feedback-button'
                                aria-label='Like message'
                                title='Like'
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  padding: '4px',
                                  borderRadius: '6px',
                                  border: '1px solid rgba(255, 255, 255, 0.05)',
                                  background: 'rgba(255, 255, 255, 0.02)',
                                  color:
                                    msg.feedback === 'like'
                                      ? '#00dc8c'
                                      : 'rgba(160, 220, 255, 0.5)',
                                  cursor: 'pointer',
                                  transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                                }}
                              >
                                <IconThumbsUp />
                              </button>
                              <button
                                type='button'
                                onClick={() => handleMessageFeedback(idx, 'dislike')}
                                className='feedback-button'
                                aria-label='Dislike message'
                                title='Dislike'
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  padding: '4px',
                                  borderRadius: '6px',
                                  border: '1px solid rgba(255, 255, 255, 0.05)',
                                  background: 'rgba(255, 255, 255, 0.02)',
                                  color:
                                    msg.feedback === 'dislike'
                                      ? '#ff4646'
                                      : 'rgba(160, 220, 255, 0.5)',
                                  cursor: 'pointer',
                                  transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                                }}
                              >
                                <IconThumbsDown />
                              </button>
                            </div>
                          )}
                          <CopyButton text={msg.text} onCopy={handleCopyNotification} />
                          <button
                            type='button'
                            onClick={() => handleDeleteMessage(idx)}
                            className='delete-msg-button'
                            aria-label='Delete message'
                            title='Delete message'
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              padding: '4px',
                              borderRadius: '6px',
                              border: '1px solid rgba(255, 255, 255, 0.05)',
                              background: 'rgba(255, 255, 255, 0.02)',
                              color: 'rgba(255, 100, 100, 0.65)',
                              cursor: 'pointer',
                              transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                            }}
                          >
                            <IconTrash size={12} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {isProcessing && (
                <div
                  className='msg-in'
                  style={{
                    display: 'flex',
                    justifyContent: 'flex-start',
                  }}
                >
                  <div
                    style={{
                      maxWidth: '78%',
                      padding: '10px 15px',
                      borderRadius: '18px 18px 18px 4px',
                      fontSize: 13,
                      fontWeight: 300,
                      lineHeight: 1.55,
                      backdropFilter: 'blur(12px)',
                      background: 'rgba(0, 220, 140, 0.05)',
                      border: '1px solid rgba(0, 220, 140, 0.1)',
                      color: 'rgba(100, 240, 180, 0.7)',
                      boxShadow: '0 2px 16px rgba(0, 200, 120, 0.04)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <span style={{ display: 'inline-flex', gap: 4 }} aria-hidden='true'>
                      {[0, 180, 360].map((ms) => (
                        <span
                          key={ms}
                          style={{
                            animation: `thinking-dot 1.2s ease-in-out ${ms}ms infinite`,
                            display: 'inline-block',
                            fontSize: 16,
                            lineHeight: '10px',
                          }}
                        >
                          •
                        </span>
                      ))}
                    </span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Bottom Fade Overlay */}
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 24,
                right: 24,
                height: 20,
                background: 'linear-gradient(to top, #03050c 20%, transparent)',
                pointerEvents: 'none',
                zIndex: 5,
              }}
            />

            {showScrollBottom && (
              <button
                type='button'
                onClick={() => {
                  messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
                  setHasNewMessageAlert(false);
                }}
                style={{
                  position: 'absolute',
                  right: 28,
                  bottom: 12,
                  zIndex: 20,
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  border: hasNewMessageAlert
                    ? '1px solid rgba(0, 220, 140, 0.35)'
                    : '1px solid rgba(255, 255, 255, 0.08)',
                  background: 'rgba(3, 5, 12, 0.75)',
                  backdropFilter: 'blur(8px)',
                  boxShadow: hasNewMessageAlert
                    ? '0 0 16px rgba(0, 220, 140, 0.55), 0 4px 12px rgba(0, 0, 0, 0.5)'
                    : '0 4px 12px rgba(0, 0, 0, 0.5), 0 0 10px rgba(0, 180, 255, 0.1)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: hasNewMessageAlert ? '#00dc8c' : 'rgba(160, 220, 255, 0.85)',
                  transition: 'all 0.25s ease',
                  animation: 'msg-in 0.25s ease forwards',
                }}
                title='Scroll to bottom'
                aria-label='Scroll to bottom'
              >
                <IconChevronDown />
                {hasNewMessageAlert && (
                  <span
                    style={{
                      position: 'absolute',
                      top: 1,
                      right: 1,
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: '#00dc8c',
                      boxShadow: '0 0 8px #00dc8c',
                    }}
                  />
                )}
              </button>
            )}
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
            <div style={{ flex: 1, position: 'relative', display: 'flex' }}>
              <input
                ref={inputRef}
                type='text'
                maxLength={250}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setInputText('');
                  } else if (e.key === 'ArrowUp' && inputText === '') {
                    e.preventDefault();
                    const userMsgs = messages.filter((m) => m.role === 'user');
                    if (userMsgs.length > 0) {
                      setInputText(userMsgs[userMsgs.length - 1].text);
                      playChime('click');
                    }
                  }
                }}
                disabled={isProcessing || isResponding}
                placeholder={
                  isProcessing
                    ? 'Thinking...'
                    : isResponding
                      ? 'Speaking...'
                      : PLACEHOLDERS[placeholderIdx]
                }
                style={{
                  flex: 1,
                  padding: '12px 78px 12px 18px',
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
              {inputText.length > 0 && (
                <>
                  <button
                    type='button'
                    onClick={() => {
                      playChime('click');
                      setCounterMode((prev) => (prev === 'char' ? 'word' : 'char'));
                    }}
                    className={inputText.length >= 230 ? 'warning-pulse' : ''}
                    style={{
                      position: 'absolute',
                      right: 42,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      fontSize: 10,
                      fontWeight: 300,
                      color:
                        inputText.length >= 220
                          ? 'rgba(255, 100, 100, 0.75)'
                          : 'rgba(160, 220, 255, 0.45)',
                      background: 'none',
                      border: 'none',
                      outline: 'none',
                      cursor: 'pointer',
                      padding: 0,
                      transition: 'color 0.2s ease',
                      userSelect: 'none',
                    }}
                    title={
                      counterMode === 'char' ? 'Switch to word count' : 'Switch to character count'
                    }
                    aria-label={
                      counterMode === 'char' ? 'Switch to word count' : 'Switch to character count'
                    }
                  >
                    {getCounterText()}
                  </button>
                  <button
                    type='button'
                    onClick={() => {
                      setInputText('');
                      inputRef.current?.focus();
                    }}
                    style={{
                      position: 'absolute',
                      right: 14,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      outline: 'none',
                      cursor: 'pointer',
                      padding: 4,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'rgba(160, 220, 255, 0.4)',
                    }}
                    className='input-clear-btn'
                    title='Clear text'
                    aria-label='Clear text'
                  >
                    <IconX size={12} />
                  </button>
                </>
              )}
              {/* Character Limit Visual Progress Bar */}
              {inputText.length > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 18,
                    right: 78,
                    height: 2,
                    background: 'rgba(255, 255, 255, 0.05)',
                    borderRadius: 1,
                    overflow: 'hidden',
                    pointerEvents: 'none',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${(inputText.length / 250) * 100}%`,
                      background:
                        inputText.length >= 220
                          ? 'linear-gradient(90deg, #ff4646, #ff7878)'
                          : 'linear-gradient(90deg, #00b4ff, #00dc8c)',
                      boxShadow:
                        inputText.length >= 220
                          ? '0 0 6px rgba(255, 70, 70, 0.6)'
                          : '0 0 6px rgba(0, 180, 255, 0.6)',
                      transition: 'width 0.15s ease-out, background 0.2s ease',
                    }}
                  />
                </div>
              )}
            </div>
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

        {/* Keyboard Shortcuts Helper */}
        {micStatus === 'active' && (
          <button
            type='button'
            className='shortcuts-helper'
            onClick={() => {
              playChime('click');
              setShowHelpModal(true);
            }}
            style={{
              marginTop: 12,
              fontSize: 10,
              fontWeight: 300,
              letterSpacing: '0.06em',
              color: 'rgba(160, 220, 255, 0.3)',
              display: 'flex',
              gap: 16,
              userSelect: 'none',
              pointerEvents: 'auto',
              animation: 'msg-in 0.5s ease forwards',
              background: 'none',
              border: 'none',
              outline: 'none',
              padding: 0,
            }}
            title='Click to view interaction guide & commands'
          >
            <span>[Esc] Silence</span>
            <span>[⌘K / ⌃K] Clear</span>
            <span>[M] Mute</span>
            <span>[S] Speed</span>
            <span>[H] Help</span>
          </button>
        )}

        {/* Interaction Protocols Help Modal */}
        {showHelpModal && (
          // biome-ignore lint/a11y/useKeyWithClickEvents: Escape key already closes the modal globally
          // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click handler is standard for modal dismissal
          <div
            onClick={() => {
              playChime('click');
              setShowHelpModal(false);
            }}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 300,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(3, 5, 12, 0.75)',
              backdropFilter: 'blur(12px)',
              animation: 'msg-in 0.25s ease forwards',
            }}
          >
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation doesn't trigger actions */}
            {/* biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation wrapper is standard */}
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '90%',
                maxWidth: 460,
                borderRadius: 24,
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid rgba(0, 180, 255, 0.2)',
                boxShadow: '0 24px 64px rgba(0, 0, 0, 0.65), 0 0 30px rgba(0, 180, 255, 0.15)',
                padding: '28px 24px',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                gap: 20,
              }}
            >
              {/* Header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                  paddingBottom: 14,
                }}
              >
                <h3
                  style={{
                    fontSize: 14,
                    fontWeight: 400,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'rgba(0, 180, 255, 0.95)',
                    textShadow: '0 0 8px rgba(0, 180, 255, 0.4)',
                    margin: 0,
                  }}
                >
                  Interaction Protocols
                </h3>
                <button
                  type='button'
                  onClick={() => {
                    playChime('click');
                    setShowHelpModal(false);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    outline: 'none',
                    cursor: 'pointer',
                    color: 'rgba(160, 220, 255, 0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 4,
                    borderRadius: '50%',
                    transition: 'all 0.2s',
                  }}
                  className='control-btn'
                  aria-label='Close help modal'
                >
                  <IconX size={16} />
                </button>
              </div>

              {/* Body */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 12 }}>
                {/* Keyboard shortcuts */}
                <div>
                  <h4
                    style={{
                      fontSize: 11,
                      fontWeight: 400,
                      color: 'rgba(255, 255, 255, 0.8)',
                      letterSpacing: '0.05em',
                      marginBottom: 8,
                      textTransform: 'uppercase',
                    }}
                  >
                    Keyboard Shortcuts
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {[
                      { keys: ['Esc'], desc: 'Silence July / Stop response playback' },
                      { keys: ['⌘ K', '⌃ K'], desc: 'Clear conversation history' },
                      { keys: ['M'], desc: 'Toggle audio feedback mute' },
                      { keys: ['S'], desc: 'Cycle playback speed (1.0x → 1.2x → 1.5x)' },
                      { keys: ['H'], desc: 'Toggle help modal' },
                      { keys: ['↑'], desc: 'Recall / edit last sent prompt (in empty input)' },
                      { keys: ['Any Key'], desc: 'Auto-focus prompt input box (when active)' },
                    ].map((item) => (
                      <div
                        key={item.desc}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: 12,
                        }}
                      >
                        <span style={{ color: 'rgba(160, 220, 255, 0.7)', fontWeight: 300 }}>
                          {item.desc}
                        </span>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {item.keys.map((k) => (
                            <kbd
                              key={k}
                              style={{
                                display: 'inline-block',
                                padding: '2px 6px',
                                fontSize: 10,
                                fontWeight: 400,
                                color: '#fff',
                                background: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid rgba(255, 255, 255, 0.08)',
                                borderRadius: 4,
                                boxShadow: '0 2px 0 rgba(0, 0, 0, 0.3)',
                                fontFamily: 'inherit',
                              }}
                            >
                              {k}
                            </kbd>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Mouse Actions */}
                <div>
                  <h4
                    style={{
                      fontSize: 11,
                      fontWeight: 400,
                      color: 'rgba(255, 255, 255, 0.8)',
                      letterSpacing: '0.05em',
                      marginBottom: 8,
                      textTransform: 'uppercase',
                    }}
                  >
                    Control Panel & Gesture Bindings
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {[
                      {
                        action: 'Orb Interaction',
                        desc: 'Click the central orb to activate microphone / cancel / silence response',
                      },
                      {
                        action: 'Playback Ring',
                        desc: 'Outer green ring displays remaining speech duration',
                      },
                      {
                        action: 'Speed Selector',
                        desc: 'Click top right number to throttle speech rate',
                      },
                      {
                        action: 'Mute Button',
                        desc: 'Click top right speaker icon to toggle sound response',
                      },
                      {
                        action: 'Clear Button',
                        desc: 'Click trash icon (double tap to confirm) to wipe chat logs',
                      },
                      {
                        action: 'Reaction Badges',
                        desc: 'Click thumbs up/down icons under message bubbles to feedback',
                      },
                    ].map((item) => (
                      <div
                        key={item.action}
                        style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}
                      >
                        <span style={{ color: 'rgba(0, 180, 255, 0.85)', fontWeight: 400 }}>
                          {item.action}
                        </span>
                        <span
                          style={{
                            color: 'rgba(160, 220, 255, 0.55)',
                            fontWeight: 300,
                            fontSize: 11,
                          }}
                        >
                          {item.desc}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Profile Personalization */}
                <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: 16 }}>
                  <h4
                    style={{
                      fontSize: 11,
                      fontWeight: 400,
                      color: 'rgba(255, 255, 255, 0.8)',
                      letterSpacing: '0.05em',
                      marginBottom: 8,
                      textTransform: 'uppercase',
                    }}
                  >
                    Profile Personalization
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: 12,
                      }}
                    >
                      <span style={{ color: 'rgba(160, 220, 255, 0.7)', fontWeight: 300 }}>
                        Preferred Display Name
                      </span>
                    </div>
                    <input
                      type='text'
                      value={userName}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val.length <= 25) {
                          setUserName(val);
                        }
                      }}
                      style={{
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: 12,
                        padding: '10px 14px',
                        color: '#fff',
                        fontSize: 12,
                        outline: 'none',
                        transition: 'all 0.2s',
                        width: '100%',
                      }}
                      placeholder='e.g. Master, Creator'
                      className='settings-text-input'
                      aria-label='Preferred Display Name'
                    />
                  </div>
                </div>

                {/* Acoustic Calibration */}
                <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: 16 }}>
                  <h4
                    style={{
                      fontSize: 11,
                      fontWeight: 400,
                      color: 'rgba(255, 255, 255, 0.8)',
                      letterSpacing: '0.05em',
                      marginBottom: 8,
                      textTransform: 'uppercase',
                    }}
                  >
                    Acoustic Calibration
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: 12,
                      }}
                    >
                      <span style={{ color: 'rgba(160, 220, 255, 0.7)', fontWeight: 300 }}>
                        Microphone Sensitivity (lower threshold = more sensitive)
                      </span>
                      <span
                        style={{
                          color: '#00dc8c',
                          fontWeight: 400,
                          textShadow: '0 0 6px rgba(0, 220, 140, 0.4)',
                        }}
                      >
                        {speakingThreshold} RMS
                      </span>
                    </div>
                    <input
                      type='range'
                      min='3'
                      max='30'
                      value={speakingThreshold}
                      onChange={(e) => setSpeakingThreshold(Number(e.target.value))}
                      className='sensitivity-slider'
                      aria-label='Microphone Sensitivity Threshold'
                    />
                  </div>
                </div>

                {/* Session Diagnostics */}
                <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: 16 }}>
                  <h4
                    style={{
                      fontSize: 11,
                      fontWeight: 400,
                      color: 'rgba(255, 255, 255, 0.8)',
                      letterSpacing: '0.05em',
                      marginBottom: 8,
                      textTransform: 'uppercase',
                    }}
                  >
                    Session Diagnostics
                  </h4>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 10,
                      fontSize: 12,
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span
                        style={{
                          color: 'rgba(160, 220, 255, 0.55)',
                          fontSize: 10,
                          textTransform: 'uppercase',
                        }}
                      >
                        Queries Sent
                      </span>
                      <span style={{ color: '#fff', fontWeight: 300 }}>
                        {messages.filter((m) => m.role === 'user').length}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span
                        style={{
                          color: 'rgba(160, 220, 255, 0.55)',
                          fontSize: 10,
                          textTransform: 'uppercase',
                        }}
                      >
                        Avg Latency
                      </span>
                      <span style={{ color: '#fff', fontWeight: 300 }}>
                        {(() => {
                          const latMsgs = messages.filter((m) => m.latency);
                          if (latMsgs.length === 0) return 'N/A';
                          const sum = latMsgs.reduce(
                            (acc, m) => acc + parseFloat(m.latency || '0'),
                            0
                          );
                          return `⚡ ${(sum / latMsgs.length).toFixed(1)}s`;
                        })()}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span
                        style={{
                          color: 'rgba(160, 220, 255, 0.55)',
                          fontSize: 10,
                          textTransform: 'uppercase',
                        }}
                      >
                        Playback Speed
                      </span>
                      <span style={{ color: '#fff', fontWeight: 300 }}>
                        {playbackSpeed.toFixed(1)}x
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span
                        style={{
                          color: 'rgba(160, 220, 255, 0.55)',
                          fontSize: 10,
                          textTransform: 'uppercase',
                        }}
                      >
                        Audio Feedback
                      </span>
                      <span
                        style={{
                          color: isMuted ? 'rgba(255, 100, 100, 0.75)' : '#00dc8c',
                          fontWeight: 300,
                        }}
                      >
                        {isMuted ? 'Muted' : 'Enabled'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span
                        style={{
                          color: 'rgba(160, 220, 255, 0.55)',
                          fontSize: 10,
                          textTransform: 'uppercase',
                        }}
                      >
                        Welcome Guide
                      </span>
                      <button
                        type='button'
                        onClick={() => {
                          playChime('click');
                          setShowWelcomeGuide((prev) => !prev);
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          outline: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          color: showWelcomeGuide ? '#00dc8c' : 'rgba(160, 220, 255, 0.55)',
                          fontSize: 12,
                          textAlign: 'left',
                          transition: 'all 0.2s',
                          fontWeight: 300,
                        }}
                        className='control-btn'
                      >
                        {showWelcomeGuide ? 'Visible' : 'Hidden (click to show)'}
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span
                        style={{
                          color: 'rgba(160, 220, 255, 0.55)',
                          fontSize: 10,
                          textTransform: 'uppercase',
                        }}
                      >
                        Mic Threshold
                      </span>
                      <span style={{ color: '#fff', fontWeight: 300 }}>
                        {speakingThreshold} RMS
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span
                        style={{
                          color: 'rgba(160, 220, 255, 0.55)',
                          fontSize: 10,
                          textTransform: 'uppercase',
                        }}
                      >
                        Auto-Scroll
                      </span>
                      <button
                        type='button'
                        onClick={() => {
                          playChime('click');
                          setAutoScrollEnabled((prev) => !prev);
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          outline: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          color: autoScrollEnabled ? '#00dc8c' : 'rgba(160, 220, 255, 0.55)',
                          fontSize: 12,
                          textAlign: 'left',
                          transition: 'all 0.2s',
                          fontWeight: 300,
                        }}
                        className='control-btn'
                      >
                        {autoScrollEnabled ? 'Enabled' : 'Disabled'}
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span
                        style={{
                          color: 'rgba(160, 220, 255, 0.55)',
                          fontSize: 10,
                          textTransform: 'uppercase',
                        }}
                      >
                        Session Duration
                      </span>
                      <span style={{ color: '#fff', fontWeight: 300 }}>
                        {formatDuration(sessionDuration)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span
                        style={{
                          color: 'rgba(160, 220, 255, 0.55)',
                          fontSize: 10,
                          textTransform: 'uppercase',
                        }}
                      >
                        Chimes
                      </span>
                      <button
                        type='button'
                        onClick={() => {
                          playChime('click');
                          setSoundEffectsEnabled((prev) => !prev);
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          outline: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          color: soundEffectsEnabled ? '#00dc8c' : 'rgba(160, 220, 255, 0.55)',
                          fontSize: 12,
                          textAlign: 'left',
                          transition: 'all 0.2s',
                          fontWeight: 300,
                        }}
                        className='control-btn'
                      >
                        {soundEffectsEnabled ? 'Enabled' : 'Disabled'}
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span
                        style={{
                          color: 'rgba(160, 220, 255, 0.55)',
                          fontSize: 10,
                          textTransform: 'uppercase',
                        }}
                      >
                        Response Length
                      </span>
                      <button
                        type='button'
                        onClick={() => {
                          playChime('click');
                          setResponseLength((prev) =>
                            prev === 'concise' ? 'detailed' : 'concise'
                          );
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          outline: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          color:
                            responseLength === 'concise' ? '#00dc8c' : 'rgba(160, 220, 255, 0.55)',
                          fontSize: 12,
                          textAlign: 'left',
                          transition: 'all 0.2s',
                          fontWeight: 300,
                        }}
                        className='control-btn'
                      >
                        {responseLength === 'concise'
                          ? 'Concise (<30 words)'
                          : 'Detailed (<100 words)'}
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span
                        style={{
                          color: 'rgba(160, 220, 255, 0.55)',
                          fontSize: 10,
                          textTransform: 'uppercase',
                        }}
                      >
                        Active Model
                      </span>
                      <span style={{ color: '#fff', fontWeight: 300 }}>Gemini 2.5 Flash</span>
                    </div>
                  </div>
                </div>

                {/* Reset to Defaults */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                  <button
                    type='button'
                    onClick={() => {
                      playChime('click');

                      // Revert states
                      setSpeakingThreshold(10);
                      setShowWelcomeGuide(true);
                      setUserName('Master');
                      setAutoScrollEnabled(true);
                      setSoundEffectsEnabled(true);
                      setCounterMode('char');
                      setPlaybackSpeed(1.0);
                      setIsMuted(false);
                      setResponseLength('detailed');

                      // Remove items from local storage to clean up
                      localStorage.removeItem('july_speaking_threshold');
                      localStorage.removeItem('july_show_welcome_guide');
                      localStorage.removeItem('july_user_name');
                      localStorage.removeItem('july_auto_scroll');
                      localStorage.removeItem('july_sound_effects');
                      localStorage.removeItem('july_counter_mode');
                      localStorage.removeItem('july_response_length');
                    }}
                    style={{
                      background: 'rgba(255, 255, 255, 0.02)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: 12,
                      padding: '8px 16px',
                      color: 'rgba(160, 220, 255, 0.72)',
                      fontSize: 11,
                      cursor: 'pointer',
                      transition: 'all 0.25s ease',
                      fontWeight: 400,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                    }}
                    className='control-btn'
                    aria-label='Reset all settings to defaults'
                  >
                    Reset Settings to Default
                  </button>
                </div>
              </div>
            </div>
          </div>
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

function IconWave({ active, volume = 0 }: { active: boolean; volume?: number }) {
  const baseHeights = active ? [10, 18, 22, 16, 8] : [4, 8, 6, 8, 4];
  const scale = 1 + (volume / 100) * 1.5;
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
        const baseH = baseHeights[i];
        const h = Math.min(24, active ? baseH * scale : baseH);
        return (
          <line
            key={x}
            x1={x}
            y1={13 - h / 2}
            x2={x}
            y2={13 + h / 2}
            style={{ transition: 'all 60ms ease-out' }}
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

function IconSpeaking({ playbackSpeed }: { playbackSpeed: number }) {
  const heights = [7, 15, 20, 13, 6];
  const duration = 0.7 / playbackSpeed;
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
            style={{
              animation: `speaking-bar ${duration.toFixed(2)}s ease-in-out ${i * 100}ms infinite`,
            }}
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

function IconTrash({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
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

function IconDownload({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.6'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
    >
      <path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' />
      <polyline points='7 10 12 15 17 10' />
      <line x1='12' y1='15' x2='12' y2='3' />
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

function CopyButton({ text, onCopy }: { text: string; onCopy?: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onCopy?.();
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
        padding: copied ? '4px 8px' : '4px',
        borderRadius: copied ? '10px' : '6px',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        background: 'rgba(255, 255, 255, 0.02)',
        color: copied ? 'rgba(0, 220, 140, 0.85)' : 'rgba(160, 220, 255, 0.7)',
        cursor: 'pointer',
        transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        marginLeft: 'auto',
      }}
      className='copy-button'
      aria-label={copied ? 'Copied' : 'Copy message text'}
      title={copied ? 'Copied!' : 'Copy message'}
    >
      {copied ? (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 10,
            fontWeight: 400,
            lineHeight: 1,
          }}
        >
          <IconCheck />
          <span>Copied</span>
        </span>
      ) : (
        <IconCopy />
      )}
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

function IconAlertCircle() {
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
      <circle cx='12' cy='12' r='10' />
      <line x1='12' y1='8' x2='12' y2='12' />
      <line x1='12' y1='16' x2='12.01' y2='16' />
    </svg>
  );
}

function IconChevronDown() {
  return (
    <svg
      width='14'
      height='14'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
    >
      <polyline points='6 9 12 15 18 9' />
    </svg>
  );
}

function IconX({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
    >
      <line x1='18' y1='6' x2='6' y2='18' />
      <line x1='6' y1='6' x2='18' y2='18' />
    </svg>
  );
}

function IconSpeakerWave() {
  return (
    <svg
      width='10'
      height='10'
      viewBox='0 0 24 24'
      fill='none'
      stroke='#00dc8c'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      style={{
        filter: 'drop-shadow(0 0 3px rgba(0, 220, 140, 0.4))',
      }}
      aria-hidden='true'
    >
      <polygon points='11 5 6 9 2 9 2 15 6 15 11 19 11 5' />
      <path d='M15.54 8.46a5 5 0 0 1 0 7.07'>
        <animate attributeName='opacity' values='0.15;1;0.15' dur='1.2s' repeatCount='indefinite' />
      </path>
      <path d='M19.07 4.93a10 10 0 0 1 0 14.14'>
        <animate
          attributeName='opacity'
          values='0.15;0.15;1;0.15'
          dur='1.2s'
          repeatCount='indefinite'
        />
      </path>
    </svg>
  );
}

function IconThumbsUp() {
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
      <path d='M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3' />
    </svg>
  );
}

function IconThumbsDown() {
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
      <path d='M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3' />
    </svg>
  );
}
