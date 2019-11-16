const recorder = require('node-record-lpcm16');
const fs = require('fs');

const file = fs.createWriteStream('record.wav', { encoding: 'binary' });
console.log('record for 3000');

const recording = recorder.record({
  sampleRate: 16000,
});

recording.stream().pipe(file);

setTimeout(() => {
  console.log('stop');
  recording.stop();
}, 65*1000);
