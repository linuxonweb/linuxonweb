// URL path -> GitHub release asset name. boot-manifest.json and
// desktop-extras.cpio.json carry the sha256/size of the packages, so all of
// these must come from the same release.
export const RELEASE_FILES = {
  '/linux/boot-manifest.json': 'boot-manifest.json',
  '/linux/vmlinux.wasm': 'vmlinux.wasm',
  '/linux/initramfs.cpio': 'initramfs.cpio',
  '/linux/initramfs-firefox.cpio.gz': 'initramfs-firefox.cpio.gz',
  '/linux/desktop-extras.cpio.json': 'desktop-extras.cpio.json',
  '/linux/desktop-extras.cpio': 'desktop-extras.cpio',
  '/linux/desktop-extras.cpio.gz': 'desktop-extras.cpio.gz',
};
