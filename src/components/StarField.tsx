import { useCallback, useEffect, useRef } from "react";
import type { SceneGraph } from "@/lib/scene";
import { HIT_COLOUR, HIT_WORD, type CaseNode, type SceneSummary } from "@/lib/scene";

interface BackgroundStar {
  u: number;
  v: number;
  depth: number;
  radius: number;
  base: number;
  speed: number;
  phase: number;
  twinkle: number;
}

interface Props {
  scene: SceneGraph;
  /** Bumped by the caller whenever the scene or the pipeline changed. */
  revision: number;
  mode?: "ambient" | "live";
  reducedMotion: boolean;
  hoveredId?: string | null;
  onHover?: (id: string | null) => void;
  onOpenCase?: (id: string) => void;
  className?: string;
  compact?: boolean;
}

const CENTER_RANKS = 5;
const EDGE_GROW_MS = 700;
const NODE_RISE_MS = 420;

function seededStars(count: number): BackgroundStar[] {
  let state = 12345 >>> 0;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const stars: BackgroundStar[] = [];
  for (let i = 0; i < count; i += 1) {
    const depth = 0.25 + next() * 0.75;
    stars.push({
      u: next(),
      v: next(),
      depth,
      radius: 0.35 + depth * (0.5 + next() * 0.9),
      base: 0.16 + depth * (0.18 + next() * 0.3),
      speed: 0.004 + next() * 0.012,
      phase: next() * Math.PI * 2,
      twinkle: 0.0004 + next() * 0.0013,
    });
  }
  return stars;
}

function nodeTarget(node: CaseNode, w: number, h: number): { x: number; y: number } {
  const rank = node.rank;
  if (rank !== null && rank >= 1 && rank <= CENTER_RANKS) {
    const m = Math.min(w, h);
    const step = rank - 1;
    if (step === 0) return { x: w / 2, y: h / 2 };
    const per = 5;
    const ring = 1 + Math.floor((step - 1) / per);
    const index = (step - 1) % per;
    const radius = ring * m * 0.16;
    const angle = -Math.PI / 2 + index * ((Math.PI * 2) / per) + ring * 0.45;
    return { x: w / 2 + Math.cos(angle) * radius, y: h / 2 + Math.sin(angle) * radius * 0.8 };
  }
  return { x: node.u * w, y: node.v * h };
}

function fade(now: number, appearedAt: number, duration: number, instant: boolean): number {
  if (instant) return 1;
  return Math.max(0, Math.min(1, (now - appearedAt) / duration));
}

/** Plain-language reading of the field — the visual state, in words. */
export function describeScene(summary: SceneSummary): string {
  if (summary.total === 0) {
    return "No opinions are lit yet. The field is empty.";
  }
  const parts: string[] = [
    `${summary.total} opinion${summary.total === 1 ? "" : "s"} on the field:`,
    `${summary.keyword} ${HIT_WORD.keyword}${summary.keyword === 1 ? "" : "s"}`,
    `${summary.meaning} ${HIT_WORD.meaning}${summary.meaning === 1 ? "" : "s"}`,
    `${summary.both} ${HIT_WORD.both}`,
  ];
  if (summary.traced) parts.push(`${summary.traced} ${HIT_WORD.traced}`);
  parts.push(`${summary.edges} citation link${summary.edges === 1 ? "" : "s"} drawn`);
  if (summary.topLabel) parts.push(`ranked first: ${summary.topLabel}`);
  if (summary.cited) parts.push(`${summary.cited} cited in the answer`);
  return `${parts.join(", ")}.`;
}

export default function StarField({
  scene,
  revision,
  mode = "live",
  reducedMotion,
  hoveredId = null,
  onHover,
  onOpenCase,
  className = "",
  compact = false,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const starsRef = useRef<BackgroundStar[]>([]);
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const screenRef = useRef<Array<{ id: string; x: number; y: number; r: number }>>([]);
  const sizeRef = useRef({ w: 0, h: 0 });
  const pointerRef = useRef({ x: 0, y: 0, active: false });
  const drawRef = useRef<(now: number) => void>(() => {});

  const resize = useCallback(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const rect = wrap.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sizeRef.current = { w, h };
    const count = Math.round(Math.min(240, Math.max(70, (w * h) / (compact ? 12000 : 8000))));
    starsRef.current = seededStars(count);
  }, [compact]);

  const draw = useCallback(
    (now: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const { w, h } = sizeRef.current;
      if (!w || !h) return;
      const instant = reducedMotion;
      const ambient = mode === "ambient";

      ctx.clearRect(0, 0, w, h);
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, "#070c1a");
      sky.addColorStop(1, "#050a16");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      const glow = ctx.createRadialGradient(w * 0.5, h * 0.55, 0, w * 0.5, h * 0.55, Math.max(w, h) * 0.6);
      glow.addColorStop(0, "rgba(36, 50, 87, 0.5)");
      glow.addColorStop(1, "rgba(5, 10, 22, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      const parallaxX = instant || !pointerRef.current.active ? 0 : pointerRef.current.x * 16;
      const parallaxY = instant || !pointerRef.current.active ? 0 : pointerRef.current.y * 12;

      for (const star of starsRef.current) {
        const drift = instant ? 0 : (now * star.speed * star.depth) % w;
        const x = (star.u * w + drift + parallaxX * star.depth) % w;
        const y = star.v * h + parallaxY * star.depth;
        const twinkle = instant ? 1 : 0.78 + 0.22 * Math.sin(now * star.twinkle + star.phase);
        ctx.beginPath();
        ctx.fillStyle = `rgba(232, 240, 252, ${star.base * twinkle})`;
        ctx.arc(x < 0 ? x + w : x, y, star.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      if (ambient) return;

      const nodes = [...scene.nodes.values()];
      const lerp = instant ? 1 : 0.09;
      const nextScreen: Array<{ id: string; x: number; y: number; r: number }> = [];

      for (const node of nodes) {
        const target = nodeTarget(node, w, h);
        const current = positionsRef.current.get(node.id);
        const point = current
          ? { x: current.x + (target.x - current.x) * lerp, y: current.y + (target.y - current.y) * lerp }
          : instant
            ? target
            : { x: target.x, y: target.y + 12 };
        positionsRef.current.set(node.id, point);
        const radius =
          2.1 + (node.rank !== null ? Math.max(0, CENTER_RANKS - node.rank + 1) * 0.55 : 0) + (node.cited ? 1.1 : 0);
        nextScreen.push({ id: node.id, x: point.x, y: point.y, r: radius });
      }
      screenRef.current = nextScreen;

      // Citation links, drawn as growing thin lines under the points of light.
      for (const edge of scene.edges) {
        const from = positionsRef.current.get(edge.source);
        const to = positionsRef.current.get(edge.target);
        if (!from || !to) continue;
        const progress = fade(now, edge.appearedAt, EDGE_GROW_MS, instant);
        if (progress <= 0) continue;
        ctx.beginPath();
        ctx.strokeStyle = "rgba(79, 214, 232, 0.3)";
        ctx.lineWidth = 1;
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(from.x + (to.x - from.x) * progress, from.y + (to.y - from.y) * progress);
        ctx.stroke();
      }

      for (const node of nodes) {
        const point = positionsRef.current.get(node.id);
        const screen = nextScreen.find((s) => s.id === node.id);
        if (!point || !screen) continue;
        const alpha = fade(now, node.appearedAt, NODE_RISE_MS, instant);
        if (alpha <= 0) continue;
        const colour = HIT_COLOUR[node.kind];
        const isHovered = hoveredId === node.id;

        if (node.cited || isHovered) {
          const pulse = instant ? 0.8 : 0.62 + 0.38 * Math.sin(now * 0.0016 + node.u * 9);
          const haloRadius = screen.r + (isHovered ? 13 : 9);
          const halo = ctx.createRadialGradient(
            point.x,
            point.y,
            Math.max(1, screen.r),
            point.x,
            point.y,
            haloRadius,
          );
          const strength = (node.cited ? 0.34 : 0) + (isHovered ? 0.34 : 0) + 0.1;
          halo.addColorStop(0, `rgba(232, 192, 106, ${Math.min(0.75, strength * pulse) * alpha})`);
          halo.addColorStop(1, "rgba(232, 192, 106, 0)");
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(point.x, point.y, haloRadius, 0, Math.PI * 2);
          ctx.fill();

          ctx.beginPath();
          const ringAlpha = Math.min(0.95, (node.cited ? 0.5 : 0) + (isHovered ? 0.45 : 0.1)) * alpha;
          ctx.strokeStyle = `rgba(232, 192, 106, ${ringAlpha.toFixed(3)})`;
          ctx.lineWidth = 1;
          ctx.arc(point.x, point.y, screen.r + 5.5, 0, Math.PI * 2);
          ctx.stroke();
        }

        const core = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, screen.r * 3.4);
        core.addColorStop(0, colour);
        core.addColorStop(0.4, `${colour}88`);
        core.addColorStop(1, `${colour}00`);
        ctx.globalAlpha = alpha * (isHovered ? 1 : 0.85);
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(point.x, point.y, screen.r * 3.4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.arc(point.x, point.y, screen.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        if (node.rank !== null) {
          ctx.font = "600 11px Inter, system-ui, sans-serif";
          ctx.fillStyle = `rgba(238, 242, 251, ${alpha * 0.92})`;
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(String(node.rank), point.x + screen.r + 4, point.y - screen.r - 3);
        }

        const showLabel = w > 560 && (isHovered || node.cited || (node.rank ?? 99) <= 3);
        if (showLabel) {
          const label = node.name.length > 34 ? `${node.name.slice(0, 33)}…` : node.name;
          ctx.font = "500 11px Inter, system-ui, sans-serif";
          ctx.fillStyle = `rgba(194, 203, 224, ${alpha * (isHovered ? 1 : 0.8)})`;
          ctx.textAlign = nodeTarget(node, w, h).x > w * 0.72 ? "right" : "left";
          const offset = nodeTarget(node, w, h).x > w * 0.72 ? -screen.r - 6 : screen.r + 6;
          ctx.fillText(label, point.x + offset, point.y + screen.r + 10);
        }
      }
    },
    [mode, scene, hoveredId, reducedMotion],
  );

  drawRef.current = draw;

  useEffect(() => {
    resize();
    const frame = requestAnimationFrame(() => {
      resize();
      drawRef.current(performance.now());
    });
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") {
      return () => cancelAnimationFrame(frame);
    }
    const observer = new ResizeObserver(() => {
      resize();
      drawRef.current(performance.now());
    });
    observer.observe(wrap);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [resize]);

  useEffect(() => {
    if (reducedMotion) {
      drawRef.current(performance.now());
      return;
    }
    let frame = 0;
    const loop = (now: number) => {
      drawRef.current(now);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [reducedMotion, revision, mode]);

  useEffect(() => {
    // Forget the old question's geometry when a new search starts.
    if (scene.nodes.size === 0) positionsRef.current.clear();
  }, [revision, scene]);

  const pick = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best: { id: string; distance: number } | null = null;
    for (const node of screenRef.current) {
      const distance = Math.hypot(node.x - x, node.y - y);
      const reach = Math.max(13, node.r + 9);
      if (distance <= reach && (!best || distance < best.distance)) best = { id: node.id, distance };
    }
    return best?.id ?? null;
  }, []);

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (mode === "ambient") return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      pointerRef.current = {
        x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1,
        active: true,
      };
      onHover?.(pick(event.clientX, event.clientY));
    },
    [mode, onHover, pick],
  );

  const handleLeave = useCallback(() => {
    pointerRef.current = { x: 0, y: 0, active: false };
    onHover?.(null);
  }, [onHover]);

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (mode === "ambient") return;
      const hit = pick(event.clientX, event.clientY);
      if (hit) onOpenCase?.(hit);
    },
    [mode, onOpenCase, pick],
  );

  const rootPosition = className.split(/\s+/).includes("absolute") ? "" : "relative ";
  return (
    <div ref={wrapRef} className={`${rootPosition}overflow-hidden ${className}`}>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        onPointerMove={handlePointerMove}
        onPointerLeave={handleLeave}
        onClick={handleClick}
        className="absolute inset-0 block"
        style={{ cursor: hoveredId ? "pointer" : "default" }}
      />
    </div>
  );
}
