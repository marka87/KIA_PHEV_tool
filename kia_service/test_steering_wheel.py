#!/usr/bin/env python3
"""
Test Steering Wheel Heater CLI Script
Usage:
  python kia_service/test_steering_wheel.py [--state on|off]
"""
import sys
import argparse
from experimental_controls import execute_experimental_command, DEFAULT_CONFIG_FILE

def main():
    parser = argparse.ArgumentParser(description="Test Kia Steering Wheel Heater")
    parser.add_argument("--state", choices=["on", "off"], default="on", help="State (on/off)")
    parser.add_argument("--config", default=DEFAULT_CONFIG_FILE, help="Path to config.json")
    args = parser.parse_args()

    print(f"♨️ Teste Lenkradheizung (Status: {args.state})...")

    result = execute_experimental_command(
        action="steering_wheel_heat",
        state=args.state,
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
