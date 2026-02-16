# Asset Image Protection

## Overview

A 3-layer technique to prevent casual users from saving, dragging, or right-clicking images on the site. Used primarily for testimonial photos but reusable on any asset.

## Implementation

### 1. CSS Class: `.img-protected`

```css
.img-protected {
    pointer-events: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-user-drag: none;
    -webkit-touch-callout: none;
}
```

- `pointer-events: none` — image ignores all mouse/touch events
- `user-select: none` — prevents text-selection-style interaction
- `-webkit-user-drag: none` — blocks drag on Safari/Chrome
- `-webkit-touch-callout: none` — blocks long-press save on iOS

### 2. Transparent Overlay (for large/hero images)

```html
<div class="relative" oncontextmenu="return false;">
    <img src="photo.jpg" class="img-protected" draggable="false">
    <!-- Transparent overlay captures all clicks -->
    <div class="absolute inset-0 z-10"></div>
</div>
```

The invisible `<div>` sits on top of the image — right-clicking hits the div, not the `<img>`. This is the strongest method for hero-sized images.

### 3. JavaScript Event Blockers

```html
<script>
    document.querySelectorAll('.img-protected').forEach(img => {
        img.addEventListener('contextmenu', e => e.preventDefault());
        img.addEventListener('dragstart', e => e.preventDefault());
    });
</script>
```

Blocks right-click context menu and drag-start events on all protected images.

### 4. HTML Attribute

Always add `draggable="false"` to the `<img>` tag:

```html
<img src="photo.jpg" class="img-protected" draggable="false">
```

## Usage

### Small avatars / thumbnails
```html
<img src="./assets/images/photo.jpg" alt="Name avatar" loading="lazy"
    class="h-8 w-8 rounded-none object-cover ring-1 ring-white/10 img-protected" draggable="false">
```

### Large / hero images
Wrap in a container with `oncontextmenu="return false;"` and add the transparent overlay div.

## Limitations

- Does **not** stop technical users (DevTools, inspect element, network tab)
- Does block ~95% of casual right-click/save/drag attempts
- Works across Chrome, Safari, Firefox, Edge, and mobile browsers
- No performance impact (CSS-only for most images)

## Where It's Applied

- `index.html` — All testimonial section images (avatars + main photo)

## When to Use

Apply to any client-facing imagery you want to protect:
- Testimonial photos
- Proprietary screenshots
- Brand assets in hero sections
- Client logos (if applicable)

---

**Created**: February 2026
**Project**: Exo Enterprise Website
