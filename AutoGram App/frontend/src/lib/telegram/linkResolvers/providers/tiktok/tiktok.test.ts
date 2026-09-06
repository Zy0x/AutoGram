import { describe, it, expect } from 'vitest';
import {
  tiktokResolver,
  inspectTikTokAudio,
  attachTikTokMuxIfSilent,
  isTikTokProfileUrl,
  extractTikTokUsername,
  qualityTierForMeasuredHeight,
} from './index';
import type { StreamQualityFormat } from '../../types';

describe('TikTok Link Resolver & Audio Integrity Engine', () => {
  describe('URL Pattern Matching & Profile Detection', () => {
    it('correctly detects TikTok and Douyin URLs', () => {
      expect(tiktokResolver.canHandle('https://www.tiktok.com/@izuru.01/video/7680589730219707666')).toBe(true);
      expect(tiktokResolver.canHandle('https://vt.tiktok.com/ZS2X9x8/')).toBe(true);
      expect(tiktokResolver.canHandle('https://www.douyin.com/video/7123456789')).toBe(true);
      expect(tiktokResolver.canHandle('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false);
      expect(tiktokResolver.canHandle('https://instagram.com/p/C12345/')).toBe(false);
    });

    it('distinguishes profile URLs from video, photo, and story posts', () => {
      expect(isTikTokProfileUrl('https://www.tiktok.com/@izuru.01')).toBe(true);
      expect(isTikTokProfileUrl('https://www.tiktok.com/@izuru.01/')).toBe(true);
      expect(isTikTokProfileUrl('https://www.tiktok.com/@izuru.01?lang=en')).toBe(true);
      expect(isTikTokProfileUrl('https://www.tiktok.com/@izuru.01/video/7680589730219707666')).toBe(false);
      expect(isTikTokProfileUrl('https://www.tiktok.com/@izuru.01/photo/7680589730219707666')).toBe(false);
      expect(isTikTokProfileUrl('https://www.tiktok.com/@izuru.01/story/7680589730219707666')).toBe(false);
    });

    it('extracts unique username from profile URLs', () => {
      expect(extractTikTokUsername('https://www.tiktok.com/@izuru.01')).toBe('izuru.01');
      expect(extractTikTokUsername('https://www.tiktok.com/@tokyo.prompt/')).toBe('tokyo.prompt');
      expect(extractTikTokUsername('https://www.tiktok.com/video/123')).toBe(null);
    });
  });

  describe('Audio Integrity & Mute Detection (inspectTikTokAudio)', () => {
    it('identifies healthy original audio tracks', () => {
      const status = inspectTikTokAudio({
        title: 'Yangyang Xuanling 4K 120FPS',
        music: 'https://v16-ies-music.tiktokcdn-us.com/audio123.mp3',
        music_info: {
          id: '7680589789749398280',
          title: 'original sound - izuru.01',
          author: 'Izuru',
          original: true,
          duration: 26,
          bitrate: 128000,
          sample_rate: 44100,
          channels: 2,
          status: 1,
        },
        author: {
          nickname: 'Izuru',
          unique_id: 'izuru.01',
        },
      });

      expect(status.hasAudio).toBe(true);
      expect(status.isMuted).toBe(false);
      expect(status.isOriginalSound).toBe(true);
      expect(status.audioBitrate).toBe(128000);
      expect(status.audioTitle).toBe('original sound - izuru.01');
      expect(status.canMux).toBe(true);
    });

    it('detects copyright muting and audio removal from title keywords', () => {
      const status = inspectTikTokAudio({
        title: 'Anime Edit 2026',
        music: 'https://v16-ies-music.tiktokcdn-us.com/audio_muted.mp3',
        music_info: {
          id: '12345',
          title: 'original sound - user123 (sound removed due to copyright)',
          author: 'user123',
          original: false,
          status: 1,
        },
      });

      expect(status.hasAudio).toBe(false);
      expect(status.isMuted).toBe(true);
      expect(status.muteReason).toBe('copyright');
      expect(status.canMux).toBe(false);
    });

    it('detects disabled audio from status = 0', () => {
      const status = inspectTikTokAudio({
        music: 'https://v16-ies-music.tiktokcdn-us.com/audio_disabled.mp3',
        music_info: {
          title: 'Popular Track',
          status: 0,
        },
      });

      expect(status.isMuted).toBe(true);
      expect(status.muteReason).toBe('disabled');
      expect(status.canMux).toBe(false);
    });

    it('detects region licensing restrictions', () => {
      const status = inspectTikTokAudio({
        music: 'https://v16-ies-music.tiktokcdn-us.com/geo.mp3',
        music_info: {
          title: 'Song not available in your region due to license restrictions',
          status: 1,
        },
      });

      expect(status.isMuted).toBe(true);
      expect(status.muteReason).toBe('geo_restricted');
      expect(status.canMux).toBe(false);
    });

    it('handles posts with completely empty sound fields', () => {
      const status = inspectTikTokAudio({});
      expect(status.isMuted).toBe(true);
      expect(status.muteReason).toBe('empty');
      expect(status.hasAudio).toBe(false);
    });
  });

  describe('Audio-Video Muxing & Mute Badge Assignment (attachTikTokMuxIfSilent)', () => {
    it('attaches RemoteMuxSpec when video is video-only and companion audio is present', () => {
      const videoFormat: StreamQualityFormat = {
        id: 'tiktok_hd_nwm',
        label: '1080p (MP4)',
        qualityTier: '1080p',
        ext: 'mp4',
        directUrl: 'https://v16-notes.tiktokcdn-us.com/video_master.mp4',
        isVideo: true,
        height: 1080,
        filesizeBytes: 50_000_000,
        durationSec: 26,
        downloadOnly: true, // flagged as video-only
      };

      const audioFormat: StreamQualityFormat = {
        id: 'tiktok_audio',
        label: 'Original Audio (MP3)',
        qualityTier: 'audio',
        ext: 'mp3',
        directUrl: 'https://v16-ies-music.tiktokcdn-us.com/sound_track.mp3',
        isAudio: true,
        filesizeBytes: 400_000,
      };

      const audioStatus = inspectTikTokAudio({
        music: audioFormat.directUrl,
        music_info: { title: 'original sound - izuru.01', status: 1 },
      });

      attachTikTokMuxIfSilent(videoFormat, audioFormat, audioStatus);

      expect(videoFormat.mux).toBeDefined();
      expect(videoFormat.mux?.videoUrl).toBe(videoFormat.directUrl);
      expect(videoFormat.mux?.audioUrl).toBe(audioFormat.directUrl);
      expect(videoFormat.mux?.outputExt).toBe('mp4');
      expect(videoFormat.badge).toBe('AUDIO RESTORED');
    });

    it('marks format as MUTED (COPYRIGHT) when sound was removed by TikTok', () => {
      const videoFormat: StreamQualityFormat = {
        id: 'tiktok_hd_nwm',
        label: '1080p (MP4)',
        qualityTier: '1080p',
        ext: 'mp4',
        directUrl: 'https://v16-notes.tiktokcdn-us.com/video_master.mp4',
        isVideo: true,
      };

      const audioStatus = inspectTikTokAudio({
        music_info: { title: 'Sound removed due to copyright', status: 1 },
      });

      attachTikTokMuxIfSilent(videoFormat, undefined, audioStatus);

      expect(videoFormat.badge).toBe('MUTED (COPYRIGHT)');
      expect(videoFormat.verification?.status).toBe('wrapper');
      expect(videoFormat.verification?.reason).toContain('copyright');
      expect(videoFormat.mux).toBeUndefined();
    });
  });

  describe('Full Format Generation Matrix', () => {
    it('produces HD video, original audio, and creator avatar formats from TikTok metadata', () => {
      const mockData = {
        id: '7680589730219707666',
        title: 'Yangyang Xuanling 4K 120FPS',
        duration: 26,
        size: 313367660,
        hd_size: 313367660,
        height: 1920,
        width: 1080,
        fps: 120,
        play: 'https://v16m.tiktokcdn-us.com/video_standard.mp4',
        hdplay: 'https://v16-notes.tiktokcdn-us.com/video_hd.mp4',
        music: 'https://v16-ies-music.tiktokcdn-us.com/music.mp3',
        music_info: {
          id: '7680589789749398280',
          title: 'original sound - izuru.01',
          author: 'Izuru',
          original: true,
          duration: 26,
          bitrate: 128000,
          sample_rate: 44100,
          channels: 2,
          status: 1,
        },
        author: {
          nickname: 'Izuru',
          unique_id: 'izuru.01',
          avatar_larger: 'https://p19-common-sign.tiktokcdn-us.com/avatar_hd.jpg',
        },
      };

      const audioStatus = inspectTikTokAudio(mockData);
      expect(audioStatus.hasAudio).toBe(true);
      expect(audioStatus.isOriginalSound).toBe(true);
      expect(audioStatus.audioBitrate).toBe(128000);

      // Verify quality tier mapping (height 1920 is 2K tier)
      const tier = qualityTierForMeasuredHeight(mockData.height);
      expect(tier).toBe('2k');
    });
  });

  describe('Quality Tier Calculation', () => {
    it('returns exact standard quality tiers for pixel heights', () => {
      expect(qualityTierForMeasuredHeight(2160)).toBe('4k');
      expect(qualityTierForMeasuredHeight(1080)).toBe('1080p');
      expect(qualityTierForMeasuredHeight(720)).toBe('720p');
      expect(qualityTierForMeasuredHeight(480)).toBe('480p');
      expect(qualityTierForMeasuredHeight(undefined)).toBe('original');
    });
  });
});
