# Portable OKF reader

Keep this entry point browser-safe and read-only. Import parser/schema/validator modules directly; the okf-pamat barrel also exports filesystem and write operations. App and Obsidian share these rules and fixtures. Temporary snapshots are discarded on unload; persistence requires a separate decision under ADR 0014.
