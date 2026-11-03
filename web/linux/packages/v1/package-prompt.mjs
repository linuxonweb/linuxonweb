// Both normal and recovery init paths set this exact PS1 before execing ash.
// An APK progress bar can end in "# "; it is never an interactive shell prompt.
export function hasInitialNativePrompt(pending) {
  return pending.replaceAll('\r', '') === 'linux:/home/admin # ';
}
