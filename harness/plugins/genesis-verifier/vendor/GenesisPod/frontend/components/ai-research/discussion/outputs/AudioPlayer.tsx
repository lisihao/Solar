'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Loader2,
  AlertCircle,
  Mic,
} from 'lucide-react';

export interface TTSSegment {
  speaker: string;
  text: string;
  emotion?: string;
}

export interface AudioOverviewScript {
  title: string;
  script: {
    segments: TTSSegment[];
    estimatedDuration: string;
  };
}

interface AudioPlayerProps {
  outputId: string;
  projectId: string;
  script?: AudioOverviewScript;
  audioUrl?: string;
  className?: string;
}

/**
 * Audio Player for Audio Overview outputs
 * Supports server-side TTS audio or browser-based TTS fallback
 */
export function AudioPlayer({
  outputId,
  projectId,
  script: initialScript,
  audioUrl: initialAudioUrl,
  className = '',
}: AudioPlayerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(
    initialAudioUrl || null
  );
  const [script, setScript] = useState<AudioOverviewScript | null>(
    initialScript || null
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const [usingBrowserTTS, setUsingBrowserTTS] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);

  // Initialize browser TTS
  useEffect(() => {
    if (typeof window !== 'undefined') {
      synthRef.current = window.speechSynthesis;
    }
  }, []);

  // Fetch audio from server
  const fetchAudio = useCallback(async () => {
    if (audioUrl) return; // Already have audio

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/v1/ai-studio/projects/${projectId}/outputs/${outputId}/audio`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
          },
        }
      );

      if (!res.ok) {
        throw new Error('Failed to generate audio');
      }

      const result = await res.json();
      // Handle wrapped API response { success: true, data: T }
      const data = result?.data ?? result;

      if (data.available && data.audioUrl) {
        setAudioUrl(data.audioUrl);
        setDuration(data.duration || 0);
      } else {
        // Use browser TTS fallback
        setUsingBrowserTTS(true);
        if (data.script) {
          setScript(data.script);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audio');
    } finally {
      setLoading(false);
    }
  }, [projectId, outputId, audioUrl]);

  // Handle audio element events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleLoadedMetadata = () => setDuration(audio.duration);
    const handleEnded = () => setIsPlaying(false);
    const handleError = () => setError('Failed to play audio');

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, [audioUrl]);

  // Browser TTS playback
  const playWithBrowserTTS = useCallback(() => {
    if (!script || !synthRef.current) return;

    const synth = synthRef.current;
    const segments = script.script.segments;

    // Cancel any ongoing speech
    synth.cancel();

    // Get available voices
    const voices = synth.getVoices();
    const maleVoice = voices.find(
      (v) => v.name.includes('Male') || v.name.includes('David')
    );
    const femaleVoice = voices.find(
      (v) => v.name.includes('Female') || v.name.includes('Zira')
    );

    let segmentIndex = currentSegmentIndex;

    const speakSegment = () => {
      if (segmentIndex >= segments.length) {
        setIsPlaying(false);
        setCurrentSegmentIndex(0);
        return;
      }

      const segment = segments[segmentIndex];
      const utterance = new SpeechSynthesisUtterance(segment.text);

      // Select voice based on speaker
      if (segment.speaker === 'Host1' && maleVoice) {
        utterance.voice = maleVoice;
      } else if (segment.speaker === 'Host2' && femaleVoice) {
        utterance.voice = femaleVoice;
      }

      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.volume = isMuted ? 0 : volume;

      utterance.onend = () => {
        segmentIndex++;
        setCurrentSegmentIndex(segmentIndex);
        speakSegment();
      };

      utterance.onerror = () => {
        setError('Browser TTS error');
        setIsPlaying(false);
      };

      synth.speak(utterance);
    };

    setIsPlaying(true);
    speakSegment();
  }, [script, currentSegmentIndex, isMuted, volume]);

  // Stop browser TTS
  const stopBrowserTTS = useCallback(() => {
    if (synthRef.current) {
      synthRef.current.cancel();
    }
    setIsPlaying(false);
  }, []);

  // Play/pause toggle
  const togglePlay = useCallback(() => {
    if (usingBrowserTTS || (!audioUrl && script)) {
      if (isPlaying) {
        stopBrowserTTS();
      } else {
        playWithBrowserTTS();
      }
    } else if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  }, [
    isPlaying,
    usingBrowserTTS,
    audioUrl,
    script,
    playWithBrowserTTS,
    stopBrowserTTS,
  ]);

  // Seek
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  // Volume change
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    setVolume(vol);
    if (audioRef.current) {
      audioRef.current.volume = vol;
    }
  };

  // Toggle mute
  const toggleMute = () => {
    setIsMuted(!isMuted);
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
    }
  };

  // Skip to previous/next segment
  const skipSegment = (direction: 'prev' | 'next') => {
    if (!script) return;
    const newIndex =
      direction === 'prev'
        ? Math.max(0, currentSegmentIndex - 1)
        : Math.min(script.script.segments.length - 1, currentSegmentIndex + 1);
    setCurrentSegmentIndex(newIndex);
  };

  // Format time
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Initialize: fetch audio if needed
  useEffect(() => {
    if (!audioUrl && !script) {
      fetchAudio();
    }
  }, [fetchAudio, audioUrl, script]);

  // Current segment display
  const currentSegment = script?.script.segments[currentSegmentIndex];

  return (
    <div
      className={`rounded-lg bg-gradient-to-br from-purple-50 to-indigo-50 p-4 ${className}`}
    >
      {/* Hidden audio element */}
      {audioUrl && <audio ref={audioRef} src={audioUrl} preload="metadata" />}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
          <span className="ml-2 text-purple-600">Generating audio...</span>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="flex items-center justify-center py-4 text-red-500">
          <AlertCircle className="mr-2 h-5 w-5" />
          {typeof error === 'string' ? error : '加载失败'}
        </div>
      )}

      {/* Player UI */}
      {!loading && !error && (
        <>
          {/* Header */}
          <div className="mb-4 flex items-center gap-2">
            <Mic className="h-5 w-5 text-purple-600" />
            <span className="font-medium text-gray-900">Audio Overview</span>
            {usingBrowserTTS && (
              <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700">
                Browser TTS
              </span>
            )}
          </div>

          {/* Current segment display */}
          {currentSegment && (
            <div className="mb-4 rounded-lg bg-white/70 p-3">
              <div className="mb-1 flex items-center gap-2">
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    currentSegment.speaker === 'Host1'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-pink-100 text-pink-700'
                  }`}
                >
                  {currentSegment.speaker}
                </span>
                {currentSegment.emotion && (
                  <span className="text-xs text-gray-500">
                    {currentSegment.emotion}
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-700">{currentSegment.text}</p>
            </div>
          )}

          {/* Progress bar */}
          {!usingBrowserTTS && duration > 0 && (
            <div className="mb-4">
              <input
                type="range"
                min={0}
                max={duration}
                value={currentTime}
                onChange={handleSeek}
                className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-purple-200 accent-purple-600"
              />
              <div className="mt-1 flex justify-between text-xs text-gray-500">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>
          )}

          {/* Segment progress for browser TTS */}
          {usingBrowserTTS && script && (
            <div className="mb-4">
              <div className="h-2 overflow-hidden rounded-full bg-purple-200">
                <div
                  className="h-full bg-purple-600 transition-all"
                  style={{
                    width: `${((currentSegmentIndex + 1) / script.script.segments.length) * 100}%`,
                  }}
                />
              </div>
              <div className="mt-1 text-center text-xs text-gray-500">
                Segment {currentSegmentIndex + 1} of{' '}
                {script.script.segments.length}
              </div>
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => skipSegment('prev')}
              disabled={!script || currentSegmentIndex === 0}
              className="rounded-full p-2 text-gray-600 hover:bg-white/50 disabled:opacity-30"
            >
              <SkipBack className="h-5 w-5" />
            </button>

            <button
              onClick={togglePlay}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-600 text-white shadow-lg transition-transform hover:scale-105"
            >
              {isPlaying ? (
                <Pause className="h-6 w-6" />
              ) : (
                <Play className="ml-1 h-6 w-6" />
              )}
            </button>

            <button
              onClick={() => skipSegment('next')}
              disabled={
                !script ||
                currentSegmentIndex >= (script?.script.segments.length ?? 0) - 1
              }
              className="rounded-full p-2 text-gray-600 hover:bg-white/50 disabled:opacity-30"
            >
              <SkipForward className="h-5 w-5" />
            </button>
          </div>

          {/* Volume control */}
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              onClick={toggleMute}
              className="text-gray-600 hover:text-gray-900"
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="h-4 w-4" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              className="h-1 w-24 cursor-pointer appearance-none rounded-lg bg-gray-200 accent-purple-600"
            />
          </div>
        </>
      )}
    </div>
  );
}
