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

#ifndef __MOCK_IO_STREAM_H__
#define __MOCK_IO_STREAM_H__

#include <gio/gio.h>

#define MOCK_TYPE_IO_STREAM    (mock_io_stream_get_type ())
#define MOCK_IO_STREAM(o)      (G_TYPE_CHECK_INSTANCE_CAST ((o), MOCK_TYPE_IO_STREAM, MockIOStream))
#define MOCK_IS_IO_STREAM(o)   (G_TYPE_CHECK_INSTANCE_TYPE ((o), MOCK_TYPE_IO_STREAM))

typedef struct _MockIOStream MockIOStream;

GType            mock_io_stream_get_type          (void);

GIOStream *      mock_io_stream_new               (GInputStream *input,
                                                   GOutputStream *output);

#endif /* __MOCK_IO_STREAM_H__ */
