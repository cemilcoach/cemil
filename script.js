let audioCtx, micStream, analyser, processor;
let hpFilter;
let running = false;
let lastTrigger = 0;

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusEl = document.getElementById('status');
const flash = document.getElementById('flash');

const sensitivityEl = document.getElementById('sensitivity');
const sensitivityVal = document.getElementById('sensitivityVal');
const absThresholdEl = document.getElementById('absThreshold');
const absVal = document.getElementById('absVal');
const cooldownEl = document.getElementById('cooldown');
const cooldownVal = document.getElementById('cooldownVal');
const testAlarmBtn = document.getElementById('testAlarm');

sensitivityEl.oninput = () => sensitivityVal.textContent = sensitivityEl.value;
absThresholdEl.oninput = () => absVal.textContent = Number(absThresholdEl.value).toFixed(4);
cooldownEl.oninput = () => cooldownVal.textContent = cooldownEl.value;

startBtn.addEventListener('click', start);
stopBtn.addEventListener('click', stop);
testAlarmBtn.addEventListener('click', playAlarm);

async function start() {
  if (running) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    micStream = audioCtx.createMediaStreamSource(stream);

    // Highpass to reduce rumble / low freq background (tweak freq if needed)
    hpFilter = audioCtx.createBiquadFilter();
    hpFilter.type = 'highpass';
    hpFilter.frequency.value = 300; // 300 Hz baseline

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;

    micStream.connect(hpFilter);
    hpFilter.connect(analyser);

    // we'll use time domain data for RMS
    const bufferLen = analyser.fftSize;
    const data = new Float32Array(bufferLen);

    // moving average RMS for background energy
    const avgHistory = [];
    const maxHistory = 20;

    running = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    statusEl.textContent = 'Durum: Dinleniyor...';

    function process() {
      if (!running) return;
      analyser.getFloatTimeDomainData(data);
      // compute RMS
      let sum = 0;
      for (let i = 0; i < bufferLen; i++) {
        sum += data[i] * data[i];
      }
      const rms = Math.sqrt(sum / bufferLen);

      // update moving average
      avgHistory.push(rms);
      if (avgHistory.length > maxHistory) avgHistory.shift();
      const avg = avgHistory.reduce((a,b)=>a+b,0)/avgHistory.length;

      const absThreshold = Number(absThresholdEl.value); // absolute floor to avoid false triggers from silence
      const sensitivityFactor = Number(sensitivityEl.value); // lower => more sensitive

      // detect spike: rms significantly greater than background average * factor AND above absolute threshold
      if (rms > Math.max(avg * sensitivityFactor, absThreshold)) {
        const now = Date.now();
        const cooldownMs = Number(cooldownEl.value) * 1000;
        if (now - lastTrigger > cooldownMs) {
          lastTrigger = now;
          onTrigger(rms, avg);
        }
      }

      // run ~60fps
      requestAnimationFrame(process);
    }

    requestAnimationFrame(process);
  } catch (err) {
    console.error('Mikrofon açılamadı:', err);
    statusEl.textContent = 'Hata: Mikrofon erişimi gerek.';
  }
}

function stop() {
  running = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  statusEl.textContent = 'Durum: Durduruldu';
  if (micStream && micStream.mediaStream) {
    const tracks = micStream.mediaStream.getTracks();
    tracks.forEach(t => t.stop());
  }
  if (audioCtx && audioCtx.state !== 'closed') {
    audioCtx.close();
  }
  audioCtx = null;
  analyser = null;
}

function onTrigger(rms, avg) {
  console.log('Tetiklendi', {rms, avg});
  statusEl.textContent = `Tetiklendi! (rms ${rms.toFixed(4)})`;
  flashScreen();
  playAlarmSequence();
}

function flashScreen() {
  flash.style.opacity = '1';
  setTimeout(()=> flash.style.opacity = '0', 150);
}

let alarmPlaying = false;
function playAlarm() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  // single beep
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = 'sine';
  o.frequency.value = 880;
  g.gain.value = 0.0001;
  o.connect(g);
  g.connect(audioCtx.destination);
  o.start();
  // fade in and out quickly
  g.gain.exponentialRampToValueAtTime(0.4, audioCtx.currentTime + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.5);
  setTimeout(()=> { o.stop(); o.disconnect(); g.disconnect(); }, 700);
}

function playAlarmSequence() {
  if (alarmPlaying) return;
  alarmPlaying = true;
  // play 4 beeps separated
  const intervals = [0, 400, 900, 1400];
  intervals.forEach((ms, i) => {
    setTimeout(() => {
      flashScreen();
      playAlarm();
      if (i === intervals.length - 1) {
        setTimeout(()=> alarmPlaying = false, 800);
      }
    }, ms);
  });
}

// test button
testAlarmBtn.addEventListener('click', () => {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)());
  playAlarmSequence();
});
