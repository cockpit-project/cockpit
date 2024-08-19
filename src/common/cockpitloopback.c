/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

#include "cockpitloopback.h"

struct _CockpitLoopback {
  GSocketAddressEnumerator parent;
  GQueue addresses;
};

static void cockpit_loopback_connectable_iface (GSocketConnectableIface *iface);

G_DEFINE_TYPE_WITH_CODE (CockpitLoopback, cockpit_loopback, G_TYPE_SOCKET_ADDRESS_ENUMERATOR,
                         G_IMPLEMENT_INTERFACE (G_TYPE_SOCKET_CONNECTABLE, cockpit_loopback_connectable_iface)
)

static void
cockpit_loopback_init (CockpitLoopback *self)
{
  g_queue_init (&self->addresses);
}

static void
cockpit_loopback_finalize (GObject *object)
{
  CockpitLoopback *self = COCKPIT_LOOPBACK (object);

  while (!g_queue_is_empty (&self->addresses))
    g_object_unref (g_queue_pop_head (&self->addresses));
  g_queue_clear (&self->addresses);

  G_OBJECT_CLASS (cockpit_loopback_parent_class)->finalize (object);
}

static GSocketAddress *
cockpit_loopback_next (GSocketAddressEnumerator *enumerator,
                       GCancellable *cancellable,
                       GError **error)
{
  CockpitLoopback *self = COCKPIT_LOOPBACK (enumerator);
  return g_queue_pop_head (&self->addresses);
}

static void
cockpit_loopback_next_async (GSocketAddressEnumerator *enumerator,
                             GCancellable *cancellable,
                             GAsyncReadyCallback callback,
                             gpointer user_data)
{
  CockpitLoopback *self = COCKPIT_LOOPBACK (enumerator);
  GTask *res;
  GSocketAddress *address;
  GError *error = NULL;

  address = cockpit_loopback_next (enumerator, cancellable, &error);
  g_assert (error == NULL);

  res = g_task_new (G_OBJECT (self), NULL, callback, user_data);
  g_task_return_pointer (res, address, g_object_unref);
  g_object_unref (res);
}

static GSocketAddress *
cockpit_loopback_next_finish (GSocketAddressEnumerator *enumerator,
                              GAsyncResult *result,
                              GError **error)
{
  g_warn_if_fail (g_task_is_valid (result, enumerator));

  return g_task_propagate_pointer (G_TASK (result), error);
}

static void
cockpit_loopback_class_init (CockpitLoopbackClass *klass)
{
  GSocketAddressEnumeratorClass *enumerator_class = G_SOCKET_ADDRESS_ENUMERATOR_CLASS (klass);
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);

  gobject_class->finalize = cockpit_loopback_finalize;

  enumerator_class->next = cockpit_loopback_next;
  enumerator_class->next_async = cockpit_loopback_next_async;
  enumerator_class->next_finish = cockpit_loopback_next_finish;
}

static void
ref_to_queue (gpointer data,
              gpointer user_data)
{
  g_queue_push_tail (user_data, g_object_ref (data));
}

static GSocketAddressEnumerator *
cockpit_loopback_enumerate (GSocketConnectable *connectable)
{
  CockpitLoopback *self = COCKPIT_LOOPBACK (connectable);
  CockpitLoopback *copy;

  copy = g_object_new (COCKPIT_TYPE_LOOPBACK, NULL);
  g_queue_foreach (&self->addresses, ref_to_queue, &copy->addresses);

  return G_SOCKET_ADDRESS_ENUMERATOR (copy);
}

static void
cockpit_loopback_connectable_iface (GSocketConnectableIface *iface)
{
  iface->enumerate = cockpit_loopback_enumerate;
  iface->proxy_enumerate = cockpit_loopback_enumerate;
}

GSocketConnectable *
cockpit_loopback_new (guint16 port)
{
  CockpitLoopback *self;
  GInetAddress *addr;

  self = g_object_new (COCKPIT_TYPE_LOOPBACK, NULL);

  addr = g_inet_address_new_loopback (G_SOCKET_FAMILY_IPV6);
  g_queue_push_tail (&self->addresses, g_inet_socket_address_new (addr, port));
  g_object_unref (addr);

  addr = g_inet_address_new_loopback (G_SOCKET_FAMILY_IPV4);
  g_queue_push_tail (&self->addresses, g_inet_socket_address_new (addr, port));
  g_object_unref (addr);

  return G_SOCKET_CONNECTABLE (self);
}
