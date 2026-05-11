import React, { useState, useEffect, useCallback, useRef } from 'react';
import { WebUSBTransport } from '../transport.js';
import { DSPiClient } from '../dspi-client.js';
import { renderEQCurve } from '../eq-curve.js';
import { renderMeters, parseMeterData } from '../meters.js';
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

// ── EQ Curve Canvas ──────────────────────────────────────────────

function EQCurveCanvas({ bands, className }) {
    const canvasRef = useRef(null);
    useEffect(() => {
        if (canvasRef.current) renderEQCurve(canvasRef.current, bands, { sampleRate: DEFAULT_SR });
    }, [bands]);
    return <canvas ref={canvasRef} className={`w-full h-44 rounded-md bg-[hsl(var(--card))] ${className || ''}`} />;
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

    return <canvas ref={canvasRef} className="w-full h-52 rounded-md bg-[hsl(var(--card))]" />;
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
                                <SelectTrigger className="h-7 text-xs w-24"><SelectValue /></SelectTrigger>
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

// ── Connection Screen ────────────────────────────────────────────

function ConnectScreen({ onConnect }) {
    return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-6">
            <h1 className="text-2xl font-bold text-primary">DSPi Web Interface</h1>
            <p className="text-muted-foreground text-sm max-w-xs text-center">
                Connect your DSPi device via WebUSB.
            </p>
            <Button size="lg" onClick={onConnect}>Connect via WebUSB</Button>
            <p className="text-xs text-muted-foreground">
                Requires Chrome, Edge, or Opera.{' '}
                <a href="https://caniuse.com/webusb" target="_blank" rel="noopener" className="text-primary underline">Browser support</a>
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

    // EQ
    const [eqTab, setEqTab] = useState(0);
    const [masterEq, setMasterEq] = useState({ left: defaultBands(), right: defaultBands() });

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

            t.onDisconnect(() => {
                setConnected(false);
                setClient(null);
                clientRef.current = null;
            });
        } catch (e) {
            alert('WebUSB connection failed: ' + e.message);
        }
    }, []);

    // ── EQ band change ────────────────────────────────────────

    const handleEqBandChange = useCallback(async (channel, bandIdx, field, value) => {
        const key = channel === 0 ? 'left' : 'right';
        setMasterEq(prev => {
            const next = { ...prev, [key]: prev[key].map((b, i) => i === bandIdx ? { ...b, [field]: value } : b) };
            const band = next[key][bandIdx];
            clientRef.current?.setEqParam(channel, bandIdx, band.type, band.freq, band.Q, band.gain_db);
            return next;
        });
    }, []);

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
            {/* Header */}
            <header className="flex items-center justify-between px-6 py-3 border-b">
                <h1 className="text-lg font-semibold text-primary">DSPi Control Panel</h1>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    Connected
                    <Badge variant="outline">WebUSB</Badge>
                </div>
            </header>

            <div className="grid grid-cols-[240px_1fr_240px] gap-4 p-4 max-w-[1400px] mx-auto">
                {/* Left: Presets + Preamp + Bypass */}
                <div className="flex flex-col gap-4">
                    <Card>
                        <CardHeader className="pb-2"><CardTitle className="text-sm">Presets</CardTitle></CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-2 gap-1.5">
                                {presets.map((p, i) => (
                                    <button key={i}
                                        className={`text-xs px-2 py-1.5 rounded border transition-colors
                                            ${i === activePreset ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50'}`}
                                        onClick={async () => {
                                            await clientRef.current.presetLoad(i);
                                            setActivePreset(i);
                                            await loadState(clientRef.current, numChannels, setPresets, setActivePreset,
                                                setMasterVolume, setIsMuted, setPreampL, setPreampR, setMasterEq, setBypass);
                                        }}>
                                        {p.name || `Slot ${i + 1}`}
                                    </button>
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
                        <CardHeader className="pb-2"><CardTitle className="text-sm">Preamp</CardTitle></CardHeader>
                        <CardContent className="space-y-3">
                            <div className="flex items-center gap-3">
                                <Label className="w-4 text-xs text-muted-foreground">L</Label>
                                <Slider min={-30} max={12} step={0.5} value={[preampL]}
                                        onValueChange={([v]) => { setPreampL(v); clientRef.current?.setPreampCh(0, v); }}
                                        className="flex-1" />
                                <span className="text-xs w-12 text-right">{preampL.toFixed(1)} dB</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <Label className="w-4 text-xs text-muted-foreground">R</Label>
                                <Slider min={-30} max={12} step={0.5} value={[preampR]}
                                        onValueChange={([v]) => { setPreampR(v); clientRef.current?.setPreampCh(1, v); }}
                                        className="flex-1" />
                                <span className="text-xs w-12 text-right">{preampR.toFixed(1)} dB</span>
                            </div>
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
                <div className="flex flex-col gap-4">
                    <Card>
                        <CardHeader className="pb-2">
                            <div className="flex items-center justify-between">
                                <CardTitle className="text-sm">Master EQ</CardTitle>
                                <Tabs value={String(eqTab)} onValueChange={v => setEqTab(parseInt(v))}>
                                    <TabsList className="h-7">
                                        <TabsTrigger value="0" className="text-xs px-3">Left</TabsTrigger>
                                        <TabsTrigger value="1" className="text-xs px-3">Right</TabsTrigger>
                                    </TabsList>
                                </Tabs>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <EQCurveCanvas bands={eqBands} />
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
                            <EQCurveCanvas bands={outBands} />
                            <EQBandTable bands={outBands} onBandChange={(i, f, v) => handleOutputEqBandChange(outputEqTab, i, f, v)} />
                        </CardContent>
                    </Card>
                </div>

                {/* Right: Volume + Meters + Info */}
                <div className="flex flex-col gap-4">
                    <Card>
                        <CardHeader className="pb-2"><CardTitle className="text-sm">Master Volume</CardTitle></CardHeader>
                        <CardContent className="flex flex-col items-center gap-3">
                            <span className="text-2xl font-bold text-primary">
                                {isMuted ? 'MUTE' : `${masterVolume.toFixed(1)} dB`}
                            </span>
                            <Slider min={-127} max={0} step={0.5} value={[isMuted ? -128 : masterVolume]}
                                    onValueChange={([v]) => {
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
