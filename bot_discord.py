#!/usr/bin/env python3
"""
Bot Discord — Notes JDR
Commandes : /campagnes /session /resumer /demander /transcrire /rejoindre /quitter
"""

import discord
import aiohttp
import asyncio
import tempfile
import os
import json
from datetime import date

# ═══════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
GUILD_ID          = 1389170611116314666
VAULTLOG_URL      = "http://localhost:16384"
VAULTLOG_TOKEN    = "volog_29502c9c1f1242ecb7b6747168fa42fd"
TRANSCRIBE_SCRIPT = "/opt/jdrnotes/transcribe.py"
RECORDINGS_DIR    = "/opt/jdrnotes/recordings"
PYTHON_PATH       = os.path.expanduser("~/.pyenv/versions/3.11.10/bin/python3")

HEADERS = {
    "Content-Type": "application/json",
    "x-api-token": VAULTLOG_TOKEN
}

os.makedirs(RECORDINGS_DIR, exist_ok=True)

# ═══════════════════════════════════════════════
# BOT SETUP
# ═══════════════════════════════════════════════
intents = discord.Intents.default()
intents.message_content = True
intents.members = True
intents.voice_states = True
bot = discord.Bot(intents=intents)

active_recordings = {}

# ═══════════════════════════════════════════════
# HEARTBEAT — maintient la connexion vocale active
# ═══════════════════════════════════════════════
async def audio_heartbeat(vc, guild_id):
    """Envoie un paquet silencieux toutes les 5s pour maintenir la connexion."""
    while guild_id in active_recordings:
        try:
            if vc.is_connected():
                vc.send_audio_packet(b'\xf8\xff\xfe', encode=False)
        except:
            pass
        await asyncio.sleep(5)

async def keepalive(vc, guild_id, channel):
    """Vérifie toutes les 30s que le bot est encore connecté."""
    while guild_id in active_recordings:
        await asyncio.sleep(30)
        if guild_id in active_recordings:
            if not vc.is_connected():
                await channel.send(embed=make_embed(
                    "⚠️ Déconnexion détectée",
                    "Le bot a été déconnecté. Relancez `/rejoindre`.",
                    0xc9a84c
                ))
                active_recordings.pop(guild_id, None)
                break

# ═══════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════
async def api_get(path):
    async with aiohttp.ClientSession() as s:
        async with s.get(f"{VAULTLOG_URL}/api{path}", headers=HEADERS) as r:
            return await r.json()

async def api_post(path, data):
    async with aiohttp.ClientSession() as s:
        async with s.post(f"{VAULTLOG_URL}/api{path}", headers=HEADERS, json=data) as r:
            return await r.json()

def make_embed(title, description="", color=0x2e7d4f):
    embed = discord.Embed(title=title, description=description, color=color)
    embed.set_footer(text="Notes JDR • Archives de vos aventures")
    return embed

# ═══════════════════════════════════════════════
# TRANSCRIPTION
# ═══════════════════════════════════════════════
async def transcribe_audio(audio_path):
    try:
        proc = await asyncio.create_subprocess_exec(
            PYTHON_PATH, "-c",
            f"""
from faster_whisper import WhisperModel
import json
model = WhisperModel("small", device="cpu")
segments, _ = model.transcribe("{audio_path}", language="fr")
result = [s.text.strip() for s in segments]
print(json.dumps(result, ensure_ascii=False))
""",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=300)
        lines = json.loads(stdout.decode())
        return " ".join(lines)
    except Exception as e:
        return f"[Erreur transcription: {e}]"

async def process_recording(sink, channel, campaign_id, titre):
    await channel.send(embed=make_embed(
        "🎙️ Traitement en cours...",
        f"Transcription de **{len(sink.audio_data)}** participant(s)...\nCela peut prendre quelques minutes."
    ))

    transcriptions = []

    for user_id, audio in sink.audio_data.items():
        member = channel.guild.get_member(user_id)
        username = member.display_name if member else f"Joueur_{user_id}"

        tmp_path = os.path.join(RECORDINGS_DIR, f"{user_id}_{int(asyncio.get_event_loop().time())}.wav")
        with open(tmp_path, "wb") as f:
            f.write(audio.file.getvalue())

        await channel.send(f"🔄 Transcription de **{username}**...")
        text = await transcribe_audio(tmp_path)

        try:
            os.unlink(tmp_path)
        except:
            pass

        if text and not text.startswith("[Erreur"):
            transcriptions.append((username, text))

    if not transcriptions:
        await channel.send(embed=make_embed(
            "⚠️ Aucune parole détectée",
            "Vérifiez que les participants ont bien parlé pendant l'enregistrement.",
            0xc9a84c
        ))
        return

    full_text = "\n\n".join([f"[{username}]\n{text}" for username, text in transcriptions])

    result = await api_post(f"/sessions/campaign/{campaign_id}", {
        "title": titre,
        "date": date.today().isoformat(),
        "raw_notes": full_text
    })

    session_id = result.get("id")
    preview = full_text[:500] + "..." if len(full_text) > 500 else full_text

    embed = make_embed("✅ Session enregistrée !", color=0x2e7d4f)
    embed.add_field(name="📋 Session créée", value=f"**{titre}** (ID: `{session_id}`)", inline=False)
    embed.add_field(name="👥 Participants", value="\n".join([f"• **{u}**" for u, _ in transcriptions]), inline=False)
    embed.add_field(name="🎙️ Aperçu", value=f"```{preview}```", inline=False)
    embed.add_field(name="💡 Suite", value=f"Utilisez `/resumer {session_id}` pour générer un résumé IA !", inline=False)
    await channel.send(embed=embed)

# ═══════════════════════════════════════════════
# EVENTS
# ═══════════════════════════════════════════════
@bot.event
async def on_ready():
    print(f"✅ Bot connecté : {bot.user}")
    await bot.change_presence(activity=discord.Activity(
        type=discord.ActivityType.watching,
        name="vos aventures 📜"
    ))

@bot.event
async def on_voice_state_update(member, before, after):
    """Détecte si le bot est déconnecté du vocal et tente de se reconnecter."""
    if member.id != bot.user.id:
        return
    # Le bot vient d'être déconnecté
    if before.channel is not None and after.channel is None:
        guild_id = before.channel.guild.id
        if guild_id in active_recordings:
            rec = active_recordings[guild_id]
            channel = rec["channel"]
            voice_channel = before.channel
            campaign_id = rec["campaign_id"]
            titre = rec["titre"]
            print(f"⚠️ Déconnexion détectée, reconnexion dans {voice_channel.name}...")
            await asyncio.sleep(2)
            try:
                vc = await voice_channel.connect()
                await asyncio.sleep(1)

                def finished_callback(sink, ch, *args):
                    asyncio.ensure_future(process_recording(sink, ch, campaign_id, titre))

                vc.start_recording(
                    discord.sinks.WaveSink(),
                    finished_callback,
                    channel
                )
                active_recordings[guild_id]["vc"] = vc
                asyncio.ensure_future(audio_heartbeat(vc, guild_id))
                await channel.send(embed=make_embed(
                    "🔄 Reconnexion automatique",
                    f"Le bot a été déconnecté et s'est reconnecté à **{voice_channel.name}**.\nL'enregistrement continue.",
                    0xc9a84c
                ))
            except Exception as e:
                active_recordings.pop(guild_id, None)
                await channel.send(embed=make_embed(
                    "❌ Reconnexion impossible",
                    f"Erreur : {e}\nRelancez `/rejoindre` manuellement.",
                    0xc04040
                ))

# ═══════════════════════════════════════════════
# /campagnes
# ═══════════════════════════════════════════════
@bot.slash_command(guild_ids=[GUILD_ID], name="campagnes", description="Voir toutes vos campagnes")
async def campagnes(ctx: discord.ApplicationContext):
    await ctx.defer()
    try:
        data = await api_get("/campaigns")
        if not isinstance(data, list) or not data:
            await ctx.respond(embed=make_embed("📜 Campagnes", "Aucune campagne trouvée."))
            return
        embed = make_embed("⚔️ Vos campagnes")
        for c in data[:10]:
            sessions = c.get("session_count", 0)
            embed.add_field(
                name=f"[{c['id']}] {c['title']}",
                value=f"🎲 {c['system']} • 📋 {sessions} session{'s' if sessions > 1 else ''}",
                inline=False
            )
        embed.set_footer(text="Utilisez l'ID entre crochets pour les autres commandes")
        await ctx.respond(embed=embed)
    except Exception as e:
        await ctx.respond(embed=make_embed("❌ Erreur", str(e), 0xc04040))

# ═══════════════════════════════════════════════
# /session
# ═══════════════════════════════════════════════
@bot.slash_command(guild_ids=[GUILD_ID], name="session", description="Ajouter une session à une campagne")
async def session(
    ctx: discord.ApplicationContext,
    campaign_id: discord.Option(int, "ID de la campagne (voir /campagnes)"),
    titre: discord.Option(str, "Titre de la session"),
    notes: discord.Option(str, "Notes brutes de la session")
):
    await ctx.defer()
    try:
        result = await api_post(f"/sessions/campaign/{campaign_id}", {
            "title": titre,
            "date": date.today().isoformat(),
            "raw_notes": notes
        })
        if "id" in result:
            await ctx.respond(embed=make_embed(
                "✅ Session ajoutée !",
                f"**{titre}**\nSession #{result['number']} créée.\n\nUtilisez `/resumer {result['id']}` pour générer un résumé IA.",
                0x2e7d4f
            ))
        else:
            await ctx.respond(embed=make_embed("❌ Erreur", result.get("error", "Erreur inconnue"), 0xc04040))
    except Exception as e:
        await ctx.respond(embed=make_embed("❌ Erreur", str(e), 0xc04040))

# ═══════════════════════════════════════════════
# /resumer
# ═══════════════════════════════════════════════
@bot.slash_command(guild_ids=[GUILD_ID], name="resumer", description="Générer un résumé IA d'une session")
async def resumer(
    ctx: discord.ApplicationContext,
    session_id: discord.Option(int, "ID de la session à résumer")
):
    await ctx.defer()
    try:
        await ctx.respond(embed=make_embed("🔮 Génération en cours...", "L'IA analyse vos notes..."))
        async with aiohttp.ClientSession() as s:
            async with s.post(
                f"{VAULTLOG_URL}/api/sessions/{session_id}/generate",
                headers=HEADERS
            ) as r:
                result = await r.json()
        if "summary" in result:
            points = result["summary"].split("\n")
            summary_text = "\n".join([f"◆ {p}" for p in points if p.strip()])
            embed = make_embed("✨ Résumé IA généré !", color=0xc9a84c)
            embed.add_field(name="📋 Points clés", value=summary_text[:1000] or "—", inline=False)
            if result.get("narrative"):
                n = result["narrative"]
                embed.add_field(
                    name="📖 Journal narratif",
                    value=f"*{n[:500]}...*" if len(n) > 500 else f"*{n}*",
                    inline=False
                )
            await ctx.edit(embed=embed)
        else:
            await ctx.edit(embed=make_embed("❌ Erreur", result.get("error", "IA indisponible"), 0xc04040))
    except Exception as e:
        await ctx.edit(embed=make_embed("❌ Erreur", str(e), 0xc04040))

# ═══════════════════════════════════════════════
# /demander
# ═══════════════════════════════════════════════
@bot.slash_command(guild_ids=[GUILD_ID], name="demander", description="Poser une question à l'IA sur une campagne")
async def demander(
    ctx: discord.ApplicationContext,
    campaign_id: discord.Option(int, "ID de la campagne"),
    question: discord.Option(str, "Votre question")
):
    await ctx.defer()
    try:
        result = await api_post(f"/sessions/campaign/{campaign_id}/ask", {"question": question})
        embed = make_embed("🔮 Réponse de l'archiviste", color=0x2e7d4f)
        embed.add_field(name="❓ Question", value=question, inline=False)
        answer = result.get("answer", "Pas de réponse")
        embed.add_field(name="📜 Réponse", value=answer[:1000] if len(answer) > 1000 else answer, inline=False)
        await ctx.respond(embed=embed)
    except Exception as e:
        await ctx.respond(embed=make_embed("❌ Erreur", str(e), 0xc04040))

# ═══════════════════════════════════════════════
# /transcrire — upload fichier audio
# ═══════════════════════════════════════════════
@bot.slash_command(guild_ids=[GUILD_ID], name="transcrire", description="Transcrire un fichier audio de session")
async def transcrire(
    ctx: discord.ApplicationContext,
    audio: discord.Option(discord.Attachment, "Fichier audio (mp3, wav, m4a, ogg)"),
    campaign_id: discord.Option(int, "ID de la campagne"),
    titre: discord.Option(str, "Titre de la session", default="Session transcrite")
):
    await ctx.defer()
    ext = os.path.splitext(audio.filename)[1].lower()
    if ext not in [".mp3", ".wav", ".m4a", ".ogg", ".flac", ".webm", ".zip"]:
        await ctx.respond(embed=make_embed("❌ Format non supporté", "Formats : mp3, wav, m4a, ogg, flac, webm", 0xc04040))
        return
    await ctx.respond(embed=make_embed(
        "🎙️ Transcription en cours...",
        f"Fichier : **{audio.filename}**\nCela peut prendre quelques minutes..."
    ))
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp_path = tmp.name
            async with aiohttp.ClientSession() as s:
                async with s.get(audio.url) as r:
                    tmp.write(await r.read())
        proc = await asyncio.create_subprocess_exec(
            PYTHON_PATH, TRANSCRIBE_SCRIPT, tmp_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=600)
        if proc.returncode != 0:
            await ctx.channel.send(embed=make_embed("❌ Erreur transcription", stderr.decode()[:500], 0xc04040))
            return
        segments = json.loads(stdout.decode())
        lines = []
        current_speaker = None
        for seg in segments:
            spk = seg.get("speaker", "Inconnu")
            if spk != current_speaker:
                current_speaker = spk
                lines.append(f"\n[{spk}]")
            lines.append(seg["text"])
        transcription = "\n".join(lines).strip()
        result = await api_post(f"/sessions/campaign/{campaign_id}", {
            "title": titre,
            "date": date.today().isoformat(),
            "raw_notes": transcription
        })
        session_id = result.get("id")
        preview = transcription[:600] + "..." if len(transcription) > 600 else transcription
        embed = make_embed("✅ Transcription terminée !", color=0x2e7d4f)
        embed.add_field(name="📋 Session créée", value=f"**{titre}** (ID: `{session_id}`)", inline=False)
        embed.add_field(name="🎙️ Aperçu", value=f"```{preview}```", inline=False)
        embed.add_field(name="💡 Suite", value=f"Utilisez `/resumer {session_id}` pour générer un résumé IA !", inline=False)
        await ctx.channel.send(embed=embed)
    except asyncio.TimeoutError:
        await ctx.channel.send(embed=make_embed("❌ Timeout", "Fichier trop long.", 0xc04040))
    except Exception as e:
        await ctx.channel.send(embed=make_embed("❌ Erreur", str(e), 0xc04040))
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)

# ═══════════════════════════════════════════════
# /rejoindre — enregistrement vocal
# ═══════════════════════════════════════════════
@bot.slash_command(guild_ids=[GUILD_ID], name="rejoindre", description="Rejoindre le vocal et enregistrer la session")
async def rejoindre(
    ctx: discord.ApplicationContext,
    campaign_id: discord.Option(int, "ID de la campagne"),
    titre: discord.Option(str, "Titre de la session", default=None)
):
    if not ctx.user.voice:
        await ctx.respond(embed=make_embed("❌ Erreur", "Tu dois être dans un salon vocal !", 0xc04040))
        return

    guild_id = ctx.guild.id
    if guild_id in active_recordings:
        await ctx.respond(embed=make_embed(
            "⚠️ Déjà en cours",
            "Un enregistrement est actif. Utilisez `/quitter` pour l'arrêter.",
            0xc9a84c
        ))
        return

    voice_channel = ctx.user.voice.channel
    session_titre = titre or f"Session du {date.today().strftime('%d/%m/%Y')}"

    await ctx.defer(ephemeral=False)
    try:
        vc = await voice_channel.connect()
        await asyncio.sleep(2)

        def finished_callback(sink, channel, *args):
            asyncio.ensure_future(process_recording(sink, channel, campaign_id, session_titre))

        vc.start_recording(
            discord.sinks.WaveSink(),
            finished_callback,
            ctx.channel
        )

        active_recordings[guild_id] = {
            "vc": vc,
            "campaign_id": campaign_id,
            "titre": session_titre,
            "channel": ctx.channel
        }

        asyncio.ensure_future(audio_heartbeat(vc, guild_id))
        asyncio.ensure_future(keepalive(vc, guild_id, ctx.channel))

        membres = [m.display_name for m in voice_channel.members if not m.bot]
        embed = make_embed(
            "🎙️ Enregistrement démarré !",
            f"Je suis dans **{voice_channel.name}**\n\n"
            f"📋 Campagne : `{campaign_id}`\n"
            f"📝 Session : **{session_titre}**\n\n"
            f"Utilisez `/quitter` pour arrêter et transcrire automatiquement.",
            0x2e7d4f
        )
        embed.add_field(
            name="👥 Participants détectés",
            value="\n".join([f"• {m}" for m in membres]) or "Aucun pour l'instant",
            inline=False
        )
        await ctx.respond(embed=embed)

    except Exception as e:
        await ctx.respond(embed=make_embed("❌ Erreur", str(e), 0xc04040))

# ═══════════════════════════════════════════════
# /quitter — arrêter l'enregistrement
# ═══════════════════════════════════════════════
@bot.slash_command(guild_ids=[GUILD_ID], name="quitter", description="Arrêter l'enregistrement et transcrire")
async def quitter(ctx: discord.ApplicationContext):
    guild_id = ctx.guild.id

    if guild_id not in active_recordings:
        await ctx.respond(embed=make_embed(
            "⚠️ Aucun enregistrement",
            "Aucun enregistrement actif.",
            0xc9a84c
        ))
        return

    await ctx.respond(embed=make_embed(
        "⏹️ Enregistrement arrêté",
        "Transcription en cours... Je vous envoie les résultats dans quelques minutes."
    ))

    recording = active_recordings.pop(guild_id)
    recording["vc"].stop_recording()
    await recording["vc"].disconnect()

# ═══════════════════════════════════════════════
# START
# ═══════════════════════════════════════════════
bot.run(DISCORD_TOKEN)
