"use strict";

// Incremental voice matching keeps only a small centroid per speaker, never
// the meeting's PCM. Labels are provisional, especially for short/overlapping
// speech, and can be corrected in the saved transcript.
class SpeakerClusters {
  constructor(threshold = 0.5, limit = 64) {
    this.threshold = threshold;
    this.limit = limit;
    this.voices = [];
  }

  identify(embedding, { allowNew = true, adapt = true } = {}) {
    const norm = Math.hypot(...embedding);
    if (!Number.isFinite(norm) || norm === 0) return null;
    const vector = Float32Array.from(embedding, value => value / norm);
    let best = -1;
    let score = -Infinity;
    let runnerUp = -Infinity;
    for (let i = 0; i < this.voices.length; i++) {
      const similarity = vector.reduce((sum, value, j) => sum + value * this.voices[i][j], 0);
      if (similarity > score) { runnerUp = score; best = i; score = similarity; }
      else if (similarity > runnerUp) runnerUp = similarity;
    }
    if (score < this.threshold) {
      if (!allowNew || this.voices.length >= this.limit) return null;
      this.voices.push(vector);
      return this.voices.length - 1;
    }
    // A tie between known voices is uncertainty, not evidence of a new person.
    if (score - runnerUp < 0.08) return null;
    if (!adapt) return best;
    // Slow adaptation prevents one noisy utterance from replacing a voice.
    const updated = this.voices[best].map((value, i) => value * 0.9 + vector[i] * 0.1);
    const length = Math.hypot(...updated);
    this.voices[best] = updated.map(value => value / length);
    return best;
  }
}

class LiveSpeakers {
  constructor(sherpa, config) {
    // CAM++ embeddings vary with words, duration and microphone position.
    // Requiring 0.75 split real same-speaker turns scoring 0.63 into new IDs.
    // Keep this separate from the diarizer's clustering-distance threshold.
    this.clusters = new SpeakerClusters();
    this.diarizer = new sherpa.OfflineSpeakerDiarization({
      segmentation: { pyannote: { model: config.segModel }, numThreads: 2, provider: "cpu", debug: 0 },
      embedding: { model: config.embModel, numThreads: 2, provider: "cpu", debug: 0 },
      clustering: { numClusters: -1, threshold: config.threshold },
      minDurationOn: 0.2,
      minDurationOff: 0.5,
    });
    this.extractor = new sherpa.SpeakerEmbeddingExtractor({
      model: config.embModel, numThreads: 2, provider: "cpu", debug: 0,
    });
  }

  identify(samples) {
    if (samples.length < 16000) return null;
    const turns = this.diarizer.process(samples) ?? [];
    const voices = new Map();
    for (const turn of turns) {
      const start = Math.max(0, Math.floor(turn.start * 16000));
      const end = Math.min(samples.length, Math.floor(turn.end * 16000));
      if (end <= start) continue;
      const voice = voices.get(turn.speaker) ?? { parts: [], length: 0 };
      voice.parts.push(samples.subarray(start, end));
      voice.length += end - start;
      voices.set(turn.speaker, voice);
    }
    let dominant = null;
    let total = 0;
    for (const voice of voices.values()) {
      total += voice.length;
      if (!dominant || voice.length > dominant.length) dominant = voice;
    }
    // Only the dominant voice receives this segment's label. Enrolling every
    // local speaker created hidden identities from noise and brief overlap.
    if (!dominant || dominant.length < 16000 || dominant.length / total < 0.65) return null;
    const audio = new Float32Array(Math.min(dominant.length, 160000));
    let offset = 0;
    for (const part of dominant.parts) {
      const take = Math.min(part.length, audio.length - offset);
      audio.set(part.subarray(0, take), offset);
      offset += take;
      if (offset === audio.length) break;
    }
    const stream = this.extractor.createStream();
    stream.acceptWaveform({ samples: audio, sampleRate: 16000 });
    stream.inputFinished();
    if (!this.extractor.isReady(stream)) return null;
    // Electron disallows external N-API buffers. Brief speech can match a
    // known voice, but cannot create or move an identity on its own.
    return this.clusters.identify(this.extractor.compute(stream, false), {
      allowNew: dominant.length >= 24000,
      adapt: dominant.length >= 32000,
    });
  }
}

module.exports = { SpeakerClusters, LiveSpeakers };
