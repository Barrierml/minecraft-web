// ===== benchmark.js =====
// Deterministic browser benchmark runner and report formatter.

function clampNumber(value, min, max, fallback) {
  if (value === '' || value === null || value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next === undefined ? sorted[base] : sorted[base] + rest * (next - sorted[base]);
}

function makeStats(values) {
  if (!values.length) {
    return { count: 0, min: 0, max: 0, avg: 0, median: 0, p90: 0, p95: 0, p99: 0, stdev: 0 };
  }
  const sorted = values.slice().sort((a, b) => a - b);
  let sum = 0;
  for (const v of values) sum += v;
  const avg = sum / values.length;
  let variance = 0;
  for (const v of values) variance += (v - avg) * (v - avg);
  variance /= values.length;
  return {
    count: values.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg,
    median: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
    stdev: Math.sqrt(variance),
  };
}

function averageWorstFrameFps(values, ratio) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => b - a);
  const count = Math.max(1, Math.ceil(sorted.length * ratio));
  let sum = 0;
  for (let i = 0; i < count; i++) sum += sorted[i];
  return 1000 / (sum / count);
}

function countOver(values, limit) {
  let count = 0;
  for (const v of values) if (v > limit) count++;
  return count;
}

function fmtMs(value) {
  return value.toFixed(2) + ' ms';
}

function fmtNum(value) {
  return Math.round(value).toLocaleString('en-US');
}

function fmtFloat(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : '0.00';
}

function fmtBytes(value) {
  if (!Number.isFinite(value)) return 'n/a';
  const sign = value < 0 ? '-' : '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = Math.abs(value);
  let unit = 0;
  while (n >= 1024 && unit < units.length - 1) {
    n /= 1024;
    unit++;
  }
  return sign + n.toFixed(unit === 0 ? 0 : 1) + ' ' + units[unit];
}

function memorySnapshot() {
  const memory = performance.memory;
  if (!memory) return null;
  return {
    usedJSHeapSize: memory.usedJSHeapSize,
    totalJSHeapSize: memory.totalJSHeapSize,
    jsHeapSizeLimit: memory.jsHeapSizeLimit,
  };
}

function compactSample(value) {
  return Math.round(value * 1000) / 1000;
}

export const BENCHMARK_LIMITS = Object.freeze({
  duration: { min: 1, max: 300, fallback: 30 },
  warmup: { min: 0, max: 30, fallback: 2 },
  cameraHeight: { min: 2, max: 40, fallback: 10 },
  cameraLoops: { min: 0.25, max: 12, fallback: 2 },
  fixedTime: { min: 0, max: 1, fallback: 0.72 },
  stress: { min: 0, max: 5, fallback: 1 },
  extraMobs: { min: 0, max: 120 },
  extraAnimals: { min: 0, max: 120 },
  drops: { min: 0, max: 300 },
  props: { min: 0, max: 600 },
  lights: { min: 0, max: 40 },
  particleBurstsPerSecond: { min: 0, max: 20 },
  particleBurstSize: { min: 1, max: 80, fallback: 12 },
});

export function buildBenchmarkConfig(source = {}, { defaultSeed = 1337, parseSeed } = {}) {
  const rawSeed = source.seed ?? defaultSeed;
  const seed = parseSeed ? parseSeed(String(rawSeed)) : Number(rawSeed) || defaultSeed;
  const stress = clampNumber(source.stress, BENCHMARK_LIMITS.stress.min, BENCHMARK_LIMITS.stress.max, BENCHMARK_LIMITS.stress.fallback);
  return {
    enabled: Boolean(source.enabled),
    seed,
    duration: clampNumber(source.duration, BENCHMARK_LIMITS.duration.min, BENCHMARK_LIMITS.duration.max, BENCHMARK_LIMITS.duration.fallback),
    warmup: clampNumber(source.warmup, BENCHMARK_LIMITS.warmup.min, BENCHMARK_LIMITS.warmup.max, BENCHMARK_LIMITS.warmup.fallback),
    cameraHeight: clampNumber(source.height ?? source.cameraHeight, BENCHMARK_LIMITS.cameraHeight.min, BENCHMARK_LIMITS.cameraHeight.max, BENCHMARK_LIMITS.cameraHeight.fallback),
    cameraLoops: clampNumber(source.loops ?? source.cameraLoops, BENCHMARK_LIMITS.cameraLoops.min, BENCHMARK_LIMITS.cameraLoops.max, BENCHMARK_LIMITS.cameraLoops.fallback),
    fixedTime: clampNumber(source.time ?? source.fixedTime, BENCHMARK_LIMITS.fixedTime.min, BENCHMARK_LIMITS.fixedTime.max, BENCHMARK_LIMITS.fixedTime.fallback),
    stress,
    extraMobs: Math.round(clampNumber(source.extraMobs, BENCHMARK_LIMITS.extraMobs.min, BENCHMARK_LIMITS.extraMobs.max, stress * 16)),
    extraAnimals: Math.round(clampNumber(source.extraAnimals, BENCHMARK_LIMITS.extraAnimals.min, BENCHMARK_LIMITS.extraAnimals.max, stress * 12)),
    drops: Math.round(clampNumber(source.drops, BENCHMARK_LIMITS.drops.min, BENCHMARK_LIMITS.drops.max, 3 + stress * 32)),
    props: Math.round(clampNumber(source.props, BENCHMARK_LIMITS.props.min, BENCHMARK_LIMITS.props.max, stress * 120)),
    lights: Math.round(clampNumber(source.lights, BENCHMARK_LIMITS.lights.min, BENCHMARK_LIMITS.lights.max, stress * 8)),
    particleBurstsPerSecond: clampNumber(source.particleRate ?? source.particleBurstsPerSecond, BENCHMARK_LIMITS.particleBurstsPerSecond.min, BENCHMARK_LIMITS.particleBurstsPerSecond.max, stress * 2),
    particleBurstSize: Math.round(clampNumber(source.particleSize ?? source.particleBurstSize, BENCHMARK_LIMITS.particleBurstSize.min, BENCHMARK_LIMITS.particleBurstSize.max, BENCHMARK_LIMITS.particleBurstSize.fallback)),
    title: String(source.title ?? 'Mini Minecraft Benchmark'),
  };
}

export function readBenchmarkConfig({ defaultSeed = 1337, parseSeed } = {}) {
  const params = new URLSearchParams(window.location.search);
  const paramConfig = Object.fromEntries(params.entries());
  const globalConfig = window.__MINIMC_BENCHMARK_CONFIG__ || {};
  return buildBenchmarkConfig({
    ...globalConfig,
    ...paramConfig,
    enabled: window.__MINIMC_BENCHMARK__ === true ||
      document.body?.dataset.benchmark === 'true' ||
      params.get('bench') === '1',
  }, { defaultSeed, parseSeed });
}

export function createBenchmarkRunner({
  config,
  renderer,
  camera,
  player,
  worldSize,
  getStats,
}) {
  const statusEl = document.getElementById('benchStatus');
  const reportEl = document.getElementById('benchReport');
  const startMemory = memorySnapshot();
  const samples = {
    frameMs: [],
    gameUpdateMs: [],
    worldEffectsMs: [],
    renderMs: [],
    totalJsMs: [],
    drawCalls: [],
    triangles: [],
    lines: [],
    points: [],
    geometries: [],
    textures: [],
    chunkTriangles: [],
    chunkVertices: [],
    chunks: [],
    torches: [],
    mobs: [],
    animals: [],
    drops: [],
    particles: [],
    props: [],
    lights: [],
    objects: [],
    meshes: [],
    usedJSHeapSize: [],
  };
  let startNow = null;
  let measureStartNow = null;
  let lastStatusNow = 0;
  let done = false;
  let report = null;

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function elapsedSeconds(now) {
    if (startNow === null) startNow = now;
    return (now - startNow) / 1000;
  }

  function updateCamera(elapsed) {
    const total = Math.max(1, config.warmup + config.duration);
    const progress = elapsed / total;
    const cx = worldSize.width / 2;
    const cz = worldSize.depth / 2;
    const radius = Math.max(8, Math.min(worldSize.width, worldSize.depth) * 0.36);
    const angle = progress * Math.PI * 2 * config.cameraLoops + Math.PI * 0.15;
    const x = Math.max(2, Math.min(worldSize.width - 3, cx + Math.cos(angle) * radius));
    const z = Math.max(2, Math.min(worldSize.depth - 3, cz + Math.sin(angle) * radius));
    const y = worldSize.height * 0.58 + config.cameraHeight + Math.sin(angle * 0.5) * 1.5;
    const targetY = worldSize.height * 0.42 + Math.sin(angle * 0.35) * 1.2;
    player.pos.set(x, y, z);
    camera.position.copy(player.pos);
    camera.lookAt(cx, targetY, cz);
  }

  function pushStats(runtime) {
    samples.drawCalls.push(runtime.drawCalls);
    samples.triangles.push(runtime.triangles);
    samples.lines.push(runtime.lines);
    samples.points.push(runtime.points);
    samples.geometries.push(runtime.geometries);
    samples.textures.push(runtime.textures);
    samples.chunkTriangles.push(runtime.chunkTriangles);
    samples.chunkVertices.push(runtime.chunkVertices);
    samples.chunks.push(runtime.chunks);
    samples.torches.push(runtime.torches);
    samples.mobs.push(runtime.mobs);
    samples.animals.push(runtime.animals);
    samples.drops.push(runtime.drops);
    samples.particles.push(runtime.particles);
    samples.props.push(runtime.props ?? 0);
    samples.lights.push(runtime.lights ?? 0);
    samples.objects.push(runtime.objects ?? 0);
    samples.meshes.push(runtime.meshes ?? 0);
    const memory = memorySnapshot();
    if (memory) samples.usedJSHeapSize.push(memory.usedJSHeapSize);
  }

  function record(now, frameTimings) {
    const elapsed = elapsedSeconds(now);
    if (done) return true;

    const phase = elapsed < config.warmup ? 'Warmup' : 'Running';
    if (now - lastStatusNow > 250) {
      const measuredElapsed = Math.max(0, elapsed - config.warmup);
      const lastFrame = samples.frameMs[samples.frameMs.length - 1];
      const fpsText = lastFrame ? ' | approx FPS ' + fmtFloat(1000 / lastFrame, 1) : '';
      setStatus(`${phase} ${fmtFloat(measuredElapsed, 1)} / ${fmtFloat(config.duration, 1)} s${fpsText}`);
      lastStatusNow = now;
    }

    if (elapsed < config.warmup) return false;
    if (measureStartNow === null) measureStartNow = now;

    samples.frameMs.push(compactSample(frameTimings.frameMs));
    samples.gameUpdateMs.push(compactSample(frameTimings.gameUpdateMs));
    samples.worldEffectsMs.push(compactSample(frameTimings.worldEffectsMs));
    samples.renderMs.push(compactSample(frameTimings.renderMs));
    samples.totalJsMs.push(compactSample(frameTimings.totalJsMs));
    pushStats(getStats());

    if (elapsed >= config.warmup + config.duration) {
      done = true;
      report = buildReport(now);
      window.__perfReport = report;
      if (reportEl) reportEl.textContent = formatReport(report);
      setStatus(`Done: ${fmtFloat(report.summary.fpsAvg, 1)} FPS average over ${fmtFloat(report.summary.measuredSeconds, 2)} s`);
      return true;
    }
    return false;
  }

  function buildReport(now) {
    const frame = makeStats(samples.frameMs);
    const gameUpdate = makeStats(samples.gameUpdateMs);
    const worldEffects = makeStats(samples.worldEffectsMs);
    const render = makeStats(samples.renderMs);
    const totalJs = makeStats(samples.totalJsMs);
    const drawCalls = makeStats(samples.drawCalls);
    const triangles = makeStats(samples.triangles);
    const geometries = makeStats(samples.geometries);
    const textures = makeStats(samples.textures);
    const chunkTriangles = makeStats(samples.chunkTriangles);
    const mobs = makeStats(samples.mobs);
    const animals = makeStats(samples.animals);
    const drops = makeStats(samples.drops);
    const particles = makeStats(samples.particles);
    const heap = makeStats(samples.usedJSHeapSize);
    const measuredSeconds = Math.max(0.001, (now - (measureStartNow ?? now)) / 1000);
    const endMemory = memorySnapshot();
    const canvas = renderer.domElement;
    return {
      title: config.title,
      createdAt: new Date().toISOString(),
      url: window.location.href,
      userAgent: navigator.userAgent,
      config: {
        seed: config.seed,
        durationSeconds: config.duration,
        warmupSeconds: config.warmup,
        cameraHeight: config.cameraHeight,
        cameraLoops: config.cameraLoops,
        fixedTime: config.fixedTime,
        stress: config.stress,
        extraMobs: config.extraMobs,
        extraAnimals: config.extraAnimals,
        drops: config.drops,
        props: config.props,
        lights: config.lights,
        particleBurstsPerSecond: config.particleBurstsPerSecond,
        particleBurstSize: config.particleBurstSize,
      },
      environment: {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        rendererPixelRatio: renderer.getPixelRatio(),
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        worldWidth: worldSize.width,
        worldHeight: worldSize.height,
        worldDepth: worldSize.depth,
      },
      summary: {
        measuredSeconds,
        measuredFrames: samples.frameMs.length,
        fpsAvg: samples.frameMs.length / measuredSeconds,
        fpsFromAvgFrameMs: frame.avg > 0 ? 1000 / frame.avg : 0,
        fps1PercentLow: averageWorstFrameFps(samples.frameMs, 0.01),
        fps5PercentLow: averageWorstFrameFps(samples.frameMs, 0.05),
        framesOver16_67ms: countOver(samples.frameMs, 16.67),
        framesOver33_33ms: countOver(samples.frameMs, 33.33),
        framesOver50ms: countOver(samples.frameMs, 50),
        framesOver100ms: countOver(samples.frameMs, 100),
      },
      timings: {
        frameMs: frame,
        gameUpdateMs: gameUpdate,
        worldEffectsMs: worldEffects,
        renderMs: render,
        totalJsMs: totalJs,
      },
      renderer: {
        drawCalls,
        triangles,
        lines: makeStats(samples.lines),
        points: makeStats(samples.points),
        geometries,
        textures,
      },
      scene: {
        chunks: makeStats(samples.chunks),
        chunkTriangles,
        chunkVertices: makeStats(samples.chunkVertices),
        torches: makeStats(samples.torches),
        mobs,
        animals,
        drops,
        particles,
        props: makeStats(samples.props),
        lights: makeStats(samples.lights),
        objects: makeStats(samples.objects),
        meshes: makeStats(samples.meshes),
      },
      memory: {
        available: Boolean(endMemory),
        start: startMemory,
        end: endMemory,
        usedJSHeapSize: heap,
        usedDelta: startMemory && endMemory ? endMemory.usedJSHeapSize - startMemory.usedJSHeapSize : null,
      },
      samples,
    };
  }

  function formatStats(label, stats, unit = '') {
    const suffix = unit ? ' ' + unit : '';
    return `${label}: avg ${fmtFloat(stats.avg)}${suffix}, median ${fmtFloat(stats.median)}${suffix}, p95 ${fmtFloat(stats.p95)}${suffix}, p99 ${fmtFloat(stats.p99)}${suffix}, max ${fmtFloat(stats.max)}${suffix}`;
  }

  function formatReport(r) {
    const lines = [];
    lines.push(r.title);
    lines.push('Generated: ' + r.createdAt);
    lines.push('');
    lines.push('Config');
    lines.push(`  seed: ${r.config.seed}`);
    lines.push(`  measured duration: ${fmtFloat(r.summary.measuredSeconds, 2)} s (${r.summary.measuredFrames} frames)`);
    lines.push(`  warmup: ${fmtFloat(r.config.warmupSeconds, 1)} s`);
    lines.push(`  camera: height ${fmtFloat(r.config.cameraHeight, 1)}, loops ${fmtFloat(r.config.cameraLoops, 1)}`);
    lines.push(`  stress: ${fmtFloat(r.config.stress, 1)}`);
    lines.push(`  load: +${r.config.extraMobs} mobs, +${r.config.extraAnimals} animals, ${r.config.drops} drops, ${r.config.props} props, ${r.config.lights} lights`);
    lines.push(`  particles: ${fmtFloat(r.config.particleBurstsPerSecond, 1)} bursts/s x ${r.config.particleBurstSize}`);
    lines.push('');
    lines.push('Environment');
    lines.push(`  viewport: ${r.environment.viewportWidth} x ${r.environment.viewportHeight}, DPR ${fmtFloat(r.environment.devicePixelRatio, 2)}, renderer PR ${fmtFloat(r.environment.rendererPixelRatio, 2)}`);
    lines.push(`  canvas: ${r.environment.canvasWidth} x ${r.environment.canvasHeight}`);
    lines.push(`  world: ${r.environment.worldWidth} x ${r.environment.worldHeight} x ${r.environment.worldDepth}`);
    lines.push('');
    lines.push('FPS');
    lines.push(`  average: ${fmtFloat(r.summary.fpsAvg, 2)}`);
    lines.push(`  1% low: ${fmtFloat(r.summary.fps1PercentLow, 2)}`);
    lines.push(`  5% low: ${fmtFloat(r.summary.fps5PercentLow, 2)}`);
    lines.push(`  frames > 16.67 ms: ${r.summary.framesOver16_67ms}`);
    lines.push(`  frames > 33.33 ms: ${r.summary.framesOver33_33ms}`);
    lines.push(`  frames > 50 ms: ${r.summary.framesOver50ms}`);
    lines.push(`  frames > 100 ms: ${r.summary.framesOver100ms}`);
    lines.push('');
    lines.push('Timings');
    lines.push('  ' + formatStats('frame', r.timings.frameMs, 'ms'));
    lines.push('  ' + formatStats('game update', r.timings.gameUpdateMs, 'ms'));
    lines.push('  ' + formatStats('world effects', r.timings.worldEffectsMs, 'ms'));
    lines.push('  ' + formatStats('render', r.timings.renderMs, 'ms'));
    lines.push('  ' + formatStats('total JS measured', r.timings.totalJsMs, 'ms'));
    lines.push('  note: render timing is CPU-side renderer.render() submission time; frame timing is the end-to-end browser frame interval.');
    lines.push('');
    lines.push('Renderer');
    lines.push(`  draw calls avg/max: ${fmtFloat(r.renderer.drawCalls.avg, 1)} / ${fmtNum(r.renderer.drawCalls.max)}`);
    lines.push(`  triangles avg/max: ${fmtNum(r.renderer.triangles.avg)} / ${fmtNum(r.renderer.triangles.max)}`);
    lines.push(`  geometries avg/max: ${fmtFloat(r.renderer.geometries.avg, 1)} / ${fmtNum(r.renderer.geometries.max)}`);
    lines.push(`  textures avg/max: ${fmtFloat(r.renderer.textures.avg, 1)} / ${fmtNum(r.renderer.textures.max)}`);
    lines.push('');
    lines.push('Scene');
    lines.push(`  chunks avg/max: ${fmtFloat(r.scene.chunks.avg, 1)} / ${fmtNum(r.scene.chunks.max)}`);
    lines.push(`  chunk triangles avg/max: ${fmtNum(r.scene.chunkTriangles.avg)} / ${fmtNum(r.scene.chunkTriangles.max)}`);
    lines.push(`  mobs avg/max: ${fmtFloat(r.scene.mobs.avg, 1)} / ${fmtNum(r.scene.mobs.max)}`);
    lines.push(`  animals avg/max: ${fmtFloat(r.scene.animals.avg, 1)} / ${fmtNum(r.scene.animals.max)}`);
    lines.push(`  drops avg/max: ${fmtFloat(r.scene.drops.avg, 1)} / ${fmtNum(r.scene.drops.max)}`);
    lines.push(`  particles avg/max: ${fmtFloat(r.scene.particles.avg, 1)} / ${fmtNum(r.scene.particles.max)}`);
    lines.push(`  props avg/max: ${fmtFloat(r.scene.props.avg, 1)} / ${fmtNum(r.scene.props.max)}`);
    lines.push(`  lights avg/max: ${fmtFloat(r.scene.lights.avg, 1)} / ${fmtNum(r.scene.lights.max)}`);
    lines.push(`  scene objects avg/max: ${fmtFloat(r.scene.objects.avg, 1)} / ${fmtNum(r.scene.objects.max)}`);
    lines.push(`  scene meshes avg/max: ${fmtFloat(r.scene.meshes.avg, 1)} / ${fmtNum(r.scene.meshes.max)}`);
    lines.push(`  torches avg/max: ${fmtFloat(r.scene.torches.avg, 1)} / ${fmtNum(r.scene.torches.max)}`);
    lines.push('');
    lines.push('Memory');
    if (r.memory.available) {
      lines.push(`  used JS heap start/end/delta: ${fmtBytes(r.memory.start.usedJSHeapSize)} / ${fmtBytes(r.memory.end.usedJSHeapSize)} / ${fmtBytes(r.memory.usedDelta)}`);
      lines.push(`  used JS heap max during run: ${fmtBytes(r.memory.usedJSHeapSize.max)}`);
      lines.push(`  heap limit: ${fmtBytes(r.memory.end.jsHeapSizeLimit)}`);
    } else {
      lines.push('  performance.memory is not available in this browser.');
    }
    lines.push('');
    lines.push('Raw report is available as window.__perfReport.');
    return lines.join('\n');
  }

  return {
    updateCamera,
    record,
    get done() {
      return done;
    },
    get report() {
      return report;
    },
  };
}
