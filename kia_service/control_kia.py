#!/usr/bin/env python3
"""
Kia Connect Remote Control Service
Sends remote commands (lock, unlock, start_climate, stop_climate, start_charge, stop_charge)
to the Kia Ceed SW PHEV.
"""

import sys
import os

# Ensure UTF-8 stdout/stderr on Windows
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
if hasattr(sys.stderr, 'reconfigure'):
    try:
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

import json
import argparse
import pickle
from hyundai_kia_connect_api import VehicleManager, ClimateRequestOptions

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TOKEN_CACHE_FILE = os.path.join(SCRIPT_DIR, "token.cache")
DEFAULT_CONFIG_FILE = os.path.join(SCRIPT_DIR, "config.json")


def load_config(config_path: str) -> dict:
    if not os.path.exists(config_path):
        return {}
    with open(config_path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_cached_token():
    if os.path.exists(TOKEN_CACHE_FILE):
        try:
            with open(TOKEN_CACHE_FILE, "rb") as f:
                return pickle.load(f)
        except Exception:
            pass
    return None


def save_cached_token(token):
    if token:
        try:
            with open(TOKEN_CACHE_FILE, "wb") as f:
                pickle.dump(token, f)
        except Exception:
            pass


def main():
    parser = argparse.ArgumentParser(description="Kia Connect Remote Control")
    parser.add_argument("action", choices=["lock", "unlock", "start_climate", "stop_climate", "start_charge", "stop_charge"], help="Action to perform")
    parser.add_argument("--temp", type=float, default=21.0, help="Target temperature for climate (e.g. 21.0)")
    parser.add_argument("--duration", type=int, default=15, help="Climate duration in minutes (default: 15)")
    parser.add_argument("--defrost", action="store_true", help="Enable windscreen defroster")
    parser.add_argument("--steering-wheel", action="store_true", help="Enable steering wheel heater")
    parser.add_argument("--config", default=DEFAULT_CONFIG_FILE, help="Path to config.json")
    parser.add_argument("--json", action="store_true", help="Output result as JSON")
    args = parser.parse_args()

    config = load_config(args.config)
    username = (os.environ.get("KIA_USERNAME") or config.get("username", "")).strip()
    password = (os.environ.get("KIA_PASSWORD") or config.get("password", "")).strip()
    pin = (os.environ.get("KIA_PIN") or config.get("pin", "")).strip()
    region = int(config.get("region", 1))
    brand = int(config.get("brand", 1))

    if not username or not password:
        err_msg = "Kia Connect Zugangsdaten fehlen. Bitte in der Web-App unter Einstellungen konfigurieren."
        if args.json:
            print(json.dumps({"success": False, "error": err_msg}))
        else:
            print(f"❌ {err_msg}", file=sys.stderr)
        sys.exit(1)

    cached_token = load_cached_token()

    if not args.json:
        print(f"🔌 Verbinde mit Kia Connect API für Befehl '{args.action}'...")

    try:
        vm = VehicleManager(
            region=region,
            brand=brand,
            username=username,
            password=password,
            pin=pin,
            token=cached_token,
            language="de"
        )
        vm.check_and_refresh_token()
        save_cached_token(vm.token)

        if not vm.vehicles:
            raise RuntimeError("Keine Fahrzeuge im Kia-Account gefunden.")

        vehicle = list(vm.vehicles.values())[0]
        vehicle_id = vehicle.id

        action_result = None
        message = ""

        if args.action == "lock":
            if not args.json:
                print("🔒 Befehl 'Verriegeln' wird an das Fahrzeug gesendet...")
            action_result = vm.lock(vehicle_id)
            message = "Fahrzeug erfolgreich verriegelt"

        elif args.action == "unlock":
            if not args.json:
                print("🔓 Befehl 'Entriegeln' wird an das Fahrzeug gesendet...")
            action_result = vm.unlock(vehicle_id)
            message = "Fahrzeug erfolgreich entriegelt"

        elif args.action == "start_climate":
            if not args.json:
                print(f"❄️ Vorklimatisierung auf {args.temp}°C (Dauer: {args.duration}m, Defrost: {args.defrost}) wird gestartet...")
            options = ClimateRequestOptions(
                set_temp=args.temp,
                duration=args.duration,
                defrost=args.defrost,
                climate=True,
                heating=1 if args.temp >= 20.0 else 0,
                steering_wheel=1 if args.steering_wheel else 0,
            )
            action_result = vm.start_climate(vehicle_id, options=options)
            message = f"Vorklimatisierung auf {args.temp}°C gestartet"

        elif args.action == "stop_climate":
            if not args.json:
                print("⏹️ Klimatisierung wird beendet...")
            action_result = vm.stop_climate(vehicle_id)
            message = "Klimatisierung erfolgreich beendet"

        elif args.action == "start_charge":
            if not args.json:
                print("⚡ Ladevorgang wird gestartet...")
            action_result = vm.start_charge(vehicle_id)
            message = "Ladevorgang erfolgreich gestartet"

        elif args.action == "stop_charge":
            if not args.json:
                print("⏹️ Ladevorgang wird beendet...")
            action_result = vm.stop_charge(vehicle_id)
            message = "Ladevorgang erfolgreich beendet"

        save_cached_token(vm.token)

        out = {
            "success": True,
            "action": args.action,
            "message": message,
            "api_result": str(action_result) if action_result else "OK"
        }

        if args.json:
            print(json.dumps(out))
        else:
            print(f"✅ {message}!")

    except Exception as e:
        if args.json:
            print(json.dumps({"success": False, "action": args.action, "error": str(e)}))
        else:
            print(f"❌ Fehler bei Remote-Befehl '{args.action}': {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
