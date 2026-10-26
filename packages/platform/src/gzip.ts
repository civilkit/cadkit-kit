// gzip for saved parts: a part is plain JSON and repeats itself a great deal (a 4,000-feature part is 1.9 MB as JSON and 140 KB
// gzipped), so a file named `*.gz` is written compressed and any file that starts with the gzip magic is read compressed,
// whatever its name. Uses the browser's own CompressionStream; where there is none the text is written plain.

/** The two magic bytes of a gzip stream. */
export const isGzip = (b: Uint8Array): boolean => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;

/** A file name that asks for compression (`part.ckpart.gz`). */
export const wantsGzip = (name: string): boolean => /\.gz$/i.test(name);

const pipe = async (data: Uint8Array, t: { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }): Promise<Uint8Array> => {
  const w = t.writable.getWriter();
  void w.write(data).then(() => w.close());
  return new Uint8Array(await new Response(t.readable).arrayBuffer());
};

/** Text to gzip bytes. Without CompressionStream the UTF-8 bytes, uncompressed (the file still opens: it has no magic). */
export async function gzipText(text: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  const CS = (globalThis as { CompressionStream?: new (f: string) => { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> } }).CompressionStream;
  return CS ? pipe(bytes, new CS('gzip')) : bytes;
}

/** Bytes to text: gunzipped when they start with the gzip magic, else read as UTF-8. */
export async function bytesText(b: Uint8Array): Promise<string> {
  const DS = (globalThis as { DecompressionStream?: new (f: string) => { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> } }).DecompressionStream;
  if (isGzip(b) && DS) return new TextDecoder().decode(await pipe(b, new DS('gzip')));
  return new TextDecoder().decode(b);
}

/** The text of a File / Blob, gunzipped when it is gzip. */
export async function fileText(f: { arrayBuffer?(): Promise<ArrayBuffer>; text?(): Promise<string> }): Promise<string> {
  return f.arrayBuffer ? bytesText(new Uint8Array(await f.arrayBuffer())) : (f.text?.() ?? Promise.resolve(''));
}
