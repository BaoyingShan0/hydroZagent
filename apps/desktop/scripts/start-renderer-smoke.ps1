# Codex/CI may export ELECTRON_RUN_AS_NODE=1; Electron then exposes no app API.
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npx electron-vite --remoteDebuggingPort 9222 --logLevel warn
