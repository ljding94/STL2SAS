const SAS = require('../src/core.js');
const sizes = [5000, 20000, 100000, 250000];
const grid = Number(process.argv[2]) || 128;
console.log(`Three ${grid} x ${grid} planes; 2x oversampled FFT; median of 7 rotations; ${process.platform} ${process.arch}; Node ${process.version}`);
for (const count of sizes) {
  const {points} = SAS.sampleShape('ellipsoid', count, 42), engine = new SAS.ScatteringEngine(), times = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    engine.compute(points, SAS.rotationMatrix([20, -25 + i * 3, 15]), grid, 32);
    if (i > 2) times.push(performance.now() - start);
  }
  times.sort((a,b) => a-b);
  console.log(`${count.toLocaleString().padStart(7)} points: ${times[3].toFixed(1)} ms median`);
}
