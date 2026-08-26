# NoName TFC browser runtime

This directory is the generated runtime boundary for `/live/`. It intentionally
does not contain copied binaries from `tfc.akuji.org`.

The live shell expects these generated artifacts:

- `xash3d-fwgs.js` — an ES module exporting the WebXash3D `Xash3D` class.
- Xash3D engine `.wasm` files referenced by that module.
- TF15 client and menu `.wasm` files compiled from `Velaron/tf15-client`.
- `tfc-manifest.json` plus the licensed game files required by the virtual
  filesystem.

The runtime module must support `init()`, `main()`, `Cmd_ExecuteString()`, and
optionally `quit()`. `../xash-adapter.js` is the only site code that should know
that interface.

Do not commit RCON, SSH, API, or administrative credentials here. The public
pickup password is configured in `../config.js`; spectator restrictions still
must be enforced by the game server or relay.
