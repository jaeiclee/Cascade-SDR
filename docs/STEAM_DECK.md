# Run Cascade SDR on Steam Deck

This guide installs the SteamOS Flatpak and adds it to Steam's Gaming Mode.

## Install the Flatpak

1. Switch to Desktop Mode.
2. Open the [Cascade-SDR Steam Deck preview release](https://github.com/jaeiclee/Cascade-SDR/releases/tag/steam-deck-preview-2026-10-31-r2).
3. Download `cascade-sdr.flatpak` and `SHA256SUMS`.
4. Open Konsole in the download folder and verify the bundle:

   ```sh
   sha256sum -c SHA256SUMS
   ```

5. Install the bundle:

   ```sh
   flatpak install --user ./cascade-sdr.flatpak
   ```

6. Start the app from the applications menu, or run:

   ```sh
   flatpak run io.github.jaeiclee.CascadeSDR
   ```

## Add the app to Gaming Mode

1. Open Steam in Desktop Mode.
2. Choose **Games**, then **Add a Non-Steam Game to My Library**.
3. Add Cascade SDR if Steam lists it. If it does not, add `/usr/bin/flatpak`.
4. Open the new entry's properties. Set **Launch Options** to `run io.github.jaeiclee.CascadeSDR`.
5. Return to Gaming Mode and start Cascade SDR from the library.

The app opens fullscreen, selects SSTV, and starts on its ISS 70 cm preset at 437.550 MHz. Check the current ARISS event announcement before a pass. Use the frequency menu if the event specifies a different downlink.

## USB access and limits

The Flatpak requests access to USB devices so `librtlsdr` can open the dongle. This grants access to USB devices generally, not only the RTL-SDR. Install bundles only from a source you trust. Flatpak 1.15.11 or newer is required for this permission.

The package builds on GitHub Actions. This repository has not been tested on a Steam Deck, and the physical RTL-SDR connection and live SSTV reception remain unverified here.
