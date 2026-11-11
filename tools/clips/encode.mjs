// ffmpeg arguments for the What's new clips (the same rules as the Calcs clips): VP9 WebM first, H.264 MP4 for Safari, silent,
// looping, retina (the page is recorded at twice the pixels, 1920 px wide), at most 4 MB each (the CRF steps up until the file fits). Colour range matters: a full-range ("pc") VP9
// file makes Chromium's software decoder fail before the first frame and the error does not fall back to the MP4 source, so the
// filter tail scales to tv range and both encoders flag tv.
export const MAX_BYTES = 4 * 1024 * 1024;
/** the poster (the still shown before a clip plays) is a palette PNG of at most this size */
export const POSTER_MAX = 120 * 1024;
export const vfTail = (fps) => `scale=in_range=pc:out_range=tv,setsar=1,fps=${fps}`;
export const webmArgs = (crf, fps) => ['-c:v', 'libvpx-vp9', '-crf', String(crf), '-b:v', '0', '-g', String(fps), '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-tile-columns', '2', '-cues_to_front', '1', '-an', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt470bg'];
export const mp4Args = (crf, fps) => ['-c:v', 'libx264', '-preset', 'medium', '-profile:v', 'high', '-crf', String(crf), '-g', String(fps), '-movflags', '+faststart', '-an', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt470bg'];
export const WEBM_CRFS = [34, 37, 40, 44, 48];
export const MP4_CRFS = [30, 33, 36, 39, 42];
