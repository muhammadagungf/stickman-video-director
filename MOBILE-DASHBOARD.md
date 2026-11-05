# Stickman Autopilot — Mobile Dashboard

This dashboard is a local control panel for the existing Autopilot runtime. It does not replace production rules or approval gates.

## Start from Codespaces

1. Open this repository in Codespaces.
2. Open the Command Palette and choose **Tasks: Run Task**.
3. Select **Start Stickman Mobile Dashboard**.
4. Open the **Ports** panel, find port **4173**, and choose **Open in Browser**.
5. Keep the forwarded port **Private**. Do not make it Public.

The dashboard is served by the Codespace. Keep the Codespace running while using it.

## First version

- Local dependency check (doctor); no Gemini network request.
- Create a project under the workspace projects/ directory, outside the installed Skill.
- Copy the existing narration.txt into the new project when that source file exists.
- Run a scoped preview, record explicit user approval, and render the full film.
- Download generated preview/final MP4 and contact sheets.

The project scaffold is not a finished video. Narration audio, aligned captions, authored visual shots and SFX still need to be prepared before preview/render can pass validation.

## Safety

- The server exposes only fixed Autopilot actions; it does not accept arbitrary shell commands.
- POST actions are restricted to same-origin browser requests.
- Keep the Codespaces forwarded port Private.
- No TTS/image generation endpoint is enabled in this first version. Verify provider access, quota and billing and obtain explicit cost authorization before adding API-backed generation.
- Do not store API keys in the dashboard or commit them to the repository.
