#!/usr/bin/env python3
"""
Kia Connect / UVO Snapshot Sync Service
Fetches vehicle telemetry (odometer, battery SOC, EV/Fuel range) from Kia Connect
and saves it as a snapshot in the PHEV-Kosten-Tracker SQLite database.
"""

import sys
import os
import json
import argparse
import pickle
from datetime import datetime, timezone
import requests
from hyundai_kia_connect_api import VehicleManager

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TOKEN_CACHE_FILE = os.path.join(SCRIPT_DIR, "token.cache")
DEFAULT_CONFIG_FILE = os.path.join(SCRIPT_DIR, "config.json")


def load_config(config_path: str) -> dict:
    if not os.path.exists(config_path):
        raise FileNotFoundError(
            f"Konfigurationsdatei nicht gefunden: {config_path}\n"
            f"Bitte passe 'kia_service/config.json' mit deinen Kia Connect Zugangsdaten an."
        )
    with open(config_path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_cached_token():
    if os.path.exists(TOKEN_CACHE_FILE):
        try:
            with open(TOKEN_CACHE_FILE, "rb") as f:
                return pickle.load(f)
        except Exception as e:
            # Corrupt cache, ignore
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
    parser = argparse.ArgumentParser(description="Sync Kia Ceed SW PHEV telemetry to PHEV Tracker")
    parser.add_argument("--config", default=DEFAULT_CONFIG_FILE, help="Path to config.json")
    parser.add_argument("--force", action="store_true", help="Force live vehicle refresh (wakes car, drains 12V battery)")
    parser.add_argument("--json", action="store_true", help="Output machine-readable JSON")
    parser.add_argument("--dry-run", action="store_true", help="Fetch telemetry without sending to server")
    parser.add_argument("--server-url", help="Override backend server URL")
    parser.add_argument("--vehicle-id", type=int, help="Override vehicle ID in database")
    args = parser.parse_args()

    # Load configuration
    try:
        config = load_config(args.config)
    except Exception as e:
        if args.json:
            print(json.dumps({"success": False, "error": str(e)}))
        else:
            print(f"❌ Fehler: {e}", file=sys.stderr)
        sys.exit(1)

    username = (os.environ.get("KIA_USERNAME") or config.get("username", "")).strip()
    password = (os.environ.get("KIA_PASSWORD") or config.get("password", "")).strip()
    pin = (os.environ.get("KIA_PIN") or config.get("pin", "")).strip()
    region = int(config.get("region", 1))
    brand = int(config.get("brand", 1))
    server_url = (args.server_url or config.get("server_url", "http://localhost:3000")).rstrip("/")
    vehicle_db_id = args.vehicle_id or config.get("vehicle_id", 1)
    force_refresh = args.force or config.get("force_refresh", False)

    if not username or not password:
        err_msg = (
            "Kia Connect Zugangsdaten fehlen! "
            "Bitte trage Benutzername (E-Mail) und Passwort in 'kia_service/config.json' ein."
        )
        if args.json:
            print(json.dumps({"success": False, "error": err_msg, "configured": False}))
        else:
            print(f"⚠️  {err_msg}", file=sys.stderr)
        sys.exit(1)

    cached_token = load_cached_token()

    if not args.json:
        print("🔌 Verbinde mit Kia Connect API...")

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

        # Authenticate / refresh token
        vm.check_and_refresh_token()
        save_cached_token(vm.token)

        # Fetch telemetry
        if force_refresh:
            if not args.json:
                print("📡 Live-Abfrage an Fahrzeug wird gesendet (Force Refresh)...")
            vm.force_refresh_all_vehicles_states()
        else:
            if not args.json:
                print("🔄 Abrufen des aktuellen Cloud-Cache-Zustands (batterieschonend)...")
            vm.update_all_vehicles_with_cached_state()

        save_cached_token(vm.token)

        if not vm.vehicles:
            raise RuntimeError("Keine Fahrzeuge im Kia-Account gefunden.")

        # Pick the first vehicle (or matching Kia Ceed)
        vehicle = list(vm.vehicles.values())[0]

        # Extract telemetry
        odometer = vehicle.odometer
        ev_range = vehicle.ev_driving_range
        fuel_range = vehicle.fuel_driving_range
        battery_pct = vehicle.ev_battery_percentage
        car_12v_pct = getattr(vehicle, "car_battery_percentage", None)
        is_charging = getattr(vehicle, "ev_battery_is_charging", False)
        is_plugged = getattr(vehicle, "ev_battery_is_plugged_in", False)
        last_updated = vehicle.last_updated_at or datetime.now(timezone.utc)

        # Kia Ceed SW PHEV: When parked with ignition off, Kia API often reports ev_driving_range = 0.0.
        # If so, estimate realistic EV range from battery SOC (WLTP baseline ~50 km).
        if (ev_range is None or ev_range <= 0) and battery_pct is not None and battery_pct > 0:
            ev_range = round((battery_pct / 100.0) * 50.0, 1)

        snapshot_payload = {
            "vehicle_id": vehicle_db_id,
            "zeitpunkt": last_updated.isoformat() if hasattr(last_updated, "isoformat") else str(last_updated),
            "odometer_km": float(odometer) if odometer is not None else None,
            "ev_range_km": float(ev_range) if ev_range is not None else None,
            "fuel_range_km": float(fuel_range) if fuel_range is not None else None,
            "soc_percent": float(battery_pct) if battery_pct is not None else None,
            "quelle": "kia_connect"
        }

        if snapshot_payload["odometer_km"] is None:
            raise RuntimeError("Kilometerstand konnte nicht von Kia Connect gelesen werden.")

        post_result = None
        if not args.dry_run:
            api_endpoint = f"{server_url}/api/snapshots"
            auth = None
            b_user = os.environ.get("BASIC_AUTH_USER", "admin")
            b_pass = os.environ.get("BASIC_AUTH_PASSWORD", "")
            if b_pass:
                auth = (b_user, b_pass)
            resp = requests.post(api_endpoint, json=snapshot_payload, auth=auth, timeout=10)
            if resp.status_code >= 400:
                raise RuntimeError(f"Server-Fehler {resp.status_code}: {resp.text}")
            post_result = resp.json()

        result_data = {
            "success": True,
            "vehicle_name": vehicle.name or vehicle.model or "Kia Ceed SW PHEV",
            "odometer_km": snapshot_payload["odometer_km"],
            "soc_percent": snapshot_payload["soc_percent"],
            "ev_range_km": snapshot_payload["ev_range_km"],
            "fuel_range_km": snapshot_payload["fuel_range_km"],
            "car_12v_percent": car_12v_pct,
            "is_charging": is_charging,
            "is_plugged_in": is_plugged,
            "zeitpunkt": snapshot_payload["zeitpunkt"],
            "server_saved": not args.dry_run,
            "post_result": post_result
        }

        if args.json:
            print(json.dumps(result_data))
        else:
            print("\n✅ Kia Connect Sync erfolgreich!")
            print(f"   Fahrzeug:            {result_data['vehicle_name']}")
            print(f"   Kilometerstand:      {result_data['odometer_km']:,.0f} km".replace(",", "."))
            print(f"   Akku (HV):           {result_data['soc_percent']}%")
            print(f"   EV-Restreichweite:   {result_data['ev_range_km']} km")
            print(f"   Benzin-Reichweite:   {result_data['fuel_range_km']} km")
            if car_12v_pct is not None:
                print(f"   12V-Batterie:        {car_12v_pct}%")
            print(f"   Eingesteckt/Laden:   {'Ja' if is_plugged else 'Nein'} / {'Ja' if is_charging else 'Nein'}")
            print(f"   Stand:               {result_data['zeitpunkt']}")
            if not args.dry_run:
                print(f"   In Datenbank:        Gespeichert unter {server_url}/api/snapshots")

    except Exception as e:
        if args.json:
            print(json.dumps({"success": False, "error": str(e)}))
        else:
            print(f"\n❌ Fehler beim Kia Connect Sync: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
