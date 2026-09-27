#!/usr/bin/env python3
"""
Kia Connect / UVO Snapshot Sync Service
Fetches vehicle telemetry (odometer, battery SOC, EV/Fuel range) from Kia Connect
and saves it as a snapshot in the PHEV-Kosten-Tracker SQLite database.
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
import time
from datetime import datetime, timezone
import requests
from hyundai_kia_connect_api import VehicleManager
from hyundai_kia_connect_api.ApiImpl import ApiImplSession

# Increase connection timeout from default 10s to 30s to prevent connect timeouts on slow routes / VPN
ApiImplSession.HTTP_CONNECT_TIMEOUT = 30
ApiImplSession.HTTP_READ_TIMEOUT = 60

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

        # Authenticate / refresh token with retries
        for attempt in range(1, 4):
            try:
                vm.check_and_refresh_token()
                save_cached_token(vm.token)
                break
            except Exception as e:
                err_str = str(e).lower()
                if attempt < 3 and ("timeout" in err_str or "connection" in err_str or "reset" in err_str):
                    if not args.json:
                        print(f"⚠️ Verbindungstimeout zu Kia Connect (Versuch {attempt}/3). Warte 3s...")
                    time.sleep(3)
                else:
                    raise

        # Fetch telemetry
        if force_refresh:
            if not args.json:
                print("📡 Live-Abfrage an Fahrzeug wird gesendet (Force Refresh)...")
            try:
                vm.force_refresh_all_vehicles_states()
            except Exception as e:
                if not args.json:
                    print(f"⚠️ Live-Abfrage Warnung: {e}, lese Cloud-Zustand...")
            # After forcing vehicle wake-up, load the updated telemetry properties
            vm.update_all_vehicles_with_cached_state()
        else:
            if not args.json:
                print("🔄 Abrufen des aktuellen Cloud-Cache-Zustands (batterieschonend)...")
            for attempt in range(1, 4):
                try:
                    vm.update_all_vehicles_with_cached_state()
                    break
                except Exception as e:
                    err_str = str(e).lower()
                    if attempt < 3 and ("timeout" in err_str or "connection" in err_str):
                        if not args.json:
                            print(f"⚠️ Timeout beim Datenabruf (Versuch {attempt}/3). Warte 3s...")
                        time.sleep(3)
                    else:
                        raise

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

        # Fallback for odometer if Kia didn't return it in this frame
        if odometer is None:
            try:
                db_resp = requests.get(f"{server_url}/api/dashboard/stats?vehicleId={vehicle_db_id}", timeout=5)
                if db_resp.ok:
                    last_snap = db_resp.json().get("latestSnapshot")
                    if last_snap and last_snap.get("odometer_km"):
                        odometer = last_snap.get("odometer_km")
            except Exception:
                pass

        # Kia Ceed SW PHEV: When parked with ignition off, Kia API often reports ev_driving_range = 0.0.
        # If so, estimate realistic EV range from battery SOC (WLTP baseline ~50 km).
        if (ev_range is None or ev_range <= 0) and battery_pct is not None and battery_pct > 0:
            ev_range = round((battery_pct / 100.0) * 50.0, 1)

        # Extended telemetry
        is_locked = getattr(vehicle, "is_locked", None)
        doors = {
            "front_left": bool(getattr(vehicle, "front_left_door_is_open", False)),
            "front_right": bool(getattr(vehicle, "front_right_door_is_open", False)),
            "back_left": bool(getattr(vehicle, "back_left_door_is_open", False)),
            "back_right": bool(getattr(vehicle, "back_right_door_is_open", False)),
            "trunk": bool(getattr(vehicle, "trunk_is_open", False)),
            "hood": bool(getattr(vehicle, "hood_is_open", False)),
        }
        windows = {
            "front_left": bool(getattr(vehicle, "front_left_window_is_open", False)),
            "front_right": bool(getattr(vehicle, "front_right_window_is_open", False)),
            "back_left": bool(getattr(vehicle, "back_left_window_is_open", False)),
            "back_right": bool(getattr(vehicle, "back_right_window_is_open", False)),
        }
        climate = {
            "is_on": bool(getattr(vehicle, "air_control_is_on", False)),
            "target_temp": getattr(vehicle, "air_temperature", None),
            "defrost": bool(getattr(vehicle, "defrost_is_on", False)),
            "back_window_heater": bool(getattr(vehicle, "back_window_heater_is_on", False)),
            "steering_wheel_heater": bool(getattr(vehicle, "steering_wheel_heater_is_on", False)),
            "outside_temp": getattr(vehicle, "outside_temperature", None),
        }
        charge_port_open = bool(getattr(vehicle, "ev_charge_port_door_is_open", False))
        charge_remaining_min = getattr(vehicle, "ev_estimated_current_charge_duration", None)
        if charge_remaining_min is None and is_charging:
            charge_remaining_min = getattr(vehicle, "ev_estimated_station_charge_duration", None)

        loc_lat = getattr(vehicle, "location_latitude", None)
        loc_lon = getattr(vehicle, "location_longitude", None)

        tpms_warning = bool(getattr(vehicle, "tire_pressure_all_warning_is_on", False))
        washer_fluid_warning = bool(getattr(vehicle, "washer_fluid_warning_is_on", False))
        smart_key_warning = bool(getattr(vehicle, "smart_key_battery_warning_is_on", False))

        snapshot_payload = {
            "vehicle_id": vehicle_db_id,
            "zeitpunkt": last_updated.isoformat() if hasattr(last_updated, "isoformat") else str(last_updated),
            "odometer_km": float(odometer) if odometer is not None else None,
            "ev_range_km": float(ev_range) if ev_range is not None else None,
            "fuel_range_km": float(fuel_range) if fuel_range is not None else None,
            "soc_percent": float(battery_pct) if battery_pct is not None else None,
            "car_12v_percent": float(car_12v_pct) if car_12v_pct is not None else None,
            "is_charging": 1 if is_charging else 0,
            "is_plugged_in": 1 if is_plugged else 0,
            "is_locked": 1 if is_locked is True else (0 if is_locked is False else None),
            "doors_open_json": json.dumps(doors),
            "windows_open_json": json.dumps(windows),
            "climate_status_json": json.dumps(climate),
            "charge_remaining_min": int(charge_remaining_min) if charge_remaining_min is not None else None,
            "charge_port_open": 1 if charge_port_open else 0,
            "location_lat": float(loc_lat) if loc_lat is not None else None,
            "location_lon": float(loc_lon) if loc_lon is not None else None,
            "tire_pressure_warning": 1 if tpms_warning else 0,
            "washer_fluid_warning": 1 if washer_fluid_warning else 0,
            "smart_key_warning": 1 if smart_key_warning else 0,
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
            "is_locked": is_locked,
            "doors": doors,
            "windows": windows,
            "climate": climate,
            "charge_port_open": charge_port_open,
            "charge_remaining_min": charge_remaining_min,
            "location_lat": loc_lat,
            "location_lon": loc_lon,
            "tire_pressure_warning": tpms_warning,
            "washer_fluid_warning": washer_fluid_warning,
            "smart_key_warning": smart_key_warning,
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
            print(f"   Verriegelt:          {'Ja' if is_locked is True else ('Nein' if is_locked is False else 'Unbekannt')}")
            print(f"   Eingesteckt/Laden:   {'Ja' if is_plugged else 'Nein'} / {'Ja' if is_charging else 'Nein'}")
            if charge_remaining_min is not None:
                print(f"   Restladezeit:        ca. {charge_remaining_min} Min.")
            if loc_lat and loc_lon:
                print(f"   GPS-Position:        {loc_lat:.5f}, {loc_lon:.5f}")
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
