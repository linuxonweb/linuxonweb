#!/bin/busybox sh

PATH=/bin:/sbin:/usr/bin:/usr/sbin
export PATH
export DISPLAY=:0
export HOME=/home/admin
export USER=admin
export LOGNAME=admin
export TERM=xterm-256color
export SHELL=/bin/sh
export XDG_RUNTIME_DIR=/tmp
export SSL_CERT_FILE=/etc/ssl/cert.pem
export CURL_CA_BUNDLE=/etc/ssl/cert.pem
export SSL_CERT_DIR=/etc/ssl/certs

mount -t devtmpfs devtmpfs /dev
mount -t proc proc /proc
mount -t sysfs sysfs /sys
# wasm is NOMMU, so ramfs is used for writable runtime directories.
mkdir -p /run /tmp /workspace
mount -t ramfs ramfs /run 2>/dev/null || true
mount -t ramfs ramfs /tmp 2>/dev/null || true
mount -t ramfs ramfs /workspace 2>/dev/null || true
chmod 01777 /tmp
mkdir -p /dev/shm
mount -t ramfs -o mode=1777 ramfs /dev/shm 2>/dev/null || true
chmod 01777 /dev/shm

# Give the guest desktop account access to the devices used by TinyX/input.
chown 1000:1000 /dev/fb0 /dev/tty1 2>/dev/null || true

if [ -x /bin/linux-guest-agent ]; then
  /bin/linux-guest-agent &
fi

ifconfig lo up 2>/dev/null || true
if [ -d /sys/class/net/eth0 ]; then
  ifconfig eth0 192.0.2.2 netmask 255.255.255.0 up
  route add default gw 192.0.2.1 eth0 2>/dev/null || \
    ip route add default via 192.0.2.1 dev eth0 2>/dev/null || true
  echo "network: eth0 192.0.2.2/24 gw 192.0.2.1" >&2
  if [ ! -e /network-smoke-skip ]; then
    (
      if command -v wget >/dev/null 2>&1; then
        wget -q -O /tmp/wget-google.out --timeout=25 google.com && \
          echo "network: wget google.com ok" >&2 || echo "network: wget google.com FAILED" >&2
      fi
      if command -v curl >/dev/null 2>&1; then
        curl -fsSIL --max-time 25 -o /tmp/curl-google.hdr https://www.google.com/ && \
          echo "network: curl https://www.google.com ok" >&2 || echo "network: curl https://www.google.com FAILED" >&2
      fi
    ) &
    if [ -e /network-smoke ]; then wait; fi
  fi
else
  echo "network: no eth0 (host did not attach virtio-net)" >&2
fi

mkdir -p /home/admin/Desktop /home/admin/Documents /home/admin/Downloads
chown -R 1000:1000 /home/admin
chmod 0700 /home/admin
echo "hello from aurora-wm on wasm" > /home/admin/Documents/readme.txt
echo "sample" > /home/admin/Downloads/note.txt
cat > /home/admin/Documents/browse.txt <<'EOF'
Guest network is up (virtio-net -> WebSocket TCP proxy).
Try:  wget google.com
      curl -I https://www.google.com/
EOF
chown 1000:1000 /home/admin/Documents/* /home/admin/Downloads/* 2>/dev/null || true

if [ -r /etc/fonts/fonts.conf ]; then
  export FONTCONFIG_FILE=/etc/fonts/fonts.conf
  mkdir -p /var/cache/fontconfig
elif [ -d /share/fonts/X11/misc ]; then
  export FONTCONFIG_PATH=/share/fonts/X11
fi

if [ -c /dev/tty1 ]; then chvt 1 2>/dev/null || true; fi

screen_mode=1024x768x32
if [ -r /sys/class/graphics/fb0/virtual_size ]; then
  framebuffer_size="$(cat /sys/class/graphics/fb0/virtual_size 2>/dev/null)"
  framebuffer_width="${framebuffer_size%%,*}"
  framebuffer_height="${framebuffer_size#*,}"
  case "$framebuffer_width:$framebuffer_height" in
    *[!0-9:]*|:|*:) ;;
    *) screen_mode="${framebuffer_width}x${framebuffer_height}x32" ;;
  esac
fi

echo "display: starting Xfbdev as admin at $screen_mode" >&2
/bin/su -s /bin/sh -c "export HOME=/home/admin USER=admin LOGNAME=admin DISPLAY=:0; exec /bin/Xfbdev :0 -ac -screen '$screen_mode' -nolisten tcp -fp /share/fonts/X11/misc,/share/fonts/X11/cursor" admin &
xpid=$!

i=0
while [ "$i" -lt 50 ]; do
  if [ -S /tmp/.X11-unix/X0 ] || [ -e /tmp/.X11-unix/X0 ]; then break; fi
  i=$((i + 1))
  sleep 0.1 2>/dev/null || sleep 1
done

if ! kill -0 "$xpid" 2>/dev/null; then
  echo "Xfbdev failed to start as admin" >&2
  exec setsid cttyhack sh
fi

launch_firefox() {
  account="$1"
  home="$2"
  echo "starting /bin/firefox as $account" >&2
  /bin/su -s /bin/sh -c "export HOME=$home USER=$account LOGNAME=$account DISPLAY=:0 XDG_CONFIG_HOME=$home/.config XDG_CACHE_HOME=$home/.cache; exec /bin/firefox --no-remote --new-instance https://www.bing.com" "$account"
}

if grep -qw 'firefox=1' /proc/cmdline && [ -x /bin/firefox ]; then
  export MOZ_FORCE_DISABLE_E10S=1
  export MOZ_DISABLE_CONTENT_SANDBOX=1
  export MOZ_ENABLE_WAYLAND=0
  mkdir -p /home/admin/.mozilla /home/admin/.cache /home/firefox/.mozilla /home/firefox/.cache
  chown -R 1000:1000 /home/admin /home/firefox
  echo "firefox test mode: launching as admin in 10 seconds" >&2
  (
    sleep 10
    if [ -w /proc/sys/debug/exception-trace ]; then echo 1 > /proc/sys/debug/exception-trace; fi
    launch_firefox admin /home/admin
    firefox_status=$?
    if [ "$firefox_status" -ne 0 ] && [ -f /etc/passwd ] && grep -q '^firefox:' /etc/passwd; then
      echo "admin Firefox exited ($firefox_status); trying UID1000 firefox fallback" >&2
      launch_firefox firefox /home/firefox
      firefox_status=$?
    fi
    echo "firefox exited with status $firefox_status" >&2
  ) &
elif grep -qw 'firefox=1' /proc/cmdline && [ -x /bin/js ]; then
  echo "firefox test mode requested, but GUI binary is missing; SpiderMonkey /bin/js is installed" >&2
elif grep -qw 'firefox=1' /proc/cmdline; then
  echo "firefox test mode requested, but firefox is not installed on PATH" >&2
fi

if [ -x /bin/aurora-wm ]; then
  echo "starting /bin/aurora-wm --compositor=no as admin" >&2
  /bin/su -s /bin/sh -c 'export HOME=/home/admin USER=admin LOGNAME=admin DISPLAY=:0; exec /bin/aurora-wm --compositor=no' admin
  echo "aurora-wm exited with status $?; falling back to admin xterm" >&2
fi

exec /bin/su -s /bin/sh -c 'export HOME=/home/admin USER=admin LOGNAME=admin DISPLAY=:0; exec /bin/xterm -ls -e htop' admin
