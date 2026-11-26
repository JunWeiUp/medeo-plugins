// Cohesive 24x24 (1.85px stroke) monochrome SVG icon system for all plugin surfaces.
// Zero emojis; inherits currentColor cleanly across dark/light themes and retina displays.
const SVG_NS = 'http://www.w3.org/2000/svg';

type Shape =
  | ['path', string, Record<string, string>?]
  | ['circle', number, number, number, Record<string, string>?]
  | ['rect', number, number, number, number, number?, Record<string, string>?]
  | ['line', number, number, number, number, Record<string, string>?]
  | ['polygon', string, Record<string, string>?];

export type IconName =
  | 'volume'
  | 'volume-off'
  | 'mic'
  | 'mic-off'
  | 'camera'
  | 'camera-off'
  | 'click-ripple'
  | 'keyboard'
  | 'pin'
  | 'timer'
  | 'bug'
  | 'record-dot'
  | 'pause'
  | 'play'
  | 'stop'
  | 'close'
  | 'crop'
  | 'monitor'
  | 'bolt'
  | 'scan-text'
  | 'film'
  | 'folder'
  | 'settings'
  | 'shield'
  | 'chevron-down'
  | 'copy'
  | 'save'
  | 'cloud'
  | 'open-external'
  | 'sliders'
  | 'sparkles'
  | 'zoom-in'
  | 'scissors'
  | 'gauge'
  | 'snowflake'
  | 'sidebar'
  | 'rotate-ccw'
  | 'check'
  | 'plus'
  | 'trash'
  | 'info'
  | 'undo'
  | 'redo'
  | 'type'
  | 'grid'
  | 'message-square';

const ICONS: Record<IconName, Shape[]> = {
  volume: [
    ['path', 'M11 5L6 9H3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3l5 4V5z'],
    ['path', 'M15.5 8.8a5 5 0 0 1 0 6.4'],
    ['path', 'M18.6 5.9a9 9 0 0 1 0 12.2'],
  ],
  'volume-off': [
    ['path', 'M11 5L6 9H3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3l5 4V5z'],
    ['line', 22, 9, 16, 15],
    ['line', 16, 9, 22, 15],
  ],
  mic: [
    ['rect', 9, 2.5, 6, 11.5, 3],
    ['path', 'M5 10.5a7 7 0 0 0 14 0'],
    ['line', 12, 17.5, 12, 21.5],
    ['line', 8.5, 21.5, 15.5, 21.5],
  ],
  'mic-off': [
    ['path', 'M9 9v2a3 3 0 0 0 5.12 2.12'],
    ['path', 'M15 9.5V5.5a3 3 0 0 0-5.82-1.02'],
    ['path', 'M5 10.5a7 7 0 0 0 11.6 5.3'],
    ['line', 12, 17.5, 12, 21.5],
    ['line', 8.5, 21.5, 15.5, 21.5],
    ['line', 3, 3, 21, 21],
  ],
  camera: [
    ['rect', 2.5, 6.5, 13.5, 11, 2.5],
    ['path', 'M16 10.2l5.2-2.7a.8.8 0 0 1 1.2.7v7.6a.8.8 0 0 1-1.2.7L16 13.8'],
  ],
  'camera-off': [
    ['path', 'M10.5 6.5H13.5a2.5 2.5 0 0 1 2.5 2.5v2.2'],
    ['path', 'M15.8 16.2a2.5 2.5 0 0 1-2.3 1.3H5a2.5 2.5 0 0 1-2.5-2.5V9a2.5 2.5 0 0 1 2.5-2.5h1.2'],
    ['path', 'M16 10.2l5.2-2.7a.8.8 0 0 1 1.2.7v7.6a.8.8 0 0 1-1.2.7L16 13.8'],
    ['line', 2.5, 2.5, 21.5, 21.5],
  ],
  'click-ripple': [
    ['path', 'M5.5 3.5l5.4 13.5 2.2-5 5-2.2z'],
    ['path', 'M15.5 15.5l4 4'],
    ['path', 'M4.5 10.5A7.5 7.5 0 0 1 10.5 4.5', { opacity: '0.65' }],
  ],
  keyboard: [
    ['rect', 2, 5.5, 20, 13, 2.5],
    ['line', 6, 9.5, 6.01, 9.5],
    ['line', 10, 9.5, 10.01, 9.5],
    ['line', 14, 9.5, 14.01, 9.5],
    ['line', 18, 9.5, 18.01, 9.5],
    ['line', 6, 13, 6.01, 13],
    ['line', 18, 13, 18.01, 13],
    ['line', 9, 15, 15, 15],
  ],
  pin: [
    ['path', 'M12 17v5'],
    ['path', 'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z'],
  ],
  timer: [
    ['circle', 12, 13.5, 7.5],
    ['line', 12, 13.5, 15.2, 10.3],
    ['line', 9.5, 2.8, 14.5, 2.8],
    ['line', 12, 2.8, 12, 6],
  ],
  bug: [
    ['rect', 8, 7, 8, 11, 4],
    ['path', 'M9.5 7V5.5a2.5 2.5 0 0 1 5 0V7'],
    ['path', 'M8 10.5H4.5'],
    ['path', 'M19.5 10.5H16'],
    ['path', 'M8 14.5H4.5'],
    ['path', 'M19.5 14.5H16'],
    ['path', 'M9 7.8L6 5'],
    ['path', 'M15 7.8L18 5'],
  ],
  'record-dot': [
    ['circle', 12, 12, 8.5, { 'stroke-width': '1.8' }],
    ['circle', 12, 12, 4.4, { fill: 'currentColor', stroke: 'none' }],
  ],
  pause: [
    ['rect', 6, 4.5, 4, 15, 1.2, { fill: 'currentColor', stroke: 'none' }],
    ['rect', 14, 4.5, 4, 15, 1.2, { fill: 'currentColor', stroke: 'none' }],
  ],
  play: [
    ['polygon', '7,4.8 19.5,12 7,19.2', { fill: 'currentColor', stroke: 'currentColor', 'stroke-width': '1.2' }],
  ],
  stop: [
    ['rect', 5.5, 5.5, 13, 13, 2.5, { fill: 'currentColor', stroke: 'none' }],
  ],
  close: [
    ['line', 6, 6, 18, 18],
    ['line', 18, 6, 6, 18],
  ],
  crop: [
    ['path', 'M6.5 3v12.5a2 2 0 0 0 2 2H21'],
    ['path', 'M3 6.5h12.5a2 2 0 0 1 2 2V21'],
  ],
  monitor: [
    ['rect', 2.5, 4, 19, 13, 2.2],
    ['line', 8.5, 20.5, 15.5, 20.5],
    ['line', 12, 17, 12, 20.5],
  ],
  bolt: [
    ['path', 'M13.2 2.8L5 13.4h6.4L10.8 21.2 19 10.6h-6.4z'],
  ],
  'scan-text': [
    ['path', 'M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8'],
    ['path', 'M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8'],
    ['path', 'M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16'],
    ['path', 'M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16'],
    ['line', 8, 9.5, 16, 9.5],
    ['line', 8, 13, 14, 13],
    ['line', 8, 16.5, 12, 16.5],
  ],
  film: [
    ['rect', 3, 4.5, 18, 15, 2.2],
    ['line', 7.5, 4.5, 7.5, 19.5],
    ['line', 16.5, 4.5, 16.5, 19.5],
    ['line', 3, 9.5, 7.5, 9.5],
    ['line', 3, 14.5, 7.5, 14.5],
    ['line', 16.5, 9.5, 21, 9.5],
    ['line', 16.5, 14.5, 21, 14.5],
  ],
  folder: [
    ['path', 'M3 7a2 2 0 0 1 2-2h4.2l2 2.2H19a2 2 0 0 1 2 2v8.8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  ],
  settings: [
    ['circle', 12, 12, 3.2],
    ['path', 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.08a1.65 1.65 0 0 0 .92-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.08a1.65 1.65 0 0 0 1.51.92H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'],
  ],
  shield: [
    ['path', 'M12 3l7 3v5.5c0 4.6-3 8.1-7 9.5-4-1.4-7-4.9-7-9.5V6l7-3z'],
    ['path', 'M9 12l2 2 4-4'],
  ],
  'chevron-down': [
    ['path', 'M6.5 9.5L12 15l5.5-5.5'],
  ],
  copy: [
    ['rect', 9, 9, 11, 11, 2],
    ['path', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'],
  ],
  save: [
    ['path', 'M12 4v11'],
    ['path', 'M7.5 10.5L12 15l4.5-4.5'],
    ['path', 'M5 19.5h14'],
  ],
  cloud: [
    ['path', 'M6.5 18.5h11a4 4 0 0 0 .8-7.92A5.5 5.5 0 0 0 7.6 8.3 4.2 4.2 0 0 0 6.5 18.5z'],
  ],
  'open-external': [
    ['path', 'M14 4h6v6'],
    ['line', 10, 14, 20, 4],
    ['path', 'M18 13.5V19a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 19V7.5A1.5 1.5 0 0 1 5.5 6H11'],
  ],
  sliders: [
    ['line', 4, 21, 4, 14],
    ['line', 4, 10, 4, 3],
    ['line', 12, 21, 12, 12],
    ['line', 12, 8, 12, 3],
    ['line', 20, 21, 20, 16],
    ['line', 20, 12, 20, 3],
    ['line', 2, 14, 6, 14],
    ['line', 10, 8, 14, 8],
    ['line', 18, 16, 22, 16],
  ],
  sparkles: [
    ['path', 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z'],
    ['path', 'M19 3v3M17.5 4.5h3'],
    ['path', 'M5 17v3M3.5 18.5h3'],
  ],
  'zoom-in': [
    ['circle', 11, 11, 7],
    ['line', 20, 20, 16.2, 16.2],
    ['line', 11, 8, 11, 14],
    ['line', 8, 11, 14, 11],
  ],
  scissors: [
    ['circle', 6, 6, 3],
    ['circle', 6, 18, 3],
    ['line', 20, 4, 8.12, 15.88],
    ['line', 14.47, 14.48, 20, 20],
    ['line', 8.12, 8.12, 12, 12],
  ],
  gauge: [
    ['path', 'M12 14l4-4'],
    ['path', 'M3.5 19a9.5 9.5 0 1 1 17 0'],
    ['circle', 12, 14, 1.5],
  ],
  snowflake: [
    ['line', 12, 2.5, 12, 21.5],
    ['line', 3.8, 7.2, 20.2, 16.8],
    ['line', 20.2, 7.2, 3.8, 16.8],
    ['circle', 12, 12, 2.2],
  ],
  sidebar: [
    ['rect', 3, 4, 18, 16, 2.2],
    ['line', 9, 4, 9, 20],
  ],
  'rotate-ccw': [
    ['path', 'M3 12a9 9 0 1 0 3-6.7L3 8'],
    ['path', 'M3 3v5h5'],
  ],
  check: [
    ['path', 'M5 12.5l4.5 4.5L19 7.5'],
  ],
  plus: [
    ['line', 12, 5, 12, 19],
    ['line', 5, 12, 19, 12],
  ],
  trash: [
    ['path', 'M4 7h16'],
    ['path', 'M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7'],
    ['path', 'M6.5 7l1 13a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l1-13'],
  ],
  info: [
    ['circle', 12, 12, 9],
    ['line', 12, 16, 12, 11.5],
    ['line', 12, 8.2, 12.01, 8.2],
  ],
  undo: [
    ['path', 'M9 14L4 9l5-5'],
    ['path', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
  ],
  redo: [
    ['path', 'M15 14l5-5-5-5'],
    ['path', 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13'],
  ],
  type: [
    ['path', 'M4 7V5h16v2'],
    ['line', 12, 5, 12, 19],
    ['line', 8.5, 19, 15.5, 19],
  ],
  grid: [
    ['rect', 3.5, 3.5, 7, 7, 1.2],
    ['rect', 13.5, 3.5, 7, 7, 1.2],
    ['rect', 3.5, 13.5, 7, 7, 1.2],
    ['rect', 13.5, 13.5, 7, 7, 1.2],
  ],
  'message-square': [
    ['path', 'M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z'],
    ['line', 8, 9, 16, 9],
    ['line', 8, 13, 13, 13],
  ],
};

export function svgIcon(name: IconName, size = 16, cls = 'svg-ic'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.85');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add(cls);

  for (const shape of ICONS[name] ?? []) {
    if (shape[0] === 'path') {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', shape[1]);
      if (shape[2]) for (const [k, v] of Object.entries(shape[2])) p.setAttribute(k, v);
      svg.append(p);
    } else if (shape[0] === 'circle') {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', String(shape[1]));
      c.setAttribute('cy', String(shape[2]));
      c.setAttribute('r', String(shape[3]));
      if (shape[4]) for (const [k, v] of Object.entries(shape[4])) c.setAttribute(k, v);
      svg.append(c);
    } else if (shape[0] === 'rect') {
      const r = document.createElementNS(SVG_NS, 'rect');
      r.setAttribute('x', String(shape[1]));
      r.setAttribute('y', String(shape[2]));
      r.setAttribute('width', String(shape[3]));
      r.setAttribute('height', String(shape[4]));
      if (shape[5] !== undefined) r.setAttribute('rx', String(shape[5]));
      if (shape[6]) for (const [k, v] of Object.entries(shape[6])) r.setAttribute(k, v);
      svg.append(r);
    } else if (shape[0] === 'line') {
      const l = document.createElementNS(SVG_NS, 'line');
      l.setAttribute('x1', String(shape[1]));
      l.setAttribute('y1', String(shape[2]));
      l.setAttribute('x2', String(shape[3]));
      l.setAttribute('y2', String(shape[4]));
      if (shape[5]) for (const [k, v] of Object.entries(shape[5])) l.setAttribute(k, v);
      svg.append(l);
    } else if (shape[0] === 'polygon') {
      const p = document.createElementNS(SVG_NS, 'polygon');
      p.setAttribute('points', shape[1]);
      if (shape[2]) for (const [k, v] of Object.entries(shape[2])) p.setAttribute(k, v);
      svg.append(p);
    }
  }
  return svg;
}

/** Inline data-URI-free miniature App Icon (dark glass viewfinder + coral lens) for the Hub header. */
export function appMarkSvg(size = 34): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('hub-app-mark');

  const mk = (tag: string, attrs: Record<string, string>) => {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  const defs = mk('defs', {});
  const bg = mk('linearGradient', { id: 'hub-mark-bg', x1: '0', y1: '0', x2: '1', y2: '1' });
  bg.append(mk('stop', { offset: '0', 'stop-color': '#23242D' }), mk('stop', { offset: '1', 'stop-color': '#111216' }));
  const lens = mk('linearGradient', { id: 'hub-mark-lens', x1: '0', y1: '0', x2: '1', y2: '1' });
  lens.append(mk('stop', { offset: '0', 'stop-color': '#FF5A4E' }), mk('stop', { offset: '1', 'stop-color': '#DC2626' }));
  defs.append(bg, lens);

  const g = mk('g', {
    fill: 'none', stroke: '#F4F4F6', 'stroke-width': '3.8',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  });
  for (const d of [
    'M16 24.5V19a3 3 0 0 1 3-3h5.5',
    'M39.5 16H45a3 3 0 0 1 3 3v5.5',
    'M48 39.5V45a3 3 0 0 1-3 3h-5.5',
    'M24.5 48H19a3 3 0 0 1-3-3v-5.5',
  ]) g.append(mk('path', { d }));

  svg.append(
    defs,
    mk('rect', { width: '64', height: '64', rx: '15', fill: 'url(#hub-mark-bg)' }),
    mk('rect', { x: '0.75', y: '0.75', width: '62.5', height: '62.5', rx: '14.25', fill: 'none', stroke: 'rgba(255,255,255,0.2)', 'stroke-width': '1.5' }),
    g,
    mk('circle', { cx: '32', cy: '32', r: '10.5', fill: 'url(#hub-mark-lens)' }),
    mk('circle', { cx: '28.7', cy: '28.7', r: '2.6', fill: '#FFFFFF', 'fill-opacity': '0.5' }),
  );
  return svg;
}
