import { describe, expect, test } from 'bun:test';
import type { AudioChunk } from '../../src/local/audio/chunker';
import { LiveAudioChunker } from '../../src/local/audio/liveChunker';

const rate = 16000;
function audio(seconds: number, amplitude = 0.1): Float32Array {
  return Float32Array.from({length:Math.round(rate*seconds)},(_,i)=>amplitude*Math.sin(i*0.1));
}

describe('contextual live audio', () => {
  test('updates the same utterance with its preceding speech instead of cutting words every interval', async () => {
    const chunks: AudioChunk[] = [];
    const capture = new LiveAudioChunker({sampleRate:rate,onChunk:chunk=>chunks.push(chunk)});
    capture.push(audio(3));
    expect(chunks.map(chunk=>chunk.sequence)).toEqual([0,0]);
    expect(chunks.map(chunk=>chunk.duration)).toEqual([1.5,3]);
    expect(chunks.map(chunk=>chunk.start)).toEqual([0,0]);
    const first = new Uint8Array(await chunks[0]?.blob.arrayBuffer());
    const second = new Uint8Array(await chunks[1]?.blob.arrayBuffer());
    expect(second.slice(44,44+first.length-44)).toEqual(first.slice(44));
  });

  test('sends the short last phrase at a speech pause while capture is still running', () => {
    const chunks: AudioChunk[] = [];
    const capture = new LiveAudioChunker({sampleRate:rate,onChunk:chunk=>chunks.push(chunk)});
    capture.push(audio(0.8)); capture.push(audio(0.4,0));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.duration).toBeGreaterThanOrEqual(0.8);
    expect(chunks[0]?.duration).toBeLessThan(1.5);
  });

  test('does not send silence after a phrase or discard a quiet real voice', () => {
    const chunks: AudioChunk[] = [];
    const capture = new LiveAudioChunker({sampleRate:rate,onChunk:chunk=>chunks.push(chunk)});
    capture.push(audio(3,0));
    expect(chunks).toHaveLength(0);
    capture.push(audio(0.8,0.012)); capture.push(audio(4,0)); capture.flush();
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.start).toBeGreaterThanOrEqual(2.7);
    expect(chunks[0]?.duration).toBeLessThan(1.5);
  });

  test('bounds continuous speech windows while retaining every sample across arbitrary worklet blocks', () => {
    const chunks: AudioChunk[] = [];
    const capture = new LiveAudioChunker({sampleRate:rate,onChunk:chunk=>chunks.push(chunk)});
    const speech=audio(17);
    for(let start=0;start<speech.length;start+=2048) capture.push(speech.slice(start,start+2048));
    capture.flush(); capture.flush();
    const finalBySequence = new Map(chunks.map(chunk=>[chunk.sequence,chunk]));
    expect([...finalBySequence.values()].map(chunk=>chunk.duration)).toEqual([8,8,1]);
    expect([...finalBySequence.values()].map(chunk=>chunk.start)).toEqual([0,8,16]);
  });
});
