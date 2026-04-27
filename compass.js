// Compass — Steel Global Navigation Overlay
// Spec: DOCUMENTATION/Teleport-NAV §1–§4, roadmap.md §4
// Mounts onto any page that loads it. Triggered by clicking .brand-logo.

(function () {
    'use strict';

    // Roster — mirrors every .topic element in index.html so the Compass exposes
    // the full set of clickable destinations. Order follows roadmap.md §5.2 hierarchy:
    // revenue-bearing worlds first (front-facing, highest weight), brand/cultural after.
    // `match` is the topic label text in index.html that this destination warps to.
    const DESTINATIONS = [
        // — Revenue-bearing — (Steel Card leads, then AI, Business, Ventures)
        { label: 'STEEL CARD',   tagline: 'identity, access, citizenship',       match: 'STEEL CARD' },
        { label: 'AI',           tagline: 'autonomous intelligence',             match: 'AI' },
        { label: 'BUSINESS',     tagline: 'operators, owners, architects',       match: 'Business' },
        { label: 'VENTURES',     tagline: 'investments, partnerships',           match: 'Ventures' },

        // — Brand / cultural —
        { label: 'STEEL CINEMA', tagline: 'episodic futures in motion',          match: 'Steel Cinema' },
        { label: 'FASHION',      tagline: 'garments, objects, silhouettes',      match: 'Fashion' },
        { label: 'DESIGN',       tagline: 'form and discipline',                 match: 'Design' },
        { label: 'PHOTOGRAPHY',  tagline: 'frame and light',                     match: 'Photography' },
        { label: 'VIDEOGRAPHY',  tagline: 'moving image, archived',              match: 'Videography' },
        { label: 'SONIC ARTS',   tagline: 'sound in space',                      match: 'Sonic Arts' },
        { label: 'CULTURE',      tagline: 'context and current',                 match: 'Culture' },
        { label: 'PHILOSOPHY',   tagline: 'first principles',                    match: 'Philosophy' },
        { label: 'MODERNISM',    tagline: 'the discipline of the new',           match: 'Modernism' },
        { label: 'FUTURISM',     tagline: "the shape of what's coming",          match: 'Futurism' },
        { label: 'CHARITY',      tagline: 'return and reach',                    match: 'Charity' },

        // — The Foundry — anchored at the end. Routes to /foundry directly
        // (no .topic counterpart on home). selectDestination special-cases it.
        { label: 'FOUNDRY',      tagline: 'the engine room',                     match: 'Foundry', route: '/foundry' },
    ];

    const PROMPTS = [
        'Where would you like to go?',
        'Set your destination.',
    ];

    // Per-route concierge line that surfaces inside the Compass on open.
    // Replaces the inline Voice of Steel pulse that used to fade in mid-page.
    function getConciergeLine() {
        const path = window.location.pathname;
        if (path === '/foundry' || path.endsWith('/foundry.html')) {
            return "We've arrived at the Foundry, [User]. The systems are currently hardening — which world shall we focus on?";
        }
        return 'The archive is at your disposal, [User]. Where shall we begin?';
    }

    let overlay, input, listEl, promptEl, conciergeEl;
    let isOpen = false;
    let activeIndex = -1;
    let promptCycleId = null;

    function buildOverlay() {
        if (document.getElementById('compass-overlay')) return;

        overlay = document.createElement('div');
        overlay.id = 'compass-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-label', 'Steel Global navigation');

        overlay.innerHTML = `
            <div class="compass-orbit-ring" aria-hidden="true"></div>
            <div class="compass-tag">Steel Global</div>
            <div class="compass-centerpiece">
                <h2 class="compass-prompt">${PROMPTS[0]}</h2>
                <p class="compass-concierge"></p>
                <div class="compass-input-wrap">
                    <input
                        class="compass-input"
                        type="text"
                        autocomplete="off"
                        spellcheck="false"
                        aria-label="Filter destinations">
                </div>
                <ul class="compass-destinations" role="listbox"></ul>
            </div>
        `;

        document.body.appendChild(overlay);

        input       = overlay.querySelector('.compass-input');
        listEl      = overlay.querySelector('.compass-destinations');
        promptEl    = overlay.querySelector('.compass-prompt');
        conciergeEl = overlay.querySelector('.compass-concierge');

        renderDestinations('');
        wireEvents();
    }

    function renderDestinations(filterText) {
        const filter = (filterText || '').trim().toLowerCase();
        const frag = document.createDocumentFragment();
        let visibleCount = 0;

        DESTINATIONS.forEach((dest, i) => {
            const li = document.createElement('li');
            li.className = 'compass-destination';
            li.setAttribute('role', 'option');
            li.dataset.index = String(i);
            li.style.animationDelay = `${i * 70}ms`;

            const matchesFilter =
                !filter ||
                dest.label.toLowerCase().includes(filter) ||
                dest.tagline.toLowerCase().includes(filter);

            if (!matchesFilter) {
                li.hidden = true;
            } else {
                visibleCount++;
            }

            li.innerHTML = `
                <span class="label">${dest.label}</span>${dest.tagline ? `<span class="tagline">${dest.tagline}</span>` : ''}
            `;

            li.addEventListener('click', () => selectDestination(i));
            frag.appendChild(li);
        });

        listEl.innerHTML = '';
        listEl.appendChild(frag);

        // Reset active highlight to first visible
        activeIndex = -1;
        const firstVisible = listEl.querySelector('.compass-destination:not([hidden])');
        if (firstVisible) {
            activeIndex = parseInt(firstVisible.dataset.index, 10);
            firstVisible.classList.add('is-active');
        }
    }

    function setActive(newIndex) {
        const items = Array.from(listEl.querySelectorAll('.compass-destination:not([hidden])'));
        if (!items.length) return;

        items.forEach(el => el.classList.remove('is-active'));

        const visibleIndices = items.map(el => parseInt(el.dataset.index, 10));
        let pos = visibleIndices.indexOf(newIndex);
        if (pos < 0) pos = 0;
        activeIndex = visibleIndices[pos];
        items[pos].classList.add('is-active');
        items[pos].scrollIntoView({ block: 'nearest' });
    }

    function moveActive(delta) {
        const items = Array.from(listEl.querySelectorAll('.compass-destination:not([hidden])'));
        if (!items.length) return;
        const visibleIndices = items.map(el => parseInt(el.dataset.index, 10));
        let pos = visibleIndices.indexOf(activeIndex);
        pos = (pos + delta + items.length) % items.length;
        setActive(visibleIndices[pos]);
    }

    function selectDestination(index) {
        const dest = DESTINATIONS[index];
        if (!dest) return;

        // FOUNDRY (or any future destination with a `route`) warps via the
        // gargantua engine on the current page if it's home, or hard-navigates
        // otherwise. Avoids needing a .topic placeholder for non-spatial worlds.
        if (dest.route === '/foundry') {
            closeCompass();
            setTimeout(() => {
                const onFoundry = window.location.pathname === '/foundry';
                if (onFoundry) return; // already there — nothing to do
                if (typeof window.triggerGargantuaWarp === 'function') {
                    window.triggerGargantuaWarp();
                } else {
                    window.location.href = '/foundry';
                }
            }, 320);
            return;
        }

        const topicEl = findTopicByLabel(dest.match);

        closeCompass();

        setTimeout(() => {
            if (topicEl) {
                lockOnAndWarp(topicEl);
            } else {
                // No matching topic on this page (e.g. selecting from /foundry where planets
                // aren't yet placed, Phase 2). Hand off to the home shell via sessionStorage —
                // index.html picks this up on load and triggers the warp there.
                try {
                    sessionStorage.setItem('compass:pendingWarp', dest.match);
                } catch (e) { /* sessionStorage may be unavailable */ }
                window.location.href = '/';
            }
        }, 320);
    }

    function findTopicByLabel(labelText) {
        const want = labelText.trim().toLowerCase();
        const topics = document.querySelectorAll('.topic .topic-label');
        for (const span of topics) {
            if (span.textContent.trim().toLowerCase() === want) {
                return span.closest('.topic');
            }
        }
        return null;
    }

    function lockOnAndWarp(topicEl) {
        // Brief lock-on: nudge the macro-pan toward the destination's coordinate
        // before firing the warp. Re-uses index.html's macro pan globals if present.
        const dx = parseFloat(topicEl.dataset.x) || 0;
        const dy = parseFloat(topicEl.dataset.y) || 0;

        // Map to small rotation (deg). Same convention as triggerMacroPan in index.html.
        const targetRX = -Math.max(-15, Math.min(15, dy / 80));
        const targetRY =  Math.max(-30, Math.min(30, dx / 50));

        if (typeof window.macroRotX !== 'undefined') {
            try {
                window.macroRotX = targetRX;
                window.macroRotY = targetRY;
                if (typeof window.updateUniverseTransform === 'function') {
                    window.updateUniverseTransform();
                }
            } catch (e) { /* non-fatal */ }
        }

        // Let the lock-on settle, then fire the existing warp by clicking the topic.
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const lockDelay = reduced ? 120 : 380;
        setTimeout(() => {
            topicEl.click();
        }, lockDelay);
    }

    function openCompass() {
        if (!overlay) buildOverlay();
        if (isOpen) return;
        isOpen = true;
        overlay.classList.add('is-open');
        overlay.setAttribute('aria-hidden', 'false');
        input.value = '';
        renderDestinations('');
        // Surface the per-route concierge line a beat after the overlay opens.
        if (conciergeEl) {
            conciergeEl.textContent = getConciergeLine();
            conciergeEl.classList.remove('is-visible');
            setTimeout(() => conciergeEl.classList.add('is-visible'), 320);
        }
        setTimeout(() => input && input.focus(), 80);
        startPromptCycle();
    }

    function closeCompass() {
        if (!isOpen) return;
        isOpen = false;
        overlay.classList.remove('is-open');
        overlay.setAttribute('aria-hidden', 'true');
        if (input) input.blur();
        if (conciergeEl) conciergeEl.classList.remove('is-visible');
        stopPromptCycle();
    }

    function toggleCompass() {
        isOpen ? closeCompass() : openCompass();
    }

    function startPromptCycle() {
        stopPromptCycle();
        let i = 0;
        promptEl.textContent = PROMPTS[0];
        promptEl.style.opacity = '1';
        promptCycleId = setInterval(() => {
            i = (i + 1) % PROMPTS.length;
            promptEl.style.opacity = '0';
            setTimeout(() => {
                if (!isOpen) return;
                promptEl.textContent = PROMPTS[i];
                promptEl.style.opacity = '1';
            }, 500);
        }, 5500);
    }

    function stopPromptCycle() {
        if (promptCycleId) {
            clearInterval(promptCycleId);
            promptCycleId = null;
        }
    }

    function wireEvents() {
        // ESC + Arrow keys + Enter
        document.addEventListener('keydown', (e) => {
            if (!isOpen) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                closeCompass();
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                moveActive(1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                moveActive(-1);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (activeIndex >= 0) selectDestination(activeIndex);
            }
        });

        // Outside click closes (clicks on backdrop, not centerpiece)
        overlay.addEventListener('mousedown', (e) => {
            const inside = e.target.closest('.compass-centerpiece');
            if (!inside) closeCompass();
        });

        // Live filter
        input.addEventListener('input', (e) => {
            renderDestinations(e.target.value);
        });
    }

    function wireLogo() {
        // Bind to .logo-container, not .brand-logo — the image itself has
        // .img-protected applied (styles.css:242), which sets pointer-events:none
        // to disable drag-saving. The container catches the click.
        const containers = document.querySelectorAll('.logo-container');
        containers.forEach(container => {
            container.style.cursor = 'pointer';
            container.setAttribute('role', 'button');
            container.setAttribute('aria-label', 'Open navigation');
            container.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleCompass();
            });
        });
    }

    function init() {
        buildOverlay();
        wireLogo();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose minimal API for debugging / future Phase 2 hooks
    window.SteelCompass = {
        open: openCompass,
        close: closeCompass,
        toggle: toggleCompass,
    };
})();
