/* Linux/Wasm apk-tools script helper: spawn a real process, then chroot/exec.
 * This replaces only fork's child setup; package script failures remain failures.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
extern char **environ;
int main(int argc, char **argv) {
    if (argc < 4 || (strcmp(argv[1], "--chroot") && strcmp(argv[1], "--no-chroot"))) {
        fputs("apk-script: invalid internal invocation\n", stderr); return 127;
    }
    umask(0022);
    if (fchdir(3) != 0) { perror("apk-script: fchdir"); return 127; }
    if (!strcmp(argv[1], "--chroot") && chroot(".") != 0) { perror("apk-script: chroot"); return 127; }
    close(3);
    execve(argv[2], argv + 3, environ);
    perror("apk-script: execve");
    return 127;
}
