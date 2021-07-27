#pragma once

/* Added in Linux 5.9: https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/commit/?id=278a5fbaed89dacd04e9d
 * will eventually be in glibc: https://sourceware.org/git/?p=glibc.git;a=commit;h=286286283e9bdc */
int cockpit_close_range (int from, int max_fd, int flags);
