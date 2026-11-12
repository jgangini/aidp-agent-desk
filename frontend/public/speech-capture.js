class SpeechCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = [];
    this.port.onmessage = () => {
      this.flush();
      this.port.postMessage("flushed");
    };
  }
  flush() {
    if (!this.samples.length) return;
    const pcm = new ArrayBuffer(this.samples.length * 2);
    const view = new DataView(pcm);
    this.samples.forEach((value, index) => view.setInt16(index * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true));
    this.port.postMessage(pcm, [pcm]);
    this.samples = [];
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      const value = channels.reduce((sum, channel) => sum + channel[i], 0) / channels.length;
      this.samples.push(Math.max(-1, Math.min(1, value)));
    }
    if (this.samples.length >= 1600) {
      this.flush();
    }
    return true;
  }
}
registerProcessor('speech-capture', SpeechCapture);
