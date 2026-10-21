# NSIS runtime-variable regression streams

`nsis-r0-streams.json` contains gzip/base64 archive streams compiled with the
app-builder-lib 26.16.1 pinned NSIS 3.12 bundle. Tests prepend an inert PE prefix;
neither installers nor payload executables are run. These fixtures prove archive
parsing and installed-tree integrity only.

The positive archive contains `$PLUGINSDIR/app-64.7z` and compressed
`$R0/Uninstall LAWOSS.exe`. The negative additionally contains a distinct root
`Uninstall LAWOSS.exe`, which must be refused as an ambiguous installed basename.
The helper's installed uninstaller is `expected embedded uninstaller bytes`
repeated 1000 times (35000 bytes). Both use the existing tiny x64 payload bytes.

The compiler input switches to `SetOutPath "$R0"` immediately before
`File "/oname=Uninstall LAWOSS.exe" "uninstall.bin"`; the ambiguous variant also
adds a distinct uninstaller before this switch. The application `.7z` is stored
without outer compression; uninstallers use zlib.

Pinned [official toolset](https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis%401.2.1/nsis-bundle-3.12.tar.gz)
SHA-256: `56997fdefe25e7928a1a68b4583d08b240b66cf660234053b20131a74cc082f4`.
Mac ARM64 compiler SHA-256:
`687539745c997e5cdaea6fd96333e5912bfd073ea91c18450700e5ff78b0990b`.
Uncompressed stream hashes, in positive/negative order:
`932525fe38d2dd5810c5af9dfadc62f71d6beb604ee59308db8b7f639d3225f4`,
`0ce27aa13bd2c8e19b34c71e42a7635b7188c3281f710650e19224f13287f991`.

The exact `$R0` layout was independently observed in the actual final LAWOSS
Windows x64 installer on 2026-10-21, workflow run 39656432934, checkout
737f25700f1b036bc89ee020750ffbf7121d388c, installer SHA-256
`6e1c6d4eb82a80d599e29891975a332011790f29984b32edacca64b58a4b1d1c`.
