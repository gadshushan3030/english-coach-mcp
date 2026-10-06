"use client";

import { useEffect, useRef, useState } from "react";

const MAX_SECONDS = 60;
const MAX_BYTES = 5 * 1024 * 1024;

type RecorderState = "idle" | "starting" | "recording" | "processing";

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

// Playback is local to this browser tab. Audio is never sent to the server.
export function VoiceRecorder({ prompt }: { prompt?: string }) {
  const [state, setState] = useState<RecorderState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const objectUrl = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(false);
  const busy = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearInterval(timer.current);
      if (recorder.current?.state !== "inactive") recorder.current?.stop();
      stopTracks(stream.current);
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (recorder.current?.state === "recording") {
      setState("processing");
      recorder.current.stop();
    }
    stopTracks(stream.current);
    stream.current = null;
  };

  const start = async () => {
    if (busy.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("הדפדפן לא תומך בהקלטה כאן. אפשר לנסות בדפדפן מעודכן עם חיבור מאובטח.");
      return;
    }
    busy.current = true;
    setState("starting");
    setError(null);
    setSeconds(0);
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
    setAudioUrl(null);

    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) {
        stopTracks(mic);
        busy.current = false;
        return;
      }
      stream.current = mic;
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
      const recording = new MediaRecorder(mic, mimeType ? { mimeType } : undefined);
      recorder.current = recording;
      const chunks: Blob[] = [];
      let bytes = 0;
      let failed = false;
      const startedAt = Date.now();
      recording.ondataavailable = ({ data }) => {
        if (data.size > 0 && bytes + data.size <= MAX_BYTES) {
          chunks.push(data);
          bytes += data.size;
        } else if (bytes + data.size > MAX_BYTES) {
          if (mounted.current) setError("הגענו למגבלת גודל ההקלטה. הקטע שנשמר זמין להאזנה.");
          stop();
        }
      };
      recording.onerror = () => {
        failed = true;
        if (mounted.current) setError("ההקלטה נכשלה. אפשר לנסות שוב.");
        stop();
      };
      recording.onstop = () => {
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
        stopTracks(mic);
        stream.current = null;
        recorder.current = null;
        busy.current = false;
        if (!mounted.current) return;
        if (!failed && chunks.length > 0) {
          const url = URL.createObjectURL(new Blob(chunks, { type: recording.mimeType || chunks[0].type }));
          objectUrl.current = url;
          setAudioUrl(url);
        } else if (!failed) {
          setError("לא נקלט קול. אפשר להקליט שוב ולבדוק שהמיקרופון מחובר.");
        }
        setState("idle");
      };
      recording.start(1000);
      setState("recording");
      timer.current = setInterval(() => {
        if (!mounted.current) return;
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        setSeconds(Math.min(elapsed, MAX_SECONDS));
        if (elapsed >= MAX_SECONDS) stop();
      }, 1000);
    } catch (cause) {
      stopTracks(stream.current);
      stream.current = null;
      recorder.current = null;
      busy.current = false;
      if (!mounted.current) return;
      const name = cause instanceof DOMException ? cause.name : "";
      setError(name === "NotAllowedError" || name === "SecurityError"
        ? "אין הרשאה למיקרופון. אפשר לאפשר אותה בהגדרות הדפדפן ולנסות שוב."
        : name === "NotFoundError"
          ? "לא נמצא מיקרופון מחובר."
          : "לא הצלחנו לפתוח את המיקרופון. אפשר לבדוק שהוא פנוי ולנסות שוב.");
      setState("idle");
    }
  };

  return (
    <div className="surface flex flex-col gap-2 rounded-[14px] p-3.5">
      <p className="text-sm font-semibold">לתרגל בקול</p>
      {prompt && <p dir="ltr" lang="en" className="text-sm">{prompt}</p>}
      <p className="muted text-xs">הקלטה זמנית בדפדפן להאזנה לעצמך, עד דקה. היא נמחקת בהמשך לתרגיל הבא או ברענון. אין העלאה, תמלול או ציון הגייה.</p>
      <div className="flex items-center gap-2">
        {state === "recording" ? (
          <button type="button" className="btn btn-ghost" onClick={stop}>עצירה · {seconds}/{MAX_SECONDS}</button>
        ) : (
          <button type="button" className="btn btn-ghost" disabled={state !== "idle"} onClick={start}>
            {state === "starting" ? "פותחים מיקרופון…" : state === "processing" ? "מכינים להאזנה…" : audioUrl ? "הקלטה חדשה" : "התחלת הקלטה"}
          </button>
        )}
        {state === "recording" && <span role="status" className="text-xs text-warn">מקליטים…</span>}
      </div>
      {error && <p role="alert" className="text-xs text-warn">{error}</p>}
      {audioUrl && <audio aria-label="האזנה להקלטה שלך" className="w-full" src={audioUrl} controls />}
    </div>
  );
}
