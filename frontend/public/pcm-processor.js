/**
 * AudioWorklet processor that converts Float32 audio samples
 * to Int16 PCM and sends them to the main thread.
 */
class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._bufferSize = 2048; // Send every 2048 samples (~128ms at 16kHz)
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0]; // mono
    for (let i = 0; i < channelData.length; i++) {
      this._buffer.push(channelData[i]);
    }

    if (this._buffer.length >= this._bufferSize) {
      const float32 = new Float32Array(this._buffer.splice(0, this._bufferSize));
      // Convert Float32 -> Int16
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(int16.buffer, [int16.buffer]);
    }

    return true;
  }
}

registerProcessor('pcm-processor', PcmProcessor);
