'use client';

/**
 * AI Slides V5.0 - Voice Player
 *
 * Audio player for slide narrations:
 * - Play/pause control
 * - Progress bar
 * - Volume control
 * - Auto-play next slide option
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Loader2,
  Mic,
} from 'lucide-react';
import { cn } from '@/lib/utils/common';

interface Narration {
  pageIndex: number;
  script: string;
  estimatedDuration: number;
  audioUrl?: string;
}

interface VoicePlayerProps {
  narrations: Narration[];
  currentPageIndex: number;
  onPageChange?: (pageIndex: number) => void;
  autoPlay?: boolean;
  onAutoPlayChange?: (autoPlay: boolean) => void;
  className?: string;
}

export function VoicePlayer({
  narrations,
  currentPageIndex,
  onPageChange,
  autoPlay = false,
  onAutoPlayChange,
  className,
}: VoicePlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);

  const currentNarration = narrations.find(
    (n) => n.pageIndex === currentPageIndex
  );
  const hasAudio = !!currentNarration?.audioUrl;

  // Update audio source when page changes
  useEffect(() => {
    if (audioRef.current && currentNarration?.audioUrl) {
      audioRef.current.src = currentNarration.audioUrl;
      audioRef.current.load();
      setCurrentTime(0);

      if (autoPlay) {
        audioRef.current.play().catch(() => {
          // Auto-play might be blocked by browser
          setIsPlaying(false);
        });
      }
    }
  }, [currentPageIndex, currentNarration?.audioUrl, autoPlay]);

  // Handle play/pause
  const togglePlay = useCallback(() => {
    if (!audioRef.current || !hasAudio) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {
        setIsPlaying(false);
      });
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying, hasAudio]);

  // Handle volume change
  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newVolume = parseFloat(e.target.value);
      setVolume(newVolume);
      if (audioRef.current) {
        audioRef.current.volume = newVolume;
      }
      if (newVolume === 0) {
        setIsMuted(true);
      } else if (isMuted) {
        setIsMuted(false);
      }
    },
    [isMuted]
  );

  // Toggle mute
  const toggleMute = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
    }
    setIsMuted(!isMuted);
  }, [isMuted]);

  // Handle seek
  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
    setCurrentTime(time);
  }, []);

  // Go to previous page
  const goToPrevious = useCallback(() => {
    if (currentPageIndex > 0 && onPageChange) {
      onPageChange(currentPageIndex - 1);
    }
  }, [currentPageIndex, onPageChange]);

  // Go to next page
  const goToNext = useCallback(() => {
    const maxPage = Math.max(...narrations.map((n) => n.pageIndex));
    if (currentPageIndex < maxPage && onPageChange) {
      onPageChange(currentPageIndex + 1);
    }
  }, [currentPageIndex, narrations, onPageChange]);

  // Audio event handlers
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleDurationChange = () => setDuration(audio.duration);
    const handleEnded = () => {
      setIsPlaying(false);
      if (autoPlay) {
        goToNext();
      }
    };
    const handleWaiting = () => setLoading(true);
    const handleCanPlay = () => setLoading(false);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('waiting', handleWaiting);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('waiting', handleWaiting);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
    };
  }, [autoPlay, goToNext]);

  // Format time (seconds to mm:ss)
  const formatTime = (seconds: number): string => {
    if (!isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // If no narrations, show empty state
  if (narrations.length === 0) {
    return (
      <div
        className={cn(
          'rounded-lg border border-slate-200 bg-slate-50 p-4',
          className
        )}
      >
        <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
          <Mic className="h-4 w-4" />
          <span>暂无语音旁白</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-slate-200 bg-white p-3',
        className
      )}
    >
      {/* Hidden audio element */}
      <audio ref={audioRef} preload="metadata" />

      {/* Narration script preview */}
      {currentNarration && (
        <div className="mb-3 max-h-20 overflow-y-auto rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
          {currentNarration.script}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-3">
        {/* Skip back */}
        <button
          onClick={goToPrevious}
          disabled={currentPageIndex === 0}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
            currentPageIndex === 0
              ? 'cursor-not-allowed text-slate-300'
              : 'text-slate-600 hover:bg-slate-100'
          )}
        >
          <SkipBack className="h-4 w-4" />
        </button>

        {/* Play/Pause */}
        <button
          onClick={togglePlay}
          disabled={!hasAudio}
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-full transition-colors',
            !hasAudio
              ? 'cursor-not-allowed bg-slate-100 text-slate-300'
              : 'bg-orange-500 text-white hover:bg-orange-600'
          )}
        >
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : isPlaying ? (
            <Pause className="h-5 w-5" />
          ) : (
            <Play className="ml-0.5 h-5 w-5" />
          )}
        </button>

        {/* Skip forward */}
        <button
          onClick={goToNext}
          disabled={
            currentPageIndex >= Math.max(...narrations.map((n) => n.pageIndex))
          }
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
            currentPageIndex >= Math.max(...narrations.map((n) => n.pageIndex))
              ? 'cursor-not-allowed text-slate-300'
              : 'text-slate-600 hover:bg-slate-100'
          )}
        >
          <SkipForward className="h-4 w-4" />
        </button>

        {/* Progress bar */}
        <div className="flex flex-1 items-center gap-2">
          <span className="text-xs text-slate-500">
            {formatTime(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={currentTime}
            onChange={handleSeek}
            disabled={!hasAudio}
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-orange-500"
          />
          <span className="text-xs text-slate-500">{formatTime(duration)}</span>
        </div>

        {/* Volume control */}
        <div
          className="relative"
          onMouseEnter={() => setShowVolumeSlider(true)}
          onMouseLeave={() => setShowVolumeSlider(false)}
        >
          <button
            onClick={toggleMute}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
          >
            {isMuted || volume === 0 ? (
              <VolumeX className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </button>

          {showVolumeSlider && (
            <div className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="h-20 w-2 cursor-pointer appearance-none rounded-full bg-slate-200 accent-orange-500"
                style={{
                  writingMode: 'vertical-lr',
                  direction: 'rtl',
                }}
              />
            </div>
          )}
        </div>

        {/* Auto-play toggle */}
        {onAutoPlayChange && (
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={autoPlay}
              onChange={(e) => onAutoPlayChange(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 accent-orange-500"
            />
            <span className="text-xs text-slate-600">自动播放</span>
          </label>
        )}
      </div>
    </div>
  );
}

export default VoicePlayer;
