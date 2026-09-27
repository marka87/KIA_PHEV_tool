#!/usr/bin/env python3
"""
Test Seat Heater CLI Script
Usage:
  python kia_service/test_seat_heater.py [--passenger] [--state on|off] [--level 1|2|3]
"""
import sys
import argparse
from experimental_controls import execute_experimental_command, DEFAULT_CONFIG_FILE

def main():
    parser = argparse.ArgumentParser(description="Test Kia Seat Heater")
    parser.add_argument("--passenger", action="store_true", help="Target passenger seat instead of driver seat")
    parser.add_argument("--state", choices=["on", "off"], default="on", help="State (on/off)")
    parser.add_argument("--level", type=int, choices=[1, 2, 3], default=1, help="Heater level (1-3)")
    parser.add_argument("--config", default=DEFAULT_CONFIG_FILE, help="Path to config.json")
    args = parser.parse_args()

    action = "passenger_seat_heat" if args.passenger else "driver_seat_heat"
    target = "Beifahrersitz" if args.passenger else "Fahrersitz"
    print(f"🔥 Teste Sitzheizung ({target}, Status: {args.state}, Stufe: {args.level})...")

    result = execute_experimental_command(
        action=action,
        state=args.state,
        level=args.level,
        config_file=args.config,
    )

    print("\n--- TEST ERGEBNIS ---")
    print(f"Erfolg:      {'✅ JA' if result.get('success') else '❌ NEIN'}")
    if result.get("message"):
        print(f"Meldung:     {result.get('message')}")
    if result.get("error"):
        print(f"Fehler:      {result.get('error')}")
    if result.get("res_code") or result.get("res_msg"):
        print(f"Kia Code:    {result.get('res_code')} ({result.get('res_msg')})")
    if result.get("raw_response"):
        print(f"Rohe Antwort: {result.get('raw_response')}")
    print("---------------------\n")
    sys.exit(0 if result.get("success") else 1)

if __name__ == "__main__":
    main()
