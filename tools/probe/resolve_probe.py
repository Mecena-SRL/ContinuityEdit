"""ContinuityEdit - Fase 0: probe dell'API di DaVinci Resolve (sola lettura).

Uso (macOS, Resolve Studio 21.x):
  1. Copia questo file in:
     ~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility/
  2. Apri un progetto con almeno una clip nel Media Pool (meglio con dialogo parlato,
     gia' trascritta con tasto destro > Transcribe Audio) e una timeline aperta.
  3. Workspace > Scripts > resolve_probe
  4. Invia il file ~/Desktop/continuityedit_probe.json

Per default NON modifica nulla. Con WRITE_TESTS = True aggiunge e rimuove un marker di prova
sulla prima clip del Media Pool.
"""
import json
import os
import traceback

WRITE_TESTS = False
OUT = os.path.expanduser("~/Desktop/continuityedit_probe.json")

report = {"errors": []}


def get_resolve():
    try:
        return resolve  # noqa: F821  (globale iniettata da Resolve)
    except NameError:
        import DaVinciResolveScript as dvr
        return dvr.scriptapp("Resolve")


def methods(obj):
    return sorted(n for n in dir(obj) if not n.startswith("_"))


def safe(label, fn):
    try:
        return fn()
    except Exception as e:  # noqa: BLE001
        report["errors"].append({label: repr(e), "tb": traceback.format_exc()[-400:]})
        return None


def short(v, n=400):
    s = repr(v)
    return s if len(s) <= n else s[:n] + "...<troncato>"


def main():
    r = get_resolve()
    report["product"] = safe("GetProductName", r.GetProductName)
    report["version"] = safe("GetVersionString", r.GetVersionString)
    report["resolve_methods"] = methods(r)

    proj = safe("project", lambda: r.GetProjectManager().GetCurrentProject())
    if not proj:
        report["errors"].append("Nessun progetto aperto")
        return
    report["project_methods"] = methods(proj)
    report["project_name"] = safe("GetName", proj.GetName)

    mp = proj.GetMediaPool()
    report["mediapool_methods"] = methods(mp)

    folder = mp.GetRootFolder()
    report["folder_methods"] = methods(folder)
    clips = safe("GetClipList", folder.GetClipList) or []
    report["root_clip_count"] = len(clips)

    if clips:
        c = clips[0]
        report["mediapoolitem_methods"] = methods(c)
        report["transcription_like_methods"] = [
            m for m in methods(c) if any(k in m.lower() for k in ("transcri", "subtitle", "caption", "text"))
        ]
        report["clip_properties"] = safe("GetClipProperty", lambda: {
            k: short(v, 120) for k, v in (c.GetClipProperty() or {}).items()})
        report["clip_metadata"] = safe("GetMetadata", lambda: {
            k: short(v, 200) for k, v in (c.GetMetadata() or {}).items()})
        report["clip_markers"] = safe("GetMarkers", lambda: short(c.GetMarkers()))
        report["clip_flags"] = safe("GetFlagList", c.GetFlagList)
        # Prova di getter candidati per il testo della trascrizione (nessuna modifica)
        cand = {}
        for name in ("GetTranscription", "GetTranscript", "GetTranscriptionText",
                     "GetTranscriptionStatus", "GetTranscribeStatus", "IsTranscribed"):
            if hasattr(c, name):
                cand[name] = safe(name, lambda n=name: short(getattr(c, n)()))
        report["transcription_getter_results"] = cand

        if WRITE_TESTS:
            ok_add = safe("AddMarker", lambda: c.AddMarker(0, "Blue", "CE-probe", "probe", 1, "ce-probe"))
            report["write_test_add_marker"] = ok_add
            report["write_test_marker_read"] = safe("GetMarkers", lambda: short(c.GetMarkers()))
            report["write_test_delete"] = safe("DeleteMarkerByCustomData",
                                               lambda: c.DeleteMarkerByCustomData("ce-probe"))

    tl = safe("GetCurrentTimeline", proj.GetCurrentTimeline)
    if tl:
        report["timeline_methods"] = methods(tl)
        report["timeline_name"] = safe("GetName", tl.GetName)
        report["timeline_fps"] = safe("GetSetting", lambda: tl.GetSetting("timelineFrameRate"))
        report["timeline_start_frame"] = safe("GetStartFrame", tl.GetStartFrame)
        items = safe("GetItemListInTrack", lambda: tl.GetItemListInTrack("video", 1)) or []
        if items:
            report["timelineitem_methods"] = methods(items[0])
        report["subtitle_track_count"] = safe("GetTrackCount", lambda: tl.GetTrackCount("subtitle"))

    # Costanti di export disponibili (SRT? FCPXML? OTIO?)
    report["export_constants"] = [n for n in dir(r) if n.startswith(("EXPORT_", "SUBTITLE_"))]
    report["render_formats"] = safe("GetRenderFormats", proj.GetRenderFormats)


try:
    main()
except Exception as e:  # noqa: BLE001
    report["errors"].append({"fatal": repr(e), "tb": traceback.format_exc()[-800:]})

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2, ensure_ascii=False, default=str)
print("Probe scritto in", OUT)
