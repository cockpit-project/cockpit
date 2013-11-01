#ifndef CGROUP_SHOW_H
#define CGROUP_SHOW_H

#include <stdbool.h>
#include <sys/types.h>
#include <glib.h>

GVariant *collect_cgroup_and_extra_by_spec(const char *spec, bool kernel_threads, bool all,
                                           const pid_t extra_pids[], unsigned n_extra_pids);

#endif
