# 🚀 PHEV-Tracker Deployment-Anleitung

Vollständige Anleitung für den produktiven Dauerbetrieb auf einem **Windows-Homeserver** (z. B. HP EliteDesk 800 G2 Mini, Windows 10 LTSC) mit Zugriff im Heimnetzwerk und von unterwegs über **NordVPN Meshnet**.

---

## 📋 1. Voraussetzungen auf dem Homeserver

1. **Node.js (v20 oder neuer):**  
   Download von [nodejs.org](https://nodejs.org) (LTS Version).  
   Prüfen in PowerShell:
   ```powershell
   node -v
   npm -v
   ```
2. **Python (3.10+):**  
   Wird für die Kia Connect API benötigt. Bei der Installation den Haken **"Add python.exe to PATH"** setzen!  
   Prüfen in PowerShell:
   ```powershell
   python --version
   ```
3. **Python-Bibliothek für Kia Connect installieren:**
   ```powershell
   pip install hyundai-kia-connect-api requests
   ```

---

## 📂 2. Projekt auf den Server kopieren / klonen

Kopiere den Projektordner `KIA_Tool` an den gewünschten Speicherort auf dem Server (z. B. `C:\Apps\KIA_Tool` oder `D:\KIA_Tool`).

Wechsle in PowerShell in das Verzeichnis:
```powershell
cd C:\Apps\KIA_Tool
```

---

## 📦 3. Abhängigkeiten installieren & Produktions-Build erstellen

Führe im Hauptordner aus:

```powershell
# 1. Root-Abhängigkeiten installieren
npm install

# 2. Backend-Abhängigkeiten installieren
cd backend
npm install
cd ..

# 3. Frontend-Abhängigkeiten installieren
cd frontend
npm install
cd ..

# 4. Gesamtes Projekt für Produktion kompilieren (Frontend & Backend)
npm run build
```

> **Ergebnis:** Das Frontend liegt nun produktionsfertig in `frontend/dist`, das Backend kompiliert als natives JavaScript in `backend/dist/server.js`.

---

## ⚙️ 4. `.env`-Konfigurationsdatei anlegen

Kopiere die Vorlage `.env.example` zu `.env`:

```powershell
copy .env.example .env
```

Öffne `.env` mit einem Texteditor (z. B. `notepad .env`) und passe die Werte an:

```ini
# ==========================================
# PHEV-Tracker Produktions-Konfiguration
# ==========================================

# 1. Netzwerk & Port (0.0.0.0 = erreichbar über LAN und NordVPN Meshnet)
HOST=0.0.0.0
PORT=3000

# 2. Daten-Persistenz (SQLite)
# WICHTIG: Lege die Datenbank außerhalb des Git-Projektordners ab,
# damit Updates deine Daten niemals überschreiben!
DB_PATH=C:/PHEV_Data/phev.db
BACKUP_DIR=C:/PHEV_Data/backups
BACKUP_RETENTION_DAYS=30

# 3. Sicherheit (Basic Auth)
# Schützt die gesamte Web-App und API vor unbefugtem Zugriff
BASIC_AUTH_USER=admin
BASIC_AUTH_PASSWORD=DeinSicheresPasswortHier

# 4. Verschlüsselungs-Key für Kia-Zugangsdaten (mind. 16 Zeichen)
ENCRYPTION_KEY=SehrGeheimerSchluesselFuerKia2026!

# 5. Logging
LOG_DIR=./logs
```

> **Bestehende Datenbank übernehmen:**  
> Falls du bereits Einträge hast, kopiere deine bestehende `phev.db` einfach nach `C:\PHEV_Data\phev.db`.

---

## 🔄 5. Dauerbetrieb & Autostart mit PM2

Damit der Server im Hintergrund läuft, bei Abstürzen automatisch neu startet und **auch nach einem Windows-Neustart ohne Benutzer-Login** sofort hochfährt:

### A) PM2 & Windows-Startup-Wrapper global installieren:
```powershell
npm install -g pm2 pm2-windows-startup
```

### B) Windows-Autostart-Dienst einrichten:
```powershell
pm2-startup install
```
*(Bestätige die Abfrage in PowerShell).*

### C) App über die Konfigurationsdatei starten:
```powershell
cd C:\Apps\KIA_Tool
pm2 start ecosystem.config.cjs
```

### D) Aktuellen Zustand für den Autostart speichern:
```powershell
pm2 save
```

### Nützliche PM2-Befehle:
* **Status prüfen:** `pm2 status`
* **Live-Logs anzeigen:** `pm2 logs phev-tracker`
* **App neu starten:** `pm2 restart phev-tracker`
* **App stoppen:** `pm2 stop phev-tracker`

---

## 🛡️ 6. Windows-Firewall-Regel für Port 3000 freigeben

Damit dein Homeserver Anfragen aus dem lokalen Netzwerk und über NordVPN Meshnet annimmt, muss der Port in der Windows-Firewall geöffnet werden.

Öffne **PowerShell als Administrator** und führe folgenden Befehl aus:

```powershell
New-NetFirewallRule -DisplayName "PHEV Tracker (Port 3000)" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
```

*(Alternativ: Über `Systemsteuerung` ➔ `Windows Defender Firewall` ➔ `Erweiterte Einstellungen` ➔ `Eingehende Regeln` ➔ `Neue Regel` ➔ `Port 3000 TCP erlauben`).*

---

## 🌐 7. Zugriff auf den Tracker

### A) Im lokalen Heimnetzwerk (WLAN / LAN):
```text
http://<Homeserver-Lokale-IP>:3000
```
*Beispiel: `http://192.168.254.163:3000`*

### B) Von unterwegs über NordVPN Meshnet:
1. Stelle sicher, dass auf deinem Homeserver und auf deinem Smartphone/Laptop **NordVPN mit aktiviertem Meshnet** läuft.
2. In der NordVPN-App siehst du den **Meshnet-Namen** oder die **Meshnet-IP** deines Homeservers (z. B. `100.84.12.34` oder `homeserver-nord`).
3. Öffne im Browser von unterwegs:
   ```text
   http://<Meshnet-IP>:3000
   ```
   *Beispiel: `http://100.84.12.34:3000`*
4. Gib deine in `.env` definierten Basic-Auth-Zugangsdaten ein (`BASIC_AUTH_USER` & `BASIC_AUTH_PASSWORD`).

> **Hinweis PWA (App auf Handy-Homescreen):**  
> Du kannst die URL in Safari (iOS: *"Zum Home-Bildschirm"*) oder Chrome (Android: *"App installieren"*) speichern. Sie funktioniert dann wie eine native App und cacht Offline-Daten!

---

## 📁 8. Logging & Fehlersuche

Alle Logs werden automatisch in das Verzeichnis `./logs` geschrieben und bei Erreichen von 5 MB automatisch rotiert:
* **`logs/server.log`**: Alle HTTP-Anfragen, Latenzen, Systemmeldungen und Kia-Sync-Starts.
* **`logs/error.log`**: Reine Fehlerprotokolle (z. B. wenn die Kia API nicht erreichbar ist).
* **PM2 Logs:** `pm2 logs phev-tracker`

---

## 💾 9. Backups

* **Automatisches Backup:** Der Server erstellt alle 24 Stunden automatisch eine Sicherung der Datenbank in `C:\PHEV_Data\backups` und löscht Sicherungen, die älter als 30 Tage sind.
* **Manuelles Backup per Befehl:**
  ```powershell
  npm run backup
  ```

---

## 🛟 Fallback-Alternative: Dauerbetrieb mit NSSM (Windows-Dienst)

Falls PM2 nach großen Windows 10 LTSC Feature-Updates zicken sollte, kannst du die App stattdessen in 2 Minuten als echten Windows-Systemdienst registrieren:

1. Lade **NSSM** herunter: [nssm.cc/download](https://nssm.cc/download) und entpacke `nssm.exe` z. B. nach `C:\Windows\System32`.
2. Öffne **PowerShell als Administrator** und führe aus:
   ```powershell
   nssm install PHEVTracker "C:\Program Files\nodejs\node.exe" "C:\Apps\KIA_Tool\backend\dist\server.js"
   nssm set PHEVTracker AppDirectory "C:\Apps\KIA_Tool"
   nssm set PHEVTracker Start SERVICE_AUTO_START
   nssm start PHEVTracker
   ```
3. Der Dienst `PHEVTracker` startet nun automatisch beim Booten als Systemdienst (sogar noch vor dem Windows-Login-Bildschirm).
