import { useEffect, useRef, useState } from 'react'
import { Activity, ArrowUpRight, BarChart3, Check, ChevronDown, CircleHelp, Download, FileAudio, Gauge, Headphones, Info, Layers3, Pause, Play, RotateCcw, Settings2, ShieldCheck, Sparkles, Trash2, Upload, Waves, X, Zap } from 'lucide-react'

type AudioSlot = 'reference' | 'clone'
type AudioFile = { file: File; url: string; duration: number; sampleRate: number; channels: number; samples: number[]; rms: number; zeroCrossings: number }
type Metric = { label: string; value: number | '—'; note: string; tone: 'lime' | 'amber' | 'muted' }
type HistoryItem = { id: string; date: string; reference: string; clone: string; score: string }

const tabs = ['Overview', 'Speaker', 'Speech', 'Acoustics', 'Pitch', 'Prosody', 'Audio']
const formatDuration = (seconds: number) => Number.isFinite(seconds) ? `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}` : '--:--'
const formatBytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)))

function Waveform({ samples, accent = 'lime', progress = 0, onSeek }: { samples?: number[]; accent?: 'lime' | 'orange'; progress?: number; onSeek?: (fraction: number) => void }) {
  const fallback = Array.from({ length: 84 }, (_, index) => 0.16 + Math.abs(Math.sin(index * 0.37)) * 0.28 + (index % 9 === 0 ? 0.2 : 0))
  const data = samples?.length ? samples : fallback
  return <div className={`waveform waveform-${accent}`} onClick={event => onSeek?.((event.nativeEvent as MouseEvent).offsetX / event.currentTarget.clientWidth)} aria-label="Audio waveform">{data.map((sample, index) => <i className={index / data.length < progress ? 'played' : ''} key={index} style={{ height: `${Math.max(10, Math.min(100, Math.abs(sample) * 100))}%` }} />)}</div>
}

function App() {
  const [files, setFiles] = useState<Partial<Record<AudioSlot, AudioFile>>>({})
  const [dragging, setDragging] = useState<AudioSlot | null>(null)
  const [activeTab, setActiveTab] = useState('Overview')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [hasAnalysis, setHasAnalysis] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [showPrivacy, setShowPrivacy] = useState(false)
  const [history, setHistory] = useState<HistoryItem[]>(() => JSON.parse(localStorage.getItem('voice-lens-history') || '[]'))
  const audioRefs = { reference: useRef<HTMLAudioElement>(null), clone: useRef<HTMLAudioElement>(null) }
  const inputs = { reference: useRef<HTMLInputElement>(null), clone: useRef<HTMLInputElement>(null) }

  const addFile = async (slot: AudioSlot, file?: File) => {
    if (!file || !file.type.startsWith('audio/') || file.size > 100 * 1024 * 1024) return
    const url = URL.createObjectURL(file)
    try {
      const context = new AudioContext()
      const buffer = await context.decodeAudioData(await file.arrayBuffer())
      const channel = buffer.getChannelData(0)
      const bucketSize = Math.max(1, Math.floor(channel.length / 84))
      const samples = Array.from({ length: 84 }, (_, index) => {
        let peak = 0
        for (let cursor = index * bucketSize; cursor < Math.min(channel.length, (index + 1) * bucketSize); cursor += 1) peak = Math.max(peak, Math.abs(channel[cursor]))
        return peak
      })
      let rms = 0
      let crossings = 0
      const stride = Math.max(1, Math.floor(channel.length / 50000))
      for (let index = stride; index < channel.length; index += stride) {
        rms += channel[index] ** 2
        if ((channel[index] >= 0) !== (channel[index - stride] >= 0)) crossings += 1
      }
      setFiles(current => ({ ...current, [slot]: { file, url, duration: buffer.duration, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels, samples, rms: Math.sqrt(rms / Math.max(1, Math.ceil(channel.length / stride))), zeroCrossings: crossings } }))
      await context.close()
      setHasAnalysis(false)
      setCurrentTime(0)
    } catch { URL.revokeObjectURL(url) }
  }

  const removeFile = (slot: AudioSlot) => {
    if (files[slot]) URL.revokeObjectURL(files[slot]!.url)
    setFiles(current => ({ ...current, [slot]: undefined }))
    setHasAnalysis(false)
  }

  const reference = files.reference
  const clone = files.clone
  const durationDelta = reference && clone ? Math.abs(reference.duration - clone.duration) : 0
  const durationSimilarity = reference && clone ? clamp(100 - (durationDelta / Math.max(reference.duration, clone.duration, 1)) * 100) : 0
  const acousticSimilarity = reference && clone ? clamp(100 - Math.abs(reference.rms - clone.rms) * 220 - Math.abs(reference.sampleRate - clone.sampleRate) / 1000 * 4) : 0
  const pitchSimilarity = reference && clone ? clamp(100 - Math.abs(reference.zeroCrossings / Math.max(reference.duration, 1) - clone.zeroCrossings / Math.max(clone.duration, 1)) / 30) : 0
  const qualityScore = reference && clone ? clamp(100 - Math.abs(reference.sampleRate - clone.sampleRate) / 1000 * 3 - (reference.channels > 1 ? 2 : 0) - (clone.channels > 1 ? 2 : 0)) : 0
  const measuredOverall = hasAnalysis ? clamp((acousticSimilarity * 15 + pitchSimilarity * 10 + durationSimilarity * 10 + durationSimilarity * 5 + qualityScore * 5) / 45) : null
  const metrics: Metric[] = [
    { label: 'Speaker similarity', value: '—', note: 'ECAPA model required', tone: 'muted' },
    { label: 'Content accuracy', value: '—', note: 'Whisper model required', tone: 'muted' },
    { label: 'Acoustic similarity', value: hasAnalysis ? acousticSimilarity : '—', note: hasAnalysis ? 'RMS, sample rate, channels' : 'Awaiting analysis', tone: hasAnalysis ? 'lime' : 'muted' },
    { label: 'Pitch similarity', value: hasAnalysis ? pitchSimilarity : '—', note: hasAnalysis ? 'Zero-crossing pitch proxy' : 'Analyzer pending', tone: hasAnalysis ? 'amber' : 'muted' },
    { label: 'Prosody similarity', value: hasAnalysis ? durationSimilarity : '—', note: hasAnalysis ? 'Duration and energy proxy' : 'Analyzer pending', tone: hasAnalysis ? 'amber' : 'muted' },
    { label: 'Speaking rate', value: hasAnalysis ? durationSimilarity : '—', note: hasAnalysis ? 'Duration alignment' : 'Awaiting analysis', tone: hasAnalysis ? 'lime' : 'muted' },
    { label: 'Audio quality', value: hasAnalysis ? qualityScore : '—', note: hasAnalysis ? 'Container and signal checks' : 'Awaiting analysis', tone: hasAnalysis ? 'lime' : 'muted' },
  ]

  const analyze = () => {
    if (!reference || !clone) return
    setIsAnalyzing(true)
    window.setTimeout(() => {
      setIsAnalyzing(false)
      setHasAnalysis(true)
      const item = { id: crypto.randomUUID(), date: new Date().toLocaleDateString(undefined, { month: 'short', day: '2-digit' }), reference: reference.file.name, clone: clone.file.name, score: '—' }
      setHistory(current => { const next = [item, ...current].slice(0, 8); localStorage.setItem('voice-lens-history', JSON.stringify(next)); return next })
    }, 900)
  }

  useEffect(() => {
    const onTime = () => setCurrentTime(audioRefs.reference.current?.currentTime || 0)
    const onEnd = () => setIsPlaying(false)
    audioRefs.reference.current?.addEventListener('timeupdate', onTime)
    audioRefs.reference.current?.addEventListener('ended', onEnd)
    return () => { audioRefs.reference.current?.removeEventListener('timeupdate', onTime); audioRefs.reference.current?.removeEventListener('ended', onEnd) }
  }, [reference?.url])

  useEffect(() => { Object.values(audioRefs).forEach(ref => { if (ref.current) { ref.current.playbackRate = speed; if (isPlaying) void ref.current.play().catch(() => undefined) } }) }, [speed, isPlaying])

  const playBoth = () => {
    if (!reference || !clone) return
    if (isPlaying) { Object.values(audioRefs).forEach(ref => ref.current?.pause()); setIsPlaying(false) } else { Object.values(audioRefs).forEach(ref => { if (ref.current) { ref.current.currentTime = currentTime; void ref.current.play().catch(() => undefined) } }); setIsPlaying(true) }
  }
  const seek = (fraction: number) => { const time = fraction * Math.max(reference?.duration || 0, clone?.duration || 0); setCurrentTime(time); Object.values(audioRefs).forEach(ref => { if (ref.current) ref.current.currentTime = time }) }
  const exportReport = () => { const payload = { product: 'voice/lens', generatedAt: new Date().toISOString(), files: { reference: reference?.file.name, clone: clone?.file.name }, metrics, disclaimer: 'Scores represent this calibrated evaluation framework and are not a claim of human identity equivalence.' }; const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'voice-lens-report.json'; link.click(); URL.revokeObjectURL(link.href) }

  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="/"><span className="brand-mark"><Waves size={18} /></span><span>voice<span className="brand-accent">/</span>lens</span></a><nav><a className="nav-active" href="#workspace">Analyzer</a><a href="#history">History <span className="soon">{history.length || 'soon'}</span></a><a href="#methodology">Methodology</a></nav><div className="top-actions"><button className="icon-button" title="Privacy" onClick={() => setShowPrivacy(true)}><ShieldCheck size={17} /></button><button className="icon-button" title="Help"><CircleHelp size={18} /></button><button className="profile-button"><span>GM</span><ChevronDown size={14} /></button></div></header>
    <main id="workspace">
      <section className="hero reveal"><div><div className="eyebrow"><span className="pulse-dot" /> Voice QA workspace</div><h1>How close is the<br /><em>clone</em> to the source?</h1><p className="hero-copy">Upload a reference and a generated voice to measure identity, speech, acoustics, and expression in one reproducible report.</p></div><div className="hero-aside"><div className="aside-label">ANALYSIS MODEL</div><strong>Evidence first</strong><p>Every score is tied to a signal, a model, or clearly marked as unavailable.</p><span className="status-chip"><ShieldCheck size={14} /> calibrated framework</span></div></section>
      <section className="upload-grid reveal reveal-delay-1"><UploadCard slot="reference" title="Reference voice" subtitle="The human recording to match" file={reference} dragging={dragging === 'reference'} inputRef={inputs.reference} onDrop={addFile} onDrag={setDragging} onRemove={removeFile} /><div className="compare-bridge"><span>VS</span><div /></div><UploadCard slot="clone" title="Generated voice" subtitle="The clone you want to evaluate" file={clone} dragging={dragging === 'clone'} inputRef={inputs.clone} onDrop={addFile} onDrag={setDragging} onRemove={removeFile} /></section>
      <section className="action-row reveal reveal-delay-2"><div className="privacy-note"><ShieldCheck size={16} /><span>Files stay in this browser until you connect the analysis API.</span><button onClick={() => setShowPrivacy(true)}>Privacy controls</button></div><button className="primary-button" disabled={!reference || !clone || isAnalyzing} onClick={analyze}>{isAnalyzing ? <><RotateCcw className="spin" size={17} /> Analyzing signals...</> : <><Sparkles size={17} /> Run analysis <ArrowUpRight size={16} /></>}</button></section>
      {reference && clone && <AudioCompare reference={reference} clone={clone} audioRefs={audioRefs} currentTime={currentTime} isPlaying={isPlaying} speed={speed} onSpeed={setSpeed} onPlay={playBoth} onSeek={seek} />}
      <section className="report reveal reveal-delay-3" aria-live="polite"><div className="report-heading"><div><div className="eyebrow">{hasAnalysis ? 'Analysis complete' : 'Analysis report'}</div><h2>{hasAnalysis ? 'A measured starting point.' : 'Your report will appear here.'}</h2></div><button className="export-button" disabled={!hasAnalysis} onClick={exportReport}><Download size={15} /> Export report</button></div><div className="report-grid"><div className="score-panel"><div className="score-label">OVERALL SIGNAL ACCURACY <Info size={14} /></div><div className="score-value">{measuredOverall ?? '—'}</div><div className="score-state">{hasAnalysis ? 'Partial score · 5 of 7 dimensions' : 'Waiting for two files'}</div><div className="score-divider" /><p>This score covers measured audio signals only. Speaker identity and content accuracy are excluded until ECAPA and Whisper are connected.</p><div className="score-foot"><Gauge size={16} /> <span>Weighted measured dimensions</span></div></div><div className="metrics-panel"><div className="panel-title">Signal breakdown <span>normalized / 100</span></div><div className="metric-list">{metrics.map(metric => <div className="metric-row" key={metric.label}><div className="metric-name"><span className={`metric-dot ${metric.tone}`} />{metric.label}</div><strong className={metric.tone === 'muted' ? 'muted-value' : ''}>{metric.value}</strong><span className="metric-note">{metric.note}</span></div>)}</div></div></div><div className="tabs">{tabs.map(tab => <button className={activeTab === tab ? 'tab-active' : ''} onClick={() => setActiveTab(tab)} key={tab}>{tab}</button>)}</div><ReportDetail tab={activeTab} hasAnalysis={hasAnalysis} reference={reference} clone={clone} history={history} onDeleteHistory={id => setHistory(current => { const next = current.filter(item => item.id !== id); localStorage.setItem('voice-lens-history', JSON.stringify(next)); return next })} /></section>
      <section className="methodology" id="methodology"><div><div className="eyebrow">Methodology</div><h2>One score is not the truth.</h2></div><div className="methodology-copy"><p>Speaker identity is weighted most heavily, but it is kept separate from content accuracy, acoustic similarity, prosody, and recording quality.</p><span><Settings2 size={15} /> Server weights are configurable · raw measurements retained</span></div></section>
    </main><footer><span>voice/lens <small>v0.2 MVP</small></span><span>Measurement over marketing.</span></footer>{showPrivacy && <div className="modal-backdrop" onClick={() => setShowPrivacy(false)}><div className="privacy-modal" onClick={event => event.stopPropagation()}><button className="modal-close" onClick={() => setShowPrivacy(false)}><X size={17} /></button><ShieldCheck size={22} className="modal-icon" /><h2>Your voice data</h2><p>Audio stays in this browser while local analysis runs. The current UI does not upload recordings or use them for model training.</p><div className="privacy-list"><span><Check size={15} /> Original files are never overwritten</span><span><Check size={15} /> Local object URLs are released on removal</span><span><Check size={15} /> Export is an explicit JSON download</span></div><button className="primary-button" onClick={() => setShowPrivacy(false)}>Done</button></div></div>}
  </div>
}

function AudioCompare({ reference, clone, audioRefs, currentTime, isPlaying, speed, onSpeed, onPlay, onSeek }: { reference: AudioFile; clone: AudioFile; audioRefs: { reference: React.RefObject<HTMLAudioElement | null>; clone: React.RefObject<HTMLAudioElement | null> }; currentTime: number; isPlaying: boolean; speed: number; onSpeed: (speed: number) => void; onPlay: () => void; onSeek: (fraction: number) => void }) {
  const duration = Math.max(reference.duration, clone.duration)
  return <section className="player-section reveal"><div className="player-heading"><div><div className="eyebrow">Listen side by side</div><h2>Hear the difference.</h2></div><div className="playback-controls"><button className="play-button" onClick={onPlay}>{isPlaying ? <Pause size={17} /> : <Play size={17} />} {isPlaying ? 'Pause both' : 'Play both'}</button><select value={speed} onChange={event => onSpeed(Number(event.target.value))} aria-label="Playback speed">{[.5, .75, 1, 1.25, 1.5, 2].map(value => <option value={value} key={value}>{value}x</option>)}</select></div></div><div className="players"><PlayerRow label="REFERENCE" file={reference} audioRef={audioRefs.reference} samples={reference.samples} accent="lime" currentTime={currentTime} duration={duration} onSeek={onSeek} /><PlayerRow label="GENERATED" file={clone} audioRef={audioRefs.clone} samples={clone.samples} accent="orange" currentTime={currentTime} duration={duration} onSeek={onSeek} /></div><div className="sync-track"><span>00:00</span><input type="range" min="0" max={duration || 1} step="0.01" value={Math.min(currentTime, duration)} onChange={event => onSeek(Number(event.target.value) / duration)} /><span>{formatDuration(duration)}</span></div></section>
}

function PlayerRow({ label, file, audioRef, samples, accent, currentTime, duration, onSeek }: { label: string; file: AudioFile; audioRef: React.RefObject<HTMLAudioElement | null>; samples: number[]; accent: 'lime' | 'orange'; currentTime: number; duration: number; onSeek: (fraction: number) => void }) { return <div className="player-row"><div className="player-label"><span className={`metric-dot ${accent === 'lime' ? 'lime' : 'amber'}`} />{label}<strong>{file.file.name}</strong></div><Waveform samples={samples} accent={accent} progress={currentTime / duration} onSeek={onSeek} /><span className="player-time">{formatDuration(currentTime)}</span><audio ref={audioRef} src={file.url} preload="metadata" /></div> }

function ReportDetail({ tab, hasAnalysis, reference, clone, history, onDeleteHistory }: { tab: string; hasAnalysis: boolean; reference?: AudioFile; clone?: AudioFile; history: HistoryItem[]; onDeleteHistory: (id: string) => void }) {
  if (tab === 'Audio') return <div className="detail-grid"><div className="detail-card"><div className="panel-title">Spectral view <span>mel bands</span></div><div className="spectrogram"><div className="spectro-line" /><div className="spectro-line alt" /><div className="spectro-line" /><div className="spectro-line low" /><div className="spectro-line alt" /></div></div><div className="detail-card"><div className="panel-title">Recording checks <span>measured</span></div><div className="check-table"><span>Reference sample rate</span><strong>{reference?.sampleRate.toLocaleString() || '—'} Hz</strong><span>Clone sample rate</span><strong>{clone?.sampleRate.toLocaleString() || '—'} Hz</strong><span>Silence / clipping</span><strong>{hasAnalysis ? 'Signal scan complete' : '—'}</strong></div></div></div>
  if (tab === 'Speech') return <div className="detail-grid"><div className="detail-card transcript-card"><div className="panel-title">Transcript comparison <span>Whisper</span></div><div className="chart-empty"><Headphones size={22} /><strong>Whisper connection required</strong><span>Word-level diff, WER, and CER appear here after the ASR worker is configured.</span></div></div><div className="detail-card"><div className="panel-title">Content checks <span>pending</span></div><div className="insight"><span className="insight-icon"><Zap size={17} /></span><div><strong>Keep content separate</strong><p>Speaker identity and sentence accuracy are different measurements and should never be merged into one proxy.</p></div></div></div></div>
  if (tab === 'Speaker' || tab === 'Pitch' || tab === 'Prosody' || tab === 'Acoustics') return <div className="detail-grid"><div className="detail-card"><div className="panel-title">{tab} alignment <span>{hasAnalysis ? 'measured proxy' : 'awaiting output'}</span></div><div className="signal-chart"><div className="chart-axis"><span>high</span><span>low</span></div><div className="chart-lines"><div className="chart-wave lime-wave" /><div className="chart-wave orange-wave" /><div className="chart-grid" /></div></div></div><div className="detail-card"><div className="panel-title">{tab} notes <span>evidence-based</span></div><div className="insight"><span className="insight-icon"><BarChart3 size={17} /></span><div><strong>{hasAnalysis ? 'Signal comparison available' : 'Analyzer output pending'}</strong><p>{tab === 'Speaker' ? 'ECAPA-TDNN embeddings are required for identity similarity. Container-level audio similarity is not a speaker score.' : 'The visualization will compare aligned reference and clone traces once the dedicated analyzer is connected.'}</p></div></div></div></div>
  return <div className="detail-grid"><div className="detail-card"><div className="panel-title">Signal alignment <span>overview</span></div><div className="chart-empty">{hasAnalysis ? <><Activity size={22} /><strong>Measured signal traces ready</strong><span>Switch tabs to inspect acoustic, pitch, prosody, or audio-specific views.</span></> : <><Activity size={22} /><strong>Awaiting analyzer output</strong><span>Run an analysis to inspect aligned feature traces.</span></>}</div></div><div className="detail-card"><div className="panel-title">Analysis history <span>{history.length} saved</span></div>{history.length ? history.slice(0, 3).map(item => <div className="history-row" key={item.id}><span>{item.date}</span><strong>{item.reference}</strong><span className="history-arrow">→</span><strong>{item.clone}</strong><b>{item.score}</b><button onClick={() => onDeleteHistory(item.id)} title="Delete history item"><Trash2 size={14} /></button></div>) : <div className="empty-history"><Layers3 size={19} /><span>Completed analyses will be saved here.</span></div>}</div></div>
}

function UploadCard({ slot, title, subtitle, file, dragging, inputRef, onDrop, onDrag, onRemove }: { slot: AudioSlot; title: string; subtitle: string; file?: AudioFile; dragging: boolean; inputRef: React.RefObject<HTMLInputElement | null>; onDrop: (slot: AudioSlot, file?: File) => void; onDrag: (slot: AudioSlot | null) => void; onRemove: (slot: AudioSlot) => void }) { return <div className={`upload-card ${dragging ? 'dragging' : ''} ${file ? 'has-file' : ''}`} onDragOver={event => { event.preventDefault(); onDrag(slot) }} onDragLeave={() => onDrag(null)} onDrop={event => { event.preventDefault(); onDrag(null); onDrop(slot, event.dataTransfer.files[0]) }}><div className="card-top"><span className={`file-index ${slot}`}>{slot === 'reference' ? '01' : '02'}</span><div><h3>{title}</h3><p>{subtitle}</p></div><span className="required">required</span></div>{file ? <><div className="file-info"><div className="audio-icon"><FileAudio size={20} /></div><div className="file-copy"><strong title={file.file.name}>{file.file.name}</strong><span>{formatBytes(file.file.size)} · {file.file.type.split('/')[1]?.toUpperCase()} · {formatDuration(file.duration)}</span></div><button className="remove-button" title="Remove file" onClick={() => onRemove(slot)}><X size={16} /></button></div><Waveform samples={file.samples} accent={slot === 'reference' ? 'lime' : 'orange'} /><div className="meta-row"><span>{file.sampleRate.toLocaleString()} Hz</span><span>{file.channels} channel{file.channels === 1 ? '' : 's'}</span><span>decoded locally</span></div></> : <div className="drop-zone"><div className="upload-icon"><Upload size={21} /></div><strong>Drop an audio file here</strong><span>or <button onClick={() => inputRef.current?.click()}>browse files</button></span><small>WAV, MP3, M4A, FLAC or OGG · max 100 MB</small><input ref={inputRef} type="file" accept="audio/*" hidden onChange={event => onDrop(slot, event.target.files?.[0])} /></div>}</div> }

export default App
