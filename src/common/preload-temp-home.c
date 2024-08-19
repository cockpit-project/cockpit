/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#include "config.h"

#include <dlfcn.h>
#include <pwd.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <assert.h>

static void *
get_libc_func(const char *f)
{
    void *fp;
    fp = dlsym(RTLD_NEXT, f);
    assert(fp);
    return fp;
}

#define libc_func(name, rettype, ...)			\
    static rettype (*_ ## name) (__VA_ARGS__) = NULL;	\
    if (_ ## name == NULL)				\
        _ ## name = get_libc_func(#name);

/**
 * Change pw_dir to the value of $HOME for the current uid.
 * This is useful for libssh's expansion of ~ to point to our temporary test
 * $HOME instead of the real one from /etc/passwd.
 *
 */
int getpwuid_r(uid_t uid, struct passwd *pwd, char *buf, size_t buflen, struct passwd **result)
{
    int res;
    libc_func(getpwuid_r, int, uid_t, struct passwd *, char*, size_t, struct passwd **);
    res = _getpwuid_r(uid, pwd, buf, buflen, result);
    if (res == 0 && uid == getuid()) {
        /* fprintf(stderr, "temp-home wrapped getpwuid_r(uid %i): changing original home %s to $HOME %s\n", (int) uid, pwd->pw_dir, getenv("HOME")); */
        /* note: in theory the caller might change this and thus change the
         * environment, but this is only for the unit tests where we know that
         * libssh doesn't do that, so avoid any unnecessary copying here */
        pwd->pw_dir = getenv("HOME");
    }
    return res;
}
