class MeetilyPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = (event) => {
      if (event.data?.type === 'flush') {
        this.port.postMessage({ type: 'flush-ack', requestId: event.data.requestId });
      }
    };
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;

    const frameLength = channels[0]?.length ?? 0;
    if (frameLength === 0) return true;
    const mono = new Float32Array(frameLength);
    for (const channel of channels) {
      for (let index = 0; index < frameLength; index += 1) {
        mono[index] += (channel[index] ?? 0) / channels.length;
      }
    }
    this.port.postMessage(mono.buffer, [mono.buffer]);
    return true;
  }
}

registerProcessor('meetily-pcm-capture', MeetilyPcmCaptureProcessor);
