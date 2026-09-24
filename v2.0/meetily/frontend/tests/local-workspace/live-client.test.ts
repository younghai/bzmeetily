import { afterEach, describe, expect, test } from 'bun:test';
import { LocalApiError, requestTranslation, transcribeLiveChunk } from '../../src/local/client';

const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;});

describe('live inference request recovery',()=>{
 test('retries a transient ASR failure without losing its audio body',async()=>{
  const bodies: (BodyInit | null | undefined)[]=[];
  globalThis.fetch=Object.assign(async (_input: Parameters<typeof fetch>[0], init?: RequestInit)=>{
   bodies.push(init?.body);
   return bodies.length===1 ? Response.json({error:'Whisper temporarily unavailable'},{status:502}) : Response.json({segments:[]});
  },{preconnect:originalFetch.preconnect});
  const blob=new Blob(['test']);
  const result=await transcribeLiveChunk({sequence:0,start:0,duration:2,blob});
  expect(result.segments).toEqual([]);
  expect(bodies).toEqual([blob,blob]);
 });
 test('limits retries for a persistent translation failure',async()=>{
  let attempts=0;
  globalThis.fetch=Object.assign(async()=>{attempts++;return Response.json({error:'model unavailable'},{status:503});},{preconnect:originalFetch.preconnect});
  await expect(requestTranslation('テスト')).rejects.toBeInstanceOf(LocalApiError);
  expect(attempts).toBe(2);
 });
 test('honors caller cancellation and does not retry it',async()=>{
  const controller=new AbortController();let attempts=0;
  globalThis.fetch=Object.assign(async()=>{attempts++;controller.abort();throw new DOMException('cancelled','AbortError');},{preconnect:originalFetch.preconnect});
  await expect(requestTranslation('テスト',[],controller.signal)).rejects.toHaveProperty('name','AbortError');
  expect(attempts).toBe(1);
 });
 test('adds a live request deadline even when caller did not supply a signal',async()=>{
  let received: AbortSignal | null | undefined;
  globalThis.fetch=Object.assign(async(_input:Parameters<typeof fetch>[0],init?:RequestInit)=>{received=init?.signal;return Response.json({text:'테스트',elapsedMs:1});},{preconnect:originalFetch.preconnect});
  await requestTranslation('テスト');
  expect(received).toBeInstanceOf(AbortSignal);
 });
 test('sends prior turns as structured translation context',async()=>{
  let body: unknown;
  globalThis.fetch=Object.assign(async(_input:Parameters<typeof fetch>[0],init?:RequestInit)=>{
   body=JSON.parse(String(init?.body));
   return Response.json({text:'어떻게 생각하십니까?',elapsedMs:1});
  },{preconnect:originalFetch.preconnect});
  await requestTranslation('どうお考えでしょうか。',[{sourceText:'本日はありがとうございます。',translation:'오늘 와 주셔서 감사합니다.'}]);
  expect(body).toEqual({
   text:'どうお考えでしょうか。',
   sourceLanguage:'ja',
   targetLanguage:'ko',
   context:[{sourceText:'本日はありがとうございます。',translation:'오늘 와 주셔서 감사합니다.'}],
  });
 });
});
