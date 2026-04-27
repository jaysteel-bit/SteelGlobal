// gargantua.js — Steel Global Phase 1.3
//
// Replaces the previous Three.js inner scene with a fork of ebruneton's real
// geodesic black hole shader. The persistent-canvas wiring (top-level mount,
// route-aware behaviour, no remount on pushState) and the Steel Global feature
// set (60 BPM heartbeat, mouse/gyro drift, ripple + warp animation, cold
// landing, Voice of Steel hooks) all stay intact — only the WebGL scene swaps.
//
// Source assets:
//   - Precomputed geodesic / Doppler / blackbody / noise textures live in
//     /assets/black-hole/. Built once on WSL via ebruneton's Makefile.
//   - The forked demo (model.js, camera_view, bloom.js, GLSL) lives in
//     /vendor/black-hole-demo/. Settings panels and rocket model removed.
//   - Slider defaults (Temperature ≈ 2698K, Initial distance ≈ 20.5,
//     Inclination 3.5°, HD on, High Contrast on, Opacity 100%) are baked
//     into vendor/black-hole-demo/model/model.js. The /-route corner pin
//     bumps the start radius to ≈ 40 dynamically.

const ASSET_BASE = 'assets/black-hole/';
const VENDOR_BASE = 'vendor/black-hole-demo/';

// startRadius QuantizedValue indexes (from model.js: f(x) = max(1+39x², 1.01)).
// Foundry hero = ~20.5 (index 707). Home corner = ~40 (index 1000, max).
const RADIUS_INDEX_FOUNDRY = 707;
const RADIUS_INDEX_HOME = 1000;

const HEARTBEAT_BPM = 60;
const HEARTBEAT_BASELINE_INDEX = 500; // model default for discDensity

let cameraViewInstance = null;
let booting = false;
let isWarping = false;
let routeIsFoundry = null;
let heartbeatRaf = null;
let mouseHoverRaf = null;

const prefersReducedMotion = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Voice of Steel (matches the previous file's contract).
function showVoiceOfSteel(text) {
    const el = document.getElementById('voice-of-steel');
    if (!el) return;
    el.innerText = text;
    el.style.opacity = 1;
    setTimeout(() => { el.style.opacity = 0; }, 4500);
}

// --- DOM scaffold inside #gargantua-canvas-container -----------------------

function mountCameraViewScaffold(container) {
    if (container.querySelector('#camera_view')) return;
    const wrap = document.createElement('div');
    wrap.className = 'cv-container';
    wrap.innerHTML = `
      <canvas id="camera_view"></canvas>
      <div id="cv_error_panel" class="cv-error-panel cv-hidden"></div>
      <div id="cv_loading_panel" class="cv-loading-panel">
        <div class="cv-loading-bar"><div id="cv_loading_bar" class="cv-loading-bar-value"></div></div>
      </div>
    `;
    container.appendChild(wrap);
}

// --- Asset loading helpers -------------------------------------------------

async function fetchText(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Failed to load ${url}: ${r.status}`);
    return await r.text();
}

function injectShaderScript(id, type, text) {
    if (document.getElementById(id)) return;
    const tag = document.createElement('script');
    tag.id = id;
    tag.type = type;
    tag.text = text;
    document.head.appendChild(tag);
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[data-gargantua="${src}"]`);
        if (existing) { resolve(); return; }
        const tag = document.createElement('script');
        tag.src = src;
        tag.async = false; // preserve insertion order
        tag.dataset.gargantua = src;
        tag.onload = resolve;
        tag.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(tag);
    });
}

// No-op stub for the rocket model. The forked demo expects RocketManager to
// exist on BlackHoleShaderDemoApp before camera_view.js's IIFE evaluates it.
class NoOpRocketManager {
    constructor() {}
    renderEnvMap() {}
    drawRocket() {}
    drawExhaust() {}
}

// --- Boot sequence ---------------------------------------------------------

export async function initGargantua() {
    if (cameraViewInstance || booting) return;
    booting = true;

    const container = document.getElementById('gargantua-canvas-container');
    if (!container) { booting = false; return; }

    mountCameraViewScaffold(container);

    window.BlackHoleShaderDemoApp = window.BlackHoleShaderDemoApp || {};
    window.BlackHoleShaderDemoApp.assetBase = ASSET_BASE;

    try {
        const cacheBuster = '?v=' + new Date().getTime();
        const [vertex, fragment, blackHole] = await Promise.all([
            fetchText(VENDOR_BASE + 'camera_view/vertex_shader.glsl' + cacheBuster),
            fetchText(VENDOR_BASE + 'camera_view/fragment_shader.glsl' + cacheBuster),
            fetchText(VENDOR_BASE + 'black_hole_shader.glsl' + cacheBuster),
        ]);
        injectShaderScript('vertex_shader', 'x-shader/x-vertex', vertex);
        injectShaderScript('fragment_shader', 'x-shader/x-fragment', fragment);
        injectShaderScript('black_hole_shader', 'x-shader/x-fragment', blackHole);

        await loadScript(VENDOR_BASE + 'model/model.js' + cacheBuster);

        // Mobile LOD: bump startRadius further out and force highDefinition off.
        // The shader cost is dominated by per-pixel geodesic sampling, so reducing
        // devicePixelRatio (highDefinition=false) is the heaviest single lever.
        const isLowEnd = isLowEndDevice();
        if (isLowEnd) {
            BlackHoleShaderDemoApp.model.highDefinition.setValue(false);
        }

        // Stub the rocket BEFORE camera_view.js evaluates its IIFE.
        BlackHoleShaderDemoApp.RocketManager = NoOpRocketManager;

        await loadScript(VENDOR_BASE + 'bloom.js' + cacheBuster);
        await loadScript(VENDOR_BASE + 'camera_view/texture_manager.js' + cacheBuster);
        await loadScript(VENDOR_BASE + 'camera_view/shader_manager.js' + cacheBuster);
        await loadScript(VENDOR_BASE + 'camera_view/camera_view.js' + cacheBuster);

        // Set the route framing BEFORE constructing CameraView so the orbit's
        // initial r0 matches the visible canvas size.
        const isFoundry = window.location.pathname === '/foundry';
        applyRoute(isFoundry, /*animate=*/false);

        cameraViewInstance = new BlackHoleShaderDemoApp.CameraView(
            BlackHoleShaderDemoApp.model, container);

        startHeartbeat();
        wireMouseHoverDrift();
        wireGyro();
        wireClickToWarp(container);
        wirePopstate();

        if (isFoundry) {
            triggerColdLanding();
        }
    } catch (err) {
        console.error('[gargantua] boot failed:', err);
    } finally {
        booting = false;
    }

    // Expose for compass.js (regular script tag, no ES module imports).
    window.triggerGargantuaWarp = triggerRippleAndWarp;
}

// --- Route framing (screen-space pin) --------------------------------------

function applyRoute(isFoundry, animate) {
    routeIsFoundry = isFoundry;
    document.body.classList.toggle('foundry-route', isFoundry);
    // The actual size/position pinning lives in styles.css. Here we only
    // adjust the model's startRadius so the orbit settles at the framing the
    // route expects.
    const model = window.BlackHoleShaderDemoApp && BlackHoleShaderDemoApp.model;
    if (!model) return;
    const targetIndex = isFoundry ? RADIUS_INDEX_FOUNDRY : RADIUS_INDEX_HOME;
    if (animate) {
        lerpStartRadius(targetIndex,
            prefersReducedMotion() ? 600 : 1500);
    } else {
        model.startRadius.setIndex(targetIndex);
    }
    // Canvas dimensions tracking — the cv-container CSS animates, but
    // camera_view only re-allocates buffers on window resize. After CSS
    // settles, push one resize so bloom/textures match the new size.
    if (cameraViewInstance) {
        const settle = animate ? 900 : 0;
        setTimeout(() => cameraViewInstance.onResize(), settle);
    }
}

// Lerp the startRadius QuantizedValue from current → targetIndex over `ms`.
let radiusLerpRaf = null;
function lerpStartRadius(targetIndex, ms) {
    if (radiusLerpRaf) cancelAnimationFrame(radiusLerpRaf);
    const model = BlackHoleShaderDemoApp.model;
    const startIndex = model.startRadius.getIndex();
    const startTime = performance.now();
    function tick(now) {
        const t = Math.min((now - startTime) / ms, 1);
        const ease = 1 - Math.pow(1 - t, 3); // cubic ease-out
        const idx = Math.round(startIndex + (targetIndex - startIndex) * ease);
        model.startRadius.setIndex(idx);
        if (t < 1) radiusLerpRaf = requestAnimationFrame(tick);
        else radiusLerpRaf = null;
    }
    radiusLerpRaf = requestAnimationFrame(tick);
}

// --- 60 BPM heartbeat ------------------------------------------------------

function startHeartbeat() {
    const reduced = prefersReducedMotion();
    const amplitude = reduced ? 8 : 28; // index swing around baseline
    const start = performance.now();
    function tick(now) {
        const t = (now - start) / 1000;
        const pulse = Math.sin(t * Math.PI * 2 * (HEARTBEAT_BPM / 60));
        const idx = HEARTBEAT_BASELINE_INDEX + Math.round(pulse * amplitude);
        const dd = BlackHoleShaderDemoApp.model.discDensity;
        const max = dd.getSize() - 1;
        dd.setIndex(Math.max(0, Math.min(max, idx)));
        heartbeatRaf = requestAnimationFrame(tick);
    }
    heartbeatRaf = requestAnimationFrame(tick);
}

// --- Mouse hover drift ("stirring molten gold") ----------------------------

// Camera_view.js handles click-and-drag for the camera. We add a *passive*
// hover drift on top: a small yaw/pitch nudge based on cursor position even
// when the user isn't dragging. Feels like the singularity is slightly aware
// of where you are.
function wireMouseHoverDrift() {
    let targetX = 0, targetY = 0, currentX = 0, currentY = 0;
    let lastApplied = { yaw: 0, pitch: 0 };
    const reduced = prefersReducedMotion();
    const driftScale = reduced ? 0.005 : 0.02; // radians of yaw nudge

    window.addEventListener('mousemove', (e) => {
        targetX = (e.clientX / window.innerWidth) * 2 - 1;
        targetY = -(e.clientY / window.innerHeight) * 2 + 1;
    });

    function tick() {
        currentX += (targetX - currentX) * 0.025; // weighted ease
        currentY += (targetY - currentY) * 0.025;
        const model = BlackHoleShaderDemoApp.model;
        const isFoundry = window.location.pathname === '/foundry';
        if (model && !isWarping && isFoundry) {
            const yawDelta = currentX * driftScale - lastApplied.yaw;
            const pitchDelta = currentY * driftScale - lastApplied.pitch;
            let yaw = model.cameraYaw.getValue() + yawDelta;
            yaw = yaw - 2 * Math.PI * Math.floor(yaw / (2 * Math.PI));
            model.cameraYaw.setValue(yaw);
            const pitch = model.cameraPitch.getValue() + pitchDelta;
            model.cameraPitch.setValue(pitch);
            lastApplied.yaw = currentX * driftScale;
            lastApplied.pitch = currentY * driftScale;
        }
        mouseHoverRaf = requestAnimationFrame(tick);
    }
    mouseHoverRaf = requestAnimationFrame(tick);
}

// --- Mobile gyro ------------------------------------------------------------

function wireGyro() {
    let baseline = null;
    window.addEventListener('deviceorientation', (e) => {
        if (e.beta === null || e.gamma === null) return;
        const model = BlackHoleShaderDemoApp.model;
        if (!model || isWarping) return;
        if (baseline === null) {
            baseline = { beta: e.beta, gamma: e.gamma };
            return;
        }
        // Map small device tilts into yaw/pitch deltas.
        const dgamma = (e.gamma - baseline.gamma) / 45; // [-1, 1]-ish
        const dbeta = (e.beta - baseline.beta) / 45;
        const yaw = model.cameraYaw.getValue() + dgamma * 0.0008;
        const pitch = model.cameraPitch.getValue() - dbeta * 0.0008;
        model.cameraYaw.setValue(
            yaw - 2 * Math.PI * Math.floor(yaw / (2 * Math.PI)));
        model.cameraPitch.setValue(pitch);
    });
}

// --- Click → ripple → warp -------------------------------------------------

function wireClickToWarp(container) {
    const canvas = container.querySelector('#camera_view');
    if (!canvas) return;
    let downX = 0, downY = 0, downTime = 0;

    canvas.addEventListener('mousedown', (e) => {
        downX = e.clientX; downY = e.clientY; downTime = Date.now();
    });

    canvas.addEventListener('mouseup', (e) => {
        const dx = Math.abs(e.clientX - downX);
        const dy = Math.abs(e.clientY - downY);
        const dt = Date.now() - downTime;
        if (dx > 6 || dy > 6 || dt > 350) return; // a drag, not a click
        // Tap on Gargantua: only warp on /. On /foundry, do a flare instead.
        if (routeIsFoundry) {
            triggerFlare();
        } else {
            triggerRippleAndWarp();
        }
    });

    canvas.addEventListener('touchstart', (e) => {
        const t = e.touches[0]; if (!t) return;
        downX = t.clientX; downY = t.clientY; downTime = Date.now();
    });
    canvas.addEventListener('touchend', (e) => {
        const t = e.changedTouches[0]; if (!t) return;
        const dx = Math.abs(t.clientX - downX);
        const dy = Math.abs(t.clientY - downY);
        const dt = Date.now() - downTime;
        if (dx > 12 || dy > 12 || dt > 400) return;
        if (routeIsFoundry) triggerFlare();
        else triggerRippleAndWarp();
    });
}

// Brief brightness flare on mobile tap (and on /foundry tap).
function triggerFlare() {
    const model = BlackHoleShaderDemoApp.model;
    if (!model) return;
    const exposure = model.exposure;
    const orig = exposure.getIndex();
    const max = exposure.getSize() - 1;
    exposure.setIndex(Math.min(max, orig + 60));
    setTimeout(() => exposure.setIndex(orig), 220);
}

// --- Popstate (browser back/forward) ---------------------------------------

function wirePopstate() {
    window.addEventListener('popstate', () => {
        const isFoundry = window.location.pathname === '/foundry';
        applyRoute(isFoundry, /*animate=*/true);
    });
}

// --- Cold landing on /foundry direct hit -----------------------------------

function triggerColdLanding() {
    const reduced = prefersReducedMotion();
    const ms = reduced ? 800 : 1200;
    const model = BlackHoleShaderDemoApp.model;
    if (!model) return;
    // Start a touch further out, settle into the foundry hero distance.
    const overshootIndex = Math.min(
        model.startRadius.getSize() - 1, RADIUS_INDEX_FOUNDRY + 120);
    model.startRadius.setIndex(overshootIndex);
    lerpStartRadius(RADIUS_INDEX_FOUNDRY, ms);
}

// --- The ripple + warp sequence (export retained for future external calls) -

export function triggerRippleAndWarp() {
    if (isWarping) return;
    isWarping = true;
    const reduced = prefersReducedMotion();

    const gargantuaContainer = document.getElementById('gargantua-canvas-container');
    const warpFlash = document.getElementById('warp-flash');

    if (!reduced && gargantuaContainer && warpFlash) {
        // Start the zoom on the container
        gargantuaContainer.classList.add('warp-zoom');

        // Delay the flash to happen near the peak of the zoom (e.g. 400ms in)
        setTimeout(() => {
            warpFlash.classList.add('flash-active');
            
            // Wait for flash to cover screen (50ms), then swap route under the cover of the flash
            setTimeout(() => {
                if (window.location.pathname !== '/foundry') {
                    window.history.pushState({}, '', '/foundry');
                }
                
                // Apply route instantly switches body class and lerps camera radius
                applyRoute(true, true);
                
                // Remove zoom class so it sits perfectly in fullscreen
                gargantuaContainer.classList.remove('warp-zoom');

                // Fade out flash to reveal the new location
                setTimeout(() => {
                    warpFlash.classList.remove('flash-active');
                    setTimeout(() => isWarping = false, 1000);
                }, 100);

            }, 60);

        }, 350);
        return;
    }

    // Reduced motion fallback
    if (window.location.pathname !== '/foundry') {
        window.history.pushState({}, '', '/foundry');
    }
    applyRoute(true, true);
    setTimeout(() => isWarping = false, 700);
}

// --- Mobile / low-end heuristic --------------------------------------------

function isLowEndDevice() {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    if (w < 768) return true;
    if (dpr < 2 && w < 1280) return true;
    // Crude GPU heuristic via WEBGL_debug_renderer_info — fall back gracefully.
    try {
        const test = document.createElement('canvas').getContext('webgl');
        const dbg = test && test.getExtension('WEBGL_debug_renderer_info');
        const r = dbg && test.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '';
        if (/Mali|Adreno [3-5][0-9]\d|PowerVR/.test(r)) return true;
    } catch (e) { /* ignore */ }
    return false;
}
