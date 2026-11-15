// Finto Resolve con le stesse firme (tutte async) della API reale di Resolve Studio 21.2 (elenco metodi dai probe).
// Dati interamente sintetici. Frame/marker relativi alla clip; AppendToTimeline con fine esclusa e recordFrame
// ASSOLUTO (la timeline parte da 01:00:00:00 = frame 90000 a 25 fps, come verificato sul probe).
// Usato dai test node e dall'harness browser (plugin/dev): niente API di Node.

const tcOf = (frames, fps) => {
  const p = (v) => String(v).padStart(2, '0');
  const ff = frames % fps;
  const s = Math.floor(frames / fps);
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(ff)}`;
};
const framesOf = (tc, fps) => {
  const m = /^(\d+):(\d+):(\d+)[:;](\d+)$/.exec(String(tc));
  return m ? ((+m[1] * 3600 + +m[2] * 60 + +m[3]) * fps) + +m[4] : null;
};
const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));

export class FakeItem {
  constructor({ id, name, fps = 25, frames = 1000, startTc = '01:00:00:00', transcription = null, props = {}, exportFrame = 'ok', metadata = {}, clipColor = '', flags = [] }) {
    this.id = id; this.name = name; this.fps = fps; this.frames = frames; this.startTc = startTc;
    this.markers = {};
    this.transcription = transcription;
    this.transcribeStatus = transcription ? 'Complete' : 'Inactive';
    this.markInOut = null;
    this.calls = [];
    this.failMarkInOut = false;
    this.props = props; // Scene, Shot, Take, 'Camera #', Angle, 'File Path', 'Video Codec'...
    this.metadata = { ...metadata };
    this.clipColor = clipColor;
    this.flags = [...flags];
    this.exportFrame = exportFrame; // 'ok' | 'false' | 'throw' | 'absent' | 'nofile'
    this.exported = [];
    this.pendingTranscription = null; // trascrizione che "arriva" quando il job finisce (harness)
    if (exportFrame === 'absent') this.ExportFrame = undefined;
  }
  async ExportFrame(frame, path) {
    this.calls.push(['ExportFrame', frame, path]);
    if (this.exportFrame === 'throw') throw new Error('firma errata');
    if (this.exportFrame === 'false') return false;
    if (this.exportFrame !== 'nofile') this.exported.push(path);
    return true;
  }
  async GetUniqueId() { return this.id; }
  async GetName() { return this.name; }
  async GetClipProperty(k) {
    switch (k) {
      case 'FPS': return String(this.fps);
      case 'Frames': return String(this.frames);
      case 'Duration': return tcOf(this.frames, this.fps);
      case 'Start TC': return this.startTc;
      case 'Transcription Status': return this.transcription ? 'Transcribed' : '';
      case 'Clip Color': return this.clipColor;
      default: return this.props[k] ?? '';
    }
  }
  async GetMetadata(k) { return k === undefined ? clone(this.metadata) : (this.metadata[k] ?? ''); }
  async SetMetadata(k, v) { if (typeof k === 'object') Object.assign(this.metadata, k); else this.metadata[k] = v; return true; }
  async GetClipColor() { return this.clipColor; }
  async SetClipColor(c) { this.clipColor = c; return true; }
  async ClearClipColor() { this.clipColor = ''; return true; }
  async AddFlag(c) { if (!this.flags.includes(c)) this.flags.push(c); return true; }
  async GetFlagList() { return [...this.flags]; }
  async ClearFlags(c) { this.flags = c === 'All' ? [] : this.flags.filter((x) => x !== c); return true; }
  async GetMarkers() { return clone(this.markers); }
  async AddMarker(frame, color, name, note, duration, customData) {
    if (this.markers[frame]) return false;
    this.markers[frame] = { color, name, note, duration, customData };
    return true;
  }
  async GetMarkerByCustomData(cd) { return clone(Object.values(this.markers).find((m) => m.customData === cd) || {}); }
  async DeleteMarkerByCustomData(cd) {
    if (this.noDeleteByCustomData) return false;
    const e = Object.entries(this.markers).find(([, m]) => m.customData === cd);
    if (!e) return false;
    delete this.markers[e[0]]; return true;
  }
  async DeleteMarkerAtFrame(frame) { const had = frame in this.markers; delete this.markers[frame]; return had; }
  async GetTranscription() { return clone(this.transcription); }
  async TranscribeAudio() { if (this.noAudio) return false; this.transcribeStatus = 'InProgress'; return true; }
  // il job di trascrizione finisce (test/harness)
  finishTranscription(t = this.pendingTranscription) { this.transcription = t; this.transcribeStatus = 'Complete'; }
  async SetMarkInOut(i, o, type = 'all') {
    this.calls.push(['SetMarkInOut', i, o, type]);
    if (this.failMarkInOut) throw new Error('boom');
    this.markInOut = { in: i, out: o, type };
    return true;
  }
  async GetMarkInOut() { return this.markInOut ? { video: { in: this.markInOut.in, out: this.markInOut.out } } : {}; }
  async ClearMarkInOut() { this.markInOut = null; return true; }
}

export class FakeTimelineItem {
  constructor(mpi, start, end, srcStart, { track = 1, type = 'video' } = {}) {
    this.mpi = mpi; this.start = start; this.end = end; this.srcStart = srcStart; this.track = track; this.type = type;
  }
  async GetMediaPoolItem() { return this.mpi; }
  async GetStart() { return this.start; }
  async GetEnd() { return this.end; }
  async GetDuration() { return this.end - this.start; }
  async GetSourceStartFrame() { return this.srcStart; }
  async GetSourceEndFrame() { return this.srcStart + (this.end - this.start); }
  async GetName() { return this.mpi?.name ?? ''; }
}

export class FakeTimeline {
  constructor(name, fps = 25, startFrame = 90000) {
    this.name = name; this.fps = fps; this.startFrame = startFrame; this.items = []; this.tc = tcOf(startFrame, fps); this.noTc = false;
    this.tracks = { video: 1, audio: 1, subtitle: 0 }; this.noAddTrack = false; this.markers = {}; this.dropFrame = false;
  }
  async AddTrack(type) { if (this.noAddTrack) return false; if (!(type in this.tracks)) return false; this.tracks[type]++; return true; }
  async GetName() { return this.name; }
  async GetSetting(k) {
    if (k === 'timelineFrameRate') return String(this.fps);
    if (k === 'timelineDropFrameTimecode') return this.dropFrame ? '1' : '0';
    return '';
  }
  async GetStartFrame() { return this.startFrame; }
  async GetStartTimecode() { return tcOf(this.startFrame, this.fps); }
  async GetEndFrame() { return Math.max(this.startFrame, ...this.items.map((i) => i.end)); }
  async GetCurrentTimecode() { if (this.noTc) throw new Error('non supportata'); return this.tc; }
  async SetCurrentTimecode(tc) { if (this.noTc || framesOf(tc, this.fps) === null) return false; this.tc = tc; return true; }
  async GetTrackCount(type = 'video') { return this.tracks[type] ?? 0; }
  async GetItemListInTrack(type = 'video', index = 1) { return this.items.filter((i) => i.type === type && i.track === index); }
  async GetCurrentVideoItem() {
    const f = framesOf(this.tc, this.fps);
    return this.items.filter((i) => i.type === 'video' && f >= i.start && f < i.end).sort((a, b) => b.track - a.track)[0] ?? null;
  }
  async AddMarker(frame, color, name, note, duration, customData) {
    if (this.markers[frame]) return false;
    this.markers[frame] = { color, name, note, duration, customData };
    return true;
  }
  async GetMarkers() { return clone(this.markers); }
  async DeleteMarkerByCustomData(cd) {
    const e = Object.entries(this.markers).find(([, m]) => m.customData === cd);
    if (!e) return false;
    delete this.markers[e[0]]; return true;
  }
}

class FakeFolder {
  constructor(items = [], subs = [], name = undefined) { this.items = items; this.subs = subs; this.name = name; if (name === undefined) this.GetName = undefined; }
  async GetName() { return this.name; }
  async GetClipList() { return this.items; }
  async GetSubFolderList() { return this.subs; }
  async TranscribeAudio() { for (const i of this.items) await i.TranscribeAudio(); return true; }
}

class FakeMediaPool {
  constructor(res) { this.res = res; this.selected = []; this.setSelectedCalls = []; this.imported = []; }
  async GetRootFolder() { return this.res.root; }
  async GetCurrentFolder() { return this.res.root; }
  async GetSelectedClips() { return this.selected; }
  async SetSelectedClip(item) { this.setSelectedCalls.push(item.id); this.selected = [item]; return true; }
  async CreateEmptyTimeline(name) {
    if (this.res.timelines.some((t) => t.name === name)) return null;
    const tl = new FakeTimeline(name, this.res.fps);
    this.res.timelines.push(tl);
    this.res.currentTimeline = tl;
    return tl;
  }
  async ImportMedia(paths) { this.imported.push(...paths); return this.res.importMediaOk ? paths.map((p) => ({ path: p })) : []; }
  async AppendToTimeline(infos) {
    const tl = this.res.currentTimeline;
    if (this.res.failAppend || !tl) return false;
    // i campi trackIndex/recordFrame/mediaType compaiono solo se passati (i test confrontano oggetti esatti)
    this.res.appended.push(clone(infos.map((i) => {
      const o = { id: i.mediaPoolItem.id, startFrame: i.startFrame, endFrame: i.endFrame };
      for (const k of ['trackIndex', 'recordFrame', 'mediaType']) if (i[k] !== undefined) o[k] = i[k];
      return o;
    })));
    const out = [];
    for (const i of infos) {
      if (this.res.failLinked && i.mediaType === undefined && i.recordFrame !== undefined) continue;
      const len = i.endFrame - i.startFrame;
      const track = i.trackIndex ?? 1;
      const types = i.mediaType === 1 ? ['video'] : i.mediaType === 2 ? ['audio'] : ['video', 'audio'];
      const endOf = (type) => Math.max(tl.startFrame, ...tl.items.filter((x) => x.type === type && x.track === track).map((x) => x.end));
      const at = i.recordFrame ?? endOf(types[0]);
      for (const type of types) {
        const it = new FakeTimelineItem(i.mediaPoolItem, at, at + len, i.startFrame, { track, type });
        tl.items.push(it);
        if (type === types[0]) out.push(it);
      }
    }
    return out;
  }
  async DeleteTimelines(list) { this.res.timelines = this.res.timelines.filter((t) => !list.includes(t)); if (list.includes(this.res.currentTimeline)) this.res.currentTimeline = null; return true; }
}

// items: [{id,name,fps,frames,startTc,transcription,props,exportFrame}]
// bins (alternativo a items): [{name, items:[...], subs:[bin...]}] -> Media Pool con bin annidati con nome.
export function makeFakeResolve({ items = [], bins = null, projectName = 'Progetto di prova', projectId = 'P1', fps = 25 } = {}) {
  const clips = items.map((i) => new FakeItem(i));
  let root;
  if (bins) {
    const build = (b) => {
      const its = (b.items || []).map((i) => new FakeItem(i));
      clips.push(...its);
      return new FakeFolder(its, (b.subs || []).map(build), b.name);
    };
    root = new FakeFolder([], bins.map(build), 'Master');
  } else root = new FakeFolder([], [new FakeFolder(clips)]);
  const res = { root, timelines: [], currentTimeline: null, appended: [], fps, clips, failAppend: false, importMediaOk: false };
  const mp = new FakeMediaPool(res);
  const project = {
    name: projectName,
    id: projectId,
    GetName: async () => project.name,
    GetUniqueId: async () => project.id,
    GetMediaPool: async () => mp,
    GetCurrentTimeline: async () => res.currentTimeline,
    GetTimelineCount: async () => res.timelines.length,
    GetTimelineByIndex: async (i) => res.timelines[i - 1] ?? null,
    SetCurrentTimeline: async (tl) => { if (!res.timelines.includes(tl)) return false; res.currentTimeline = tl; return true; },
    GetSetting: async () => String(fps),
    // Verificato su 21.2: lo stato della trascrizione e' del progetto ({JobStatus}), non della clip.
    GetTranscribeAudioStatus: async () => {
      const st = clips.map((c) => c.transcribeStatus);
      return { JobStatus: st.includes('InProgress') ? 'InProgress' : st.includes('Complete') ? 'Complete' : 'Inactive' };
    },
  };
  const resolve = {
    page: 'edit',
    GetVersionString: async () => '21.2.0.1',
    GetProductName: async () => 'DaVinci Resolve Studio',
    GetCurrentPage: async () => resolve.page,
    GetProjectManager: async () => ({ GetCurrentProject: async () => project }),
  };
  return { resolve, mp, res, clips, project };
}

// Trascrizione sintetica nel formato di GetTranscription(): parole con timecode assoluti.
export function syntheticTranscript({ fps = 25, startTc = '01:00:00:00', words = [], startSec = 0, step = 0.4 } = {}) {
  const [h, m, s, f] = startTc.split(':').map(Number);
  const base = ((h * 3600 + m * 60 + s) * fps) + f;
  const at = (sec) => tcOf(base + Math.round(sec * fps), fps);
  const ws = words.map((w, i) => ({ start: at(startSec + i * step), end: at(startSec + i * step + step * 0.9), text: ` ${w}` }));
  return { language: 'it', segments: [{ start: ws[0].start, end: ws[ws.length - 1].end, text: words.join(' '), words: ws }] };
}

export { tcOf as fakeTc };
