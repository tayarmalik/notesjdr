#!/usr/bin/env python3
import sys
import json
import torch
import os
import subprocess
import tempfile
import zipfile
import re
from faster_whisper import WhisperModel
from pyannote.audio import Pipeline

HF_TOKEN = os.getenv("HF_TOKEN", "")
WHISPER_MODEL = "medium"
NUM_SPEAKERS = int(os.environ.get('NUM_SPEAKERS', '0'))
MIN_SPEAKERS = int(os.environ.get('MIN_SPEAKERS', '2'))
MAX_SPEAKERS = int(os.environ.get('MAX_SPEAKERS', '6'))
CLUSTERING_THRESHOLD = float(os.environ.get('CLUSTERING_THRESHOLD', '0')) or None

def to_wav(audio_path):
    """Convertit en WAV 16kHz mono — utilise un chemin tmp sans créer le fichier."""
    tmp_path = os.path.join(tempfile.gettempdir(), f"jdr_{os.getpid()}_{id(audio_path)}.wav")
    result = subprocess.run([
        "ffmpeg", "-y", "-i", audio_path,
        "-ar", "16000", "-ac", "1",
        
        tmp_path
    ], capture_output=True)
    if result.returncode != 0 or not os.path.exists(tmp_path):
        raise RuntimeError(f"ffmpeg failed: {result.stderr.decode()[-200:]}")
    return tmp_path

def get_speaker_at(diarization, seg_start, seg_end):
    """Trouve le locuteur avec le meilleur chevauchement."""
    best_overlap = 0
    best_speaker = "Inconnu"
    try:
        # Nouvelle API pyannote >= 3.x
        for turn, _, spk in diarization.itertracks(yield_label=True):
            overlap = min(seg_end, turn.end) - max(seg_start, turn.start)
            if overlap > best_overlap:
                best_overlap = overlap
                best_speaker = spk
    except (TypeError, AttributeError):
        try:
            # Ancienne API avec itertracks
            for turn, _, spk in diarization.itertracks(yield_label=True):
                overlap = min(seg_end, turn.end) - max(seg_start, turn.start)
                if overlap > best_overlap:
                    best_overlap = overlap
                    best_speaker = spk
        except:
            pass
    return best_speaker

def transcribe_single(audio_path, speaker_name="Inconnu"):
    """Transcrit un fichier audio pour un seul locuteur (piste Craig)."""
    wav_path = to_wav(audio_path)
    try:
        model = WhisperModel(WHISPER_MODEL, device="cuda" if torch.cuda.is_available() else "cpu")
        segments, _ = model.transcribe(wav_path, language="fr", vad_filter=False,
                                             no_speech_threshold=0.8, beam_size=5,
                                             initial_prompt="Transcription d'une session de jeu de rôle en français. Personnages, sorts, dés, donjons, dragons, aventure, magie.")
        result = []
        HALLUCINATIONS = ["amara", "sous-titres", "abonnez", "merci d'avoir", "générique", "c'est ça"]
        for segment in segments:
            text = segment.text.strip()
            if not text:
                continue
            if any(h in text.lower() for h in HALLUCINATIONS):
                continue
            # Filtrer les segments à faible probabilité (hallucinations)
            if hasattr(segment, 'avg_logprob') and segment.avg_logprob < -2.0:
                continue
            if hasattr(segment, 'no_speech_prob') and segment.no_speech_prob > 0.9:
                continue
            if True:
                result.append({
                    "speaker": speaker_name,
                    "start": round(segment.start, 1),
                    "end": round(segment.end, 1),
                    "text": segment.text.strip()
                })
        return result
    finally:
        try: os.unlink(wav_path)
        except: pass

def transcribe_craig_zip(zip_path):
    """Transcrit un zip Craig — une piste FLAC par joueur Discord."""
    tmpdir = tempfile.mkdtemp()
    try:
        with zipfile.ZipFile(zip_path, 'r') as z:
            z.extractall(tmpdir)

        tracks = []
        for fname in sorted(os.listdir(tmpdir)):
            if fname.endswith(('.flac', '.wav', '.mp3', '.ogg')) and fname != 'raw.dat':
                if fname == 'global_mix.wav':
                    continue  # Ignorer le mix global, utiliser les pistes individuelles
                m = re.match(r'^\d+-(.+)\.(flac|wav|mp3|ogg)$', fname)
                if m:
                    pseudo = m.group(1)
                    tracks.append((os.path.join(tmpdir, fname), pseudo))

        if not tracks:
            return []

        all_segments = []
        for audio_path, pseudo in tracks:
            print(f"Transcription de {pseudo}...", file=sys.stderr)
            segs = transcribe_single(audio_path, speaker_name=pseudo)
            all_segments.extend(segs)

        print("Finalisation des segments...", file=sys.stderr)
        all_segments.sort(key=lambda x: x["start"])
        return all_segments
    finally:
        import shutil
        try: shutil.rmtree(tmpdir)
        except: pass

def transcribe_single_file(audio_path):
    """Transcrit un fichier unique avec diarisation pyannote."""
    wav_path = to_wav(audio_path)
    try:
        print("Diarisation en cours...", file=sys.stderr)
        pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            token=HF_TOKEN
        )
        if torch.cuda.is_available():
            pipeline = pipeline.to(torch.device("cuda"))

        diarize_kwargs = {}
        if NUM_SPEAKERS > 0:
            diarize_kwargs['num_speakers'] = NUM_SPEAKERS
            print(f"Diarisation avec {NUM_SPEAKERS} locuteurs", file=sys.stderr)
        else:
            diarize_kwargs['min_speakers'] = MIN_SPEAKERS
            diarize_kwargs['max_speakers'] = MAX_SPEAKERS

        if CLUSTERING_THRESHOLD is not None:
            try:
                pipeline.segmentation_inference.postprocessing.onset = CLUSTERING_THRESHOLD
                pipeline.segmentation_inference.postprocessing.offset = CLUSTERING_THRESHOLD * 0.9
            except: pass
        diarization = pipeline(wav_path, **diarize_kwargs, batch_size=4).speaker_diarization

        # Afficher les locuteurs détectés
        try:
            speakers = set(spk for _, _, spk in diarization.itertracks(yield_label=True))
        except:
            speakers = set()
        print(f"Locuteurs détectés: {len(speakers)} → {speakers}", file=sys.stderr)

        model = WhisperModel(WHISPER_MODEL, device="cuda" if torch.cuda.is_available() else "cpu")
        segments, _ = model.transcribe(wav_path, language="fr", vad_filter=False,
                                             no_speech_threshold=0.8, beam_size=5,
                                             initial_prompt="Transcription d'une session de jeu de rôle en français. Personnages, sorts, dés, donjons, dragons, aventure, magie.")

        result = []
        for segment in segments:
            if not segment.text.strip():
                continue
            speaker = get_speaker_at(diarization, segment.start, segment.end)
            result.append({
                "speaker": speaker,
                "start": round(segment.start, 1),
                "end": round(segment.end, 1),
                "text": segment.text.strip()
            })
        return result
    finally:
        try: os.unlink(wav_path)
        except: pass

def transcribe(audio_path):
    ext = os.path.splitext(audio_path)[1].lower()
    if ext == '.zip':
        return transcribe_craig_zip(audio_path)
    return transcribe_single_file(audio_path)

if __name__ == "__main__":
    audio_path = sys.argv[1]
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('audio')
    parser.add_argument('num_speakers', nargs='?', type=int, default=0)
    parser.add_argument('--min-speakers', type=int, default=2)
    parser.add_argument('--max-speakers', type=int, default=6)
    parser.add_argument('--threshold', type=float, default=None)
    pargs = parser.parse_args()
    if pargs.num_speakers > 0:
        os.environ['NUM_SPEAKERS'] = str(pargs.num_speakers)
    os.environ['MIN_SPEAKERS'] = str(pargs.min_speakers)
    os.environ['MAX_SPEAKERS'] = str(pargs.max_speakers)
    if pargs.threshold:
        os.environ['CLUSTERING_THRESHOLD'] = str(pargs.threshold)
    results = transcribe(audio_path)
    print(json.dumps(results, ensure_ascii=False))
