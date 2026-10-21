# Startup and recovery

An installed LAWOSS starts on its native host, preserves its synthetic workspace after restart and exposes failures truthfully.

## Sub-features

- `startup`: embedded SHA, OS/arch, executable, owned profile and visible initial screen.
- `restart`: same client, matter, memory and preferences after an actual stop/relaunch.
- `error-recovery`: unavailable directory/provider produces an explicit error and recovers after restoration.

## How to get to it (user POV)

Start the installed application, open the selected client and matter, then quit and reopen. Directory failures occur when the selected synthetic directory becomes unavailable.

## Driving it with native alpha runner

Preconditions: exact final artifact, synthetic profile and native capture capability.

- Run the helper. `startup` records live identity and a native owned-window image.
- Record the selected client/matter/settings before the `restart` prompt; verify them after the runner relaunches the same artifact/profile.
- Temporarily move only a disposable synthetic client folder, observe the error, restore it and verify the client reappears. Test invalid provider state without sending real content.

## Gotchas

Startup is not all-feature acceptance. Keep failing cleanup leases. Windows descendant closure or missing native capture support blocks a receipt; a renderer screenshot cannot prove a native picker.
