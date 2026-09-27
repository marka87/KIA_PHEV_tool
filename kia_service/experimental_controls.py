#!/usr/bin/env python3
"""
Kia Connect - Experimental Remote Controls
Allows isolated testing of individual climate and comfort sub-functions:
- Driver seat heating on/off
- Passenger seat heating on/off
- Steering wheel heating on/off
- Rear window & mirror defrost on/off
- Pure AC cooling (isolated test with heating=0)
- Stop climate

Returns full raw Kia API diagnostics (HTTP code, retCode, resCode, resMsg, payload, raw response).
"""

import sys
import os

# Ensure UTF-8 stdout/stderr on Windows
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
if hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

import json
import argparse
import pickle
import time
from typing import Any, Dict, Optional, Tuple

import requests
from hyundai_kia_connect_api import VehicleManager, ClimateRequestOptions
from hyundai_kia_connect_api.ApiImplType1 import get_index_into_hex_temp

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


class ApiCallRecorder:
    """Hooks session.post to record request and raw response details."""

    def __init__(self, session: requests.Session):
        self.session = session
        self.original_post = session.post
        self.calls = []

    def start_recording(self):
        def hooked_post(url, *args, **kwargs):
            call_info: Dict[str, Any] = {
                "url": url,
                "timestamp": time.time(),
                "json_payload": kwargs.get("json"),
                "status_code": None,
                "raw_body": None,
                "json_body": None,
                "error": None,
            }
            try:
                resp = self.original_post(url, *args, **kwargs)
                call_info["status_code"] = resp.status_code
                try:
                    call_info["json_body"] = resp.json()
                    call_info["raw_body"] = resp.text
                except Exception:
                    call_info["raw_body"] = resp.text
                self.calls.append(call_info)
                return resp
            except Exception as e:
                call_info["error"] = str(e)
                self.calls.append(call_info)
                raise e

        self.session.post = hooked_post

    def get_last_call(self) -> Optional[Dict[str, Any]]:
        return self.calls[-1] if self.calls else None


def execute_experimental_command(
    action: str,
    state: str = "on",
    level: int = 1,
    temp: float = 17.0,
    duration: int = 5,
    mode: str = "auto",
    config_file: str = DEFAULT_CONFIG_FILE,
) -> Dict[str, Any]:
    """
    Executes an experimental remote control command and captures the exact API response.
    """
    config = load_config(config_file)
    username = (os.environ.get("KIA_USERNAME") or config.get("username", "")).strip()
    password = (os.environ.get("KIA_PASSWORD") or config.get("password", "")).strip()
    pin = (os.environ.get("KIA_PIN") or config.get("pin", "")).strip()
    region = int(config.get("region", 1))
    brand = int(config.get("brand", 1))

    if not username or not password:
        return {
            "success": False,
            "action": action,
            "error": "Kia Connect Zugangsdaten fehlen in config.json",
        }

    cached_token = load_cached_token()

    # Retry connection up to 2 times for transient network/timeout glitches
    vm = None
    last_conn_error = None
    for attempt in range(2):
        try:
            vm = VehicleManager(
                region=region,
                brand=brand,
                username=username,
                password=password,
                pin=pin,
                token=cached_token,
                language="de",
            )
            vm.check_and_refresh_token()
            save_cached_token(vm.token)
            break
        except Exception as exc:
            last_conn_error = exc
            time.sleep(2)

    if vm is None or not vm.token:
        return {
            "success": False,
            "action": action,
            "error": f"Verbindung zu Kia Connect fehlgeschlagen: {last_conn_error}",
        }

    # Hook session to capture raw responses
    recorder = ApiCallRecorder(vm.api.session)
    recorder.start_recording()

    if not vm.vehicles:
        vm.initialize_vehicles()

    if not vm.vehicles:
        return {
            "success": False,
            "action": action,
            "error": "Keine Fahrzeuge im Kia-Konto gefunden",
        }

    vehicle = list(vm.vehicles.values())[0]
    vehicle_id = vehicle.id
    is_ccs2 = bool(vehicle.ccu_ccs2_protocol_support)

    result_data: Dict[str, Any] = {
        "success": False,
        "action": action,
        "state": state,
        "vehicle_id": vehicle_id,
        "vehicle_name": vehicle.name,
        "is_ccs2": is_ccs2,
    }

    try:
        if action == "stop_climate":
            action_result = vm.stop_climate(vehicle_id)
            result_data["success"] = True
            result_data["message"] = "Klimatisierung erfolgreich beendet"
            result_data["api_result"] = str(action_result)

        elif action == "driver_seat_heat":
            # State: on/off, Level: 1-3 (or 1 for on, 0 for off)
            seat_val = level if state == "on" else 0
            if mode == "ccs2" or (mode == "auto" and is_ccs2):
                # Send via CCS2 temperature endpoint
                options = ClimateRequestOptions(
                    climate=True,
                    front_left_seat=seat_val,
                    heating=0,
                    set_temp=temp,
                    duration=duration,
                )
                action_result = vm.start_climate(vehicle_id, options=options)
            else:
                # For non-CCS2 vehicles, standard start_climate omits seat keys.
                # Here we explicitly construct the temperature control payload
                # including seat control keys to test if ECU/server recognizes them.
                hex_temp = get_index_into_hex_temp(
                    vm.api.temperature_range.index(temp if temp in vm.api.temperature_range else 21.0)
                )
                endpoint_url = vm.api.SPA_API_URL + "vehicles/" + vehicle_id + "/control/temperature"
                payload = {
                    "action": "start" if state == "on" else "stop",
                    "hvacType": 0,
                    "options": {
                        "defrost": False,
                        "heating1": 0,
                        "igniOnDuration": duration,
                        "drvSeatOptCmd": seat_val,
                        "front_left_seat": seat_val,
                        "seatHeaterVentCMD": {
                            "drvSeatOptCmd": seat_val,
                            "astSeatOptCmd": 0,
                            "rlSeatOptCmd": 0,
                            "rrSeatOptCmd": 0,
                        },
                    },
                    "tempCode": hex_temp,
                    "unit": "C",
                }
                headers = vm.api._get_authenticated_headers(vm.token, vehicle.ccu_ccs2_protocol_support)
                resp = vm.api.session.post(endpoint_url, json=payload, headers=headers).json()
                from hyundai_kia_connect_api.ApiImplType1 import _check_response_for_errors
                _check_response_for_errors(resp)
                action_result = resp.get("msgId", "OK")

            result_data["success"] = True
            result_data["message"] = f"Sitzheizung Fahrer ({'AN Level ' + str(seat_val) if state == 'on' else 'AUS'}) gesendet"
            result_data["api_result"] = str(action_result)

        elif action == "passenger_seat_heat":
            seat_val = level if state == "on" else 0
            if mode == "ccs2" or (mode == "auto" and is_ccs2):
                options = ClimateRequestOptions(
                    climate=True,
                    front_right_seat=seat_val,
                    heating=0,
                    set_temp=temp,
                    duration=duration,
                )
                action_result = vm.start_climate(vehicle_id, options=options)
            else:
                hex_temp = get_index_into_hex_temp(
                    vm.api.temperature_range.index(temp if temp in vm.api.temperature_range else 21.0)
                )
                endpoint_url = vm.api.SPA_API_URL + "vehicles/" + vehicle_id + "/control/temperature"
                payload = {
                    "action": "start" if state == "on" else "stop",
                    "hvacType": 0,
                    "options": {
                        "defrost": False,
                        "heating1": 0,
                        "igniOnDuration": duration,
                        "astSeatOptCmd": seat_val,
                        "front_right_seat": seat_val,
                        "seatHeaterVentCMD": {
                            "drvSeatOptCmd": 0,
                            "astSeatOptCmd": seat_val,
                            "rlSeatOptCmd": 0,
                            "rrSeatOptCmd": 0,
                        },
                    },
                    "tempCode": hex_temp,
                    "unit": "C",
                }
                headers = vm.api._get_authenticated_headers(vm.token, vehicle.ccu_ccs2_protocol_support)
                resp = vm.api.session.post(endpoint_url, json=payload, headers=headers).json()
                from hyundai_kia_connect_api.ApiImplType1 import _check_response_for_errors
                _check_response_for_errors(resp)
                action_result = resp.get("msgId", "OK")

            result_data["success"] = True
            result_data["message"] = f"Sitzheizung Beifahrer ({'AN Level ' + str(seat_val) if state == 'on' else 'AUS'}) gesendet"
            result_data["api_result"] = str(action_result)

        elif action == "steering_wheel_heat":
            # heating=3 represents steering wheel in Kia HEAT_STATUS
            sw_val = 1 if state == "on" else 0
            heat_val = 3 if state == "on" else 0
            options = ClimateRequestOptions(
                climate=False,
                steering_wheel=sw_val,
                heating=heat_val,
                duration=duration,
                set_temp=21.0,
            )
            action_result = vm.start_climate(vehicle_id, options=options)
            result_data["success"] = True
            result_data["message"] = f"Lenkradheizung ({'AN' if state == 'on' else 'AUS'}) gesendet"
            result_data["api_result"] = str(action_result)

        elif action == "rear_window_heat":
            # heating=2 represents rear window in Kia HEAT_STATUS
            heat_val = 2 if state == "on" else 0
            options = ClimateRequestOptions(
                climate=False,
                defrost=False,
                heating=heat_val,
                duration=duration,
                set_temp=21.0,
            )
            action_result = vm.start_climate(vehicle_id, options=options)
            result_data["success"] = True
            result_data["message"] = f"Heckscheibenheizung ({'AN' if state == 'on' else 'AUS'}) gesendet"
            result_data["api_result"] = str(action_result)

        elif action == "pure_cooling":
            # Isolated pure AC cooling test: heating=0, low temp (default 17.0°C), defrost=False
            options = ClimateRequestOptions(
                climate=True,
                heating=0,
                defrost=False,
                steering_wheel=0,
                set_temp=temp,
                duration=duration,
            )
            action_result = vm.start_climate(vehicle_id, options=options)
            result_data["success"] = True
            result_data["message"] = f"Isoliertes Kühlen ({temp}°C, {duration}m, Heizung=0) gesendet"
            result_data["api_result"] = str(action_result)

        else:
            return {
                "success": False,
                "action": action,
                "error": f"Unbekannter Befehl: {action}",
            }

        save_cached_token(vm.token)

    except Exception as exc:
        result_data["success"] = False
        result_data["error"] = str(exc)

    # Attach recorded HTTP details
    last_call = recorder.get_last_call()
    if last_call:
        result_data["endpoint"] = last_call.get("url")
        result_data["request_payload"] = last_call.get("json_payload")
        result_data["http_status"] = last_call.get("status_code")
        raw_json = last_call.get("json_body")
        if raw_json and isinstance(raw_json, dict):
            result_data["ret_code"] = raw_json.get("retCode")
            result_data["res_code"] = raw_json.get("resCode")
            result_data["res_msg"] = raw_json.get("resMsg")
            result_data["raw_response"] = raw_json
        else:
            result_data["raw_response"] = last_call.get("raw_body")

    return result_data


def main():
    parser = argparse.ArgumentParser(
        description="Kia Connect Experimental Remote Control Tester"
    )
    parser.add_argument(
        "action",
        choices=[
            "driver_seat_heat",
            "passenger_seat_heat",
            "steering_wheel_heat",
            "rear_window_heat",
            "pure_cooling",
            "stop_climate",
        ],
        help="Experimental action to perform",
    )
    parser.add_argument(
        "--state",
        choices=["on", "off"],
        default="on",
        help="Target state (default: on)",
    )
    parser.add_argument(
        "--level",
        type=int,
        default=1,
        choices=[1, 2, 3],
        help="Intensity level (default: 1)",
    )
    parser.add_argument(
        "--temp",
        type=float,
        default=17.0,
        help="Target temperature for cooling (default: 17.0)",
    )
    parser.add_argument(
        "--duration",
        type=int,
        default=5,
        help="Duration in minutes (default: 5)",
    )
    parser.add_argument(
        "--mode",
        choices=["auto", "standard", "ccs2"],
        default="auto",
        help="Protocol mode (auto, standard, ccs2)",
    )
    parser.add_argument(
        "--config",
        default=DEFAULT_CONFIG_FILE,
        help="Path to config.json",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output result strictly as JSON",
    )

    args = parser.parse_args()

    if not args.json:
        print(f"🔬 Starte experimentellen Befehl '{args.action}' (Status: {args.state})...")

    result = execute_experimental_command(
        action=args.action,
        state=args.state,
        level=args.level,
        temp=args.temp,
        duration=args.duration,
        mode=args.mode,
        config_file=args.config,
    )

    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
        sys.exit(0 if result.get("success") else 1)

    print("\n--- DIAGNOSE-ERGEBNIS ---")
    print(f"Aktion:        {result.get('action')} (State: {result.get('state')})")
    print(f"Erfolg:        {'✅ JA' if result.get('success') else '❌ NEIN'}")
    if result.get("message"):
        print(f"Meldung:       {result.get('message')}")
    if result.get("error"):
        print(f"Fehler:        {result.get('error')}")
    if result.get("endpoint"):
        print(f"Endpoint:      {result.get('endpoint')}")
    if result.get("request_payload"):
        print(f"Gesendeter Body:\n{json.dumps(result.get('request_payload'), indent=2)}")
    if result.get("http_status"):
        print(f"HTTP Status:   {result.get('http_status')}")
    if result.get("res_code") or result.get("res_msg"):
        print(f"Kia API Code:  {result.get('res_code')}")
        print(f"Kia API Msg:   {result.get('res_msg')}")
    if result.get("raw_response"):
        print(f"Rohe Antwort:\n{json.dumps(result.get('raw_response'), indent=2, ensure_ascii=False) if isinstance(result.get('raw_response'), dict) else result.get('raw_response')}")
    print("-------------------------\n")

    sys.exit(0 if result.get("success") else 1)


if __name__ == "__main__":
    main()
