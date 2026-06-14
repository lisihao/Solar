import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ToolKeyResolverService,
  NoToolKeyError,
} from "@/modules/ai-engine/facade";
import { RequestContext } from "@/common/context/request-context";

export interface TTSOptions {
  text: string;
  voice?: string;
  speed?: number;
  language?: string;
}

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

@Injectable()
export class ResearchProjectTTSService {
  private readonly logger = new Logger(ResearchProjectTTSService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly toolKeyResolver: ToolKeyResolverService,
  ) {}

  /**
   * Resolve the ElevenLabs API key at call time.
   *
   * 2026-05-28 BYOK: userId present → ToolKeyResolver (user key → grant →
   * strict/fallback). No userId → env ELEVENLABS_API_KEY admin fallback.
   */
  private async resolveElevenLabsKey(): Promise<string | undefined> {
    const userId = RequestContext.getUserId();
    if (userId) {
      try {
        const resolved = await this.toolKeyResolver.resolveToolKey(
          "elevenlabs",
          userId,
        );
        return resolved?.value ?? undefined;
      } catch (error) {
        if (error instanceof NoToolKeyError) return undefined;
        throw error;
      }
    }
    return this.configService.get<string>("ELEVENLABS_API_KEY");
  }

  /**
   * Resolve the Google TTS API key at call time.
   *
   * 2026-05-28 BYOK: userId present → ToolKeyResolver (user key → grant →
   * strict/fallback). No userId → env GOOGLE_TTS_API_KEY admin fallback.
   */
  private async resolveGoogleTtsKey(): Promise<string | undefined> {
    const userId = RequestContext.getUserId();
    if (userId) {
      try {
        const resolved = await this.toolKeyResolver.resolveToolKey(
          "googleTts",
          userId,
        );
        return resolved?.value ?? undefined;
      } catch (error) {
        if (error instanceof NoToolKeyError) return undefined;
        throw error;
      }
    }
    return this.configService.get<string>("GOOGLE_TTS_API_KEY");
  }

  /**
   * Check if TTS is available (async; resolves at call time)
   */
  async isAvailableAsync(): Promise<boolean> {
    const [el, goog] = await Promise.all([
      this.resolveElevenLabsKey(),
      this.resolveGoogleTtsKey(),
    ]);
    return !!(el || goog);
  }

  /**
   * Check if TTS is available (synchronous legacy; reads env only, no BYOK)
   */
  isAvailable(): boolean {
    return !!(
      this.configService.get<string>("ELEVENLABS_API_KEY") ||
      this.configService.get<string>("GOOGLE_TTS_API_KEY")
    );
  }

  /**
   * Get available TTS provider (synchronous legacy; reads env only, no BYOK)
   */
  getProvider(): "elevenlabs" | "google" | "none" {
    if (this.configService.get<string>("ELEVENLABS_API_KEY"))
      return "elevenlabs";
    if (this.configService.get<string>("GOOGLE_TTS_API_KEY")) return "google";
    return "none";
  }

  /**
   * Generate audio from script
   * Returns base64 encoded audio or null if no TTS provider is available
   */
  async generateAudio(
    script: AudioOverviewScript,
  ): Promise<{ audioUrl: string; duration: number } | null> {
    const elevenLabsKey = await this.resolveElevenLabsKey();
    const googleTtsKey = elevenLabsKey
      ? undefined
      : await this.resolveGoogleTtsKey();

    if (!elevenLabsKey && !googleTtsKey) {
      this.logger.warn(
        "No TTS provider configured. Set ELEVENLABS_API_KEY or GOOGLE_TTS_API_KEY.",
      );
      return null;
    }

    const provider = elevenLabsKey ? "elevenlabs" : "google";
    this.logger.log(
      `Generating audio with ${provider} for ${script.script.segments.length} segments`,
    );

    try {
      if (elevenLabsKey) {
        return this.generateWithElevenLabs(script, elevenLabsKey);
      } else if (googleTtsKey) {
        return this.generateWithGoogleTTS(script, googleTtsKey);
      }
    } catch (error) {
      this.logger.error(`TTS generation failed: ${error}`);
      return null;
    }

    return null;
  }

  /**
   * Generate audio using ElevenLabs API
   */
  private async generateWithElevenLabs(
    script: AudioOverviewScript,
    apiKey: string,
  ): Promise<{ audioUrl: string; duration: number } | null> {
    // Voice IDs for different hosts
    const voices = {
      Host1: "21m00Tcm4TlvDq8ikWAM", // Rachel - clear, professional
      Host2: "AZnzlk1XvdvUeBnXmlld", // Domi - conversational, warm
    };

    const audioChunks: Buffer[] = [];
    let totalDuration = 0;

    for (const segment of script.script.segments) {
      const voiceId =
        voices[segment.speaker as keyof typeof voices] || voices.Host1;

      try {
        const response = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
          {
            method: "POST",
            headers: {
              Accept: "audio/mpeg",
              "Content-Type": "application/json",
              "xi-api-key": apiKey,
            },
            body: JSON.stringify({
              text: segment.text,
              model_id: "eleven_multilingual_v2",
              voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75,
                style: this.getEmotionStyle(segment.emotion),
              },
            }),
          },
        );

        if (!response.ok) {
          throw new Error(`ElevenLabs API error: ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        audioChunks.push(Buffer.from(arrayBuffer));

        // Estimate duration (rough: ~150 words per minute)
        const wordCount = segment.text.split(/\s+/).length;
        totalDuration += (wordCount / 150) * 60;
      } catch (error) {
        this.logger.error(`Failed to generate segment: ${error}`);
        throw error;
      }
    }

    // Combine audio chunks
    const combinedAudio = Buffer.concat(audioChunks);
    const audioBase64 = combinedAudio.toString("base64");

    return {
      audioUrl: `data:audio/mpeg;base64,${audioBase64}`,
      duration: Math.round(totalDuration),
    };
  }

  /**
   * Generate audio using Google Cloud TTS API
   */
  private async generateWithGoogleTTS(
    script: AudioOverviewScript,
    apiKey: string,
  ): Promise<{ audioUrl: string; duration: number } | null> {
    // Voice configurations for different hosts
    const voices = {
      Host1: {
        languageCode: "en-US",
        name: "en-US-Neural2-D", // Male voice
        ssmlGender: "MALE",
      },
      Host2: {
        languageCode: "en-US",
        name: "en-US-Neural2-F", // Female voice
        ssmlGender: "FEMALE",
      },
    };

    const audioChunks: Buffer[] = [];
    let totalDuration = 0;

    for (const segment of script.script.segments) {
      const voice =
        voices[segment.speaker as keyof typeof voices] || voices.Host1;

      try {
        const response = await fetch(
          `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              input: { text: segment.text },
              voice: voice,
              audioConfig: {
                audioEncoding: "MP3",
                speakingRate: 1.0,
                pitch: 0,
              },
            }),
          },
        );

        if (!response.ok) {
          throw new Error(`Google TTS API error: ${response.status}`);
        }

        const data = await response.json();
        const audioBuffer = Buffer.from(data.audioContent, "base64");
        audioChunks.push(audioBuffer);

        // Estimate duration
        const wordCount = segment.text.split(/\s+/).length;
        totalDuration += (wordCount / 150) * 60;
      } catch (error) {
        this.logger.error(`Failed to generate segment: ${error}`);
        throw error;
      }
    }

    // Combine audio chunks
    const combinedAudio = Buffer.concat(audioChunks);
    const audioBase64 = combinedAudio.toString("base64");

    return {
      audioUrl: `data:audio/mpeg;base64,${audioBase64}`,
      duration: Math.round(totalDuration),
    };
  }

  /**
   * Get emotion style for ElevenLabs
   */
  private getEmotionStyle(emotion?: string): number {
    switch (emotion) {
      case "excited":
        return 0.8;
      case "thoughtful":
        return 0.3;
      case "curious":
        return 0.6;
      default:
        return 0.5;
    }
  }

  /**
   * Parse audio overview content to script format
   */
  parseScript(content: string): AudioOverviewScript | null {
    try {
      const parsed = JSON.parse(content);
      if (parsed.script && Array.isArray(parsed.script.segments)) {
        return parsed as AudioOverviewScript;
      }
      return null;
    } catch {
      return null;
    }
  }
}
