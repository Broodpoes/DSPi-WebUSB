import React, { useState, useEffect, useCallback, useRef } from 'react';
import { WebUSBTransport } from '../transport.js';
import { DSPiClient } from '../dspi-client.js';
import EQGraph from '@/components/eq-graph';
import { renderMeters, parseMeterData } from '../meters.js';
import { Link, Unlink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

const FILTER_TYPES = ['Flat', 'Peaking', 'Low Shelf', 'High Shelf', 'Low Pass', 'High Pass'];
const NUM_MASTER_BANDS = 10;
const DEFAULT_SR = 48000;

const CH_NAMES_RP2350 = ['Master L', 'Master R', 'Out 1', 'Out 2', 'Out 3', 'Out 4', 'Out 5', 'Out 6', 'Out 7', 'Out 8', 'PDM Sub'];
const CH_NAMES_RP2040 = ['Master L', 'Master R', 'Out 1', 'Out 2', 'Out 3', 'Out 4', 'PDM Sub'];

function defaultBands() {
    return Array(10).fill(null).map(() => ({ type: 0, freq: 1000, Q: 0.707, gain_db: 0 }));
}

// ── Meter Canvas ─────────────────────────────────────────────────

function MeterCanvas({ client, numChannels, channelNames }) {
    const canvasRef = useRef(null);
    const clientRef = useRef(client);

    useEffect(() => { clientRef.current = client; }, [client]);

    useEffect(() => {
        let active = true;
        let poll = async () => {
            if (!active || !clientRef.current) return;
            try {
                const raw = await clientRef.current.getStatus(9);
                const data = parseMeterData(raw, numChannels);
                if (active && canvasRef.current) {
                    renderMeters(canvasRef.current, data, numChannels, channelNames);
                }
            } catch { /* ignore */ }
            if (active) setTimeout(poll, 200);
        };
        poll();
        return () => { active = false; };
    }, [numChannels, channelNames]);

    return <canvas ref={canvasRef} className="w-full h-52 rounded-md bg-card" />;
}

// ── EQ Band Table ────────────────────────────────────────────────

function EQBandTable({ bands, onBandChange }) {
    return (
        <table className="w-full text-sm">
            <thead>
                <tr className="text-xs text-muted-foreground">
                    <th className="text-left py-1 px-1">#</th>
                    <th className="text-left py-1 px-1">Type</th>
                    <th className="text-left py-1 px-1">Freq</th>
                    <th className="text-left py-1 px-1">Q</th>
                    <th className="text-left py-1 px-1">Gain</th>
                </tr>
            </thead>
            <tbody>
                {bands.map((band, i) => (
                    <tr key={i} className={band.type === 0 ? 'opacity-30' : ''}>
                        <td className="py-0.5 px-1 text-muted-foreground">{i + 1}</td>
                        <td className="py-0.5 px-1">
                            <Select value={String(band.type)} onValueChange={v => onBandChange(i, 'type', parseInt(v))}>
                                <SelectTrigger className="h-7 text-xs w-24">
                                    <SelectValue>{FILTER_TYPES[band.type]}</SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                    {FILTER_TYPES.map((n, j) => <SelectItem key={j} value={String(j)}>{n}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </td>
                        <td className="py-0.5 px-1">
                            <Input type="number" className="h-7 text-xs w-20" value={band.freq.toFixed(1)}
                                   onChange={e => onBandChange(i, 'freq', parseFloat(e.target.value))}
                                   min={10} max={20000} step={1} />
                        </td>
                        <td className="py-0.5 px-1">
                            <Input type="number" className="h-7 text-xs w-16" value={band.Q.toFixed(2)}
                                   onChange={e => onBandChange(i, 'Q', parseFloat(e.target.value))}
                                   min={0.1} max={20} step={0.01} />
                        </td>
                        <td className="py-0.5 px-1">
                            <Input type="number" className="h-7 text-xs w-16" value={band.gain_db.toFixed(1)}
                                   onChange={e => onBandChange(i, 'gain_db', parseFloat(e.target.value))}
                                   min={-30} max={12} step={0.1} />
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

// ── Preset Button (click to load, dblclick to rename) ─────────

function PresetButton({ preset, index, active, onLoad, onRename }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const inputRef = useRef(null);

    const startEdit = () => {
        setDraft(preset.name || `Slot ${index + 1}`);
        setEditing(true);
    };

    const commit = () => {
        setEditing(false);
        const trimmed = draft.trim();
        if (trimmed && trimmed !== preset.name) onRename(trimmed);
    };

    useEffect(() => {
        if (editing && inputRef.current) inputRef.current.select();
    }, [editing]);

    if (editing) {
        return (
            <Input ref={inputRef}
                className="h-7 text-xs px-2"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
                maxLength={31}
            />
        );
    }

    return (
        <button
            className={`text-xs px-2 py-1.5 rounded border transition-colors
                ${active ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50'}`}
            onClick={onLoad}
            onDoubleClick={e => { e.preventDefault(); startEdit(); }}
        >
            {preset.name || `Slot ${index + 1}`}
        </button>
    );
}

// ── Connection Screen ────────────────────────────────────────────

function ConnectScreen({ onConnect }) {
    return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-5">
            <h1 className="text-sm font-medium tracking-tight">DSPi</h1>
            <p className="text-muted-foreground text-xs max-w-xs text-center leading-relaxed">
                Connect your DSPi device via WebUSB to begin.
            </p>
            <Button size="lg" onClick={onConnect}>Connect</Button>
            <p className="text-xs text-muted-foreground">
                Chrome, Edge, or Opera required.{' '}
                <a href="https://caniuse.com/webusb" target="_blank" rel="noopener" className="text-primary underline underline-offset-2">Browser support</a>
            </p>
        </div>
    );
}

// ── Main App ─────────────────────────────────────────────────────

export default function App() {
    const [connected, setConnected] = useState(false);
    const [transport, setTransport] = useState(null);
    const [client, setClient] = useState(null);
    const [platform, setPlatform] = useState(0);
    const [serial, setSerial] = useState('');
    const [numChannels, setNumChannels] = useState(7);
    const [channelNames, setChannelNames] = useState(CH_NAMES_RP2040);

    // Presets
    const [presets, setPresets] = useState(Array(10).fill(null).map((_, i) => ({ name: `Slot ${i + 1}`, active: false })));
    const [activePreset, setActivePreset] = useState(-1);

    // Volume
    const [masterVolume, setMasterVolume] = useState(-20);
    const [isMuted, setIsMuted] = useState(false);

    // Preamp
    const [preampL, setPreampL] = useState(0);
    const [preampR, setPreampR] = useState(0);
    const [preampLinked, setPreampLinked] = useState(true);

    // EQ
    const [eqTab, setEqTab] = useState(0);
    const [masterEq, setMasterEq] = useState({ left: defaultBands(), right: defaultBands() });
    const [eqLinked, setEqLinked] = useState(true);

    // Output EQ
    const [outputEqTab, setOutputEqTab] = useState(2);
    const [outputEqBands, setOutputEqBands] = useState({});

    // Bypass
    const [bypass, setBypass] = useState(false);

    const clientRef = useRef(null);

    // ── Connect ───────────────────────────────────────────────

    const handleConnect = useCallback(async () => {
        try {
            const t = new WebUSBTransport();
            await t.connect();
            const c = new DSPiClient(t);
            clientRef.current = c;
            setTransport(t);
            setClient(c);
            setConnected(true);

            // Load device info
            const p = await c.getPlatform();
            const s = await c.getSerial();
            const nc = p === 1 ? 11 : 7;
            const cn = p === 1 ? CH_NAMES_RP2350 : CH_NAMES_RP2040;
            setPlatform(p);
            setSerial(s);
            setNumChannels(nc);
            setChannelNames(cn);

            // Load state
            await loadState(c, nc, setPresets, setActivePreset, setMasterVolume, setIsMuted,
                            setPreampL, setPreampR, setMasterEq, setBypass);

            // Fetch initial output EQ tab
            {
                const initOutCh = 2;
                const bands = [];
                for (let b = 0; b < NUM_MASTER_BANDS; b++) {
                    bands.push(await c.getEqParam(initOutCh, b));
                }
                setOutputEqBands(prev => ({ ...prev, [initOutCh]: bands }));
            }

            t.onDisconnect(() => {
                setConnected(false);
                setClient(null);
                clientRef.current = null;
                setOutputEqBands({});
            });
        } catch (e) {
            alert('WebUSB connection failed: ' + e.message);
        }
    }, []);

    // ── EQ band change ────────────────────────────────────────

    const handleEqBandChange = useCallback(async (channel, bandIdx, field, value) => {
        setMasterEq(prev => {
            const channels = eqLinked ? ['left', 'right'] : [channel === 0 ? 'left' : 'right'];
            const next = { ...prev };
            for (const key of channels) {
                next[key] = next[key].map((b, i) => i === bandIdx ? { ...b, [field]: value } : b);
            }
            const chNum = key => key === 'left' ? 0 : 1;
            for (const key of channels) {
                const band = next[key][bandIdx];
                clientRef.current?.setEqParam(chNum(key), bandIdx, band.type, band.freq, band.Q, band.gain_db);
            }
            return next;
        });
    }, [eqLinked]);

    const handleOutputEqBandChange = useCallback(async (channel, bandIdx, field, value) => {
        setOutputEqBands(prev => {
            if (!prev[channel]) return prev;
            const next = { ...prev, [channel]: prev[channel].map((b, i) => i === bandIdx ? { ...b, [field]: value } : b) };
            const band = next[channel][bandIdx];
            clientRef.current?.setEqParam(channel, bandIdx, band.type, band.freq, band.Q, band.gain_db);
            return next;
        });
    }, []);

    // ── Load output EQ tab ────────────────────────────────────

    const loadOutputEq = useCallback(async (ch) => {
        setOutputEqTab(ch);
        if (!outputEqBands[ch] && clientRef.current) {
            const bands = [];
            for (let b = 0; b < NUM_MASTER_BANDS; b++) {
                bands.push(await clientRef.current.getEqParam(ch, b));
            }
            setOutputEqBands(prev => ({ ...prev, [ch]: bands }));
        }
    }, [outputEqBands]);

    // ── Render ────────────────────────────────────────────────

    if (!connected) return <ConnectScreen onConnect={handleConnect} />;

    const eqBands = eqTab === 0 ? masterEq.left : masterEq.right;
    const outBands = outputEqBands[outputEqTab] || defaultBands();

    return (
        <div className="min-h-screen bg-background text-foreground">
            <header className="flex items-center justify-between px-5 py-2.5 ring-1 ring-foreground/5">
                <h1 className="text-sm font-medium tracking-tight">DSPi</h1>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                    Connected
                    <Badge variant="outline">WebUSB</Badge>
                </div>
            </header>

            <div className="grid grid-cols-[240px_1fr_240px] gap-5 px-5 py-4 max-w-[1400px] mx-auto">
                <div className="flex flex-col gap-3">
                    <Card>
                        <CardHeader className="pb-2"><CardTitle className="text-sm">Presets</CardTitle></CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-2 gap-1.5">
                                {presets.map((p, i) => (
                                    <PresetButton key={i} preset={p} index={i} active={i === activePreset}
                                        onLoad={async () => {
                                            await clientRef.current.presetLoad(i);
                                            setActivePreset(i);
                                            await loadState(clientRef.current, numChannels, setPresets, setActivePreset,
                                                setMasterVolume, setIsMuted, setPreampL, setPreampR, setMasterEq, setBypass);
                                        }}
                                        onRename={async (name) => {
                                            await clientRef.current.presetSetName(i, name);
                                            setPresets(prev => prev.map((pp, j) => j === i ? { ...pp, name } : pp));
                                        }}
                                    />
                                ))}
                            </div>
                            <div className="flex gap-1.5 mt-3">
                                <Button variant="outline" size="sm" className="flex-1 text-xs"
                                        onClick={() => clientRef.current?.factoryReset().then(() =>
                                            loadState(clientRef.current, numChannels, setPresets, setActivePreset,
                                                setMasterVolume, setIsMuted, setPreampL, setPreampR, setMasterEq, setBypass))}>
                                    Factory Reset
                                </Button>
                                <Button variant="outline" size="sm" className="flex-1 text-xs"
                                        onClick={async () => {
                                            if (activePreset >= 0) {
                                                await clientRef.current.presetSave(activePreset);
                                            }
                                        }}>
                                    Save
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-2">
                            <div className="flex items-center justify-between">
                                <CardTitle className="text-sm">Preamp</CardTitle>
                                <Button
                                    variant="ghost" size="icon"
                                    className={`h-7 w-7 ${preampLinked ? 'text-primary' : 'text-muted-foreground'}`}
                                    onClick={() => {
                                        if (!preampLinked) setPreampR(preampL);
                                        setPreampLinked(v => !v);
                                    }}
                                    title={preampLinked ? 'Unlink L/R preamp' : 'Link L/R preamp'}
                                >
                                    {preampLinked ? <Link className="h-3.5 w-3.5" /> : <Unlink className="h-3.5 w-3.5" />}
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {preampLinked ? (
                                <div className="flex items-center gap-3">
                                    <Label className="text-xs text-muted-foreground">L+R</Label>
                                    <Slider min={-30} max={12} step={0.5} value={preampL}
                                            onValueChange={v => {
                                                setPreampL(v); setPreampR(v);
                                                clientRef.current?.setPreampCh(0, v);
                                                clientRef.current?.setPreampCh(1, v);
                                            }}
                                            className="flex-1" />
                                    <span className="text-xs w-12 text-right">{preampL.toFixed(1)} dB</span>
                                </div>
                            ) : (
                                <>
                                    <div className="flex items-center gap-3">
                                        <Label className="w-4 text-xs text-muted-foreground">L</Label>
                                        <Slider min={-30} max={12} step={0.5} value={preampL}
                                                onValueChange={v => { setPreampL(v); clientRef.current?.setPreampCh(0, v); }}
                                                className="flex-1" />
                                        <span className="text-xs w-12 text-right">{preampL.toFixed(1)} dB</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <Label className="w-4 text-xs text-muted-foreground">R</Label>
                                        <Slider min={-30} max={12} step={0.5} value={preampR}
                                                onValueChange={v => { setPreampR(v); clientRef.current?.setPreampCh(1, v); }}
                                                className="flex-1" />
                                        <span className="text-xs w-12 text-right">{preampR.toFixed(1)} dB</span>
                                    </div>
                                </>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-2"><CardTitle className="text-sm">Master EQ Bypass</CardTitle></CardHeader>
                        <CardContent>
                            <Switch checked={bypass} onCheckedChange={v => { setBypass(v); clientRef.current?.setBypass(v); }} />
                        </CardContent>
                    </Card>
                </div>

                {/* Center: EQ */}
                <div className="flex flex-col gap-5">
                    <Card>
                        <CardHeader className="pb-2">
                            <div className="flex items-center justify-between">
                                <CardTitle className="text-sm">Master EQ</CardTitle>
                                <div className="flex items-center gap-2">
                                    {eqLinked ? (
                                        <span className="text-xs text-muted-foreground">L+R</span>
                                    ) : (
                                        <Tabs value={String(eqTab)} onValueChange={v => setEqTab(parseInt(v))}>
                                            <TabsList className="h-7">
                                                <TabsTrigger value="0" className="text-xs px-3">Left</TabsTrigger>
                                                <TabsTrigger value="1" className="text-xs px-3">Right</TabsTrigger>
                                            </TabsList>
                                        </Tabs>
                                    )}
                                    <Button
                                        variant="ghost" size="icon"
                                        className={`h-7 w-7 ${eqLinked ? 'text-primary' : 'text-muted-foreground'}`}
                                        onClick={() => {
                                            if (!eqLinked) {
                                                // Linking: copy active channel to the other
                                                const src = eqTab === 0 ? 'left' : 'right';
                                                const dst = eqTab === 0 ? 'right' : 'left';
                                                setMasterEq(prev => ({ ...prev, [dst]: prev[src].map(b => ({ ...b })) }));
                                            }
                                            setEqLinked(v => !v);
                                        }}
                                        title={eqLinked ? 'Unlink L/R channels' : 'Link L/R channels'}
                                    >
                                        {eqLinked ? <Link className="h-3.5 w-3.5" /> : <Unlink className="h-3.5 w-3.5" />}
                                    </Button>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <EQGraph bands={eqBands} onBandChange={(i, f, v) => handleEqBandChange(eqTab, i, f, v)} sampleRate={DEFAULT_SR} />
                            <EQBandTable bands={eqBands} onBandChange={(i, f, v) => handleEqBandChange(eqTab, i, f, v)} />
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm">Output EQ</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <Tabs value={String(outputEqTab)} onValueChange={v => loadOutputEq(parseInt(v))}>
                                <TabsList className="h-7 flex-wrap">
                                    {channelNames.slice(2).map((name, i) => (
                                        <TabsTrigger key={i} value={String(i + 2)} className="text-xs px-2">{name}</TabsTrigger>
                                    ))}
                                </TabsList>
                            </Tabs>
                            <EQGraph bands={outBands} onBandChange={(i, f, v) => handleOutputEqBandChange(outputEqTab, i, f, v)} sampleRate={DEFAULT_SR} />
                            <EQBandTable bands={outBands} onBandChange={(i, f, v) => handleOutputEqBandChange(outputEqTab, i, f, v)} />
                        </CardContent>
                    </Card>
                </div>

                {/* Right: Volume + Meters + Info */}
                <div className="flex flex-col gap-3">
                    <Card>
                        <CardHeader className="pb-2"><CardTitle className="text-sm">Master Volume</CardTitle></CardHeader>
                        <CardContent className="flex flex-col items-center gap-3">
                            <span className="text-2xl font-bold text-primary">
                                {isMuted ? 'MUTE' : `${masterVolume.toFixed(1)} dB`}
                            </span>
                            <Slider min={-127} max={0} step={0.5} value={isMuted ? -128 : masterVolume}
                                    onValueChange={v => {
                                        setMasterVolume(v);
                                        setIsMuted(false);
                                        clientRef.current?.setMasterVolume(v);
                                    }}
                                    className="w-full" />
                            <Button variant={isMuted ? 'destructive' : 'outline'} size="sm"
                                    onClick={() => {
                                        if (isMuted) {
                                            const v = masterVolume > -127 ? masterVolume : -20;
                                            setIsMuted(false);
                                            setMasterVolume(v);
                                            clientRef.current?.setMasterVolume(v);
                                        } else {
                                            setIsMuted(true);
                                            clientRef.current?.setMasterVolume(-128);
                                        }
                                    }}>
                                {isMuted ? 'Unmute' : 'Mute'}
                            </Button>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-2"><CardTitle className="text-sm">Meters</CardTitle></CardHeader>
                        <CardContent>
                            <MeterCanvas client={client} numChannels={numChannels} channelNames={channelNames} />
                            <Button variant="outline" size="sm" className="w-full mt-2 text-xs"
                                    onClick={() => clientRef.current?.clearClips()}>
                                Clear Clips
                            </Button>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-2"><CardTitle className="text-sm">Device Info</CardTitle></CardHeader>
                        <CardContent className="text-xs text-muted-foreground space-y-0.5">
                            <p>Platform: {platform === 1 ? 'RP2350' : 'RP2040'}</p>
                            <p>Serial: {serial}</p>
                            <p>Channels: {numChannels}</p>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}

// ── State Loading ────────────────────────────────────────────────

async function loadState(c, nc, setPresets, setActive, setVol, setMuted, setPreL, setPreR, setEq, setBypass) {
    // Presets
    const active = await c.presetGetActive();
    setActive(active);
    const presetList = [];
    for (let i = 0; i < 10; i++) {
        const name = await c.presetGetName(i);
        presetList.push({ name: name || `Slot ${i + 1}`, active: i === active });
    }
    setPresets(presetList);

    // Volume
    const vol = await c.getMasterVolume();
    setVol(vol);
    setMuted(vol <= -128);

    // Preamp
    setPreL(await c.getPreampCh(0));
    setPreR(await c.getPreampCh(1));

    // EQ
    const left = [], right = [];
    for (let b = 0; b < NUM_MASTER_BANDS; b++) {
        left.push(await c.getEqParam(0, b));
        right.push(await c.getEqParam(1, b));
    }
    setEq({ left, right });

    // Bypass
    setBypass(await c.getBypass());
}
