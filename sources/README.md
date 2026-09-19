# Upstream source snapshots

These directories are upstream checkouts kept separate from the browser
adapter. They are intentionally not patched.

| Project | Remote | Revision | State |
| --- | --- | --- | --- |
| Linux | `https://github.com/torvalds/linux.git` | `40288c920` | shallow checkout, materialized |
| X server | `https://gitlab.freedesktop.org/xorg/xserver.git` | `306071c0b` | shallow checkout, materialized |
| Firefox | `https://github.com/mozilla-firefox/firefox.git` | `b16f852ba` | shallow partial clone; Git object fetch completed, but this environment timed out while materializing the very large working tree |

The Firefox revision and source metadata are available for adapter analysis;
retry checkout with `git -C sources/firefox restore --source=HEAD :/` on a
network with enough time and disk if a complete tree is required.
