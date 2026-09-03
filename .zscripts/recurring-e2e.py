#!/usr/bin/env python3
"""One-shot browser E2E for the Recurring Billing view (contention-tolerant)."""
import re
import subprocess
import time

PROJ = "/home/z/my-project"


def ab(*args, timeout=45):
    return subprocess.run(
        ["agent-browser", *args], capture_output=True, text=True, timeout=timeout
    )


def snapshot():
    r = ab("snapshot")
    return r.stdout + r.stderr


def main_heading():
    m = re.search(r'- heading "([^"]+)" \[level=1', snapshot())
    return m.group(1) if m else ""


def ref_for(pattern, snap):
    m = re.search(pattern + r"\s*\[ref=(e\d+)\]", snap)
    return m.group(1) if m else None


def click_ref(ref):
    return ab("click", f"@{ref}")


# 1) Get to the Recurring Billing view
ok_view = False
for attempt in range(6):
    h = main_heading()
    print(f"[try {attempt}] main heading: {h}")
    if h == "Recurring Billing":
        ok_view = True
        break
    snap = snapshot()
    ref = ref_for(r'button "Recurring Billing"', snap)
    if ref:
        click_ref(ref)
    else:
        ab("reload")
    time.sleep(2.5)

if not ok_view:
    raise SystemExit("FAIL: could not reach Recurring Billing view")

time.sleep(1.5)
print(ab("screenshot", f"{PROJ}/cron-19-recurring.png").stdout)

# 2) Open the New Template dialog
ok_dialog = False
for attempt in range(5):
    snap = snapshot()
    ref = ref_for(r'button "New Template"', snap)
    if ref:
        click_ref(ref)
        time.sleep(1.5)
        if "New Recurring Template" in snapshot():
            ok_dialog = True
            break
    time.sleep(1.5)

if not ok_dialog:
    raise SystemExit("FAIL: could not open New Template dialog")

print(ab("screenshot", f"{PROJ}/cron-19-recurring-dialog.png").stdout)

# 3) Close the dialog (Esc)
ab("press", "Escape")
time.sleep(1)

print("DONE: screenshots captured")
