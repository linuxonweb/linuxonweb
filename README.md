# linuxonweb

Index of the source repositories used by the linuxonweb browser guest: a Linux
kernel, X server, Mesa, the Mesa-based graphics test programs, musl libc and a
few small userspace programs. Each one is a git submodule pinned to a commit.

## Subrepos

| Path | What it is | Upstream | Pinned to |
| --- | --- | --- | --- |
| `linux/` | Linux kernel source (snapshot) | https://github.com/torvalds/linux | upstream `40288c920` |
| `xserver/` | X.Org server source (snapshot) | https://gitlab.freedesktop.org/xorg/xserver | upstream `306071c` |
| `mesa/` | Mesa 26.2.3 source (snapshot) | https://gitlab.freedesktop.org/mesa/mesa | tag `mesa-26.2.3` (`31e9a6b`) |
| `musl/` | musl libc 1.2.6 source (snapshot) | https://git.musl-libc.org/git/musl | tag `v1.2.6` |
| `vkmark/` | vkmark Vulkan benchmark | https://github.com/vkmark/vkmark | upstream `83a128d` |
| `glmark2/` | glmark2 OpenGL benchmark | https://github.com/glmark2/glmark2 | upstream `22c527c` |
| `firefox/` | Firefox 159.0a1 source for the wasm guest, with the linuxonweb build recipe (see `firefox/LINUXONWEB-WASM-BUILD.md`) | https://github.com/mozilla-firefox/firefox (mozilla-central `dfc77f7a6d`) | upstream `bf9757d91e` + linuxonweb commit |
| `guest-glremote/` | GL bridge for the wasm guest (`glremote.c`, `ops.def`, `build.sh`) | linuxonweb project | project commit `3de18d3` |
| `guest-gpu-stack/` | Zink/Mesa wasm config, guest Vulkan ICD, wgpu host crate, vkmark/glmark2 build scripts, Firefox packagers | linuxonweb project | project commit `3de18d3` |
| `glgears/` | glxgears port for the wasm guest (linuxonweb code) | linuxonweb project | project commit `3de18d3` |
| `htop/` | htop process viewer | https://github.com/htop-dev/htop | tag `3.5.1` |
| `tinyx/` | tinyx userspace patch and helper for the wasm X server | linuxonweb project | project tree |

The Firefox repo keeps two commits: the upstream base, then the linuxonweb changes.
The other snapshots are single commits with the upstream files, not the upstream
git history. The upstream URL and pinned commit are in its commit message.
`tinyx/`, `glgears/`, `guest-glremote/` and `guest-gpu-stack/` are linuxonweb's own code.

## Not included

- **Firefox 128 ESR source tarball** (`firefox-128.14.0esr.source.tar.xz`,
  480 MB): an older version, and larger than GitHub's 100 MB file limit.
  The Firefox 159.0a1 source is in `firefox/` instead.
- **Build outputs**: prebuilt wasm, initramfs images, `obj-nightly/`, caches.
- **Toolchain**: the Nix store (wasm32-musl LLVM 22.1.8, binaryen, rustc
  nightly), which `firefox/linuxonweb-build/recipe/environment.sh` names.
- **Vulkan-Headers 1.3.231**, used by the guest ICD. It is upstream
  KhronosGroup/Vulkan-Headers and is not vendored here.
- **The web app** (`web/desktop`, the browser page and publisher).

## How to use

Clone with all submodules:

```sh
git clone --recurse-submodules git@github.com:linuxonweb/linuxonweb.git
cd linuxonweb
```

If you already cloned without them:

```sh
git submodule update --init --recursive
```

Update one subrepo to the newest commit on its `main` branch:

```sh
git -C mesa pull origin main
git add mesa && git commit -m "Update mesa"
```

Build notes:

- `mesa/` is built for wasm32 by `tools/zink/configure-wasm32.sh` in the
  linuxonweb project, which expects `mesa-26.2.3/` in its task directory.
- `vkmark/` and `glmark2/` are built by `tools/guest-gpu-bench/*-build.sh`
  in the project.
- `glgears/` is built by `build-glgears.sh` in the project, using the Mesa
  and ICD output from the step above.
- `musl/` is pinned to the v1.2.6 git tag. The project's wasm toolchain
  uses a Nix-built musl 1.2.6, which may include patches not in this
  snapshot. Check that before relying on it for a bit-exact build.
- The project scripts still use `/mnt/p6/...` paths. Adjust them when you
  run them somewhere else.

Each subrepo keeps its upstream licence. See the licence file in each one.
