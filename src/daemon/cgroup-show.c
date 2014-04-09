/***
  This file is no longer part of systemd.

  Copyright 2010 Lennart Poettering
  Copyright 2012 Red Hat

  systemd is free software; you can redistribute it and/or modify it
  under the terms of the GNU Lesser General Public License as published by
  the Free Software Foundation; either version 2.1 of the License, or
  (at your option) any later version.

  systemd is distributed in the hope that it will be useful, but
  WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
  Lesser General Public License for more details.

  You should have received a copy of the GNU Lesser General Public License
  along with systemd; If not, see <http://www.gnu.org/licenses/>.
***/

#include "config.h"

#include <stdio.h>
#include <string.h>
#include <dirent.h>
#include <errno.h>
#include <stdlib.h>
#include <assert.h>
#include <unistd.h>
#include <limits.h>
#include <stdarg.h>
#include <ctype.h>

#include "cgroup-show.h"

#define SYSTEMD_CGROUP_CONTROLLER "name=systemd"

#define NEWLINE "\n\r"

static void fclosep(FILE **f) {
        if (*f)
                fclose(*f);
}

#define _unlikely_(x) (__builtin_expect(!!(x),0))
#define _malloc_ __attribute__ ((malloc))
#define _sentinel_ __attribute__ ((sentinel))
#define _cleanup_fclose_ __attribute__((cleanup(fclosep)))

_malloc_  static inline void *malloc_multiply(size_t a, size_t b) {
        if (_unlikely_(b == 0 || a > ((size_t) -1) / b))
                return NULL;

        return malloc(a * b);
}

#define new(t, n) ((t*) malloc_multiply(sizeof(t), (n)))

#ifndef MAX
#define MAX(a,b)                                \
        __extension__ ({                        \
                        typeof(a) _a = (a);     \
                        typeof(b) _b = (b);     \
                        _a > _b ? _a : _b;      \
                })
#endif

#ifndef MIN
#define MIN(a,b)                                \
        __extension__ ({                        \
                        typeof(a) _a = (a);     \
                        typeof(b) _b = (b);     \
                        _a < _b ? _a : _b;      \
                })
#endif

static char* startswith(const char *s, const char *prefix) {
        const char *a, *b;

        assert(s);
        assert(prefix);

        a = s, b = prefix;
        for (;;) {
                if (*b == 0)
                        return (char*) a;
                if (*a != *b)
                        return NULL;

                a++, b++;
        }
}

static char *strjoin(const char *x, ...) {
        va_list ap;
        size_t l;
        char *r, *p;

        va_start(ap, x);

        if (x) {
                l = strlen(x);

                for (;;) {
                        const char *t;
                        size_t n;

                        t = va_arg(ap, const char *);
                        if (!t)
                                break;

                        n = strlen(t);
                        if (n > ((size_t) -1) - l) {
                                va_end(ap);
                                return NULL;
                        }

                        l += n;
                }
        } else
                l = 0;

        va_end(ap);

        r = new(char, l+1);
        if (!r)
                return NULL;

        if (x) {
                p = stpcpy(r, x);

                va_start(ap, x);

                for (;;) {
                        const char *t;

                        t = va_arg(ap, const char *);
                        if (!t)
                                break;

                        p = stpcpy(p, t);
                }

                va_end(ap);
        } else
                r[0] = 0;

        return r;
}

static char *truncate_nl(char *s) {
        assert(s);

        s[strcspn(s, NEWLINE)] = 0;
        return s;
}

static int read_one_line_file(const char *fn, char **line) {
        _cleanup_fclose_ FILE *f = NULL;
        char t[LINE_MAX], *c;

        assert(fn);
        assert(line);

        f = fopen(fn, "re");
        if (!f)
                return -errno;

        if (!fgets(t, sizeof(t), f)) {

                if (ferror(f))
                        return errno ? -errno : -EIO;

                t[0] = 0;
        }

        c = strdup(t);
        if (!c)
                return -ENOMEM;
        truncate_nl(c);

        *line = c;
        return 0;
}

static int get_process_comm(pid_t pid, char **name) {
        int r;

        assert(name);

        if (pid == 0)
                r = read_one_line_file("/proc/self/comm", name);
        else {
                char *p;
                if (asprintf(&p, "/proc/%lu/comm", (unsigned long) pid) < 0)
                        return -ENOMEM;

                r = read_one_line_file(p, name);
                free(p);
        }

        return r;
}

static int get_process_cmdline(pid_t pid, size_t max_length, bool comm_fallback, char **line) {
        char *r, *k;
        int c;
        bool space = false;
        size_t left;
        FILE *f;

        assert(max_length > 0);
        assert(line);

        if (pid == 0)
                f = fopen("/proc/self/cmdline", "re");
        else {
                char *p;
                if (asprintf(&p, "/proc/%lu/cmdline", (unsigned long) pid) < 0)
                        return -ENOMEM;

                f = fopen(p, "re");
                free(p);
        }

        if (!f)
                return -errno;

        r = new(char, max_length);
        if (!r) {
                fclose(f);
                return -ENOMEM;
        }

        k = r;
        left = max_length;
        while ((c = getc(f)) != EOF) {

                if (isprint(c)) {
                        if (space) {
                                if (left <= 4)
                                        break;

                                *(k++) = ' ';
                                left--;
                                space = false;
                        }

                        if (left <= 4)
                                break;

                        *(k++) = (char) c;
                        left--;
                }  else
                        space = true;
        }

        if (left <= 4) {
                size_t n = MIN(left-1, 3U);
                memcpy(k, "...", n);
                k[n] = 0;
        } else
                *k = 0;

        fclose(f);

        /* Kernel threads have no argv[] */
        if (r[0] == 0) {
                char *t;
                int h;

                free(r);

                if (!comm_fallback)
                        return -ENOENT;

                h = get_process_comm(pid, &t);
                if (h < 0)
                        return h;

                r = strjoin("[", t, "]", NULL);
                free(t);

                if (!r)
                        return -ENOMEM;
        }

        *line = r;
        return 0;
}

static int is_kernel_thread(pid_t pid) {
        char *p;
        size_t count;
        char c;
        bool eof;
        FILE *f;

        if (pid == 0)
                return 0;

        if (asprintf(&p, "/proc/%lu/cmdline", (unsigned long) pid) < 0)
                return -ENOMEM;

        f = fopen(p, "re");
        free(p);

        if (!f)
                return -errno;

        count = fread(&c, 1, 1, f);
        eof = feof(f);
        fclose(f);

        /* Kernel threads have an empty cmdline */

        if (count <= 0)
                return eof ? 1 : -errno;

        return 0;
}

static char* path_startswith(const char *path, const char *prefix) {
        assert(path);
        assert(prefix);

        if ((path[0] == '/') != (prefix[0] == '/'))
                return NULL;

        for (;;) {
                size_t a, b;

                path += strspn(path, "/");
                prefix += strspn(prefix, "/");

                if (*prefix == 0)
                        return (char*) path;

                if (*path == 0)
                        return NULL;

                a = strcspn(path, "/");
                b = strcspn(prefix, "/");

                if (a != b)
                        return NULL;

                if (memcmp(path, prefix, a) != 0)
                        return NULL;

                path += a;
                prefix += b;
        }
}

static char *path_kill_slashes(char *path) {
        char *f, *t;
        bool slash = false;

        /* Removes redundant inner and trailing slashes. Modifies the
         * passed string in-place.
         *
         * ///foo///bar/ becomes /foo/bar
         */

        for (f = path, t = path; *f; f++) {

                if (*f == '/') {
                        slash = true;
                        continue;
                }

                if (slash) {
                        slash = false;
                        *(t++) = '/';
                }

                *(t++) = *f;
        }

        /* Special rule, if we are talking of the root directory, a
        trailing slash is good */

        if (t == path && slash)
                *(t++) = '/';

        *t = 0;
        return path;
}

static char *path_get_file_name(const char *p) {
        char *r;

        assert(p);

        if ((r = strrchr(p, '/')))
                return r + 1;

        return (char*) p;
}

static inline const char *strna(const char *s) {
        return s ? s : "n/a";
}
#define streq(a,b) (strcmp((a),(b)) == 0)


static const char *normalize_controller(const char *controller) {

        if (streq(controller, SYSTEMD_CGROUP_CONTROLLER))
                return "systemd";
        else if (startswith(controller, "name="))
                return controller + 5;
        else
                return controller;
}

static int join_path(const char *controller, const char *path, const char *suffix, char **fs) {
        char *t = NULL;

        if (!(controller || path))
                return -EINVAL;

        if (controller) {
                if (path && suffix)
                        t = strjoin("/sys/fs/cgroup/", controller, "/", path, "/", suffix, NULL);
                else if (path)
                        t = strjoin("/sys/fs/cgroup/", controller, "/", path, NULL);
                else if (suffix)
                        t = strjoin("/sys/fs/cgroup/", controller, "/", suffix, NULL);
                else
                        t = strjoin("/sys/fs/cgroup/", controller, NULL);
        } else {
                if (path && suffix)
                        t = strjoin(path, "/", suffix, NULL);
                else if (path)
                        t = strdup(path);
        }

        if (!t)
                return -ENOMEM;

        path_kill_slashes(t);

        *fs = t;
        return 0;
}

static int cg_split_spec(const char *spec, char **controller, char **path) {
        const char *e;
        char *t = NULL, *u = NULL;

        assert(spec);
        assert(controller || path);

        if (*spec == '\0') {
                if (controller)
                        *controller = NULL;
                if (path)
                        *path = NULL;

                return 0;
        }

        if (*spec == '/') {

                if (path) {
                        if (!(t = strdup(spec)))
                                return -ENOMEM;

                        *path = t;
                }

                if (controller)
                        *controller = NULL;

                return 0;
        }

        if (!(e = strchr(spec, ':'))) {

                if (strchr(spec, '/') || spec[0] == 0)
                        return -EINVAL;

                if (controller) {
                        if (!(t = strdup(spec)))
                                return -ENOMEM;

                        *controller = t;
                }

                if (path)
                        *path = NULL;

                return 0;
        }

        if (e[1] != '/' ||
            e == spec ||
            memchr(spec, '/', e-spec))
                return -EINVAL;

        if (controller)
                if (!(t = strndup(spec, e-spec)))
                        return -ENOMEM;

        if (path)
                if (!(u = strdup(e+1))) {
                        free(t);
                        return -ENOMEM;
                }

        if (controller)
                *controller = t;

        if (path)
                *path = u;

        return 0;
}

static int cg_get_path(const char *controller, const char *path, const char *suffix, char **fs) {
        const char *p;

        assert(fs);

        p = controller ? normalize_controller(controller) : NULL;
        return join_path(p, path, suffix, fs);
}

static int cg_fix_path(const char *path, char **result) {
        char *t, *c, *p;
        int r;

        assert(path);
        assert(result);

        /* First check if it already is a filesystem path */
        if (path_startswith(path, "/sys/fs/cgroup") &&
            access(path, F_OK) >= 0) {

                t = strdup(path);
                if (!t)
                        return -ENOMEM;

                *result = t;
                return 0;
        }

        /* Otherwise treat it as cg spec */
        r = cg_split_spec(path, &c, &p);
        if (r < 0)
                return r;

        r = cg_get_path(c ? c : SYSTEMD_CGROUP_CONTROLLER, p ? p : "/", NULL, result);
        free(c);
        free(p);

        return r;
}

static int cg_read_pid(FILE *f, pid_t *_pid) {
        unsigned long ul;

        /* Note that the cgroup.procs might contain duplicates! See
         * cgroups.txt for details. */

        errno = 0;
        if (fscanf(f, "%lu", &ul) != 1) {

                if (feof(f))
                        return 0;

                return (errno > 0) ? -errno : -EIO;
        }

        if (ul <= 0)
                return -EIO;

        *_pid = (pid_t) ul;
        return 1;
}

static int cg_read_subgroup(DIR *d, char **fn) {
        struct dirent *de;

        assert(d);

        errno = 0;
        while ((de = readdir(d))) {
                char *b;

                if (de->d_type != DT_DIR)
                        continue;

                if (streq(de->d_name, ".") ||
                    streq(de->d_name, ".."))
                        continue;

                if (!(b = strdup(de->d_name)))
                        return -ENOMEM;

                *fn = b;
                return 1;
        }

        if (errno)
                return -errno;

        return 0;
}

static int cg_enumerate_tasks(const char *controller, const char *path, FILE **_f) {
        char *fs;
        int r;
        FILE *f;

        assert(path);
        assert(_f);

        r = cg_get_path(controller, path, "tasks", &fs);
        if (r < 0)
                return r;

        f = fopen(fs, "re");
        free(fs);

        if (!f)
                return -errno;

        *_f = f;
        return 0;
}

static int cg_is_empty(const char *controller, const char *path, bool ignore_self) {
        pid_t pid = 0, self_pid;
        int r;
        FILE *f = NULL;
        bool found = false;

        assert(path);

        r = cg_enumerate_tasks(controller, path, &f);
        if (r < 0)
                return r == -ENOENT ? 1 : r;

        self_pid = getpid();

        while ((r = cg_read_pid(f, &pid)) > 0) {

                if (ignore_self && pid == self_pid)
                        continue;

                found = true;
                break;
        }

        fclose(f);

        if (r < 0)
                return r;

        return !found;
}

static int cg_enumerate_subgroups(const char *controller, const char *path, DIR **_d) {
        char *fs;
        int r;
        DIR *d;

        assert(path);
        assert(_d);

        /* This is not recursive! */

        r = cg_get_path(controller, path, NULL, &fs);
        if (r < 0)
                return r;

        d = opendir(fs);
        free(fs);

        if (!d)
                return -errno;

        *_d = d;
        return 0;
}

static int cg_is_empty_recursive(const char *controller, const char *path, bool ignore_self) {
        int r;
        DIR *d = NULL;
        char *fn;

        assert(path);

        r = cg_is_empty(controller, path, ignore_self);
        if (r <= 0)
                return r;

        r = cg_enumerate_subgroups(controller, path, &d);
        if (r < 0)
                return r == -ENOENT ? 1 : r;

        while ((r = cg_read_subgroup(d, &fn)) > 0) {
                char *p = NULL;

                r = asprintf(&p, "%s/%s", path, fn);
                free(fn);

                if (r < 0) {
                        r = -ENOMEM;
                        goto finish;
                }

                r = cg_is_empty_recursive(controller, p, ignore_self);
                free(p);

                if (r <= 0)
                        goto finish;
        }

        if (r >= 0)
                r = 1;

finish:

        if (d)
                closedir(d);

        return r;
}

static int cg_get_by_pid(const char *controller, pid_t pid, char **path) {
        int r;
        char *p = NULL;
        FILE *f;
        char *fs;
        size_t cs;

        assert(controller);
        assert(path);
        assert(pid >= 0);

        if (pid == 0)
                pid = getpid();

        if (asprintf(&fs, "/proc/%lu/cgroup", (unsigned long) pid) < 0)
                return -ENOMEM;

        f = fopen(fs, "re");
        free(fs);

        if (!f)
                return errno == ENOENT ? -ESRCH : -errno;

        cs = strlen(controller);

        while (!feof(f)) {
                char line[LINE_MAX];
                char *l;

                errno = 0;
                if (!(fgets(line, sizeof(line), f))) {
                        if (feof(f))
                                break;

                        r = errno ? -errno : -EIO;
                        goto finish;
                }

                truncate_nl(line);

                if (!(l = strchr(line, ':')))
                        continue;

                l++;
                if (strncmp(l, controller, cs) != 0)
                        continue;

                if (l[cs] != ':')
                        continue;

                if (!(p = strdup(l + cs + 1))) {
                        r = -ENOMEM;
                        goto finish;
                }

                *path = p;
                r = 0;
                goto finish;
        }

        r = -ENOENT;

finish:
        fclose(f);

        return r;
}

static int compare(const void *a, const void *b) {
        const pid_t *p = a, *q = b;

        if (*p < *q)
                return -1;
        if (*p > *q)
                return 1;
        return 0;
}

static void
collect_pid_array(GVariantBuilder *bob,
                  int pids[], unsigned n_pids, bool extra, bool more, bool kernel_threads)
{
        unsigned i, m;
        pid_t biggest = 0;

        /* Filter duplicates */
        m = 0;
        for (i = 0; i < n_pids; i++) {
                unsigned j;

                if (pids[i] > biggest)
                        biggest = pids[i];

                for (j = i+1; j < n_pids; j++)
                        if (pids[i] == pids[j])
                                break;

                if (j >= n_pids)
                        pids[m++] = pids[i];
        }
        n_pids = m;

        /* And sort */
        qsort(pids, n_pids, sizeof(pid_t), compare);

        for (i = 0; i < n_pids; i++) {
                char *t = NULL;

                get_process_cmdline(pids[i], 512, true, &t);

                GVariantBuilder pbob;
                g_variant_builder_init (&pbob, G_VARIANT_TYPE ("a{sv}"));
                g_variant_builder_add (&pbob, "{sv}", "Pid", g_variant_new_uint64 (pids[i]));
                if (t)
                        g_variant_builder_add (&pbob, "{sv}", "CmdLine", g_variant_new_string (t));
                g_variant_builder_add (bob, "v", g_variant_builder_end (&pbob));
                free(t);
        }
}


static int
collect_cgroup_one_by_path(GVariantBuilder *bob,
                           const char *path, bool more, bool kernel_threads)
{
        char *fn;
        FILE *f;
        size_t n = 0, n_allocated = 0;
        pid_t *pids = NULL;
        char *p;
        pid_t pid;
        int r;

        r = cg_fix_path(path, &p);
        if (r < 0)
                return r;

        r = asprintf(&fn, "%s/cgroup.procs", p);
        free(p);
        if (r < 0)
                return -ENOMEM;

        f = fopen(fn, "re");
        free(fn);
        if (!f)
                return -errno;

        while ((r = cg_read_pid(f, &pid)) > 0) {

                if (!kernel_threads && is_kernel_thread(pid) > 0)
                        continue;

                if (n >= n_allocated) {
                        pid_t *npids;

                        n_allocated = MAX(16U, n*2U);

                        npids = realloc(pids, sizeof(pid_t) * n_allocated);
                        if (!npids) {
                                r = -ENOMEM;
                                goto finish;
                        }

                        pids = npids;
                }

                assert(n < n_allocated);
                pids[n++] = pid;
        }

        if (r < 0)
                goto finish;

        if (n > 0)
                collect_pid_array(bob, pids, n, false, more, kernel_threads);

        r = 0;

finish:
        free(pids);

        if (f)
                fclose(f);

        return r;
}

static int
collect_cgroup_by_path(GVariantBuilder *bob,
                       const char *path, bool kernel_threads, bool all)
{
        DIR *d;
        char *last = NULL;
        char *p1 = NULL, *p2 = NULL, *fn = NULL, *gn = NULL;
        bool shown_pids = false;
        int r;

        assert(path);

        r = cg_fix_path(path, &fn);
        if (r < 0)
                return r;

        d = opendir(fn);
        if (!d) {
                free(fn);
                return -errno;
        }

        while ((r = cg_read_subgroup(d, &gn)) > 0) {
                char *k;

                r = asprintf(&k, "%s/%s", fn, gn);
                free(gn);
                if (r < 0) {
                        r = -ENOMEM;
                        goto finish;
                }

                if (!all && cg_is_empty_recursive(NULL, k, false) > 0) {
                        free(k);
                        continue;
                }

                if (!shown_pids) {
                        collect_cgroup_one_by_path(bob, path, true, kernel_threads);
                        shown_pids = true;
                }

                if (last) {
                        GVariantBuilder subbob;
                        g_variant_builder_init (&subbob, G_VARIANT_TYPE("av"));
                        g_variant_builder_add (&subbob, "v", g_variant_new_string (path_get_file_name(last)));
                        collect_cgroup_by_path(&subbob, last, kernel_threads, all);
                        g_variant_builder_add (bob, "v", g_variant_builder_end (&subbob));
                        free(last);
                }

                last = k;
        }

        if (r < 0)
                goto finish;

        if (!shown_pids)
                collect_cgroup_one_by_path(bob, path, !!last, kernel_threads);

        if (last) {
                GVariantBuilder subbob;
                g_variant_builder_init (&subbob, G_VARIANT_TYPE("av"));
                g_variant_builder_add (&subbob, "v", g_variant_new_string (path_get_file_name(last)));
                collect_cgroup_by_path(&subbob, last, kernel_threads, all);
                g_variant_builder_add (bob, "v", g_variant_builder_end (&subbob));
        }

        r = 0;

finish:
        free(p1);
        free(p2);
        free(last);
        free(fn);

        closedir(d);

        return r;
}

static int
collect_cgroup(GVariantBuilder *bob,
               const char *controller, const char *path, bool kernel_threads, bool all)
{
        char *p;
        int r;

        assert(controller);
        assert(path);

        r = cg_get_path(controller, path, NULL, &p);
        if (r < 0)
                return r;

        r = collect_cgroup_by_path(bob, p, kernel_threads, all);
        free(p);

        return r;
}

static int
collect_extra_pids (GVariantBuilder *bob,
                    const char *controller, const char *path, const pid_t pids[], unsigned n_pids)
{
        pid_t *copy;
        unsigned i, j;
        int r;

        if (n_pids <= 0)
                return 0;

        copy = new(pid_t, n_pids);
        if (!copy)
                return -ENOMEM;

        for (i = 0, j = 0; i < n_pids; i++) {
                if (controller && path) {
                        char *k;
                        r = cg_get_by_pid(controller, pids[i], &k);
                        if (r < 0) {
                                free(copy);
                                return r;
                        }

                        r = path_startswith(k, path) != NULL;
                        free (k);

                        if (r)
                                continue;
                }

                copy[j++] = pids[i];
        }

        collect_pid_array(bob, copy, j, true, false, false);

        free(copy);
        return 0;
}

static GVariant *
collect_cgroup_and_extra (const char *controller, const char *path, bool kernel_threads, bool all,
                          const pid_t extra_pids[], unsigned n_extra_pids)
{
        GVariantBuilder bob;

        g_variant_builder_init (&bob, G_VARIANT_TYPE ("av"));
        g_variant_builder_add (&bob, "v", g_variant_new_string (""));
        if (controller && path)
                collect_cgroup (&bob, controller, path, kernel_threads, all);
        collect_extra_pids (&bob, controller, path, extra_pids, n_extra_pids);

        return g_variant_builder_end (&bob);
}

GVariant *
collect_cgroup_and_extra_by_spec (const char *spec, bool kernel_threads, bool all,
                                  const pid_t extra_pids[], unsigned n_extra_pids)
{
        GVariant *v;
        char *controller, *path;

        assert(spec);

        int r = cg_split_spec(spec, &controller, &path);
        if (r < 0)
                return NULL;

        v = collect_cgroup_and_extra(controller, path, kernel_threads, all, extra_pids, n_extra_pids);
        free(controller);
        free(path);

        return v;
}
