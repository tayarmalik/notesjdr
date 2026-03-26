#!/usr/bin/env python3

import discord
from discord import app_commands
from discord.ext import voice_recv
import asyncio
import aiohttp
import os
import tempfile
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
GUILD_ID       = 1072616290897891378
VAULTLOG_URL   = "https://jdrnotes.duckdns.org:16384"
VAULTLOG_TOKEN = os.getenv("VAULTLOG_TOKEN", "volog_a7abc834e0028a1657465827ed304ffc")

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
        self.user_names = {}
        self.user_files = {}
        self.tmpdir = tempfile.mkdtemp(prefix="vault_rec_")
        self.global_file = open(os.path.join(self.tmpdir, "global.pcm"), "wb")
        self.packet_count = 0  # Compteur global de paquets pour la sync
        self.user_packet_start = {}  # uid -> packet_count au début de la piste
        log.info("PerUserSink: tmpdir=%s", self.tmpdir)
    def cleanup(self):
        for f in self.user_files.values():
            try: f.close()
            except: pass
        try: self.global_file.close()
        except: pass
    def wants_opus(self):
        return False
    def write(self, user, data):
        if user is None:
            return
        pcm = getattr(data, "pcm", None)
        if pcm is None or len(pcm) == 0:
            return
        uid = user.id
        is_silent = max(abs(int.from_bytes(pcm[i:i+2], "little", signed=True)) for i in range(0, min(64, len(pcm)), 2)) < 100
        self.packet_count += 1
        if uid not in self.user_files:
            if is_silent:
                return  # Pas encore commencé à parler
            path = os.path.join(self.tmpdir, f"{uid}.pcm")
            self.user_files[uid] = open(path, "wb")
            self.user_names[uid] = user.display_name
            self.user_packet_start[uid] = self.packet_count
            # Combler le retard avec des zéros
            delay_packets = self.packet_count - 1
            if delay_packets > 0:
                self.user_files[uid].write(b'\x00' * (len(pcm) * delay_packets))
                log.info(f"Sync: {delay_packets} paquets de silence ajoutés pour {user.display_name}")
        # Ecrire silence ou audio (pour garder la sync)
        if is_silent:
            self.user_files[uid].write(b'\x00' * len(pcm))
        else:
            self.user_files[uid].write(pcm)
        # Ecrire dans le fichier global
        try: self.global_file.write(pcm)
        except: pass
    def get_all_audio(self):
        # Flush et fermer le fichier global
        try:
            if not self.global_file.closed:
                self.global_file.flush()
                self.global_file.close()
        except: pass
        result = {}
        for uid, f in self.user_files.items():
            try:
                if not f.closed:
                    f.flush()
                    f.close()
            except Exception:
                pass
            path = os.path.join(self.tmpdir, f"{uid}.pcm")
            if not os.path.exists(path):
                continue
            size = os.path.getsize(path)
            if size < 9600:
                continue
            with open(path, "rb") as pf:
                pcm = pf.read()
            result[uid] = (self.user_names.get(uid, f"user_{uid}"), pcm)
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

    # Marquer pour suppression dans 48h
    with open(zip_path + '.expiry', 'w') as ef:
        ef.write(str(int(time.time() * 1000) + 48*60*60*1000))
    return zip_path, zip_name


# ═══════════════════════════════════════
# VAULTLOG
# ═══════════════════════════════════════

async def get_discord_mappings(campaign_id):
    headers = {"x-api-token": VAULTLOG_TOKEN}
    try:
        async with aiohttp.ClientSession() as http:
            async with http.get(
                f"{VAULTLOG_URL}/api/characters/campaign/{campaign_id}/discord-mappings",
                headers=headers
            ) as resp:
                chars = await resp.json()
        mappings = {ch["discord_id"]: ch["name"] for ch in chars if ch.get("discord_id") and ch.get("name")}
        log.info("Mappings Discord: %s", mappings)
        return mappings
    except Exception as e:
        log.warning("Impossible de recuperer les mappings: %s", e)
        return {}


async def transcrire_zip(zip_name, campaign_id, titre, num_speakers=0):

    headers = {"x-api-token": VAULTLOG_TOKEN, "Content-Type": "application/json"}
    payload = {"filename": zip_name, "campaign_id": str(campaign_id), "titre": titre}

    mappings = await get_discord_mappings(campaign_id)
    if mappings:
        payload["speaker_mappings"] = mappings

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

        for i in range(1440):  # 1440 × 5s = 120 minutes max

            await asyncio.sleep(5)

            async with http.get(
                f"{VAULTLOG_URL}/api/upload/job/{job_id}",
                headers=headers,
                ssl=False
            ) as r:
                job = await r.json()

            if job.get("status") == "done":
                return job.get("session_id")

            elif job.get("status") == "error":
                raise Exception(job.get("error", "Erreur transcription"))
            # Mise à jour toutes les 5 minutes
            if i > 0 and i % 60 == 0:
                mins = (i * 5) // 60
                log.info(f"Transcription en cours... {mins} min")

    raise Exception("Timeout transcription (120 min)")


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

    channel = interaction.user.voice.channel
    if not channel:
        await interaction.response.send_message("❌ Tu n'es pas dans un channel vocal.", ephemeral=True)
        return
    session_key = (interaction.guild_id, channel.id)
    if session_key in bot.recording_sessions:
        await interaction.response.send_message("⚠️ Enregistrement déjà en cours !", ephemeral=True)
        return

    vc = await channel.connect(cls=voice_recv.VoiceRecvClient)
    log.info("VoiceRecvClient connecté: %s, listening=%s", vc, getattr(vc, 'listening', '?'))
    sink = PerUserSink()
    vc.listen(sink)

    bot.recording_sessions[session_key] = {
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

    channel = interaction.user.voice.channel
    if not channel:
        await interaction.response.send_message("❌ Tu n'es pas dans un channel vocal.", ephemeral=True)
        return
    session_key = (interaction.guild_id, channel.id)
    session = bot.recording_sessions.pop(session_key, None)

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
        url = f"{VAULTLOG_URL.replace('localhost', 'jdrnotes.duckdns.org')}/#session-{session_id}"
        await interaction.channel.send(
            f"✅ **{titre}** transcrite et archivée !\n"
            f"🔗 {url}"
        )
    except Exception as e:
        log.error(f"Erreur transcription: {e}")
        await interaction.channel.send(
            f"❌ Erreur transcription: {e}\n"
            f"ZIP `{zip_name}` disponible dans VaultLog → Importer audio"
        )


@bot.tree.command(name="statut_rec", description="Voir le statut de l'enregistrement en cours")
async def statut_rec(interaction: discord.Interaction):

    channel = interaction.user.voice.channel
    session_key = (interaction.guild_id, channel.id) if channel else None
    session = bot.recording_sessions.get(session_key) if session_key else None

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
# COMMANDES LECTURE
# ═══════════════════════════════════════
@bot.tree.command(name="resume", description="Afficher le résumé de la dernière session")
@app_commands.describe(campaign_id="ID de la campagne (optionnel)")
async def resume(interaction: discord.Interaction, campaign_id: int = None):
    await interaction.response.defer(ephemeral=True)
    headers = {"x-api-token": VAULTLOG_TOKEN}
    async with aiohttp.ClientSession() as http:
        # Récupérer les campagnes si pas d'ID
        if not campaign_id:
            async with http.get(f"{VAULTLOG_URL}/api/campaigns", headers=headers, ssl=False) as r:
                campaigns = await r.json()
            if not campaigns:
                await interaction.followup.send("❌ Aucune campagne trouvée.")
                return
            campaign_id = campaigns[0]["id"]
            campaign_name = campaigns[0]["title"]
        # Récupérer la dernière session
        async with http.get(f"{VAULTLOG_URL}/api/sessions/campaign/{campaign_id}", headers=headers, ssl=False) as r:
            sessions = await r.json()
        if not sessions:
            await interaction.followup.send("❌ Aucune session trouvée.")
            return
        last = sessions[0]
        summary = last.get("summary") or last.get("narrative") or "Aucun résumé disponible."
        if len(summary) > 1900:
            summary = summary[:1900] + "..."
        url = f"https://jdrnotes.duckdns.org:16384/#session-{last['id']}"
        await interaction.followup.send(
            f"📖 **{last['title']}** (Session #{last['number']})" + "\n\n" + summary + "\n\n🔗 " + url
        )

@bot.tree.command(name="quetes", description="Voir les quêtes actives de la campagne")
@app_commands.describe(campaign_id="ID de la campagne (optionnel)")
async def quetes(interaction: discord.Interaction, campaign_id: int = None):
    await interaction.response.defer(ephemeral=True)
    headers = {"x-api-token": VAULTLOG_TOKEN}
    async with aiohttp.ClientSession() as http:
        if not campaign_id:
            async with http.get(f"{VAULTLOG_URL}/api/campaigns", headers=headers, ssl=False) as r:
                campaigns = await r.json()
            if not campaigns:
                await interaction.followup.send("❌ Aucune campagne trouvée.")
                return
            campaign_id = campaigns[0]["id"]
        async with http.get(f"{VAULTLOG_URL}/api/quests/campaign/{campaign_id}", headers=headers, ssl=False) as r:
            quests = await r.json()
    actives = [q for q in quests if q.get("status") == "active"]
    if not actives:
        await interaction.followup.send("✅ Aucune quête active en cours.")
        return
    lines = ["⚔️ **Quêtes actives**"]
    for q in actives[:10]:
        lines.append(f"• **{q['title']}** — {q.get('description', '')[:80]}")
    await interaction.followup.send("\n".join(lines))

@bot.tree.command(name="planning", description="Voir et voter pour le prochain sondage de planning")
@app_commands.describe(campaign_id="ID de la campagne (optionnel)")
async def planning(interaction: discord.Interaction, campaign_id: int = None):
    await interaction.response.defer(ephemeral=True)
    headers = {"x-api-token": VAULTLOG_TOKEN}
    async with aiohttp.ClientSession() as http:
        if not campaign_id:
            async with http.get(f"{VAULTLOG_URL}/api/campaigns", headers=headers, ssl=False) as r:
                campaigns = await r.json()
            if not campaigns:
                await interaction.followup.send("❌ Aucune campagne trouvée.")
                return
            campaign_id = campaigns[0]["id"]
        async with http.get(f"{VAULTLOG_URL}/api/planning/campaign/{campaign_id}", headers=headers, ssl=False) as r:
            plannings = await r.json()
    if not plannings:
        await interaction.followup.send("📅 Aucun sondage de planning en cours.")
        return
    last = plannings[0]
    url = f"https://jdrnotes.duckdns.org:16384/#planning"
    lines = [f"📅 **{last['title']}**"]
    for d in last.get("dates", [])[:8]:
        lines.append(f"• {d['date']}")
    lines.append("\n🔗 Vote ici : " + url)
    await interaction.followup.send("\n".join(lines))

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
        session = bot.recording_sessions[session_key]
        await asyncio.sleep(2)
        try:
            vc = await before.channel.connect(cls=voice_recv.VoiceRecvClient)
            vc.listen(session["sink"])
            session["vc"] = vc
            await session["channel"].send("⚠️ Reconnecté — enregistrement repris.")
        except Exception as e:
            bot.recording_sessions.pop(session_key, None)
            log.error(f"Reconnexion échouée: {e}")


# ═══════════════════════════════════════
# START
# ═══════════════════════════════════════

if __name__ == "__main__":

    if not DISCORD_TOKEN:
        raise RuntimeError("DISCORD_TOKEN manquant — lance avec: DISCORD_TOKEN=... python3 bot_craig_corrige.py")

    bot.run(DISCORD_TOKEN)
