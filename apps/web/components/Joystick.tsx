"use client";

import { useRef, useState, type PointerEvent } from "react";

interface JoystickProps {
  disabled?: boolean;
  /** Normalized stick vector: x = steer −1..1, y = throttle −1..1 (up = +). */
  onVector: (x: number, y: number) => void;
  /** Pointer lifted — caller must zero the drive command. */
  onRelease: () => void;
  /** Pad diameter in px. */
  size?: number;
}

/**
 * Virtual joystick built on raw pointer events (no library). The thumb is
 * clamped to the pad radius; the normalized vector is reported on every
 * pointer move while active.
 */
export function Joystick({ disabled = false, onVector, onRelease, size = 224 }: JoystickProps) {
  const padRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(false);
  const [thumb, setThumb] = useState({ x: 0, y: 0 });

  const thumbSize = Math.round(size * 0.34);
  const maxOffset = size / 2 - thumbSize / 2;

  function update(clientX: number, clientY: number) {
    const el = padRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let dx = clientX - (rect.left + rect.width / 2);
    let dy = clientY - (rect.top + rect.height / 2);
    const dist = Math.hypot(dx, dy);
    if (dist > maxOffset && dist > 0) {
      dx = (dx / dist) * maxOffset;
      dy = (dy / dist) * maxOffset;
    }
    setThumb({ x: dx, y: dy });
    // Screen y grows downward; throttle grows upward.
    onVector(dx / maxOffset, -dy / maxOffset);
  }

  function handleDown(e: PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    activeRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    update(e.clientX, e.clientY);
  }

  function handleMove(e: PointerEvent<HTMLDivElement>) {
    if (!activeRef.current || disabled) return;
    update(e.clientX, e.clientY);
  }

  function handleEnd(e: PointerEvent<HTMLDivElement>) {
    if (!activeRef.current) return;
    activeRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setThumb({ x: 0, y: 0 });
    onRelease();
  }

  return (
    <div
      ref={padRef}
      role="application"
      aria-label="Drive joystick"
      aria-disabled={disabled}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleEnd}
      onPointerCancel={handleEnd}
      className={`relative select-none rounded-full border ${
        disabled
          ? "cursor-not-allowed border-zinc-800 bg-zinc-900/40 opacity-50"
          : "cursor-grab border-zinc-700 bg-zinc-900"
      }`}
      style={{ width: size, height: size, touchAction: "none" }}
    >
      {/* crosshair guides */}
      <div className="pointer-events-none absolute left-1/2 top-3 bottom-3 w-px -translate-x-1/2 bg-zinc-800" />
      <div className="pointer-events-none absolute top-1/2 left-3 right-3 h-px -translate-y-1/2 bg-zinc-800" />
      <div
        className={`pointer-events-none absolute rounded-full border shadow-lg ${
          disabled ? "border-zinc-700 bg-zinc-800" : "border-[#ff6b35] bg-[#ff6b35]/90"
        }`}
        style={{
          width: thumbSize,
          height: thumbSize,
          left: size / 2 - thumbSize / 2 + thumb.x,
          top: size / 2 - thumbSize / 2 + thumb.y,
        }}
      />
    </div>
  );
}
