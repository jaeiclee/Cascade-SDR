#!/bin/sh
set -eu

python_version="$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
export PYTHONPATH="/app/share/cascade-sdr/backend:/app/lib/python${python_version}/site-packages${PYTHONPATH:+:$PYTHONPATH}"
export LD_LIBRARY_PATH="/app/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

python3 -c 'from app.device import _HAVE_RTLSDR; assert _HAVE_RTLSDR, "librtlsdr did not load"; import webview.platforms.gtk; print("GTK WebKit and librtlsdr imports passed")'
