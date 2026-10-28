# Pulse Disc (test version)

Pulse as a disc that floats on your desktop, with no window around it: a see-through, frameless,
always-on-top window the size of the disc. The corners let clicks through, so only the disc is there.

- Plays the starter pack on a loop, with Pulse's own sound. Your own sessions come next.
- Drag the disc anywhere; it remembers where you left it.
- Hover for play/pause and next. Click the disc to play or pause. Space plays or pauses, N skips.
- Right-click for the menu: play/pause, next, sound on/off, always on top, quit.

Build a runnable folder (downloads Electron's official build and checks it against Electron's checksums):

```
desktop/assemble.sh win32-x64      # or linux-x64
```

This test version is not signed, so Windows may ask once before opening it.
