// Finto Resolve con le stesse firme (tutte async) della API reale. Dati interamente sintetici.
// Frame/marker relativi alla clip; AppendToTimeline con fine esclusa.

const tcOf = (frames, fps) => {
  const p = (v) => String(v).padStart(2, '0');
  const ff = frames % fps;
  const s = Math.floor(frames / fps);
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(ff)}`;
};

export class FakeItem {
  constructor({ id, name, fps = 25, frames = 1000, startTc = '01:00:00:00', transcription = null }) {
    this.id = id; this.name = name; this.fps = fps; this.frames = frames; this.startTc = startTc;
    this.markers = {};
    this.transcription = transcription;
    this.transcribeStatus = 'Inactive';
    this.markInOut = null;
    this.calls = [];
    this.failMarkInOut = false;
  }
  async GetUniqueId() { return this.id; }
  async GetName() { return this.name; }
  async GetClipProperty(k) {
    switch (k) {
      case 'FPS': return String(this.fps);
      case 'Frames': return String(this.frames);
      case 'Duration': return tcOf(this.frames, this.fps);
      case 'Start TC': return this.startTc;
      default: return '';
    }
  }
  async GetMarkers() { return structuredClone(this.markers); }
  async AddMarker(frame, color, name, note, duration, customData) {
    if (this.markers[frame]) return false;
    this.markers[frame] = { color, name, note, duration, customData };
    return true;
  }
  async DeleteMarkerAtFrame(frame) { const had = frame in this.markers; delete this.markers[frame]; return had; }
  async GetTranscription() { return this.transcription; }
  async TranscribeAudio() { this.transcribeStatus = 'InProgress'; return true; }
  async GetTranscribeAudioStatus() { return { JobStatus: this.transcribeStatus }; }
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
  constructor(mpi, start, end, srcStart) { this.mpi = mpi; this.start = start; this.end = end; this.srcStart = srcStart; }
  async GetMediaPoolItem() { return this.mpi; }
  async GetStart() { return this.start; }
  async GetEnd() { return this.end; }
  async GetSourceStartFrame() { return this.srcStart; }
}

export class FakeTimeline {
  constructor(name, fps = 25) { this.name = name; this.fps = fps; this.items = []; this.tc = '01:00:00:00'; this.noTc = false; }
  async GetName() { return this.name; }
  async GetSetting(k) { return k === 'timelineFrameRate' ? String(this.fps) : ''; }
  async GetCurrentTimecode() { if (this.noTc) throw new Error('non supportata'); return this.tc; }
  async GetTrackCount() { return 1; }
  async GetItemListInTrack() { return this.items; }
}

class FakeFolder {
  constructor(items = [], subs = []) { this.items = items; this.subs = subs; }
  async GetClipList() { return this.items; }
  async GetSubFolderList() { return this.subs; }
}

class FakeMediaPool {
  constructor(res) { this.res = res; this.selected = []; this.setSelectedCalls = []; }
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
  async AppendToTimeline(infos) {
    const tl = this.res.currentTimeline;
    this.res.appended.push(structuredClone(infos.map((i) => ({ id: i.mediaPoolItem.id, startFrame: i.startFrame, endFrame: i.endFrame }))));
    let pos = 90000;
    return infos.map((i) => {
      const len = i.endFrame - i.startFrame;
      const it = new FakeTimelineItem(i.mediaPoolItem, pos, pos + len, i.startFrame);
      pos += len;
      tl.items.push(it);
      return it;
    });
  }
  async DeleteTimelines(list) { this.res.timelines = this.res.timelines.filter((t) => !list.includes(t)); return true; }
}

// items: [{id,name,fps,frames,startTc,transcription}]
export function makeFakeResolve({ items = [], projectName = 'Progetto di prova', fps = 25 } = {}) {
  const clips = items.map((i) => new FakeItem(i));
  const res = { root: new FakeFolder([], [new FakeFolder(clips)]), timelines: [], currentTimeline: null, appended: [], fps, clips };
  const mp = new FakeMediaPool(res);
  const project = {
    GetName: async () => projectName,
    GetMediaPool: async () => mp,
    GetCurrentTimeline: async () => res.currentTimeline,
    GetSetting: async () => String(fps),
  };
  const resolve = {
    GetVersionString: async () => '21.2.0.1',
    GetProductName: async () => 'DaVinci Resolve Studio',
    GetCurrentPage: async () => 'edit',
    GetProjectManager: async () => ({ GetCurrentProject: async () => project }),
  };
  return { resolve, mp, res, clips, project };
}

// Trascrizione sintetica nel formato di GetTranscription(): parole con timecode assoluti.
export function syntheticTranscript({ fps = 25, startTc = '01:00:00:00', words = [], startSec = 0 } = {}) {
  const [h, m, s, f] = startTc.split(':').map(Number);
  const base = ((h * 3600 + m * 60 + s) * fps) + f;
  const at = (sec) => tcOf(base + Math.round(sec * fps), fps);
  const ws = words.map((w, i) => ({ start: at(startSec + i * 0.4), end: at(startSec + i * 0.4 + 0.35), text: ` ${w}` }));
  return { language: 'it', segments: [{ start: ws[0].start, end: ws[ws.length - 1].end, text: words.join(' '), words: ws }] };
}
