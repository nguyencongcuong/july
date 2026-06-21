'use client';

import {
  AutoAwesome,
  Check,
  Close,
  ContentCopy,
  Delete,
  Download,
  ErrorOutlineOutlined,
  KeyboardArrowDown,
  Mic,
  MicOff,
  Send,
  ThumbDownAlt,
  ThumbDownAltOutlined,
  ThumbUpAlt,
  ThumbUpAltOutlined,
  VolumeOff,
  VolumeUp,
} from '@mui/icons-material';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  InputBase,
  Slider,
  Stack,
  Typography,
} from '@mui/material';
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

  // Track loaded state to prevent hydration mismatch and writing default state to localStorage on mount
  const [isLoaded, setIsLoaded] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [isMuted, setIsMuted] = useState(false);

  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [inputText, setInputText] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [hasNewMessageAlert, setHasNewMessageAlert] = useState(false);
  const [greeting, setGreeting] = useState('Welcome, Master');
  const [isCopyPulseActive, setIsCopyPulseActive] = useState(false);
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const copiedMessageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const [playbackElapsed, setPlaybackElapsed] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [speakingThreshold, setSpeakingThreshold] = useState<number>(10);
  const [showWelcomeGuide, setShowWelcomeGuide] = useState(true);
  const [userName, setUserName] = useState<string>('Master');
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [soundEffectsEnabled, setSoundEffectsEnabled] = useState(true);
  const [soundVolume, setSoundVolume] = useState<number>(100);
  const [responseLength, setResponseLength] = useState<'concise' | 'detailed'>('detailed');
  const [activeModel, setActiveModel] = useState<string>('gemini-2.5-flash');
  const [counterMode, setCounterMode] = useState<'char' | 'word'>('char');
  const [messageFontSize, setMessageFontSize] = useState<'small' | 'medium' | 'large'>('medium');
  const [sessionStartTime, setSessionStartTime] = useState(0);
  const [sessionDuration, setSessionDuration] = useState(0);

  // Hydrate settings from localStorage on client mount
  useEffect(() => {
    try {
      const savedMsgs = localStorage.getItem('july_chat_history');
      if (savedMsgs) {
        const parsed: unknown = JSON.parse(savedMsgs);
        if (Array.isArray(parsed)) setMessages(parsed as Message[]);
      }
    } catch {}

    try {
      const savedInput = localStorage.getItem('july_draft_input');
      if (savedInput) setInputText(savedInput);
    } catch {}

    try {
      const savedThreshold = localStorage.getItem('july_speaking_threshold');
      if (savedThreshold) setSpeakingThreshold(Number(savedThreshold));
    } catch {}

    try {
      const savedGuide = localStorage.getItem('july_show_welcome_guide');
      if (savedGuide !== null) setShowWelcomeGuide(savedGuide === 'true');
    } catch {}

    try {
      const savedName = localStorage.getItem('july_user_name');
      if (savedName) setUserName(savedName);
    } catch {}

    try {
      const savedScroll = localStorage.getItem('july_auto_scroll');
      if (savedScroll !== null) setAutoScrollEnabled(savedScroll === 'true');
    } catch {}

    try {
      const savedSound = localStorage.getItem('july_sound_effects');
      if (savedSound !== null) setSoundEffectsEnabled(savedSound === 'true');
    } catch {}

    try {
      const savedVol = localStorage.getItem('july_sound_volume');
      if (savedVol !== null) setSoundVolume(Number(savedVol));
    } catch {}

    try {
      const savedLen = localStorage.getItem('july_response_length');
      if (savedLen) setResponseLength(savedLen as 'concise' | 'detailed');
    } catch {}

    try {
      const savedModel = localStorage.getItem('july_active_model');
      if (savedModel) setActiveModel(savedModel);
    } catch {}

    try {
      const savedCounter = localStorage.getItem('july_counter_mode');
      if (savedCounter) setCounterMode(savedCounter as 'char' | 'word');
    } catch {}

    try {
      const savedFontSize = localStorage.getItem('july_message_font_size');
      if (savedFontSize) setMessageFontSize(savedFontSize as 'small' | 'medium' | 'large');
    } catch {}

    setSessionStartTime(Date.now());
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    localStorage.setItem('july_message_font_size', messageFontSize);
  }, [messageFontSize, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    try {
      localStorage.setItem('july_chat_history', JSON.stringify(messages));
    } catch {
      // storage quota exceeded — silently skip
    }
  }, [messages, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    localStorage.setItem('july_draft_input', inputText);
  }, [inputText, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    localStorage.setItem('july_speaking_threshold', speakingThreshold.toString());
  }, [speakingThreshold, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    localStorage.setItem('july_show_welcome_guide', showWelcomeGuide.toString());
  }, [showWelcomeGuide, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    localStorage.setItem('july_user_name', userName);
  }, [userName, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    localStorage.setItem('july_auto_scroll', autoScrollEnabled.toString());
  }, [autoScrollEnabled, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    localStorage.setItem('july_sound_effects', soundEffectsEnabled.toString());
  }, [soundEffectsEnabled, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    localStorage.setItem('july_sound_volume', soundVolume.toString());
  }, [soundVolume, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    localStorage.setItem('july_response_length', responseLength);
  }, [responseLength, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    localStorage.setItem('july_active_model', activeModel);
  }, [activeModel, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    localStorage.setItem('july_counter_mode', counterMode);
  }, [counterMode, isLoaded]);

  const getCounterText = () => {
    if (counterMode === 'char') {
      return `${inputText.length}/250`;
    }
    const words = inputText.trim() === '' ? 0 : inputText.trim().split(/\s+/).length;
    return `${words} word${words === 1 ? '' : 's'}`;
  };

  useEffect(() => {
    if (sessionStartTime === 0) return;
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

  const activeModelRef = useRef(activeModel);
  activeModelRef.current = activeModel;

  const speakingThresholdRef = useRef(speakingThreshold);
  speakingThresholdRef.current = speakingThreshold;

  const soundEffectsEnabledRef = useRef(soundEffectsEnabled);
  soundEffectsEnabledRef.current = soundEffectsEnabled;

  const soundVolumeRef = useRef(soundVolume);
  soundVolumeRef.current = soundVolume;

  // ── Typewriter animation state ─────────────────────────────────────────────
  const [typingMsgIdx, setTypingMsgIdx] = useState<number | null>(null);
  const [typingText, setTypingText] = useState('');
  const typingIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    if (!isLoaded) {
      prevMessagesCountRef.current = messages.length;
      return;
    }
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
  }, [messages, isLoaded]);

  // Auto-scroll to latest message
  useEffect(() => {
    if (autoScrollEnabled && (messages.length > 0 || isProcessing)) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isProcessing, autoScrollEnabled]);

  // Dynamic browser tab title updates
  useEffect(() => {
    const originalTitle = 'July';
    let interval: ReturnType<typeof setInterval> | null = null;

    if (isProcessing) {
      document.title = '● July (Thinking...)';
    } else if (isResponding) {
      const frames = ['🔈', '🔉', '🔊', '🔉'];
      let frameIdx = 0;
      document.title = `${frames[frameIdx]} July (Speaking...)`;
      interval = setInterval(() => {
        frameIdx = (frameIdx + 1) % frames.length;
        document.title = `${frames[frameIdx]} July (Speaking...)`;
      }, 500);
    } else if (isMuted) {
      document.title = 'July (Muted)';
    } else {
      document.title = originalTitle;
    }

    return () => {
      if (interval) clearInterval(interval);
      document.title = originalTitle;
    };
  }, [isProcessing, isResponding, isMuted]);

  // Unread new message alert notification triggers
  useEffect(() => {
    if (!isLoaded) return;
    if (messages.length > prevMessagesCountRef.current) {
      if (showScrollBottom) {
        setHasNewMessageAlert(true);
      }
    }
    prevMessagesCountRef.current = messages.length;
  }, [messages.length, showScrollBottom, isLoaded]);

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

  const playChime = useCallback((type: 'wake' | 'clear' | 'click' | 'send') => {
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
      const volFactor = soundVolumeRef.current / 100;
      if (type === 'wake') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(1200, now + 0.15);
        gain.gain.setValueAtTime(0.04 * volFactor, now);
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
        gain.gain.setValueAtTime(0.04 * volFactor, now);
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
        gain.gain.setValueAtTime(0.015 * volFactor, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.05);
      } else if (type === 'send') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(900, now + 0.1);
        gain.gain.setValueAtTime(0.015 * volFactor, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.1);
      }
    } catch (e) {
      console.warn('Failed to play chime:', e);
    }
  }, []);

  const showToast = useCallback((msg: string) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToastMessage(msg);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimeoutRef.current = null;
    }, 2000);
  }, []);

  const handleCopyNotification = useCallback(
    (idx: number) => {
      playChime('click');
      setIsCopyPulseActive(true);
      setTimeout(() => setIsCopyPulseActive(false), 1000);

      setCopiedMessageIndex(idx);
      if (copiedMessageTimeoutRef.current) {
        clearTimeout(copiedMessageTimeoutRef.current);
      }
      copiedMessageTimeoutRef.current = setTimeout(() => {
        setCopiedMessageIndex(null);
        copiedMessageTimeoutRef.current = null;
      }, 800);

      showToast('Copied to clipboard');
    },
    [playChime, showToast]
  );

  const handleDeleteMessage = useCallback(
    (index: number) => {
      if (!window.confirm('Delete this message?')) return;
      playChime('clear');
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
    showToast('Chat history exported');
  }, [messages, playChime, showToast]);

  const handleCopyTranscript = useCallback(() => {
    playChime('click');
    if (messages.length === 0) return;
    const content = messages
      .map((msg) => {
        const role = msg.role === 'user' ? userName || 'User' : 'July';
        return `**${role}**: ${msg.text}`;
      })
      .join('\n\n');
    navigator.clipboard
      .writeText(content)
      .then(() => {
        showToast('Transcript copied to clipboard');
      })
      .catch((err) => {
        console.error('Failed to copy transcript: ', err);
      });
  }, [messages, userName, playChime, showToast]);

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
    if (copiedMessageTimeoutRef.current) {
      clearTimeout(copiedMessageTimeoutRef.current);
      copiedMessageTimeoutRef.current = null;
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
      formData.append('model', activeModelRef.current);

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
      playChime('send');

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
              responseLengthRef.current,
              activeModelRef.current
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
    [isProcessing, isResponding, stopSpeaking, playChime]
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
          setIsMuted((prev) => {
            const next = !prev;
            showToast(next ? 'Voice responses muted' : 'Voice responses enabled');
            return next;
          });
          return;
        }

        // 4. 's' or 'S' -> Cycle playback speed
        if (e.key.toLowerCase() === 's') {
          e.preventDefault();
          playChime('click');
          setPlaybackSpeed((prev) => {
            const next = prev === 1 ? 1.2 : prev === 1.2 ? 1.5 : 1.0;
            showToast(`Playback speed: ${next.toFixed(1)}x`);
            return next;
          });
          return;
        }

        // 5. 'h' or 'H' -> Toggle help modal
        if (e.key.toLowerCase() === 'h') {
          e.preventDefault();
          playChime('click');
          setShowHelpModal((prev) => !prev);
          return;
        }

        // 6. Space -> Request microphone / wake July (when idle or denied)
        if (e.code === 'Space' && (micStatus === 'idle' || micStatus === 'denied')) {
          e.preventDefault();
          playChime('click');
          requestMic();
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
  }, [micStatus, isResponding, stopSpeaking, showHelpModal, playChime, requestMic, showToast]);

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
      {toastMessage && (
        <Box
          className='july-toast'
          sx={{
            position: 'fixed',
            top: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 500,
            padding: '10px 20px',
            borderRadius: 4,
            background: 'rgba(3, 5, 12, 0.7)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(0, 220, 140, 0.25)',
            boxShadow: '0 0 15px rgba(0, 220, 140, 0.15)',
            color: '#00dc8c',
            fontSize: 12,
            fontWeight: 300,
            letterSpacing: '0.06em',
            pointerEvents: 'none',
            animation: 'msg-in 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards',
          }}
        >
          {toastMessage}
        </Box>
      )}
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

      <Box
        className='july-root'
        sx={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          width: '100%',
          overflow: 'hidden',
          backgroundColor: '#03050c',
        }}
      >
        {/* ── Error Banner ── */}
        {errorMessage && (
          <Box
            sx={{
              position: 'absolute',
              top: 80,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 200,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              padding: '10px 18px',
              borderRadius: 3.5,
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
            <Typography component='span' sx={{ fontSize: 13 }}>
              ⚠️
            </Typography>
            <Typography component='span' sx={{ fontSize: 'inherit' }}>
              {errorMessage}
            </Typography>
          </Box>
        )}

        {/* ── System Status Badge ── */}
        <Box
          sx={{
            position: 'absolute',
            top: 24,
            left: 24,
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            padding: '8px 14px',
            borderRadius: 5,
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
          <Box
            component='span'
            sx={{
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
          <Typography
            component='span'
            sx={{
              fontSize: 'inherit',
              fontWeight: 'inherit',
              letterSpacing: 'inherit',
            }}
          >
            JULY v1.0 •{' '}
            {isCopyPulseActive
              ? 'COPIED!'
              : isProcessing || isResponding
                ? 'PROCESSING'
                : isMuted
                  ? `ONLINE (MUTED${messages.length > 0 ? ` • ${messages.length} MSGS` : ''})`
                  : `ONLINE${messages.length > 0 ? ` • ${messages.length} MSGS` : ''}`}
          </Typography>
        </Box>

        {/* ── Control Buttons Stack ── */}
        <Stack
          direction='row'
          spacing={1.5}
          sx={{
            position: 'absolute',
            top: 24,
            right: 24,
            zIndex: 100,
          }}
        >
          {/* Export Chat Button */}
          {messages.length > 0 && (
            <IconButton
              onClick={handleExportChat}
              sx={{
                width: 44,
                height: 44,
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.03)',
                backdropFilter: 'blur(8px)',
                color: 'rgba(160, 220, 255, 0.85)',
                boxShadow: '0 0 15px rgba(0,180,255,0.1), inset 0 0 10px rgba(0,180,255,0.02)',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                '&:hover': {
                  background: 'rgba(255, 255, 255, 0.08)',
                  borderColor: 'rgba(0, 180, 255, 0.25)',
                  color: '#fff',
                  transform: 'scale(1.08)',
                  boxShadow: '0 0 15px rgba(0, 180, 255, 0.15)',
                },
                '&:active': {
                  transform: 'scale(0.95)',
                },
              }}
              aria-label='Export conversation history'
              title='Export conversation'
            >
              <Download sx={{ fontSize: 18 }} />
            </IconButton>
          )}

          {/* Copy Transcript Button */}
          {messages.length > 0 && (
            <IconButton
              onClick={handleCopyTranscript}
              sx={{
                width: 44,
                height: 44,
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.03)',
                backdropFilter: 'blur(8px)',
                color: 'rgba(160, 220, 255, 0.85)',
                boxShadow: '0 0 15px rgba(0,180,255,0.1), inset 0 0 10px rgba(0,180,255,0.02)',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                '&:hover': {
                  background: 'rgba(255, 255, 255, 0.08)',
                  borderColor: 'rgba(0, 180, 255, 0.25)',
                  color: '#fff',
                  transform: 'scale(1.08)',
                  boxShadow: '0 0 15px rgba(0, 180, 255, 0.15)',
                },
                '&:active': {
                  transform: 'scale(0.95)',
                },
              }}
              aria-label='Copy conversation transcript'
              title='Copy transcript'
            >
              <ContentCopy sx={{ fontSize: 18 }} />
            </IconButton>
          )}

          {/* Clear Chat Button */}
          {messages.length > 0 && (
            <IconButton
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
              sx={{
                width: 44,
                height: 44,
                border: confirmClear
                  ? '1px solid rgba(255,70,70,0.25)'
                  : '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.03)',
                backdropFilter: 'blur(8px)',
                color: confirmClear ? 'rgba(255,70,70,0.95)' : 'rgba(160,220,255,0.85)',
                boxShadow: confirmClear
                  ? '0 0 15px rgba(255,70,70,0.25), inset 0 0 10px rgba(255, 70, 70, 0.05)'
                  : '0 0 15px rgba(0,180,255,0.1), inset 0 0 10px rgba(0,180,255,0.02)',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                animation: confirmClear ? 'alert-shake 0.35s ease-in-out infinite' : 'none',
                '&:hover': {
                  background: confirmClear
                    ? 'rgba(255, 70, 70, 0.08)'
                    : 'rgba(255, 255, 255, 0.08)',
                  borderColor: confirmClear ? 'rgba(255, 70, 70, 0.35)' : 'rgba(0, 180, 255, 0.25)',
                  color: confirmClear ? 'rgba(255, 100, 100, 0.95)' : '#fff',
                  transform: 'scale(1.08)',
                  boxShadow: confirmClear
                    ? '0 0 15px rgba(255, 70, 70, 0.3)'
                    : '0 0 15px rgba(0, 180, 255, 0.15)',
                },
                '&:active': {
                  transform: 'scale(0.95)',
                },
              }}
              aria-label={
                confirmClear ? 'Confirm clear chat history' : 'Clear conversation history'
              }
              title={confirmClear ? 'Confirm clear history' : 'Clear conversation'}
            >
              {confirmClear ? (
                <ErrorOutlineOutlined sx={{ fontSize: 18 }} />
              ) : (
                <Delete sx={{ fontSize: 18 }} />
              )}
            </IconButton>
          )}

          {/* Speed Selector Button */}
          <Button
            onClick={() => {
              playChime('click');
              setPlaybackSpeed((s) => {
                if (s === 1) return 1.2;
                if (s === 1.2) return 1.5;
                return 1.0;
              });
            }}
            sx={{
              width: 44,
              height: 44,
              minWidth: 44,
              borderRadius: '50%',
              border:
                playbackSpeed === 1.2
                  ? '1px solid rgba(0, 220, 140, 0.25)'
                  : playbackSpeed === 1.5
                    ? '1px solid rgba(255, 150, 40, 0.3)'
                    : '1px solid rgba(255, 255, 255, 0.08)',
              background: 'rgba(255, 255, 255, 0.03)',
              backdropFilter: 'blur(8px)',
              fontSize: 11,
              fontWeight: 400,
              textTransform: 'none',
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
              '&:hover': {
                background: 'rgba(255, 255, 255, 0.08)',
                borderColor: 'rgba(0, 180, 255, 0.25)',
                color: '#fff',
                transform: 'scale(1.08)',
                boxShadow: '0 0 15px rgba(0, 180, 255, 0.15)',
              },
              '&:active': {
                transform: 'scale(0.95)',
              },
            }}
            aria-label={`Playback speed: ${playbackSpeed}x`}
            title={`Cycle speed: currently ${playbackSpeed}x`}
          >
            {playbackSpeed.toFixed(1)}x
          </Button>

          {/* Mute Toggle Button */}
          <IconButton
            onClick={() => {
              playChime('click');
              setIsMuted((m) => !m);
            }}
            sx={{
              width: 44,
              height: 44,
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'rgba(255,255,255,0.03)',
              backdropFilter: 'blur(8px)',
              color: isMuted ? 'rgba(255, 70, 70, 0.85)' : 'rgba(160, 220, 255, 0.85)',
              boxShadow: isMuted
                ? '0 0 15px rgba(255, 70, 70, 0.15), inset 0 0 10px rgba(255,70,70,0.05)'
                : '0 0 15px rgba(0,180,255,0.1), inset 0 0 10px rgba(0,180,255,0.02)',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              '&:hover': {
                background: 'rgba(255, 255, 255, 0.08)',
                borderColor: 'rgba(0, 180, 255, 0.25)',
                color: '#fff',
                transform: 'scale(1.08)',
                boxShadow: '0 0 15px rgba(0, 180, 255, 0.15)',
              },
              '&:active': {
                transform: 'scale(0.95)',
              },
            }}
            aria-label={isMuted ? 'Unmute voice response' : 'Mute voice response'}
            title={isMuted ? 'Unmute voice' : 'Mute voice'}
          >
            {isMuted ? <VolumeOff /> : <VolumeUp />}
          </IconButton>
        </Stack>

        {/* ── aurora blobs ── */}
        <Box
          aria-hidden='true'
          sx={{ pointerEvents: 'none', position: 'absolute', inset: 0, overflow: 'hidden' }}
        >
          <Box
            sx={{
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
          <Box
            sx={{
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
          <Box
            sx={{
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
        </Box>

        {/* ── dot-grid overlay ── */}
        <Box
          aria-hidden='true'
          sx={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            backgroundImage: 'radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />

        {/* ── scene ── */}
        <Box
          sx={{
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
                <Box
                  key={i}
                  sx={{
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
                <Box
                  key={i}
                  sx={{
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
                <Box
                  key={i}
                  sx={{
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
              <Box
                key={i}
                sx={{
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
            <Box
              component='svg'
              width='160'
              height='160'
              sx={{
                position: 'absolute',
                zIndex: 15,
                pointerEvents: 'none',
              }}
              aria-hidden='true'
            >
              {/* Background Track */}
              <Box
                component='circle'
                cx='80'
                cy='80'
                r='77'
                fill='transparent'
                stroke='rgba(0, 220, 140, 0.12)'
                strokeWidth='2'
              />
              {/* Progress Ring */}
              <Box
                component='circle'
                cx='80'
                cy='80'
                r='77'
                fill='transparent'
                stroke='#00dc8c'
                strokeWidth='2.5'
                strokeDasharray='484'
                strokeDashoffset={484 * (1 - Math.min(1, playbackElapsed / playbackDuration))}
                strokeLinecap='round'
                sx={{
                  transition: 'stroke-dashoffset 80ms linear',
                  transform: 'rotate(-90deg)',
                  transformOrigin: '80px 80px',
                  filter: 'drop-shadow(0 0 5px rgba(0, 220, 140, 0.6))',
                }}
              />
            </Box>
          )}

          {/* ── main orb button ── */}
          <Button
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
            sx={{
              position: 'relative',
              zIndex: 10,
              width: 148,
              height: 148,
              minWidth: 148,
              borderRadius: '50%',
              border: 'none',
              outline: 'none',
              padding: 0,
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
              '&:hover': {
                background:
                  orbMode === 'processing'
                    ? 'radial-gradient(circle at 35% 35%, rgba(255,140,30,0.35), rgba(120,50,0,0.9) 60%, rgba(15,5,0,0.98))'
                    : orbMode === 'responding'
                      ? 'radial-gradient(circle at 35% 35%, rgba(0,220,140,0.33), rgba(0,80,60,0.9) 60%, rgba(0,12,8,0.98))'
                      : isMuted
                        ? 'radial-gradient(circle at 35% 35%, rgba(140,160,180,0.25), rgba(60,70,80,0.85) 60%, rgba(5,8,12,0.98))'
                        : 'radial-gradient(circle at 35% 35%, rgba(0,200,255,0.33), rgba(0,50,120,0.92) 60%, rgba(0,8,28,0.98))',
              },
            }}
          >
            {/* inner highlight */}
            <Box
              component='span'
              sx={{
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
            <Box
              component='span'
              sx={{
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
              {micStatus === 'idle' && <Mic />}
              {micStatus === 'requesting' && (
                <CircularProgress size={34} sx={{ color: 'inherit' }} />
              )}
              {micStatus === 'active' && !isProcessing && !isResponding && (
                <IconWave active={isSpeaking} volume={volume} />
              )}
              {isProcessing && <AutoAwesome />}
              {isResponding && <IconSpeaking playbackSpeed={playbackSpeed} />}
              {micStatus === 'denied' && <MicOff />}
            </Box>
          </Button>

          {/* volume bar — only while user is speaking */}
          {micStatus === 'active' && isSpeaking && (
            <Box
              role='meter'
              aria-valuenow={volume}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label='Microphone volume'
              sx={{
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
              <Box
                sx={{
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
            </Box>
          )}
        </Box>

        {/* ── name + status ── */}
        <Box sx={{ marginTop: 4.5, textAlign: 'center', userSelect: 'none' }}>
          <Typography
            variant='h1'
            sx={{
              fontSize: 28,
              fontWeight: 200,
              letterSpacing: '0.55em',
              color: 'rgba(170,215,255,0.92)',
              textShadow: '0 0 18px rgba(0,170,255,0.55)',
              marginBottom: 1.25,
            }}
          >
            J U L Y
          </Typography>

          <Box
            sx={{
              height: 22,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 0.5,
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
            <Typography
              component='span'
              sx={{
                fontSize: 'inherit',
                fontWeight: 'inherit',
                letterSpacing: 'inherit',
                textTransform: 'inherit',
                color: 'inherit',
              }}
            >
              {taglines[orbMode] ?? taglines.standby}
            </Typography>
            {orbMode === 'processing' && (
              <Box
                component='span'
                sx={{ display: 'inline-flex', gap: 0.35, marginLeft: 0.25 }}
                aria-hidden='true'
              >
                {[0, 180, 360].map((ms) => (
                  <Box
                    component='span'
                    key={ms}
                    sx={{
                      animation: `thinking-dot 1.3s ease-in-out ${ms}ms infinite`,
                      display: 'inline-block',
                    }}
                  >
                    •
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        </Box>
        {/* ── suggestion chips ── */}
        {messages.length === 0 && (
          <Box
            sx={{
              marginTop: 5,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 1.5,
              width: '100%',
              maxWidth: 380,
              padding: '0 20px',
            }}
          >
            {/* ── Welcome Guide Panel ── */}
            {showWelcomeGuide && (
              <Box
                sx={{
                  width: '100%',
                  padding: '20px',
                  borderRadius: 5,
                  background: 'rgba(255, 255, 255, 0.01)',
                  border: '1px solid rgba(255, 255, 255, 0.04)',
                  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.25)',
                  backdropFilter: 'blur(10px)',
                  textAlign: 'center',
                  marginBottom: 1,
                  animation: 'msg-in 0.4s ease forwards',
                  position: 'relative',
                }}
              >
                <IconButton
                  onClick={() => {
                    playChime('click');
                    setShowWelcomeGuide(false);
                  }}
                  sx={{
                    position: 'absolute',
                    top: 12,
                    right: 12,
                    background: 'none',
                    border: 'none',
                    outline: 'none',
                    color: 'rgba(160, 220, 255, 0.4)',
                    padding: 0.5,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '50%',
                    transition: 'all 0.2s',
                    '&:hover': {
                      background: 'rgba(255, 255, 255, 0.08)',
                      borderColor: 'rgba(0, 180, 255, 0.25)',
                      color: '#fff',
                      transform: 'scale(1.08)',
                      boxShadow: '0 0 15px rgba(0, 180, 255, 0.15)',
                    },
                    '&:active': {
                      transform: 'scale(0.95)',
                    },
                  }}
                  aria-label='Dismiss welcome guide'
                  title='Dismiss guide'
                >
                  <Close sx={{ fontSize: 12 }} />
                </IconButton>
                <Typography
                  variant='h2'
                  onDoubleClick={() => {
                    playChime('click');
                    const newName = window.prompt('Enter your name, Master:', userName);
                    if (newName !== null) {
                      const trimmed = newName.trim();
                      if (trimmed) {
                        setUserName(trimmed);
                        showToast(`Name updated to: ${trimmed}`);
                      }
                    }
                  }}
                  title='Double-click to change name'
                  sx={{
                    fontSize: 14,
                    fontWeight: 400,
                    color: 'rgba(255, 255, 255, 0.95)',
                    margin: '0 0 6px 0',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    textShadow: '0 0 8px rgba(0, 180, 255, 0.2)',
                    cursor: 'pointer',
                    transition: 'all 0.25s ease',
                    '&:hover': {
                      color: '#00dc8c',
                      textShadow: '0 0 8px rgba(0, 220, 140, 0.6)',
                    },
                  }}
                >
                  {greeting}
                </Typography>
                <Typography
                  sx={{
                    fontSize: 12,
                    fontWeight: 300,
                    color: 'rgba(160, 220, 255, 0.72)',
                    margin: 0,
                    lineHeight: 1.55,
                  }}
                >
                  July is fully synchronized and at your service. Choose a target prompt below,
                  start typing, or activate the orb to interact.
                </Typography>
              </Box>
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
              <Button
                key={chip.text}
                onClick={() => {
                  playChime('click');
                  handlePrompt(chip.prompt);
                }}
                disabled={isProcessing || isResponding}
                sx={{
                  width: '100%',
                  padding: '12px 16px',
                  borderRadius: 4,
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  background: 'rgba(255, 255, 255, 0.02)',
                  backdropFilter: 'blur(10px)',
                  color: 'rgba(160, 220, 255, 0.85)',
                  fontSize: 12,
                  fontWeight: 300,
                  textTransform: 'none',
                  justifyContent: 'space-between',
                  cursor: isProcessing || isResponding ? 'not-allowed' : 'pointer',
                  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
                  transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                  opacity: isProcessing || isResponding ? 0.5 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  '&:hover': {
                    background: 'rgba(255, 255, 255, 0.05)',
                    borderColor: 'rgba(0, 180, 255, 0.2)',
                    color: 'rgba(200, 235, 255, 1)',
                    transform: 'translateY(-2px)',
                    boxShadow: '0 6px 24px rgba(0, 180, 255, 0.15)',
                    '& .chip-arrow': {
                      opacity: 0.85,
                      transform: 'translateX(0)',
                      color: 'rgba(160, 220, 255, 0.95)',
                    },
                  },
                  '&:active': {
                    transform: 'translateY(0)',
                  },
                }}
              >
                <Typography
                  component='span'
                  sx={{ fontSize: 'inherit', fontWeight: 'inherit', color: 'inherit' }}
                >
                  {chip.text}
                </Typography>
                <Box
                  component='span'
                  className='chip-arrow'
                  sx={{
                    opacity: 0,
                    transform: 'translateX(-6px)',
                    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                    display: 'inline-block',
                    fontSize: 'inherit',
                    color: 'inherit',
                  }}
                >
                  ↗
                </Box>
              </Button>
            ))}
          </Box>
        )}

        {/* ── conversation feed ── */}
        {messages.length > 0 && (
          <Box sx={{ position: 'relative', width: '100%', maxWidth: 520 }}>
            {/* Top Fade Overlay */}
            <Box
              sx={{
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
            <Box
              ref={scrollContainerRef}
              onScroll={handleScroll}
              onClick={(e) => {
                if (e.target === e.currentTarget && micStatus === 'active') {
                  inputRef.current?.focus();
                }
              }}
              className='july-scroll-container'
              sx={{
                marginTop: 5,
                width: '100%',
                maxHeight: 260,
                overflowY: 'auto',
                padding: '0 24px',
                display: 'flex',
                flexDirection: 'column',
                gap: 1.25,
              }}
            >
              {messages.map((msg, idx) => {
                const isSpeakingThis =
                  msg.role === 'july' && idx === messages.length - 1 && isResponding;
                return (
                  <Box
                    // biome-ignore lint/suspicious/noArrayIndexKey: message index is safe as list is append-only
                    key={idx}
                    className='msg-in'
                    sx={{
                      display: 'flex',
                      justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    }}
                  >
                    {/* Double-click gesture to copy */}
                    <Box
                      onClick={() => {
                        if (typingMsgIdx === idx) {
                          if (typingIntervalRef.current) {
                            clearInterval(typingIntervalRef.current);
                            typingIntervalRef.current = null;
                          }
                          setTypingMsgIdx(null);
                          setTypingText('');
                        }
                      }}
                      onDoubleClick={async () => {
                        try {
                          await navigator.clipboard.writeText(msg.text);
                          handleCopyNotification(idx);
                        } catch (err) {
                          console.error('Failed to copy: ', err);
                        }
                      }}
                      title={
                        typingMsgIdx === idx
                          ? 'Click to show full response | Double-click to copy'
                          : 'Double-click to copy message'
                      }
                      sx={{
                        maxWidth: '78%',
                        padding: '10px 15px',
                        borderRadius:
                          msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                        fontSize:
                          messageFontSize === 'small' ? 11 : messageFontSize === 'large' ? 15 : 13,
                        fontWeight: 300,
                        lineHeight: 1.55,
                        backdropFilter: 'blur(12px)',
                        transition: 'all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)',
                        background:
                          msg.role === 'user' ? 'rgba(0,130,255,0.14)' : 'rgba(0,220,140,0.1)',
                        border:
                          copiedMessageIndex === idx
                            ? msg.role === 'user'
                              ? '1px solid rgba(0,180,255,0.7)'
                              : '1px solid rgba(0,255,160,0.7)'
                            : msg.role === 'user'
                              ? '1px solid rgba(0,150,255,0.22)'
                              : '1px solid rgba(0,220,140,0.2)',
                        color:
                          msg.role === 'user' ? 'rgba(160,215,255,0.9)' : 'rgba(100,240,180,0.9)',
                        boxShadow:
                          copiedMessageIndex === idx
                            ? msg.role === 'user'
                              ? '0 0 14px rgba(0,130,255,0.45)'
                              : '0 0 14px rgba(0,220,140,0.45)'
                            : msg.role === 'user'
                              ? '0 2px 16px rgba(0,120,255,0.08)'
                              : '0 2px 16px rgba(0,200,120,0.08)',
                      }}
                    >
                      {typingMsgIdx === idx ? (
                        <>
                          {typingText}
                          <Box
                            component='span'
                            sx={{
                              display: 'inline-block',
                              width: '0.55em',
                              height: '1em',
                              background: 'rgba(0, 220, 140, 0.75)',
                              marginLeft: 0.25,
                              verticalAlign: 'text-bottom',
                              borderRadius: 0.25,
                              animation: 'cursor-blink 0.7s step-end infinite',
                            }}
                            aria-hidden='true'
                          />
                        </>
                      ) : (
                        msg.text
                      )}
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 1.5,
                          marginTop: 1,
                        }}
                      >
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: 1,
                          }}
                        >
                          {msg.sources && msg.sources.length > 0 && (
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                              {msg.sources.map((src) => (
                                <Box
                                  component='a'
                                  key={src.uri}
                                  href={src.uri}
                                  target='_blank'
                                  rel='noopener noreferrer'
                                  sx={{
                                    fontSize: 10,
                                    padding: '3px 8px',
                                    borderRadius: 2,
                                    background: 'rgba(255, 255, 255, 0.05)',
                                    border: '1px solid rgba(255, 255, 255, 0.08)',
                                    color: 'rgba(160, 220, 255, 0.8)',
                                    textDecoration: 'none',
                                    transition: 'all 0.2s',
                                    '&:hover': {
                                      background: 'rgba(255, 255, 255, 0.1)',
                                      borderColor: 'rgba(0, 180, 255, 0.3)',
                                      color: 'rgba(255, 255, 255, 1)',
                                      boxShadow: '0 0 10px rgba(0, 180, 255, 0.1)',
                                    },
                                  }}
                                >
                                  🌐 {src.title}
                                </Box>
                              ))}
                            </Box>
                          )}
                          {isSpeakingThis && (
                            <Box
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.75,
                                padding: '3px 8px',
                                borderRadius: 2,
                                background: 'rgba(0, 220, 140, 0.08)',
                                border: '1px solid rgba(0, 220, 140, 0.15)',
                                backdropFilter: 'blur(8px)',
                              }}
                            >
                              <IconSpeakerWave />
                              <Box
                                component='span'
                                sx={{
                                  fontSize: 9,
                                  color: 'rgba(100, 240, 180, 0.95)',
                                  letterSpacing: '0.05em',
                                  fontWeight: 400,
                                }}
                              >
                                PLAYING AUDIO
                              </Box>
                            </Box>
                          )}
                        </Box>
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.75,
                            marginLeft: 'auto',
                          }}
                        >
                          {msg.latency && (
                            <Box
                              component='span'
                              sx={{
                                fontSize: 9,
                                color: (() => {
                                  const sec = parseFloat(msg.latency);
                                  if (Number.isNaN(sec)) return 'rgba(0, 220, 140, 0.45)';
                                  if (sec < 1.5) return 'rgba(0, 220, 140, 0.65)';
                                  if (sec < 3.0) return 'rgba(255, 150, 40, 0.65)';
                                  return 'rgba(255, 100, 100, 0.65)';
                                })(),
                                marginRight: 0.5,
                                letterSpacing: '0.04em',
                                userSelect: 'none',
                              }}
                              title='Response Generation Latency'
                            >
                              ⚡ {msg.latency}
                            </Box>
                          )}
                          {msg.timestamp && (
                            <Box
                              component='span'
                              sx={{
                                fontSize: 9,
                                color: 'rgba(160, 220, 255, 0.35)',
                                marginRight: 1,
                                letterSpacing: '0.02em',
                                userSelect: 'none',
                              }}
                            >
                              {msg.timestamp}
                            </Box>
                          )}
                          {msg.role === 'july' && (
                            <Box
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.5,
                                marginRight: 0.5,
                              }}
                            >
                              <IconButton
                                onClick={() => handleMessageFeedback(idx, 'like')}
                                aria-label='Like message'
                                title='Like'
                                sx={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  padding: 0.5,
                                  borderRadius: 1.5,
                                  border: '1px solid rgba(255, 255, 255, 0.05)',
                                  background: 'rgba(255, 255, 255, 0.02)',
                                  color:
                                    msg.feedback === 'like'
                                      ? '#00dc8c'
                                      : 'rgba(160, 220, 255, 0.5)',
                                  cursor: 'pointer',
                                  transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                                  '&:hover': {
                                    background: 'rgba(255, 255, 255, 0.06)',
                                    borderColor: 'rgba(0, 180, 255, 0.25)',
                                    color: 'rgba(255, 255, 255, 0.95)',
                                    boxShadow: '0 0 6px rgba(0, 180, 255, 0.08)',
                                  },
                                }}
                              >
                                {msg.feedback === 'like' ? (
                                  <ThumbUpAlt sx={{ fontSize: 12 }} />
                                ) : (
                                  <ThumbUpAltOutlined sx={{ fontSize: 12 }} />
                                )}
                              </IconButton>
                              <IconButton
                                onClick={() => handleMessageFeedback(idx, 'dislike')}
                                aria-label='Dislike message'
                                title='Dislike'
                                sx={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  padding: 0.5,
                                  borderRadius: 1.5,
                                  border: '1px solid rgba(255, 255, 255, 0.05)',
                                  background: 'rgba(255, 255, 255, 0.02)',
                                  color:
                                    msg.feedback === 'dislike'
                                      ? '#ff4646'
                                      : 'rgba(160, 220, 255, 0.5)',
                                  cursor: 'pointer',
                                  transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                                  '&:hover': {
                                    background: 'rgba(255, 255, 255, 0.06)',
                                    borderColor: 'rgba(0, 180, 255, 0.25)',
                                    color: 'rgba(255, 255, 255, 0.95)',
                                    boxShadow: '0 0 6px rgba(0, 180, 255, 0.08)',
                                  },
                                }}
                              >
                                {msg.feedback === 'dislike' ? (
                                  <ThumbDownAlt sx={{ fontSize: 12 }} />
                                ) : (
                                  <ThumbDownAltOutlined sx={{ fontSize: 12 }} />
                                )}
                              </IconButton>
                            </Box>
                          )}
                          <CopyButton text={msg.text} onCopy={() => handleCopyNotification(idx)} />
                          <IconButton
                            onClick={() => handleDeleteMessage(idx)}
                            aria-label='Delete message'
                            title='Delete message'
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              padding: 0.5,
                              borderRadius: 1.5,
                              border: '1px solid rgba(255, 255, 255, 0.05)',
                              background: 'rgba(255, 255, 255, 0.02)',
                              color: 'rgba(255, 100, 100, 0.65)',
                              cursor: 'pointer',
                              transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                              '&:hover': {
                                background: 'rgba(255, 70, 70, 0.08)',
                                borderColor: 'rgba(255, 70, 70, 0.25)',
                                color: 'rgba(255, 100, 100, 0.95)',
                                boxShadow: '0 0 8px rgba(255, 70, 70, 0.1)',
                              },
                            }}
                          >
                            <Delete sx={{ fontSize: 12 }} />
                          </IconButton>
                        </Box>
                      </Box>
                    </Box>
                  </Box>
                );
              })}
              {isProcessing && (
                <Box
                  className='msg-in'
                  sx={{
                    display: 'flex',
                    justifyContent: 'flex-start',
                  }}
                >
                  <Box
                    sx={{
                      maxWidth: '78%',
                      padding: '10px 15px',
                      borderRadius: '18px 18px 18px 4px',
                      fontSize:
                        messageFontSize === 'small' ? 11 : messageFontSize === 'large' ? 15 : 13,
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
                    <Box
                      component='span'
                      sx={{ display: 'inline-flex', gap: 0.5 }}
                      aria-hidden='true'
                    >
                      {[0, 180, 360].map((ms) => (
                        <Box
                          component='span'
                          key={ms}
                          sx={{
                            animation: `thinking-dot 1.2s ease-in-out ${ms}ms infinite`,
                            display: 'inline-block',
                            fontSize: 16,
                            lineHeight: '10px',
                          }}
                        >
                          •
                        </Box>
                      ))}
                    </Box>
                  </Box>
                </Box>
              )}
              <div ref={messagesEndRef} />
            </Box>

            {/* Bottom Fade Overlay */}
            <Box
              sx={{
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
              <IconButton
                onClick={() => {
                  messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
                  setHasNewMessageAlert(false);
                }}
                sx={{
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
                  '&:hover': {
                    background: 'rgba(3, 5, 12, 0.9)',
                    borderColor: 'rgba(0, 180, 255, 0.25)',
                    color: '#fff',
                    transform: 'scale(1.08)',
                  },
                }}
                title='Scroll to bottom'
                aria-label='Scroll to bottom'
              >
                <KeyboardArrowDown />
                {hasNewMessageAlert && (
                  <Box
                    component='span'
                    sx={{
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
              </IconButton>
            )}
          </Box>
        )}

        {/* ── bottom input box ── */}
        {micStatus === 'active' && (
          <Box
            component='form'
            onSubmit={(e) => {
              e.preventDefault();
              if (!inputText.trim()) return;
              handlePrompt(inputText.trim());
              setInputText('');
            }}
            sx={{
              marginTop: 3,
              width: '100%',
              maxWidth: 520,
              display: 'flex',
              flexDirection: 'column',
              gap: 1.5,
              padding: '0 24px',
            }}
          >
            {inputText === '' && !isProcessing && !isResponding && (
              <Stack
                direction='row'
                spacing={1.5}
                sx={{
                  justifyContent: 'center',
                  marginBottom: 0.5,
                  animation: 'msg-in 0.25s ease forwards',
                }}
              >
                {[
                  { label: '💡 Brainstorm', text: 'Give me 3 small ideas to brainstorm...' },
                  { label: '🎭 Short Joke', text: 'Tell me a short joke' },
                  { label: '⚡ Quantum Physics', text: 'Explain quantum physics in one sentence' },
                ].map((item) => (
                  <Button
                    key={item.label}
                    onClick={() => {
                      playChime('click');
                      setInputText(item.text);
                      inputRef.current?.focus();
                    }}
                    sx={{
                      fontSize: 11,
                      padding: '4px 12px',
                      borderRadius: '12px',
                      background: 'rgba(255, 255, 255, 0.02)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      color: 'rgba(160, 220, 255, 0.75)',
                      textTransform: 'none',
                      backdropFilter: 'blur(8px)',
                      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                      '&:hover': {
                        background: 'rgba(255, 255, 255, 0.08)',
                        borderColor: 'rgba(0, 180, 255, 0.25)',
                        color: '#fff',
                        boxShadow: '0 0 10px rgba(0, 180, 255, 0.15)',
                        transform: 'translateY(-1px)',
                      },
                      '&:active': {
                        transform: 'translateY(0) scale(0.96)',
                      },
                    }}
                  >
                    {item.label}
                  </Button>
                ))}
              </Stack>
            )}

            <Box sx={{ display: 'flex', gap: 1, width: '100%' }}>
              <Box sx={{ flex: 1, position: 'relative', display: 'flex' }}>
                <InputBase
                  inputRef={inputRef}
                  type='text'
                  inputProps={{ maxLength: 250 }}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setInputText('');
                      inputRef.current?.blur();
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
                  sx={{
                    flex: 1,
                    padding: '12px 78px 12px 18px',
                    borderRadius: '22px',
                    border:
                      inputText.length >= 250
                        ? '1px solid rgba(255, 70, 70, 0.35)'
                        : '1px solid rgba(255, 255, 255, 0.08)',
                    background: 'rgba(255, 255, 255, 0.02)',
                    color: 'rgba(255, 255, 255, 0.9)',
                    fontSize: 13,
                    fontWeight: 300,
                    backdropFilter: 'blur(10px)',
                    boxShadow:
                      inputText.length >= 250 ? '0 0 12px rgba(255, 70, 70, 0.15)' : 'none',
                    transition: 'all 0.3s ease',
                    '& input::placeholder': {
                      color: 'rgba(255, 255, 255, 0.4)',
                      opacity: 1,
                    },
                    '& input:focus': {
                      outline: 'none',
                    },
                    '&:focus-within': {
                      borderColor:
                        inputText.length >= 250
                          ? 'rgba(255, 70, 70, 0.5)'
                          : 'rgba(0, 180, 255, 0.3)',
                      boxShadow:
                        inputText.length >= 250
                          ? '0 0 15px rgba(255, 70, 70, 0.25), inset 0 0 10px rgba(255, 70, 70, 0.02)'
                          : '0 0 15px rgba(0, 180, 255, 0.15), inset 0 0 10px rgba(0, 180, 255, 0.02)',
                      background: 'rgba(255, 255, 255, 0.04)',
                    },
                  }}
                />
                {inputText.length > 0 && (
                  <>
                    <Button
                      onClick={() => {
                        playChime('click');
                        setCounterMode((prev) => (prev === 'char' ? 'word' : 'char'));
                      }}
                      className={inputText.length >= 230 ? 'warning-pulse' : ''}
                      sx={{
                        position: 'absolute',
                        right: 42,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        fontSize: 10,
                        minWidth: 0,
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
                        textTransform: 'none',
                        '&:hover': {
                          background: 'none',
                          color:
                            inputText.length >= 220
                              ? 'rgba(255, 120, 120, 0.95)'
                              : 'rgba(180, 235, 255, 0.75)',
                        },
                      }}
                      title={
                        counterMode === 'char'
                          ? 'Switch to word count'
                          : 'Switch to character count'
                      }
                      aria-label={
                        counterMode === 'char'
                          ? 'Switch to word count'
                          : 'Switch to character count'
                      }
                    >
                      {getCounterText()}
                    </Button>
                    <IconButton
                      onClick={() => {
                        playChime('click');
                        setInputText('');
                        inputRef.current?.focus();
                      }}
                      sx={{
                        position: 'absolute',
                        right: 14,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        outline: 'none',
                        padding: 0.5,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'rgba(160, 220, 255, 0.4)',
                        '&:hover': {
                          color: 'rgba(255, 100, 100, 0.85)',
                          transform: 'translateY(-50%) scale(1.15)',
                        },
                        '&:active': {
                          transform: 'translateY(-50%) scale(0.9)',
                        },
                      }}
                      title='Clear text'
                      aria-label='Clear text'
                    >
                      <Close sx={{ fontSize: 12 }} />
                    </IconButton>
                  </>
                )}
                {/* Character Limit Visual Progress Bar */}
                {inputText.length > 0 && (
                  <Box
                    sx={{
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
                    <Box
                      sx={{
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
                  </Box>
                )}
              </Box>
              <IconButton
                type='submit'
                disabled={isProcessing || isResponding || !inputText.trim()}
                sx={{
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
                  '&:hover': {
                    background: 'rgba(255, 255, 255, 0.08)',
                    borderColor: 'rgba(0, 180, 255, 0.25)',
                    color: '#fff',
                    transform: 'scale(1.08)',
                    boxShadow: '0 0 15px rgba(0, 180, 255, 0.15)',
                  },
                  '&:active': {
                    transform: 'scale(0.95)',
                  },
                }}
                aria-label='Send message'
              >
                <Send sx={{ fontSize: 18 }} />
              </IconButton>
            </Box>
          </Box>
        )}

        {/* Keyboard Shortcuts Helper */}
        {micStatus === 'active' && (
          <Button
            onClick={() => {
              playChime('click');
              setShowHelpModal(true);
            }}
            sx={{
              marginTop: 1.5,
              fontSize: 10,
              fontWeight: 300,
              letterSpacing: '0.06em',
              color: 'rgba(160, 220, 255, 0.3)',
              display: 'flex',
              gap: 2,
              userSelect: 'none',
              pointerEvents: 'auto',
              animation: 'msg-in 0.5s ease forwards',
              background: 'none',
              border: 'none',
              outline: 'none',
              padding: 0,
              textTransform: 'none',
              minWidth: 0,
              '&:hover': {
                background: 'none',
                color: 'rgba(160, 220, 255, 0.75)',
                textShadow: '0 0 8px rgba(0, 180, 255, 0.5)',
                transform: 'translateY(-1px)',
              },
            }}
            title='Click to view interaction guide & commands'
          >
            <Box component='span' sx={{ marginRight: 2 }}>
              [Esc] Silence
            </Box>
            <Box component='span' sx={{ marginRight: 2 }}>
              [⌘K / ⌃K] Clear
            </Box>
            <Box component='span' sx={{ marginRight: 2 }}>
              [M] Mute
            </Box>
            <Box component='span' sx={{ marginRight: 2 }}>
              [S] Speed
            </Box>
            <Box component='span'>[H] Help</Box>
          </Button>
        )}

        {/* Interaction Protocols Help Modal */}
        <Dialog
          open={showHelpModal}
          onClose={() => {
            playChime('click');
            setShowHelpModal(false);
          }}
          slotProps={{
            paper: {
              sx: {
                width: '90%',
                maxWidth: 460,
                borderRadius: 6,
                background: 'rgba(3, 5, 12, 0.92)',
                border: '1px solid rgba(0, 180, 255, 0.2)',
                boxShadow: '0 24px 64px rgba(0, 0, 0, 0.65), 0 0 30px rgba(0, 180, 255, 0.15)',
                padding: '24px',
                color: '#fff',
                backdropFilter: 'blur(12px)',
              },
            },
          }}
          sx={{
            '& .MuiBackdrop-root': {
              background: 'rgba(3, 5, 12, 0.75)',
              backdropFilter: 'blur(8px)',
            },
          }}
        >
          {/* Header */}
          <DialogTitle
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
              padding: '0 0 14px 0',
              fontSize: 14,
              fontWeight: 400,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'rgba(0, 180, 255, 0.95)',
              textShadow: '0 0 8px rgba(0, 180, 255, 0.4)',
            }}
          >
            Interaction Protocols
            <IconButton
              onClick={() => {
                playChime('click');
                setShowHelpModal(false);
              }}
              sx={{
                color: 'rgba(160, 220, 255, 0.5)',
                padding: 0.5,
                '&:hover': {
                  color: '#fff',
                  background: 'rgba(255, 255, 255, 0.08)',
                },
              }}
              aria-label='Close help modal'
            >
              <Close sx={{ fontSize: 16 }} />
            </IconButton>
          </DialogTitle>

          {/* Body */}
          <DialogContent
            sx={{
              padding: '20px 0 0 0',
              display: 'flex',
              flexDirection: 'column',
              gap: 2.5,
              overflowY: 'auto',
              '&::-webkit-scrollbar': {
                width: '4px',
              },
              '&::-webkit-scrollbar-thumb': {
                background: 'rgba(0, 180, 255, 0.15)',
                borderRadius: '4px',
              },
            }}
          >
            {/* Keyboard shortcuts */}
            <Box>
              <Typography
                variant='h4'
                sx={{
                  fontSize: 11,
                  fontWeight: 400,
                  color: 'rgba(255, 255, 255, 0.8)',
                  letterSpacing: '0.05em',
                  marginBottom: 1,
                  textTransform: 'uppercase',
                }}
              >
                Keyboard Shortcuts
              </Typography>
              <Stack spacing={0.75}>
                {[
                  { keys: ['Esc'], desc: 'Silence July / Stop response playback' },
                  { keys: ['⌘ K', '⌃ K'], desc: 'Clear conversation history' },
                  { keys: ['M'], desc: 'Toggle audio feedback mute' },
                  { keys: ['S'], desc: 'Cycle playback speed (1.0x → 1.2x → 1.5x)' },
                  { keys: ['H'], desc: 'Toggle help modal' },
                  { keys: ['Space'], desc: 'Activate July / request microphone' },
                  { keys: ['↑'], desc: 'Recall / edit last sent prompt (in empty input)' },
                  { keys: ['Any Key'], desc: 'Auto-focus prompt input box (when active)' },
                ].map((item) => (
                  <Box
                    key={item.desc}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: 12,
                    }}
                  >
                    <Typography
                      sx={{ color: 'rgba(160, 220, 255, 0.7)', fontWeight: 300, fontSize: 12 }}
                    >
                      {item.desc}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      {item.keys.map((k) => (
                        <Box
                          component='kbd'
                          key={k}
                          sx={{
                            display: 'inline-block',
                            padding: '2px 6px',
                            fontSize: 10,
                            fontWeight: 400,
                            color: '#fff',
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            borderRadius: 1,
                            boxShadow: '0 2px 0 rgba(0, 0, 0, 0.3)',
                            fontFamily: 'inherit',
                          }}
                        >
                          {k}
                        </Box>
                      ))}
                    </Box>
                  </Box>
                ))}
              </Stack>
            </Box>

            {/* Mouse Actions */}
            <Box>
              <Typography
                variant='h4'
                sx={{
                  fontSize: 11,
                  fontWeight: 400,
                  color: 'rgba(255, 255, 255, 0.8)',
                  letterSpacing: '0.05em',
                  marginBottom: 1,
                  textTransform: 'uppercase',
                }}
              >
                Control Panel & Gesture Bindings
              </Typography>
              <Stack spacing={1}>
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
                  <Box
                    key={item.action}
                    sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}
                  >
                    <Typography
                      sx={{ color: 'rgba(0, 180, 255, 0.85)', fontWeight: 400, fontSize: 12 }}
                    >
                      {item.action}
                    </Typography>
                    <Typography
                      sx={{ color: 'rgba(160, 220, 255, 0.55)', fontWeight: 300, fontSize: 11 }}
                    >
                      {item.desc}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </Box>

            {/* Profile Personalization */}
            <Box sx={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: 2 }}>
              <Typography
                variant='h4'
                sx={{
                  fontSize: 11,
                  fontWeight: 400,
                  color: 'rgba(255, 255, 255, 0.8)',
                  letterSpacing: '0.05em',
                  marginBottom: 1,
                  textTransform: 'uppercase',
                }}
              >
                Profile Personalization
              </Typography>
              <Stack spacing={1}>
                <Typography
                  sx={{ color: 'rgba(160, 220, 255, 0.7)', fontWeight: 300, fontSize: 12 }}
                >
                  Preferred Display Name
                </Typography>
                <InputBase
                  type='text'
                  value={userName}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val.length <= 25) {
                      setUserName(val);
                    }
                  }}
                  sx={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 3,
                    padding: '10px 14px',
                    color: '#fff',
                    fontSize: 12,
                    width: '100%',
                    '&:focus-within': {
                      borderColor: 'rgba(0, 180, 255, 0.45)',
                      boxShadow:
                        '0 0 15px rgba(0, 180, 255, 0.15), inset 0 0 8px rgba(0, 180, 255, 0.05)',
                      background: 'rgba(255, 255, 255, 0.06)',
                    },
                  }}
                  placeholder='e.g. Master, Creator'
                  aria-label='Preferred Display Name'
                />
              </Stack>
            </Box>

            {/* Acoustic Calibration */}
            <Box sx={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: 2 }}>
              <Typography
                variant='h4'
                sx={{
                  fontSize: 11,
                  fontWeight: 400,
                  color: 'rgba(255, 255, 255, 0.8)',
                  letterSpacing: '0.05em',
                  marginBottom: 1.5,
                  textTransform: 'uppercase',
                }}
              >
                Acoustic Calibration
              </Typography>
              <Stack spacing={2}>
                <Box>
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 12,
                      marginBottom: 0.5,
                    }}
                  >
                    <Typography
                      sx={{ color: 'rgba(160, 220, 255, 0.7)', fontWeight: 300, fontSize: 12 }}
                    >
                      Microphone Sensitivity (lower threshold = more sensitive)
                    </Typography>
                    <Typography
                      sx={{
                        color: '#00dc8c',
                        fontWeight: 400,
                        textShadow: '0 0 6px rgba(0, 220, 140, 0.4)',
                        fontSize: 12,
                      }}
                    >
                      {speakingThreshold} RMS
                    </Typography>
                  </Box>
                  <Slider
                    min={3}
                    max={30}
                    value={speakingThreshold}
                    onChange={(_, val) => setSpeakingThreshold(val as number)}
                    sx={{
                      color: '#00dc8c',
                      height: 4,
                      padding: '13px 0',
                      '& .MuiSlider-thumb': {
                        width: 14,
                        height: 14,
                        backgroundColor: '#00dc8c',
                        boxShadow: '0 0 10px rgba(0, 220, 140, 0.6)',
                        '&:hover, &.Mui-focusVisible': {
                          boxShadow: '0px 0px 0px 8px rgba(0, 220, 140, 0.16)',
                        },
                        '&:active': {
                          transform: 'scale(1.2)',
                          backgroundColor: '#00ffaa',
                          boxShadow: '0 0 14px rgba(0, 255, 170, 0.8)',
                        },
                      },
                      '& .MuiSlider-track': {
                        border: 'none',
                      },
                      '& .MuiSlider-rail': {
                        opacity: 0.1,
                        backgroundColor: '#fff',
                      },
                    }}
                    aria-label='Microphone Sensitivity Threshold'
                  />
                </Box>

                <Box>
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 12,
                      marginBottom: 0.5,
                    }}
                  >
                    <Typography
                      sx={{ color: 'rgba(160, 220, 255, 0.7)', fontWeight: 300, fontSize: 12 }}
                    >
                      Chimes Volume (sound effects level)
                    </Typography>
                    <Typography
                      sx={{
                        color: '#00dc8c',
                        fontWeight: 400,
                        textShadow: '0 0 6px rgba(0, 220, 140, 0.4)',
                        fontSize: 12,
                      }}
                    >
                      {soundVolume}%
                    </Typography>
                  </Box>
                  <Slider
                    min={0}
                    max={100}
                    value={soundVolume}
                    onChange={(_, val) => setSoundVolume(val as number)}
                    sx={{
                      color: '#00dc8c',
                      height: 4,
                      padding: '13px 0',
                      '& .MuiSlider-thumb': {
                        width: 14,
                        height: 14,
                        backgroundColor: '#00dc8c',
                        boxShadow: '0 0 10px rgba(0, 220, 140, 0.6)',
                        '&:hover, &.Mui-focusVisible': {
                          boxShadow: '0px 0px 0px 8px rgba(0, 220, 140, 0.16)',
                        },
                        '&:active': {
                          transform: 'scale(1.2)',
                          backgroundColor: '#00ffaa',
                          boxShadow: '0 0 14px rgba(0, 255, 170, 0.8)',
                        },
                      },
                      '& .MuiSlider-track': {
                        border: 'none',
                      },
                      '& .MuiSlider-rail': {
                        opacity: 0.1,
                        backgroundColor: '#fff',
                      },
                    }}
                    aria-label='Chimes Volume'
                  />
                </Box>
              </Stack>
            </Box>

            {/* Session Diagnostics */}
            <Box sx={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: 2 }}>
              <Typography
                variant='h4'
                sx={{
                  fontSize: 11,
                  fontWeight: 400,
                  color: 'rgba(255, 255, 255, 0.8)',
                  letterSpacing: '0.05em',
                  marginBottom: 1.5,
                  textTransform: 'uppercase',
                }}
              >
                Session Diagnostics
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 1.25,
                  fontSize: 12,
                }}
              >
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                  <Typography
                    sx={{
                      color: 'rgba(160, 220, 255, 0.55)',
                      fontSize: 10,
                      textTransform: 'uppercase',
                    }}
                  >
                    Queries Sent
                  </Typography>
                  <Typography sx={{ color: '#fff', fontWeight: 300, fontSize: 12 }}>
                    {messages.filter((m) => m.role === 'user').length}
                  </Typography>
                </Box>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                  <Typography
                    sx={{
                      color: 'rgba(160, 220, 255, 0.55)',
                      fontSize: 10,
                      textTransform: 'uppercase',
                    }}
                  >
                    Avg Latency
                  </Typography>
                  <Typography sx={{ color: '#fff', fontWeight: 300, fontSize: 12 }}>
                    {(() => {
                      const latMsgs = messages.filter((m) => m.latency);
                      if (latMsgs.length === 0) return 'N/A';
                      const sum = latMsgs.reduce((acc, m) => acc + parseFloat(m.latency || '0'), 0);
                      return `⚡ ${(sum / latMsgs.length).toFixed(1)}s`;
                    })()}
                  </Typography>
                </Box>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                  <Typography
                    sx={{
                      color: 'rgba(160, 220, 255, 0.55)',
                      fontSize: 10,
                      textTransform: 'uppercase',
                    }}
                  >
                    Playback Speed
                  </Typography>
                  <Typography sx={{ color: '#fff', fontWeight: 300, fontSize: 12 }}>
                    {playbackSpeed.toFixed(1)}x
                  </Typography>
                </Box>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                  <Typography
                    sx={{
                      color: 'rgba(160, 220, 255, 0.55)',
                      fontSize: 10,
                      textTransform: 'uppercase',
                    }}
                  >
                    Audio Feedback
                  </Typography>
                  <Typography
                    sx={{
                      color: isMuted ? 'rgba(255, 100, 100, 0.75)' : '#00dc8c',
                      fontWeight: 300,
                      fontSize: 12,
                    }}
                  >
                    {isMuted ? 'Muted' : 'Enabled'}
                  </Typography>
                </Box>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                  <Typography
                    sx={{
                      color: 'rgba(160, 220, 255, 0.55)',
                      fontSize: 10,
                      textTransform: 'uppercase',
                    }}
                  >
                    Welcome Guide
                  </Typography>
                  <Button
                    onClick={() => {
                      playChime('click');
                      setShowWelcomeGuide((prev) => !prev);
                    }}
                    sx={{
                      background: 'none',
                      border: 'none',
                      outline: 'none',
                      padding: 0,
                      textTransform: 'none',
                      justifyContent: 'flex-start',
                      color: showWelcomeGuide ? '#00dc8c' : 'rgba(160, 220, 255, 0.55)',
                      fontSize: 12,
                      fontWeight: 300,
                      '&:hover': {
                        background: 'none',
                        color: '#fff',
                        textShadow: '0 0 8px rgba(0, 180, 255, 0.5)',
                      },
                    }}
                  >
                    {showWelcomeGuide ? 'Visible' : 'Hidden (click to show)'}
                  </Button>
                </Box>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                  <Typography
                    sx={{
                      color: 'rgba(160, 220, 255, 0.55)',
                      fontSize: 10,
                      textTransform: 'uppercase',
                    }}
                  >
                    User Name
                  </Typography>
                  <Button
                    onClick={() => {
                      playChime('click');
                      const newName = window.prompt('Enter your name, Master:', userName);
                      if (newName !== null) {
                        const trimmed = newName.trim();
                        if (trimmed) {
                          setUserName(trimmed);
                          showToast(`Name updated to: ${trimmed}`);
                        }
                      }
                    }}
                    sx={{
                      background: 'none',
                      border: 'none',
                      outline: 'none',
                      padding: 0,
                      textTransform: 'none',
                      justifyContent: 'flex-start',
                      color: '#00dc8c',
                      fontSize: 12,
                      fontWeight: 300,
                      '&:hover': {
                        background: 'none',
                        color: '#fff',
                        textShadow: '0 0 8px rgba(0, 180, 255, 0.5)',
                      },
                    }}
                  >
                    {userName}
                  </Button>
                </Box>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                  <Typography
                    sx={{
                      color: 'rgba(160, 220, 255, 0.55)',
                      fontSize: 10,
                      textTransform: 'uppercase',
                    }}
                  >
                    Mic Threshold
                  </Typography>
                  <Typography sx={{ color: '#fff', fontWeight: 300, fontSize: 12 }}>
                    {speakingThreshold} RMS
                  </Typography>
                </Box>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                  <Typography
                    sx={{
                      color: 'rgba(160, 220, 255, 0.55)',
                      fontSize: 10,
                      textTransform: 'uppercase',
                    }}
                  >
                    Auto-Scroll
                  </Typography>
                  <Button
                    onClick={() => {
                      playChime('click');
                      setAutoScrollEnabled((prev) => !prev);
                    }}
                    sx={{
                      background: 'none',
                      border: 'none',
                      outline: 'none',
                      padding: 0,
                      textTransform: 'none',
                      justifyContent: 'flex-start',
                      color: autoScrollEnabled ? '#00dc8c' : 'rgba(160, 220, 255, 0.55)',
                      fontSize: 12,
                      fontWeight: 300,
                      '&:hover': {
                        background: 'none',
                        color: '#fff',
                        textShadow: '0 0 8px rgba(0, 180, 255, 0.5)',
                      },
                    }}
                  >
                    {autoScrollEnabled ? 'Enabled' : 'Disabled'}
                  </Button>
                </Box>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                  <Typography
                    sx={{
                      color: 'rgba(160, 220, 255, 0.55)',
                      fontSize: 10,
                      textTransform: 'uppercase',
                    }}
                  >
                    Session Duration
                  </Typography>
                  <Typography sx={{ color: '#fff', fontWeight: 300, fontSize: 12 }}>
                    {formatDuration(sessionDuration)}
                  </Typography>
                </Box>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                  <Typography
                    sx={{
                      color: 'rgba(160, 220, 255, 0.55)',
                      fontSize: 10,
                      textTransform: 'uppercase',
                    }}
                  >
                    Chimes
                  </Typography>
                  <Button
                    onClick={() => {
                      playChime('click');
                      setSoundEffectsEnabled((prev) => !prev);
                    }}
                    sx={{
                      background: 'none',
                      border: 'none',
                      outline: 'none',
                      padding: 0,
                      textTransform: 'none',
                      justifyContent: 'flex-start',
                      color: soundEffectsEnabled ? '#00dc8c' : 'rgba(160, 220, 255, 0.55)',
                      fontSize: 12,
                      fontWeight: 300,
                      '&:hover': {
                        background: 'none',
                        color: '#fff',
                        textShadow: '0 0 8px rgba(0, 180, 255, 0.5)',
                      },
                    }}
                  >
                    {soundEffectsEnabled ? 'Enabled' : 'Disabled'}
                  </Button>
                </Box>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                  <Typography
                    sx={{
                      color: 'rgba(160, 220, 255, 0.55)',
                      fontSize: 10,
                      textTransform: 'uppercase',
                    }}
                  >
                    Response Length
                  </Typography>
                  <Button
                    onClick={() => {
                      playChime('click');
                      setResponseLength((prev) => (prev === 'concise' ? 'detailed' : 'concise'));
                    }}
                    sx={{
                      background: 'none',
                      border: 'none',
                      outline: 'none',
                      padding: 0,
                      textTransform: 'none',
                      justifyContent: 'flex-start',
                      color: responseLength === 'concise' ? '#00dc8c' : 'rgba(160, 220, 255, 0.55)',
                      fontSize: 12,
                      fontWeight: 300,
                      '&:hover': {
                        background: 'none',
                        color: '#fff',
                        textShadow: '0 0 8px rgba(0, 180, 255, 0.5)',
                      },
                    }}
                  >
                    {responseLength === 'concise' ? 'Concise (<30 words)' : 'Detailed (<100 words)'}
                  </Button>
                </Box>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                  <Typography
                    sx={{
                      color: 'rgba(160, 220, 255, 0.55)',
                      fontSize: 10,
                      textTransform: 'uppercase',
                    }}
                  >
                    Active Model
                  </Typography>
                  <Button
                    onClick={() => {
                      playChime('wake');
                      setActiveModel((prev) => {
                        const next =
                          prev === 'gemini-2.5-flash'
                            ? 'gemini-2.5-pro'
                            : prev === 'gemini-2.5-pro'
                              ? 'gemini-2.0-flash'
                              : 'gemini-2.5-flash';
                        const labels: Record<string, string> = {
                          'gemini-2.5-flash': 'Gemini 2.5 Flash',
                          'gemini-2.5-pro': 'Gemini 2.5 Pro',
                          'gemini-2.0-flash': 'Gemini 2.0 Flash',
                        };
                        showToast(`Active model: ${labels[next] || next}`);
                        return next;
                      });
                    }}
                    sx={{
                      background: 'none',
                      border: 'none',
                      outline: 'none',
                      padding: 0,
                      textTransform: 'none',
                      justifyContent: 'flex-start',
                      color: '#00dc8c',
                      fontSize: 12,
                      fontWeight: 300,
                      '&:hover': {
                        background: 'none',
                        color: '#fff',
                        textShadow: '0 0 8px rgba(0, 180, 255, 0.5)',
                      },
                    }}
                  >
                    {activeModel === 'gemini-2.5-flash'
                      ? 'Gemini 2.5 Flash'
                      : activeModel === 'gemini-2.5-pro'
                        ? 'Gemini 2.5 Pro'
                        : 'Gemini 2.0 Flash'}
                  </Button>
                </Box>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                  <Typography
                    sx={{
                      color: 'rgba(160, 220, 255, 0.55)',
                      fontSize: 10,
                      textTransform: 'uppercase',
                    }}
                  >
                    Font Size
                  </Typography>
                  <Button
                    onClick={() => {
                      playChime('click');
                      setMessageFontSize((prev) =>
                        prev === 'small' ? 'medium' : prev === 'medium' ? 'large' : 'small'
                      );
                    }}
                    sx={{
                      background: 'none',
                      border: 'none',
                      outline: 'none',
                      padding: 0,
                      textTransform: 'none',
                      justifyContent: 'flex-start',
                      color: '#00dc8c',
                      fontSize: 12,
                      fontWeight: 300,
                      '&:hover': {
                        background: 'none',
                        color: '#fff',
                        textShadow: '0 0 8px rgba(0, 180, 255, 0.5)',
                      },
                    }}
                  >
                    {messageFontSize === 'small'
                      ? 'Small (11px)'
                      : messageFontSize === 'large'
                        ? 'Large (15px)'
                        : 'Medium (13px)'}
                  </Button>
                </Box>
              </Box>
            </Box>

            {/* Reset to Defaults */}
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', marginTop: 1 }}>
              <Button
                onClick={() => {
                  if (!window.confirm('Reset all session settings to defaults?')) return;
                  playChime('clear');

                  // Revert states
                  setSpeakingThreshold(10);
                  setShowWelcomeGuide(true);
                  setUserName('Master');
                  setAutoScrollEnabled(true);
                  setSoundEffectsEnabled(true);
                  setSoundVolume(100);
                  setMessageFontSize('medium');
                  setCounterMode('char');
                  setPlaybackSpeed(1.0);
                  setResponseLength('detailed');
                  setActiveModel('gemini-2.5-flash');
                  setInputText('');

                  // Remove items from local storage to clean up
                  localStorage.removeItem('july_speaking_threshold');
                  localStorage.removeItem('july_show_welcome_guide');
                  localStorage.removeItem('july_user_name');
                  localStorage.removeItem('july_auto_scroll');
                  localStorage.removeItem('july_sound_effects');
                  localStorage.removeItem('july_sound_volume');
                  localStorage.removeItem('july_message_font_size');
                  localStorage.removeItem('july_draft_input');
                  localStorage.removeItem('july_counter_mode');
                  localStorage.removeItem('july_response_length');
                  localStorage.removeItem('july_active_model');

                  showToast('Settings reset to default');
                }}
                sx={{
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 3,
                  padding: '8px 16px',
                  color: 'rgba(160, 220, 255, 0.72)',
                  fontSize: 11,
                  fontWeight: 400,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  '&:hover': {
                    background: 'rgba(255, 255, 255, 0.08)',
                    borderColor: 'rgba(0, 180, 255, 0.25)',
                    color: '#fff',
                    boxShadow: '0 0 15px rgba(0, 180, 255, 0.15)',
                  },
                }}
              >
                Reset Settings to Default
              </Button>
            </Box>
          </DialogContent>
        </Dialog>
      </Box>
    </>
  );
}

// ─── Icons & Subcomponents ───────────────────────────────────────────────────

function IconWave({ active, volume = 0 }: { active: boolean; volume?: number }) {
  const baseHeights = active ? [10, 18, 22, 16, 8] : [4, 8, 6, 8, 4];
  const scale = 1 + (volume / 100) * 1.5;
  return (
    <Box
      component='svg'
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
          <Box
            component='line'
            key={x}
            x1={x}
            y1={13 - h / 2}
            x2={x}
            y2={13 + h / 2}
            sx={{ transition: 'all 60ms ease-out' }}
          />
        );
      })}
    </Box>
  );
}

function IconSpeaking({ playbackSpeed }: { playbackSpeed: number }) {
  const heights = [7, 15, 20, 13, 6];
  const duration = 0.7 / playbackSpeed;
  return (
    <Box
      component='svg'
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
          <Box
            component='line'
            key={x}
            x1={x}
            y1={13 - h / 2}
            x2={x}
            y2={13 + h / 2}
            sx={{
              animation: `speaking-bar ${duration.toFixed(2)}s ease-in-out ${i * 100}ms infinite`,
            }}
          />
        );
      })}
    </Box>
  );
}

function IconSpeakerWave() {
  return (
    <Box
      component='svg'
      width='10'
      height='10'
      viewBox='0 0 24 24'
      fill='none'
      stroke='#00dc8c'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      sx={{
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
    </Box>
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
    <IconButton
      onClick={handleCopy}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: copied ? '4px 8px' : 0.5,
        borderRadius: copied ? '10px' : '6px',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        background: 'rgba(255, 255, 255, 0.02)',
        color: copied ? 'rgba(0, 220, 140, 0.85)' : 'rgba(160, 220, 255, 0.7)',
        cursor: 'pointer',
        transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        marginLeft: 'auto',
        '&:hover': {
          background: 'rgba(255, 255, 255, 0.08)',
          borderColor: 'rgba(0, 180, 255, 0.25)',
          color: '#fff',
          boxShadow: '0 0 8px rgba(0, 180, 255, 0.1)',
        },
      }}
      aria-label={copied ? 'Copied' : 'Copy message text'}
      title={copied ? 'Copied!' : 'Copy message'}
    >
      {copied ? (
        <Box
          component='span'
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            fontSize: 10,
            fontWeight: 400,
            lineHeight: 1,
          }}
        >
          <Check sx={{ fontSize: 12 }} />
          <span>Copied</span>
        </Box>
      ) : (
        <ContentCopy sx={{ fontSize: 12 }} />
      )}
    </IconButton>
  );
}
