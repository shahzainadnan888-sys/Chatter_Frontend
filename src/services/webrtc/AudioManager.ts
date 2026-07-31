"use client";

type ToneKind =
  | "outgoing"
  | "incoming"
  | "connected"
  | "ended"
  | "busy"
  | "none";

/**
 * Lightweight Web Audio tones — no external audio assets required.
 */
class AudioManagerService {
  private context: AudioContext | null = null;
  private nodes: AudioNode[] = [];
  private interval: ReturnType<typeof setInterval> | null = null;
  private current: ToneKind = "none";

  play(kind: ToneKind) {
    if (kind === this.current) return;
    this.stop();
    this.current = kind;
    if (kind === "none") return;

    const context = this.ensureContext();
    if (kind === "outgoing") this.startRingPattern(context, [440, 480], 1800, 3200);
    else if (kind === "incoming") this.startRingPattern(context, [520, 620], 400, 900);
    else if (kind === "busy") this.startRingPattern(context, [480], 350, 700);
    else if (kind === "connected") this.beep(context, 880, 0.12, 0.05);
    else if (kind === "ended") this.beep(context, 320, 0.22, 0.08);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.nodes.forEach((node) => {
      try {
        node.disconnect();
      } catch {
        // ignore
      }
    });
    this.nodes = [];
    this.current = "none";
  }

  private ensureContext() {
    if (!this.context) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.context = new AudioCtx();
    }
    if (this.context.state === "suspended") void this.context.resume();
    return this.context;
  }

  private beep(
    context: AudioContext,
    frequency: number,
    duration: number,
    gainValue: number,
  ) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.value = gainValue;
    oscillator.connect(gain);
    gain.connect(context.destination);
    this.nodes.push(oscillator, gain);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
  }

  private startRingPattern(
    context: AudioContext,
    frequencies: number[],
    onMs: number,
    cycleMs: number,
  ) {
    const pulse = () => {
      frequencies.forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.value = 0.045;
        oscillator.connect(gain);
        gain.connect(context.destination);
        this.nodes.push(oscillator, gain);
        const start = context.currentTime + index * 0.01;
        oscillator.start(start);
        oscillator.stop(start + onMs / 1000);
      });
    };
    pulse();
    this.interval = setInterval(pulse, cycleMs);
  }
}

export const audioManager = new AudioManagerService();
