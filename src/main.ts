import { createSpeechRecognition, transcriptMatchesTarget } from './asr';
import { GROUP_KEYS, GROUPS, VC, VH, W2C } from './data';
import { extractFrames, extractNucleusMfcc, resetMelFilterbank } from './dsp';
import { heuristicFeedback } from './feedback';
import { generateNonsenseWord, pickCurriculumWord } from './phonemes/generator';
import { analyzeReferenceCatalog } from './reference-offline';
import { oneHot, trainingBuffer, vowelNet } from './net';
import {
  $,
  addFB,
  addHistory,
  clearFB,
  drawHeatmap,
  drawWave,
  hide,
  show,
  showErr,
  showProbBars,
  updateNetBadge,
  updateScores,
} from './ui';

const REFERENCE_AUDIO_PATHS: string[] = [
  // Add WAV files under public/reference-audio/ then list them here.
];

let audioCtx: AudioContext | null = null;
let recChunks: Blob[] = [];
let mediaRec: MediaRecorder | null = null;
let recStream: MediaStream | null = null;
let recognition: SpeechRecognition | null = null;
let listening = false;
let stopWave: (() => void) | null = null;
let lastNuc: number[] | null = null;

let correct = 0;
let total = 0;
const history: { w: string; h: string; pass: boolean }[] = [];

let curGroup = GROUP_KEYS[0];
let curWord = '';
let useNonsense = true;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new Ctx();
  }
  return audioCtx;
}

function setTargetWord(display: string, phonLabel: string): void {
  curWord = display;
  $('tWord').textContent = display;
  $('tPhon').textContent = phonLabel;
  clearFB();
  hide('hmWrap');
  hide('pbWrap');
}

function nextWord(): void {
  if (useNonsense) {
    const gen = generateNonsenseWord(curGroup);
    setTargetWord(gen.display, `focus: ${gen.phonemeFocus}`);
  } else {
    const pick = pickCurriculumWord(curGroup);
    setTargetWord(pick.display, pick.phonemeFocus);
  }
}

function runVowelNet(frames: ReturnType<typeof extractFrames>): void {
  const gtype = GROUPS[curGroup]?.type;
  if (gtype !== 'vowel') return;

  lastNuc = extractNucleusMfcc(frames);
  if (!lastNuc) return;

  const t0 = performance.now();
  const probs = vowelNet.predict(lastNuc);
  const ms = (performance.now() - t0).toFixed(2);
  showProbBars(probs, ms);

  let top = 0;
  for (let i = 1; i < probs.length; i++) if (probs[i] > probs[top]) top = i;

  const exp = W2C[curWord];
  const conf = Math.round(probs[top] * 100);
  const n = trainingBuffer.X.length;

  if (n < 8) {
    addFB({
      t: 'info',
      s: `Neural net: model cold — need ~10 correct vowel attempts before predictions are reliable (have ${n})`,
    });
  } else if (top === exp) {
    addFB({
      t: 'pass',
      s: `Neural net: ${VC[top].label} ✓ (${conf}% confidence · ${n} training samples · ${ms}ms)`,
    });
  } else {
    const tip = VH[curWord]?.tip;
    addFB({
      t: 'fail',
      s: `Neural net: predicted ${VC[top].label} (${conf}%), expected ${VC[exp]?.label ?? '?'}${tip ? ` — ${tip}` : ''}`,
    });
  }
}

async function processAudio(): Promise<void> {
  if (!recChunks.length || !audioCtx) return;
  const blob = new Blob(recChunks, { type: 'audio/webm' });
  const ab = await blob.arrayBuffer();

  try {
    const aB = await audioCtx.decodeAudioData(ab);
    const audio = Array.from(aB.getChannelData(0));
    const frames = extractFrames(audio, aB.sampleRate);

    if (frames.length < 4) {
      addFB({ t: 'warn', s: 'Recording too short — try again' });
      return;
    }

    drawHeatmap(frames);
    lastNuc = null;
    runVowelNet(frames);
    for (const fb of heuristicFeedback(frames, curWord, curGroup)) {
      addFB(fb);
    }
  } catch {
    addFB({ t: 'warn', s: 'Could not decode audio' });
  }
}

function startASR(): void {
  recognition = createSpeechRecognition();
  if (!recognition) return;

  recognition.onresult = (e: SpeechRecognitionEvent) => {
    const heard = e.results[0][0].transcript.trim().toLowerCase();
    const pass = transcriptMatchesTarget(heard, curWord);

    total++;
    if (pass) correct++;
    updateScores(correct, total);
    addHistory(curWord, heard, pass, history);
    addFB(
      {
        t: pass ? 'pass' : 'fail',
        s: `speech-to-text: “${heard}” — ${pass ? 'matches target' : `expected “${curWord}”`}`,
      },
      true,
    );

    if (pass && lastNuc) {
      const ci = W2C[curWord];
      if (ci !== undefined) {
        trainingBuffer.X.push(lastNuc.slice());
        trainingBuffer.Y.push(oneHot(ci, 6));
        const loss = vowelNet.train(trainingBuffer.X, trainingBuffer.Y);
        updateNetBadge(trainingBuffer.X.length, loss);
      }
    }

    stopRec();
  };

  recognition.onerror = () => stopRec();
  recognition.onend = () => {
    if (listening) stopRec();
  };

  try {
    recognition.start();
  } catch {
    /* already started */
  }
}

function stopRec(): void {
  if (!listening) return;
  listening = false;
  if (mediaRec && mediaRec.state !== 'inactive') mediaRec.stop();
  if (recStream) recStream.getTracks().forEach((t) => t.stop());
  stopWave?.();
  stopWave = null;
  $('btnRec').classList.remove('on');
  $('btnLbl').textContent = 'tap to speak';
}

async function toggleRec(): Promise<void> {
  if (listening) {
    stopRec();
    return;
  }

  const ctx = getAudioContext();
  if (ctx.state === 'suspended') await ctx.resume();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    recStream = stream;
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    src.connect(an);

    recChunks = [];
    mediaRec = new MediaRecorder(stream);
    mediaRec.ondataavailable = (e) => {
      if (e.data.size > 0) recChunks.push(e.data);
    };
    mediaRec.onstop = () => {
      void processAudio();
    };
    mediaRec.start(100);

    startASR();
    listening = true;
    $('btnRec').classList.add('on');
    $('btnLbl').textContent = 'listening...';
    clearFB();
    hide('hmWrap');
    hide('pbWrap');
    stopWave = drawWave(an, () => listening);
  } catch (e) {
    showErr(`Mic denied — ${e instanceof Error ? e.message : String(e)}`);
  }
}

function initPills(): void {
  const container = $('pillGroup');
  GROUP_KEYS.forEach((g, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pill' + (idx === 0 ? ' on' : '');
    btn.textContent = g;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pill').forEach((p) => p.classList.remove('on'));
      btn.classList.add('on');
      curGroup = g;
      resetMelFilterbank();
      nextWord();
    });
    container.appendChild(btn);
  });
}

function init(): void {
  initPills();

  $('btnRec').addEventListener('click', () => {
    void toggleRec();
  });
  $('btnNext').addEventListener('click', nextWord);

  const nonsenseToggle = $('nonsenseMode') as HTMLInputElement;
  nonsenseToggle.addEventListener('change', () => {
    useNonsense = nonsenseToggle.checked;
    nextWord();
  });
  useNonsense = nonsenseToggle.checked;

  if (!navigator.mediaDevices?.getUserMedia) {
    showErr('getUserMedia not available — run npm run dev and use Chrome or Edge');
  }

  updateNetBadge(0);
  nextWord();

  if (REFERENCE_AUDIO_PATHS.length > 0) {
    void analyzeReferenceCatalog(REFERENCE_AUDIO_PATHS);
  }
}

init();
