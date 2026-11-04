const SAS = require('../src/core.js');
console.log(`Isotropic average; all points; qD 0–120; 513 q values; median of 3 runs after warmup; ${process.platform} ${process.arch}; Node ${process.version}`);
for (const count of [20000, 250000]) {
  const {points} = SAS.sampleShape('ellipsoid', count, 42);
  for (const quality of ['quick', 'balanced']) {
    SAS.isotropicScattering(points, 120, quality);
    const times = [];
    let result;
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      result = SAS.isotropicScattering(points, 120, quality);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    console.log(`${count.toLocaleString().padStart(7)} points; ${quality.padEnd(8)} ${result.directions.toLocaleString().padStart(5)} directions: ${times[1].toFixed(1)} ms median`);
  }
}
