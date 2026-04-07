# 📜 VaultLog — Journal de sessions JDR

Application web auto-hébergée inspirée de VoLog, pour archiver tes sessions de JDR avec résumés IA via Ollama.

## ✨ Fonctionnalités

- **Multi-campagnes** : Gère plusieurs campagnes (D&D 5e, Pathfinder, CoC, etc.)
- **Journal de sessions** : Notes brutes + résumé IA automatique + journal narratif
- **Personnages** : PJ, PNJ importants, boss
- **🔮 Interroger l'IA** : Pose des questions sur toute ta campagne (ex: "Pourquoi les héros se méfient-ils du Baron ?")
- **Tokens API** : Pour connecter ton bot Discord existant
- **100% local** : Utilise Ollama + llama3.2 (ton setup habituel)

## 🚀 Installation rapide

### Prérequis
- Node.js 18+
- Ollama avec llama3.2 installé

### Sur ton serveur `jdr`

```bash
# 1. Copier les fichiers
sudo mkdir -p /opt/vaultlog
sudo cp -r * /opt/vaultlog/
sudo chown -R malik:malik /opt/vaultlog

# 2. Créer le dossier de données
mkdir -p /opt/vaultlog/data

# 3. Installer les dépendances
cd /opt/vaultlog && npm install --production

# 4. Configurer le service systemd
sudo cp vaultlog.service /etc/systemd/system/
# ⚠️  Édite SESSION_SECRET dans le fichier .service !
sudo nano /etc/systemd/system/vaultlog.service

# 5. Activer et démarrer
sudo systemctl daemon-reload
sudo systemctl enable vaultlog
sudo systemctl start vaultlog

# 6. Vérifier
sudo systemctl status vaultlog
sudo journalctl -u vaultlog -f
```

### Tester
```
http://localhost:3000
# ou depuis l'extérieur:
http://IP_SERVEUR:3000
```

## ⚙️ Configuration

Variables d'environnement (dans `/etc/systemd/system/vaultlog.service`) :

| Variable | Défaut | Description |
|---|---|---|
| `PORT` | 3000 | Port du serveur |
| `SESSION_SECRET` | ⚠️ À changer | Clé secrète sessions |
| `OLLAMA_URL` | `http://localhost:11434` | URL d'Ollama |
| `OLLAMA_MODEL` | `llama3.2` | Modèle à utiliser |

## 🤖 Intégration Bot Discord

Depuis les paramètres de l'app, génère un **token API**.

Dans ton bot Discord existant (`botdnd`), tu peux appeler l'API :

```javascript
// Ajouter une session depuis Discord
await fetch('http://localhost:3000/api/sessions/campaign/ID', {
  method: 'POST',
  headers: { 
    'Content-Type': 'application/json',
    'x-api-token': 'volog_TONTOKEN'
  },
  body: JSON.stringify({
    title: 'Session #12',
    date: '2026-03-06',
    raw_notes: 'Notes dictées pendant la session...'
  })
});

// Poser une question à l'IA sur la campagne
await fetch('http://localhost:3000/api/sessions/campaign/ID/ask', {
  method: 'POST',
  headers: { 
    'Content-Type': 'application/json',
    'x-api-token': 'volog_TONTOKEN'
  },
  body: JSON.stringify({ question: 'Que sait-on sur le Baron ?' })
});
```

## 📁 Structure

```
vaultlog/
├── server.js           # Serveur Express principal
├── src/
│   ├── database.js     # SQLite + schéma
│   ├── middleware.js   # Auth session & token API
│   ├── services/
│   │   └── ai.js       # Intégration Ollama
│   └── routes/
│       ├── auth.js
│       ├── campaigns.js
│       ├── sessions.js
│       └── characters.js
├── public/
│   └── index.html      # SPA complète
├── data/
│   └── volog.db        # Base SQLite (créée automatiquement)
└── vaultlog.service    # Systemd
```
# test deploy
