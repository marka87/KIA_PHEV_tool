# PHEV Kosten-Tracker (Kia Ceed SW PHEV)

Schlanke, selbst gehostete Web-App zur Erfassung von Lade- und Tankvorgängen sowie zur Ermittlung der tatsächlichen Kosten pro Kilometer und des Break-Even-Strompreises.

---

## Schnelle Inbetriebnahme (Windows Homeserver)

### 1. Starten
Einfach die Datei **`start.bat`** per Doppelklick starten (oder im Terminal):
```cmd
npm start
```
Die App läuft auf **Port 3000**:
- **Am PC:** `http://localhost:3000`
- **Am Handy im Heimnetz:** `http://<Homeserver-IP>:3000` (z. B. `http://192.168.1.100:3000`)

### 2. Als PWA auf dem Smartphone installieren
1. Öffne die URL am Smartphone im Browser (Chrome auf Android oder Safari auf iOS).
2. Tippe auf das Browser-Menü (drei Punkte bzw. Teilen-Symbol).
3. Wähle **"Zum Startbildschirm hinzufügen"** bzw. **"App installieren"**.
4. Die App startet fortan wie eine native App im Vollbildmodus und funktioniert dank Offline-Cache auch ohne Netzwerk.

---

## Kernfunktionen & Architektur

- **Minimalistischer Stack (Ponytail):**
  - **Backend:** Node.js 26 mit nativer `node:sqlite` (keine C++ Build-Tools oder native Compiler-Addons auf Windows erforderlich!).
  - **Frontend:** React + TypeScript + Vite als moderne PWA (Service Worker + Web App Manifest).
  - **Single Port:** Das Node-Backend serviert sowohl die REST-API (`/api/...`) als auch das gebaute Frontend statisch auf Port 3000.
- **Offline-Fähigkeit (IndexedDB):**
  - Wenn unterwegs an einer Ladesäule oder Tankstelle kein Empfang besteht, speichert die App Eingaben lokal in IndexedDB.
  - Sobald wieder eine Verbindung besteht (oder manuell über den Sync-Button), werden alle Einträge automatisch an das Backend übertragen.
- **Datensicherung & Backups:**
  - Automatische tägliche Sicherung der SQLite-Datenbank nach `backend/data/backups/`.
  - Manuelle Sicherung jederzeit per Knopfdruck unter *Tarife & Backup* in der Web-App möglich.
  - Backups älter als 30 Tage werden automatisch bereinigt.
- **Berechnungslogik & Tests:**
  - Realistische Erfassung getrennter Distanzen: elektrischer Trip (`ev_km`) vs. Benzin-Trip (`fuel_km`).
  - Break-Even-Formel:
    $$\text{Strompreis}_{\text{Break-Even}} = \frac{\text{Verbrauch}_{\text{Benzin}} \times \text{Spritpreis}}{\text{Verbrauch}_{\text{EV}}}$$
  - Interaktiver Live-Simulator auf dem Dashboard.
  - Unit-Tests mit Node-Testrunner: `npm test` im Backend ausführen.
- **Kia Connect / UVO Integration (Meilenstein 4):**
  - Automatischer Abruf von Gesamtkilometerstand, Akkuladestand (SOC in %) und Reichweiten direkt aus Kia Connect.
  - Batterieschonender Cloud-Cache-Abruf als Standard (verhindert das Entladen der 12V-Batterie des Ceed PHEV).
  - Schnell-Synchronisation direkt über den Button **"Kia Sync"** auf dem Dashboard oder im Menü **Setup**.
  - Manuelle Ausführung auch per Doppelklick über **`kia_service\sync_now.bat`** oder per Python-CLI:
    ```cmd
    python kia_service/sync_kia.py
    ```
  - Konfiguration entweder direkt in der Web-App unter *Setup* oder in `kia_service/config.json`.
- **Produktions-Dauerbetrieb (Homeserver & NordVPN Meshnet):**
  - Vollständige Anleitung für PM2, Autostart beim Booten, Basic Auth, Logging und Firewall siehe [DEPLOYMENT.md](DEPLOYMENT.md).
