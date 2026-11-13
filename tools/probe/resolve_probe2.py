"""ContinuityEdit - Fase 0b: trascrizione, marker, timeline.

Uso (stessa cartella Utility del primo probe):
  Esecuzione 1: avvia la trascrizione della prima clip del Media Pool (se non c'e') ed esce.
                Attendi che Resolve finisca (barra di progresso in basso a destra).
  Esecuzione 2: legge la trascrizione e fa i test su marker e timeline.
Output: ~/Desktop/continuityedit_probe2.json e ~/Desktop/continuityedit_transcript.json

I test di scrittura (marker, timeline temporanea "CE-probe") si ripuliscono da soli.
Imposta WRITE_TESTS = False per saltarli.
"""
import json
import os
import traceback

WRITE_TESTS = True
OUT = os.path.expanduser("~/Desktop/continuityedit_probe2.json")
OUT_T = os.path.expanduser("~/Desktop/continuityedit_transcript.json")
report = {"errors": []}


def get_resolve():
    try:
        return resolve  # noqa: F821
    except NameError:
        import DaVinciResolveScript as dvr
        return dvr.scriptapp("Resolve")


def safe(label, fn):
    try:
        return fn()
    except Exception as e:  # noqa: BLE001
        report["errors"].append({label: repr(e), "tb": traceback.format_exc()[-300:]})
        return None


def short(v, n=1500):
    s = repr(v)
    return s if len(s) <= n else s[:n] + "...<troncato>"


def describe(v, depth=0):
    """Struttura sintetica di un valore (tipi e chiavi), per capire il formato."""
    if isinstance(v, dict):
        return {"__type": "dict", "keys": list(v.keys())[:30],
                "sample": {k: describe(x, depth + 1) for k, x in list(v.items())[:5]} if depth < 3 else "..."}
    if isinstance(v, (list, tuple)):
        return {"__type": type(v).__name__, "len": len(v),
                "first": describe(v[0], depth + 1) if v and depth < 3 else None}
    return {"__type": type(v).__name__, "value": short(v, 200)}


def main():
    r = get_resolve()
    proj = r.GetProjectManager().GetCurrentProject()
    mp = proj.GetMediaPool()
    clips = mp.GetRootFolder().GetClipList() or []
    if not clips:
        report["errors"].append("Media Pool vuoto")
        return
    c = clips[0]
    report["clip"] = c.GetName()
    fps = float(c.GetClipProperty("FPS") or 25)
    report["clip_fps"] = fps
    report["clip_start_tc"] = c.GetClipProperty("Start TC")
    report["clip_start_frame_prop"] = c.GetClipProperty("Start")
    report["transcription_property"] = short(c.GetClipProperty("Transcription"))
    report["transcription_status_property"] = short(c.GetClipProperty("Transcription Status"))
    report["project_transcribe_status_noarg"] = safe("GetTranscribeAudioStatus", lambda: short(proj.GetTranscribeAudioStatus()))

    t = safe("GetTranscription", c.GetTranscription)
    report["get_transcription_type"] = type(t).__name__
    if t in (None, "", {}, []):
        ret = safe("TranscribeAudio", c.TranscribeAudio)
        report["transcribe_started_return"] = short(ret)
        report["next_step"] = "Trascrizione avviata. Aspetta che finisca e rilancia lo script."
        return

    report["transcription_structure"] = describe(t)
    report["transcription_preview"] = short(t, 3000)
    with open(OUT_T, "w", encoding="utf-8") as f:
        json.dump(t, f, indent=2, ensure_ascii=False, default=str)

    for name in ("EXPORT_FCPXML_1_10", "EXPORT_FCPXML_1_9", "EXPORT_EDL", "EXPORT_OTIO", "EXPORT_AAF",
                 "EXPORT_TEXT_CSV", "EXPORT_TEXT_TAB", "EXPORT_SRT", "SUBTITLE_SRT"):
        report.setdefault("export_constants", {})[name] = short(getattr(r, name, "MISSING"), 60)

    if not WRITE_TESTS:
        return

    # --- Test marker: unita' dei frame (relativi alla clip o assoluti col TC?) ---
    mk = {}
    mk["add_0"] = safe("AddMarker0", lambda: c.AddMarker(0, "Blue", "CE-a", "n0", 1, "ce-a"))
    mk["add_100"] = safe("AddMarker100", lambda: c.AddMarker(100, "Red", "CE-b", "n100", 5, "ce-b"))
    mk["readback"] = safe("GetMarkers", lambda: short(c.GetMarkers()))
    mk["by_customdata"] = safe("GetMarkerByCustomData", lambda: short(c.GetMarkerByCustomData("ce-b")))
    mk["delete_a"] = safe("DeleteMarkerByCustomData", lambda: c.DeleteMarkerByCustomData("ce-a"))
    mk["delete_b"] = safe("DeleteMarkerByCustomData", lambda: c.DeleteMarkerByCustomData("ce-b"))
    mk["after_cleanup"] = safe("GetMarkers", lambda: short(c.GetMarkers()))
    report["marker_test"] = mk

    # --- Test timeline: AppendToTimeline con in/out e lettura dei risultati ---
    orig = proj.GetCurrentTimeline()
    tl = safe("CreateEmptyTimeline", lambda: mp.CreateEmptyTimeline("CE-probe"))
    if tl:
        res = safe("AppendToTimeline", lambda: mp.AppendToTimeline(
            [{"mediaPoolItem": c, "startFrame": 250, "endFrame": 500}]))
        report["append_result"] = short(res)
        items = safe("GetItemListInTrack", lambda: tl.GetItemListInTrack("video", 1)) or []
        report["timeline_items"] = [{
            "start": safe("GetStart", i.GetStart), "end": safe("GetEnd", i.GetEnd),
            "duration": safe("GetDuration", i.GetDuration),
            "src_start_frame": safe("GetSourceStartFrame", i.GetSourceStartFrame),
            "src_end_frame": safe("GetSourceEndFrame", i.GetSourceEndFrame),
        } for i in items]
        report["tl_start_frame"] = safe("GetStartFrame", tl.GetStartFrame)
        # marker su timeline
        report["tl_marker_add"] = safe("TlAddMarker", lambda: tl.AddMarker(10, "Green", "CE-t", "nt", 1, "ce-t"))
        report["tl_marker_read"] = safe("TlGetMarkers", lambda: short(tl.GetMarkers()))
        if orig:
            safe("SetCurrentTimeline", lambda: proj.SetCurrentTimeline(orig))
        report["tl_cleanup"] = safe("DeleteTimelines", lambda: mp.DeleteTimelines([tl]))


try:
    main()
except Exception as e:  # noqa: BLE001
    report["errors"].append({"fatal": repr(e), "tb": traceback.format_exc()[-600:]})

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2, ensure_ascii=False, default=str)
print("Probe 2 scritto in", OUT, "-", report.get("next_step", "ok"))
