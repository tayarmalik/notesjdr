#!/usr/bin/env python3

import discord
from discord import app_commands
from discord.ext import voice_recv
import asyncio
import aiohttp
import os
import io
import wave
import time
import zipfile
import logging
from datetime import datetime
from collections import defaultdict

# ═══════════════════════════════════════
# CONFIG
# ═══════════════════════════════════════

DISCORD_TOKEN  = os.getenv("DISCORD_TOKEN")
GUILD_ID       = 1389170611116314666
VAULTLOG_URL   = "http://localhost:16384"
VAULTLOG_TOKEN = os.getenv("VAULTLOG_TOKEN", "volog_29502c9c1f1242ecb7b6747168fa42fd")

AUDIO_DIR = "/opt/jdrnotes/audio"

os.makedirs(AUDIO_DIR, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)

log = logging.getLogger("bot_craig")


# ═══════════════════════════════════════
# AUDIO SINK
# ═══════════════════════════════════════

class PerUserSink(voice_recv.AudioSink):

    def __init__(self):
        super().__init__()
        self.user_audio = defaultdict(bytearray)
        self.user_names = {}

    def wants_opus(self):
        return False

    def write(self, user, data):

        if user is None:
            return

        pcm = getattr(data, "pcm", None)

        if pcm is None or len(pcm) == 0:
            return

        # Ignorer les paquets entièrement silencieux (DAVE produit du bruit résiduel)
        if max(abs(int.from_bytes(pcm[i:i+2], 'little', signed=True)) for i in range(0, min(64, len(pcm)), 2)) < 100:
            return

        self.user_audio[user.id] += pcm
        self.user_names[user.id] = user.display_name

    def get_all_audio(self):

        result = {}

        for uid, pcm in self.user_audio.items():

            if len(pcm) < 9600:  # Ignorer moins de 0.1s d'audio
                continue

            result[uid] = (
                self.user_names.get(uid, f"user_{uid}"),
                bytes(pcm)
            )

        return result


# ═══════════════════════════════════════
# WAV CONVERSION
# ═══════════════════════════════════════

def pcm_to_wav(pcm_data):

    buf = io.BytesIO()

    with wave.open(buf, "wb") as wf:

        wf.setnchannels(2)       # Discord voice = stéréo (CORRIGÉ : était 1)
        wf.setsampwidth(2)       # 16 bit
        wf.setframerate(48000)   # 48kHz

        wf.writeframes(pcm_data)

    return buf.getvalue()


# ═══════════════════════════════════════
# ZIP CREATION
# ═══════════════════════════════════════

def create_craig_zip(recordings, session_name):

    timestamp = int(time.time() * 1000)

    safe = "".join(
        c if c.isalnum() or c in "-_" else "_"
        for c in session_name
    )

    zip_name = f"{timestamp}-{safe}.zip"
    zip_path = os.path.join(AUDIO_DIR, zip_name)

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:

        for i, (uid, (name, pcm)) in enumerate(recordings.items()):

            safe_name = "".join(
                c if c.isalnum() or c in "-_" else "_"
                for c in name
            )

            wav_data = pcm_to_wav(pcm)

            fname = f"{i+1}-{safe_name}.wav"

            zf.writestr(fname, wav_data)

            log.info(f"Piste {fname} ({len(wav_data)//1024} KB)")

    log.info(f"ZIP créé : {zip_path}")

    return zip_path, zip_name


# ═══════════════════════════════════════
# VAULTLOG
# ═══════════════════════════════════════

async def transcrire_zip(zip_name, campaign_id, titre, num_speakers=0):

    headers = {"x-api-token": VAULTLOG_TOKEN, "Content-Type": "application/json"}
    payload = {"filename": zip_name, "campaign_id": str(campaign_id), "titre": titre}

    if num_speakers > 0:
        payload["num_speakers"] = num_speakers

    async with aiohttp.ClientSession() as http:

        async with http.post(
            f"{VAULTLOG_URL}/api/upload/transcribe",
            json=payload,
            headers=headers
        ) as resp:
            data = await resp.json()

        if not data.get("job_id"):
            raise Exception(f"Pas de job_id: {data}")

        job_id = data["job_id"]

        for _ in range(120):

            await asyncio.sleep(5)

            async with http.get(
                f"{VAULTLOG_URL}/api/upload/job/{job_id}",
                headers=headers
            ) as r:
                job = await r.json()

            if job.get("status") == "done":
                return job.get("session_id")

            elif job.get("status") == "error":
                raise Exception(job.get("error", "Erreur transcription"))

    raise Exception("Timeout transcription")


# ═══════════════════════════════════════
# BOT
# ═══════════════════════════════════════

intents = discord.Intents.default()
intents.voice_states = True
intents.members = True


class CraigBot(discord.Client):

    def __init__(self):
        super().__init__(intents=intents)
        self.tree = app_commands.CommandTree(self)
        self.recording_sessions = {}

    async def setup_hook(self):
        guild = discord.Object(id=GUILD_ID)
        self.tree.copy_global_to(guild=guild)
        await self.tree.sync(guild=guild)
        log.info("Commandes synchronisées")

    async def on_ready(self):
        log.info(f"Bot connecté : {self.user}")


bot = CraigBot()


# ═══════════════════════════════════════
# COMMANDES
# ═══════════════════════════════════════

@bot.tree.command(name="enregistrer", description="Démarrer l'enregistrement")
@app_commands.describe(campaign_id="ID de la campagne VaultLog", titre="Titre de la session")
async def enregistrer(interaction: discord.Interaction, campaign_id: int, titre: str):

    if not interaction.user.voice:
        await interaction.response.send_message("Tu dois être dans un salon vocal.", ephemeral=True)
        return

    if interaction.guild_id in bot.recording_sessions:
        await interaction.response.send_message("⚠️ Enregistrement déjà en cours !", ephemeral=True)
        return

    channel = interaction.user.voice.channel
    vc = await channel.connect(cls=voice_recv.VoiceRecvClient)
    sink = PerUserSink()
    vc.listen(sink)

    bot.recording_sessions[interaction.guild_id] = {
        "vc": vc,
        "sink": sink,
        "campaign_id": campaign_id,
        "titre": titre,
        "start_time": datetime.now()
    }

    await interaction.response.send_message(
        f"🎙️ Enregistrement lancé dans **{channel.name}**\n"
        f"Campagne: `{campaign_id}` — {titre}"
    )


@bot.tree.command(name="stopper", description="Arrêter l'enregistrement et transcrire")
@app_commands.describe(num_speakers="Nombre de joueurs (optionnel, améliore la diarisation)")
async def stopper(interaction: discord.Interaction, num_speakers: int = 0):

    session = bot.recording_sessions.pop(interaction.guild_id, None)

    if not session:
        await interaction.response.send_message("Aucun enregistrement actif.", ephemeral=True)
        return

    await interaction.response.defer()

    vc = session["vc"]
    sink = session["sink"]
    campaign_id = session["campaign_id"]
    titre = session["titre"]
    duration = (datetime.now() - session["start_time"]).seconds

    vc.stop_listening()
    await vc.disconnect()

    recordings = sink.get_all_audio()

    if not recordings:
        await interaction.followup.send("❌ Aucun audio capturé — vérifie que DAVE (chiffrement E2E) est désactivé sur le serveur.")
        return

    joueurs = ", ".join(n for n, _ in recordings.values())
    _, zip_name = create_craig_zip(recordings, titre)

    await interaction.followup.send(
        f"⏳ ZIP créé ({duration//60}min {duration%60}s) — Joueurs: {joueurs}\n"
        f"Transcription en cours..."
    )

    try:
        session_id = await transcrire_zip(zip_name, campaign_id, titre, num_speakers)
        await interaction.channel.send(
            f"✅ **{titre}** transcrite et archivée ! (Session `{session_id}`)"
        )
    except Exception as e:
        log.error(f"Erreur transcription: {e}")
        await interaction.channel.send(
            f"❌ Erreur transcription: {e}\n"
            f"ZIP `{zip_name}` disponible dans VaultLog → Importer audio"
        )


@bot.tree.command(name="statut_rec", description="Voir le statut de l'enregistrement en cours")
async def statut_rec(interaction: discord.Interaction):

    session = bot.recording_sessions.get(interaction.guild_id)

    if not session:
        await interaction.response.send_message("Aucun enregistrement en cours.", ephemeral=True)
        return

    duration = (datetime.now() - session["start_time"]).seconds
    recordings = session["sink"].get_all_audio()
    joueurs = ", ".join(n for n, _ in recordings.values()) or "Silence..."

    await interaction.response.send_message(
        f"🎙️ **{session['titre']}** — {duration//60}min {duration%60}s\n"
        f"Joueurs: {joueurs}",
        ephemeral=True
    )


# ═══════════════════════════════════════
# RECONNEXION AUTO
# ═══════════════════════════════════════

@bot.event
async def on_voice_state_update(member, before, after):

    if member.id != bot.user.id:
        return

    guild_id = member.guild.id

    if guild_id not in bot.recording_sessions:
        return

    if before.channel and not after.channel:
        log.warning("Bot déconnecté pendant enregistrement — reconnexion...")
        session = bot.recording_sessions[guild_id]
        await asyncio.sleep(2)
        try:
            vc = await before.channel.connect(cls=voice_recv.VoiceRecvClient)
            vc.listen(session["sink"])
            session["vc"] = vc
            await session["channel"].send("⚠️ Reconnecté — enregistrement repris.")
        except Exception as e:
            bot.recording_sessions.pop(guild_id, None)
            log.error(f"Reconnexion échouée: {e}")


# ═══════════════════════════════════════
# START
# ═══════════════════════════════════════

if __name__ == "__main__":

    if not DISCORD_TOKEN:
        raise RuntimeError("DISCORD_TOKEN manquant — lance avec: DISCORD_TOKEN=... python3 bot_craig_corrige.py")

    bot.run(DISCORD_TOKEN)
