"""Headless visual smoke check for the hydroZagent renderer preview."""

from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
SCREENSHOT = ROOT / "hydro-ui-smoke.png"


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 960}, device_scale_factor=1)
    console_errors: list[str] = []
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.goto("http://127.0.0.1:5181", wait_until="domcontentloaded")
    # Browser preview polls the local Web API, so a permanent network-idle state
    # is not guaranteed. Still attempt it to flush lazy chunks before asserting.
    try:
        page.wait_for_load_state("networkidle", timeout=5_000)
    except PlaywrightTimeoutError:
        pass
    page.locator("#boot-overlay").wait_for(state="detached")
    page.screenshot(path=str(SCREENSHOT), full_page=True)
    if page.locator("text=浙水智能体").count() == 0:
        raise AssertionError(
            "Brand lockup missing. Rendered text:\n"
            + page.locator("body").inner_text()[:4_000]
            + "\nConsole errors:\n"
            + "\n".join(console_errors)
        )
    capability = page.locator("[aria-label='水利业务能力']")
    if capability.count() == 0:
        raise AssertionError("Hydro welcome surface missing. Rendered text:\n" + page.locator("body").inner_text()[:4_000])
    capability.wait_for(state="visible")
    page.locator("text=AI 赋能水利 · 智慧守护江河").wait_for(state="visible")
    if console_errors:
        raise AssertionError("Renderer console errors:\n" + "\n".join(console_errors))
    browser.close()

print(f"visual smoke passed: {SCREENSHOT}")
