#define _GNU_SOURCE

/*
 * Minimal passwordless sudo for the single guest desktop account.
 *
 * This must be installed by the rootfs builder as root:root, mode 04755. A
 * shell script cannot change uid on this guest: /bin/su is a non-setuid
 * BusyBox applet. Keep this helper deliberately small and reject every
 * caller except admin (uid 1000) or an already-root caller.
 */
#include <errno.h>
#include <grp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <unistd.h>

static int fail(const char *operation) {
    dprintf(2, "sudo: %s: %s\n", operation, strerror(errno));
    return 1;
}

int main(int argc, char **argv) {
    uid_t uid = getuid();
    if (uid != 0 && uid != (uid_t)1000) {
        dprintf(2, "sudo: uid %lu is not authorized\n", (unsigned long)uid);
        return 1;
    }

    if (uid != 0) {
        gid_t root_gid = (gid_t)0;
        if (setgroups(1, &root_gid) != 0 || setgid(root_gid) != 0 ||
            setuid((uid_t)0) != 0)
            return fail("setuid");
    }
    if (getuid() != (uid_t)0 || geteuid() != (uid_t)0 ||
        getgid() != (gid_t)0 || getegid() != (gid_t)0)
        return fail("failed to become root");

    /* Do not let an admin-controlled PATH select a root command. */
    if (setenv("PATH", "/usr/sbin:/usr/bin:/sbin:/bin", 1) != 0)
        return fail("set PATH");
    if (argc == 1) {
        char *const shell[] = { (char *)"/bin/sh", NULL };
        execv(shell[0], shell);
    } else {
        execvp(argv[1], &argv[1]);
    }
    return fail("exec");
}
