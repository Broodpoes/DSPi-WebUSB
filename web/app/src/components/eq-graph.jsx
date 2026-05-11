import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { scaleLog, scaleLinear } from 'd3-scale';
import { line, area } from 'd3-shape';
import { combinedMagnitude, FILTER_FLAT, fmtFreq } from '../../eq-curve';

const VW = 800;
const VH = 200;
const PAD = { t: 10, r: 10, b: 24, l: 44 };

const CURVE_STROKE = '#d0d0dc';
const CURVE_FILL = 'rgba(208, 208, 220, 0.08)';
const BOOST_FILL = '#c8c0d8';
const CUT_FILL = '#c4908c';
const GRID_STROKE = '#2a2a3a';
const REF_STROKE = '#4a4a5e';
const LABEL_FILL = '#9999aa';
const BG_FILL = '#121218';

export default function EQGraph({ bands, onBandChange, sampleRate = 48000, className }) {
    const svgRef = useRef(null);
    const [dragIdx, setDragIdx] = useState(null);
    const dragIdxRef = useRef(null);

    const x = useMemo(() =>
        scaleLog().domain([20, 20000]).range([PAD.l, VW - PAD.r]),
    []);

    const y = useMemo(() =>
        scaleLinear().domain([18, -18]).range([PAD.t, VH - PAD.b]),
    []);

    const freqTicks = useMemo(() => x.ticks(10), [x]);
    const dbTicks = useMemo(() => y.ticks(6), [y]);

    const points = useMemo(() => {
        const pw = VW - PAD.l - PAD.r;
        const n = Math.max(pw * 2, 256);
        const pts = [];
        for (let i = 0; i < n; i++) {
            const freq = x.invert(PAD.l + (i / (n - 1)) * pw);
            const mag = combinedMagnitude(bands, freq, sampleRate);
            const db = 20 * Math.log10(Math.max(mag, 1e-10));
            pts.push([x(freq), y(db)]);
        }
        return pts;
    }, [bands, sampleRate, x, y]);

    const curvePath = useMemo(() => line()(points), [points]);
    const fillPath = useMemo(() => area().y0(y(0))(points), [points, y]);

    // Screen → SVG coordinates
    const toSVG = useCallback((cx, cy) => {
        const svg = svgRef.current;
        if (!svg) return null;
        const ctm = svg.getScreenCTM();
        if (!ctm) return null;
        return new DOMPoint(cx, cy).matrixTransform(ctm.inverse());
    }, []);

    // Drag: pointerdown on marker → window listeners for move/up
    const handlePointerDown = useCallback((idx, e) => {
        e.preventDefault();
        setDragIdx(idx);
        dragIdxRef.current = idx;

        const onMove = (ev) => {
            const pt = toSVG(ev.clientX, ev.clientY);
            if (!pt) return;
            const freq = Math.round(Math.max(20, Math.min(20000, x.invert(pt.x))));
            const db = Math.round(Math.max(-18, Math.min(18, y.invert(pt.y))) * 10) / 10;
            onBandChange(idx, 'freq', freq);
            onBandChange(idx, 'gain_db', db);
        };

        const onUp = () => {
            setDragIdx(null);
            dragIdxRef.current = null;
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }, [x, y, onBandChange, toSVG]);

    // Wheel for Q (non-passive to prevent page scroll)
    useEffect(() => {
        const svg = svgRef.current;
        if (!svg) return;

        const onWheel = (e) => {
            const fromTarget = parseInt(e.target.dataset.band);
            const idx = isNaN(fromTarget) ? dragIdxRef.current : fromTarget;
            if (idx == null || !bands[idx] || bands[idx].type === FILTER_FLAT) return;
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            const newQ = Math.round(Math.max(0.1, Math.min(20, bands[idx].Q + delta)) * 100) / 100;
            onBandChange(idx, 'Q', newQ);
        };

        svg.addEventListener('wheel', onWheel, { passive: false });
        return () => svg.removeEventListener('wheel', onWheel);
    }, [bands, onBandChange]);

    return (
        <svg
            ref={svgRef}
            viewBox={`0 0 ${VW} ${VH}`}
            className={`w-full select-none ${className || ''}`}
            style={{ touchAction: 'none' }}
        >
            <rect width={VW} height={VH} fill={BG_FILL} rx="6" />

            {freqTicks.map(f => (
                <g key={`f${f}`}>
                    <line x1={x(f)} y1={PAD.t} x2={x(f)} y2={VH - PAD.b} stroke={GRID_STROKE} strokeWidth="0.5" />
                    <text x={x(f)} y={VH - 7} textAnchor="middle" fill={LABEL_FILL} fontSize="10" fontFamily="monospace">
                        {fmtFreq(f)}
                    </text>
                </g>
            ))}

            {dbTicks.map(db => (
                <g key={`d${db}`}>
                    <line x1={PAD.l} y1={y(db)} x2={VW - PAD.r} y2={y(db)} stroke={GRID_STROKE} strokeWidth="0.5" />
                    <text x={PAD.l - 4} y={y(db) + 3} textAnchor="end" fill={LABEL_FILL} fontSize="10" fontFamily="monospace">
                        {db}
                    </text>
                </g>
            ))}

            <line x1={PAD.l} y1={y(0)} x2={VW - PAD.r} y2={y(0)} stroke={REF_STROKE} strokeWidth="1" />

            {fillPath && <path d={fillPath} fill={CURVE_FILL} />}
            {curvePath && <path d={curvePath} fill="none" stroke={CURVE_STROKE} strokeWidth="1.5" />}

            {bands.map((band, i) => {
                if (band.type === FILTER_FLAT) return null;
                const mag = combinedMagnitude([band], band.freq, sampleRate);
                const db = 20 * Math.log10(Math.max(mag, 1e-10));
                const cx = x(band.freq);
                const cy = y(db);
                const active = dragIdx === i;

                return (
                    <g key={`m${i}`}>
                        <circle
                            cx={cx} cy={cy} r={14}
                            fill="transparent" cursor="grab"
                            data-band={i}
                            onPointerDown={e => handlePointerDown(i, e)}
                        />
                        <circle
                            cx={cx} cy={cy}
                            r={active ? 6 : 4}
                            fill={band.gain_db >= 0 ? BOOST_FILL : CUT_FILL}
                            stroke={active ? CURVE_STROKE : 'none'}
                            strokeWidth={active ? 2 : 0}
                            pointerEvents="none"
                        />
                    </g>
                );
            })}
        </svg>
    );
}
