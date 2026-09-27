#!/usr/bin/env python3
"""
Test Isolated Pure Cooling (AC only, heating=0) CLI Script
Usage:
  python kia_service/test_pure_cooling.py [--temp 17.0] [--duration 5]
"""
import sys
import argparse
from experimental_controls import execute_experimental_command, DEFAULT_CONFIG_FILE

def main():
    parser = argparse.ArgumentParser(description="Test Kia Pure AC Cooling")
    parser.add_argument("--temp", type=float, default=17.0, help="Target temp (default: 17.0)")
    parser.add_argument("--duration", type=int, default=5, help="Duration in min (default: 5)")
    parser.add_argument("--config", default=DEFAULT_CONFIG_FILE, help="Path to config.json")
    args = parser.parse_args()

    print(f"❄️ Teste isolierte Klimakühlung ({args.temp}°C, {args.duration}m, Heizung=0)...")

    result = execute_experimental_command(
        action="pure_cooling",
        temp=args.temp,
        duration=args.duration,
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
