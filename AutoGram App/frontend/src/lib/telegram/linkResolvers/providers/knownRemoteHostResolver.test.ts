import { describe, expect, it } from 'vitest';
import { identifyKnownRemoteHost } from './knownRemoteHostResolver';

describe('known remote host discovery', () => {
  it.each([
    ['https://pixeldrain.com/u/abc', 'PixelDrain'],
    ['https://gofile.io/d/abc', 'Gofile'],
    ['https://cdn.up2file.online/path/video.mp4', 'Up2File CDN'],
    ['https://cdn.mp4ko.de/a.mp4', 'MP4ko CDN'],
    ['https://vid3.de/watch/abc', 'Vid3'],
    ['https://cdn2.example.net/file.bin', 'CDN2'],
    ['https://tribunvideo.com/f/xoxe5ibzt8w', 'Tribun Video'],
    ['https://vdko.de/d/bjzhmlctj4ug', 'VDKO'],
    ['https://vidqy.me/d/lcqoiimf9b83', 'Vidqy'],
    ['https://video2.twimg.casa/MHCDSQAp1.mp4', 'Twimg Media'],
    ['https://cdn2.slicndrive.com/f6a84de81.mp4', 'SlicaDrive CDN'],
    ['https://cdn2.slicadrivee.fun/8WhyKEfAN.mp4', 'SlicaDrive CDN'],
    ['https://cdn.videayo.cc/t1slreaIsGu', 'Videayo CDN'],
    ['https://cdn2.vidlyx.mom/f/h7n2jgrzby', 'Vidlyx CDN'],
    ['https://cdn.aceiwmg.com/T4IhbyOk1.mp4', 'Ace Image CDN'],
    ['https://rumble.com/v123', 'Rumble'],
    ['https://doodstream.com/d/abc', 'DoodStream'],
  ])('classifies %s', (url, expected) => {
    expect(identifyKnownRemoteHost(url)).toBe(expected);
  });

  it('does not classify Telegram bot links as downloadable hosts', () => {
    expect(identifyKnownRemoteHost('https://t.me/example_bot?start=abc')).toBeNull();
  });
});
