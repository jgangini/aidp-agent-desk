// Synthetic browser voice events and a local oscillator: no hardware or vendor speech service.
module.exports = function installVoiceFixtures() {
  class Utterance extends EventTarget {
    constructor(text) {
      super();
      this.text = text;
    }
  }
  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    value: Utterance,
    configurable: true,
  });
  Object.defineProperty(window, "speechSynthesis", {
    value: {
      speak(utterance) {
        window.__speechUtterance = utterance;
        queueMicrotask(() => utterance.dispatchEvent(new Event("start")));
      },
      cancel() {
        const utterance = window.__speechUtterance;
        window.__speechUtterance = undefined;
        utterance?.dispatchEvent(new Event("end"));
      },
    },
    configurable: true,
  });
  window.SpeechRecognition = class extends EventTarget {
    start() {
      window.__recognitionFixture = this;
      this.dispatchEvent(new Event("start"));
    }
    stop() {
      this.dispatchEvent(new Event("end"));
    }
    abort() {
      this.stop();
    }
  };
  Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
    value: async () => {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const destination = context.createMediaStreamDestination();
      gain.gain.value = 0;
      oscillator.connect(gain).connect(destination);
      oscillator.start();
      await context.resume();
      window.__microphoneFixtures ||= [];
      window.__microphoneFixture = {
        context,
        gain,
        stream: destination.stream,
      };
      window.__microphoneFixtures.push(window.__microphoneFixture);
      return destination.stream;
    },
    configurable: true,
  });
};
