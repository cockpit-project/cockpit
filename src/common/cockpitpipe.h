/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#ifndef __COCKPIT_PIPE_H__
#define __COCKPIT_PIPE_H__

#include <gio/gio.h>

G_BEGIN_DECLS

typedef enum {
  COCKPIT_PIPE_FLAGS_NONE = 0,
  COCKPIT_PIPE_STDERR_TO_STDOUT = 1 << 1,
  COCKPIT_PIPE_STDERR_TO_NULL = 1 << 2,
  COCKPIT_PIPE_STDERR_TO_MEMORY = 1 << 3,
} CockpitPipeFlags;

#define COCKPIT_TYPE_PIPE         (cockpit_pipe_get_type ())
#define COCKPIT_PIPE(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_PIPE, CockpitPipe))
#define COCKPIT_IS_PIPE(o)        (G_TYPE_CHECK_INSTANCE_TYPE ((o), COCKPIT_TYPE_PIPE))
#define COCKPIT_PIPE_CLASS(k)     (G_TYPE_CHECK_CLASS_CAST ((k), COCKPIT_TYPE_PIPE, CockpitPipeClass))
#define COCKPIT_PIPE_GET_CLASS(o) (G_TYPE_INSTANCE_GET_CLASS ((o), COCKPIT_TYPE_PIPE, CockpitPipeClass))

typedef struct _CockpitPipe        CockpitPipe;
typedef struct _CockpitPipeClass   CockpitPipeClass;
typedef struct _CockpitPipePrivate CockpitPipePrivate;

struct _CockpitPipe {
  GObject parent_instance;
  CockpitPipePrivate *priv;
};

struct _CockpitPipeClass {
  GObjectClass parent_class;

  /* signals */

  void        (* read)        (CockpitPipe *pipe,
                               GByteArray *buffer,
                               gboolean eof);

  void        (* close)       (CockpitPipe *pipe,
                               const gchar *problem);
};

GType              cockpit_pipe_get_type     (void) G_GNUC_CONST;

CockpitPipe *      cockpit_pipe_new          (const gchar *name,
                                              gint in_fd,
                                              gint out_fd);

CockpitPipe *      cockpit_pipe_spawn        (const gchar **argv,
                                              const gchar **env,
                                              const gchar *directory,
                                              CockpitPipeFlags flags);

CockpitPipe *      cockpit_pipe_pty          (const gchar **argv,
                                              const gchar **env,
                                              const gchar *directory);

CockpitPipe *      cockpit_pipe_connect      (const gchar *name,
                                              GSocketAddress *address);

/* HACK: Trying to debug self->priv->closed assertion */
#define cockpit_pipe_write(s, d) (_cockpit_pipe_write (s, d, G_STRFUNC, __LINE__))

void               _cockpit_pipe_write        (CockpitPipe *self,
                                              GBytes *data,
                                              const gchar *caller,
                                              gint line);

void               cockpit_pipe_close        (CockpitPipe *self,
                                              const gchar *problem);

gint               cockpit_pipe_exit_status  (CockpitPipe *self);

const gchar *      cockpit_pipe_get_name     (CockpitPipe *self);

GByteArray *       cockpit_pipe_get_buffer   (CockpitPipe *self);

GByteArray *       cockpit_pipe_get_stderr   (CockpitPipe *self);

gboolean           cockpit_pipe_get_pid      (CockpitPipe *self,
                                              GPid *pid);

void               cockpit_pipe_skip         (GByteArray *buffer,
                                              gsize skip);

GBytes *           cockpit_pipe_consume      (GByteArray *buffer,
                                              gsize before,
                                              gsize length,
                                              gsize after);

G_END_DECLS

#endif /* __COCKPIT_PIPE_H__ */
