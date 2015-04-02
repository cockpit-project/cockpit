/* -*- mode: C; c-file-style: "gnu"; indent-tabs-mode: nil; -*- */
/*
 * Copyright (C) 2011 David Zeuthen <zeuthen@gmail.com>
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General
 * Public License along with this library; if not, write to the
 * Free Software Foundation, Inc., 59 Temple Place, Suite 330,
 * Boston, MA 02111-1307, USA.
 */

#include "config.h"
#include <glib/gi18n-lib.h>

#include "udisksclient.h"
#include "org.freedesktop.UDisks2.h"

static const GDBusErrorEntry dbus_error_entries[] =
{
  {UDISKS_ERROR_FAILED,                       "org.freedesktop.UDisks2.Error.Failed"},
  {UDISKS_ERROR_CANCELLED,                    "org.freedesktop.UDisks2.Error.Cancelled"},
  {UDISKS_ERROR_ALREADY_CANCELLED,            "org.freedesktop.UDisks2.Error.AlreadyCancelled"},
  {UDISKS_ERROR_NOT_AUTHORIZED,               "org.freedesktop.UDisks2.Error.NotAuthorized"},
  {UDISKS_ERROR_NOT_AUTHORIZED_CAN_OBTAIN,    "org.freedesktop.UDisks2.Error.NotAuthorizedCanObtain"},
  {UDISKS_ERROR_NOT_AUTHORIZED_DISMISSED,     "org.freedesktop.UDisks2.Error.NotAuthorizedDismissed"},
  {UDISKS_ERROR_ALREADY_MOUNTED,              "org.freedesktop.UDisks2.Error.AlreadyMounted"},
  {UDISKS_ERROR_NOT_MOUNTED,                  "org.freedesktop.UDisks2.Error.NotMounted"},
  {UDISKS_ERROR_OPTION_NOT_PERMITTED,         "org.freedesktop.UDisks2.Error.OptionNotPermitted"},
  {UDISKS_ERROR_MOUNTED_BY_OTHER_USER,        "org.freedesktop.UDisks2.Error.MountedByOtherUser"},
  {UDISKS_ERROR_ALREADY_UNMOUNTING,           "org.freedesktop.UDisks2.Error.AlreadyUnmounting"},
  {UDISKS_ERROR_NOT_SUPPORTED,                "org.freedesktop.UDisks2.Error.NotSupported"},
  {UDISKS_ERROR_TIMED_OUT,                    "org.freedesktop.UDisks2.Error.Timedout"},
  {UDISKS_ERROR_WOULD_WAKEUP,                 "org.freedesktop.UDisks2.Error.WouldWakeup"},
  {UDISKS_ERROR_DEVICE_BUSY,                  "org.freedesktop.UDisks2.Error.DeviceBusy"},
};

GQuark
udisks_error_quark (void)
{
  G_STATIC_ASSERT (G_N_ELEMENTS (dbus_error_entries) == UDISKS_ERROR_NUM_ENTRIES);
  static volatile gsize quark_volatile = 0;
  g_dbus_error_register_error_domain ("udisks-error-quark",
                                      &quark_volatile,
                                      dbus_error_entries,
                                      G_N_ELEMENTS (dbus_error_entries));
  return (GQuark) quark_volatile;
}

G_LOCK_DEFINE_STATIC (init_lock);

struct _UDisksClient
{
  GObject parent_instance;

  gboolean is_initialized;
  GError *initialization_error;

  GDBusObjectManager *object_manager;

  GMainContext *context;

  GSource *changed_timeout_source;
};

typedef struct
{
  GObjectClass parent_class;
} UDisksClientClass;

enum
{
  PROP_0,
  PROP_OBJECT_MANAGER,
  PROP_MANAGER
};

enum
{
  CHANGED_SIGNAL,
  LAST_SIGNAL
};

static guint signals[LAST_SIGNAL] = { 0 };

static void initable_iface_init       (GInitableIface      *initable_iface);

static void on_object_added (GDBusObjectManager  *manager,
                             GDBusObject         *object,
                             gpointer             user_data);

static void on_object_removed (GDBusObjectManager  *manager,
                               GDBusObject         *object,
                               gpointer             user_data);

static void on_interface_added (GDBusObjectManager  *manager,
                                GDBusObject         *object,
                                GDBusInterface      *interface,
                                gpointer             user_data);

static void on_interface_removed (GDBusObjectManager  *manager,
                                  GDBusObject         *object,
                                  GDBusInterface      *interface,
                                  gpointer             user_data);

static void on_interface_proxy_properties_changed (GDBusObjectManagerClient   *manager,
                                                   GDBusObjectProxy           *object_proxy,
                                                   GDBusProxy                 *interface_proxy,
                                                   GVariant                   *changed_properties,
                                                   const gchar *const         *invalidated_properties,
                                                   gpointer                    user_data);

static void maybe_emit_changed_now (UDisksClient *client);

static void init_interface_proxy (UDisksClient *client,
                                  GDBusProxy   *proxy);

G_DEFINE_TYPE_WITH_CODE (UDisksClient, udisks_client, G_TYPE_OBJECT,
                         G_IMPLEMENT_INTERFACE (G_TYPE_INITABLE, initable_iface_init)
                         );
static void
udisks_client_finalize (GObject *object)
{
  UDisksClient *client = UDISKS_CLIENT (object);

  if (client->changed_timeout_source != NULL)
    g_source_destroy (client->changed_timeout_source);

  if (client->initialization_error != NULL)
    g_error_free (client->initialization_error);

  if (client->object_manager)
    {
      g_signal_handlers_disconnect_by_func (client->object_manager,
                                            G_CALLBACK (on_object_added),
                                            client);
      g_signal_handlers_disconnect_by_func (client->object_manager,
                                            G_CALLBACK (on_object_removed),
                                            client);
      g_signal_handlers_disconnect_by_func (client->object_manager,
                                            G_CALLBACK (on_interface_added),
                                            client);
      g_signal_handlers_disconnect_by_func (client->object_manager,
                                            G_CALLBACK (on_interface_removed),
                                            client);
      g_signal_handlers_disconnect_by_func (client->object_manager,
                                            G_CALLBACK (on_interface_proxy_properties_changed),
                                            client);
      g_object_unref (client->object_manager);
    }

  if (client->context != NULL)
    g_main_context_unref (client->context);

  G_OBJECT_CLASS (udisks_client_parent_class)->finalize (object);
}

static void
udisks_client_init (UDisksClient *client)
{
  static volatile GQuark udisks_error_domain = 0;
  /* this will force associating errors in the UDISKS_ERROR error
   * domain with org.freedesktop.UDisks2.Error.* errors via
   * g_dbus_error_register_error_domain().
   */
  udisks_error_domain = UDISKS_ERROR;
  udisks_error_domain; /* shut up -Wunused-but-set-variable */
}

static void
udisks_client_get_property (GObject    *object,
                            guint       prop_id,
                            GValue     *value,
                            GParamSpec *pspec)
{
  UDisksClient *client = UDISKS_CLIENT (object);

  switch (prop_id)
    {
    case PROP_OBJECT_MANAGER:
      g_value_set_object (value, udisks_client_get_object_manager (client));
      break;

    case PROP_MANAGER:
      g_value_set_object (value, udisks_client_get_manager (client));
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
udisks_client_class_init (UDisksClientClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize     = udisks_client_finalize;
  gobject_class->get_property = udisks_client_get_property;

  g_object_class_install_property (gobject_class,
                                   PROP_OBJECT_MANAGER,
                                   g_param_spec_object ("object-manager",
                                                        "Object Manager",
                                                        "The GDBusObjectManager used by the UDisksClient",
                                                        G_TYPE_DBUS_OBJECT_MANAGER,
                                                        G_PARAM_READABLE |
                                                        G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (gobject_class,
                                   PROP_MANAGER,
                                   g_param_spec_object ("manager",
                                                        "Manager",
                                                        "The UDisksManager",
                                                        UDISKS_TYPE_MANAGER,
                                                        G_PARAM_READABLE |
                                                        G_PARAM_STATIC_STRINGS));

  signals[CHANGED_SIGNAL] = g_signal_new ("changed",
                                          G_OBJECT_CLASS_TYPE (klass),
                                          G_SIGNAL_RUN_LAST,
                                          0, /* G_STRUCT_OFFSET */
                                          NULL, /* accu */
                                          NULL, /* accu data */
                                          g_cclosure_marshal_generic,
                                          G_TYPE_NONE,
                                          0);

}

UDisksClient *
udisks_client_new_sync (GCancellable  *cancellable,
                        GError       **error)
{
  GInitable *ret;
  ret = g_initable_new (UDISKS_TYPE_CLIENT,
                        cancellable,
                        error,
                        NULL);
  if (ret != NULL)
    return UDISKS_CLIENT (ret);
  else
    return NULL;
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
initable_init (GInitable     *initable,
               GCancellable  *cancellable,
               GError       **error)
{
  UDisksClient *client = UDISKS_CLIENT (initable);
  gboolean ret;
  GList *objects, *l;
  GList *interfaces, *ll;

  ret = FALSE;

  /* This method needs to be idempotent to work with the singleton
   * pattern. See the docs for g_initable_init(). We implement this by
   * locking.
   */
  G_LOCK (init_lock);
  if (client->is_initialized)
    {
      if (client->object_manager != NULL)
        ret = TRUE;
      else
        g_assert (client->initialization_error != NULL);
      goto out;
    }
  g_assert (client->initialization_error == NULL);

  client->context = g_main_context_get_thread_default ();
  if (client->context != NULL)
    g_main_context_ref (client->context);

  client->object_manager = udisks_object_manager_client_new_for_bus_sync (G_BUS_TYPE_SYSTEM,
                                                                          G_DBUS_OBJECT_MANAGER_CLIENT_FLAGS_NONE,
                                                                          "org.freedesktop.UDisks2",
                                                                          "/org/freedesktop/UDisks2",
                                                                          cancellable,
                                                                          &client->initialization_error);
  if (client->object_manager == NULL)
    goto out;

  /* init all proxies */
  objects = g_dbus_object_manager_get_objects (client->object_manager);
  for (l = objects; l != NULL; l = l->next)
    {
      interfaces = g_dbus_object_get_interfaces (G_DBUS_OBJECT (l->data));
      for (ll = interfaces; ll != NULL; ll = ll->next)
        {
          init_interface_proxy (client, G_DBUS_PROXY (ll->data));
        }
      g_list_foreach (interfaces, (GFunc) g_object_unref, NULL);
      g_list_free (interfaces);
    }
  g_list_foreach (objects, (GFunc) g_object_unref, NULL);
  g_list_free (objects);

  g_signal_connect (client->object_manager,
                    "object-added",
                    G_CALLBACK (on_object_added),
                    client);
  g_signal_connect (client->object_manager,
                    "object-removed",
                    G_CALLBACK (on_object_removed),
                    client);
  g_signal_connect (client->object_manager,
                    "interface-added",
                    G_CALLBACK (on_interface_added),
                    client);
  g_signal_connect (client->object_manager,
                    "interface-removed",
                    G_CALLBACK (on_interface_removed),
                    client);
  g_signal_connect (client->object_manager,
                    "interface-proxy-properties-changed",
                    G_CALLBACK (on_interface_proxy_properties_changed),
                    client);

  ret = TRUE;

out:
  client->is_initialized = TRUE;
  if (!ret)
    {
      g_assert (client->initialization_error != NULL);
      g_propagate_error (error, g_error_copy (client->initialization_error));
    }
  G_UNLOCK (init_lock);
  return ret;
}

static void
initable_iface_init (GInitableIface      *initable_iface)
{
  initable_iface->init = initable_init;
}

GDBusObjectManager *
udisks_client_get_object_manager (UDisksClient        *client)
{
  g_return_val_if_fail (UDISKS_IS_CLIENT (client), NULL);
  return client->object_manager;
}

UDisksManager *
udisks_client_get_manager (UDisksClient *client)
{
  UDisksManager *ret = NULL;
  GDBusObject *obj;

  g_return_val_if_fail (UDISKS_IS_CLIENT (client), NULL);

  obj = g_dbus_object_manager_get_object (client->object_manager, "/org/freedesktop/UDisks2/Manager");
  if (obj == NULL)
    goto out;

  ret = udisks_object_peek_manager (UDISKS_OBJECT (obj));
  g_object_unref (obj);

 out:
  return ret;
}

void
udisks_client_settle (UDisksClient *client)
{
  while (g_main_context_iteration (client->context, FALSE /* may_block */))
    ;
  /* TODO: careful if on different thread... */
  maybe_emit_changed_now (client);
}

UDisksObject *
udisks_client_get_object (UDisksClient  *client,
                          const gchar   *object_path)
{
  g_return_val_if_fail (UDISKS_IS_CLIENT (client), NULL);
  return (UDisksObject *) g_dbus_object_manager_get_object (client->object_manager, object_path);
}

UDisksObject *
udisks_client_peek_object (UDisksClient  *client,
                           const gchar   *object_path)
{
  UDisksObject *ret;
  ret = udisks_client_get_object (client, object_path);
  if (ret != NULL)
    g_object_unref (ret);
  return ret;
}

UDisksBlock *
udisks_client_get_block_for_dev (UDisksClient *client,
                                 dev_t         block_device_number)
{
  UDisksBlock *ret = NULL;
  GList *l, *object_proxies = NULL;

  g_return_val_if_fail (UDISKS_IS_CLIENT (client), NULL);

  object_proxies = g_dbus_object_manager_get_objects (client->object_manager);
  for (l = object_proxies; l != NULL; l = l->next)
    {
      UDisksObject *object = UDISKS_OBJECT (l->data);
      UDisksBlock *block;

      block = udisks_object_get_block (object);
     if (block == NULL)
        continue;

      if (udisks_block_get_device_number (block) == block_device_number)
        {
          ret = block;
          goto out;
        }
      g_object_unref (block);
    }

 out:
  g_list_foreach (object_proxies, (GFunc) g_object_unref, NULL);
  g_list_free (object_proxies);
  return ret;
}

GList *
udisks_client_get_block_for_label (UDisksClient        *client,
                                   const gchar         *label)
{
  GList *ret = NULL;
  GList *l, *object_proxies = NULL;

  g_return_val_if_fail (UDISKS_IS_CLIENT (client), NULL);
  g_return_val_if_fail (label != NULL, NULL);

  object_proxies = g_dbus_object_manager_get_objects (client->object_manager);
  for (l = object_proxies; l != NULL; l = l->next)
    {
      UDisksObject *object = UDISKS_OBJECT (l->data);
      UDisksBlock *block;

      block = udisks_object_get_block (object);
      if (block == NULL)
        continue;

      if (g_strcmp0 (udisks_block_get_id_label (block), label) == 0)
        ret = g_list_prepend (ret, block);
      else
        g_object_unref (block);
    }

  g_list_foreach (object_proxies, (GFunc) g_object_unref, NULL);
  g_list_free (object_proxies);
  ret = g_list_reverse (ret);
  return ret;
}

UDisksBlock *
udisks_client_get_block_for_mdraid (UDisksClient *client,
                                    UDisksMDRaid *raid)
{
  UDisksBlock *ret = NULL;
  GList *l, *object_proxies = NULL;
  GDBusObject *raid_object;
  const gchar *raid_objpath;

  g_return_val_if_fail (UDISKS_IS_CLIENT (client), NULL);
  g_return_val_if_fail (UDISKS_IS_MDRAID (raid), NULL);

  raid_object = g_dbus_interface_get_object (G_DBUS_INTERFACE (raid));
  if (raid_object == NULL)
    goto out;

  raid_objpath = g_dbus_object_get_object_path (raid_object);

  object_proxies = g_dbus_object_manager_get_objects (client->object_manager);
  for (l = object_proxies; l != NULL; l = l->next)
    {
      UDisksObject *object = UDISKS_OBJECT (l->data);
      UDisksBlock *block;

      block = udisks_object_get_block (object);
      if (block == NULL)
        continue;

      /* ignore partitions */
      if (udisks_object_peek_partition (object) != NULL)
        continue;

      if (g_strcmp0 (udisks_block_get_mdraid (block), raid_objpath) == 0)
        {
          ret = block;
          goto out;
        }
      g_object_unref (block);
    }

 out:
  g_list_foreach (object_proxies, (GFunc) g_object_unref, NULL);
  g_list_free (object_proxies);
  return ret;
}

GList *
udisks_client_get_members_for_mdraid (UDisksClient *client,
                                      UDisksMDRaid *raid)
{
  GList *ret = NULL;
  GList *l, *object_proxies = NULL;
  GDBusObject *raid_object;
  const gchar *raid_objpath;

  g_return_val_if_fail (UDISKS_IS_CLIENT (client), NULL);
  g_return_val_if_fail (UDISKS_IS_MDRAID (raid), NULL);

  raid_object = g_dbus_interface_get_object (G_DBUS_INTERFACE (raid));
  if (raid_object == NULL)
    goto out;

  raid_objpath = g_dbus_object_get_object_path (raid_object);

  object_proxies = g_dbus_object_manager_get_objects (client->object_manager);
  for (l = object_proxies; l != NULL; l = l->next)
    {
      UDisksObject *object = UDISKS_OBJECT (l->data);
      UDisksBlock *block;

      block = udisks_object_get_block (object);
      if (block == NULL)
        continue;

      if (g_strcmp0 (udisks_block_get_mdraid_member (block), raid_objpath) == 0)
        {
          ret = g_list_prepend (ret, block); /* adopts reference to block */
        }
      else
        {
          g_object_unref (block);
        }
    }

 out:
  g_list_foreach (object_proxies, (GFunc) g_object_unref, NULL);
  g_list_free (object_proxies);
  return ret;
}

UDisksBlock *
udisks_client_get_cleartext_block (UDisksClient  *client,
                                   UDisksBlock   *block)
{
  UDisksBlock *ret = NULL;
  GDBusObject *object;
  const gchar *object_path;
  GList *objects = NULL;
  GList *l;

  object = g_dbus_interface_get_object (G_DBUS_INTERFACE (block));
  if (object == NULL)
    goto out;

  object_path = g_dbus_object_get_object_path (object);
  objects = g_dbus_object_manager_get_objects (client->object_manager);
  for (l = objects; l != NULL; l = l->next)
    {
      UDisksObject *iter_object = UDISKS_OBJECT (l->data);
      UDisksBlock *iter_block;

      iter_block = udisks_object_peek_block (iter_object);
      if (iter_block == NULL)
        continue;

      if (g_strcmp0 (udisks_block_get_crypto_backing_device (iter_block), object_path) == 0)
        {
          ret = g_object_ref (iter_block);
          goto out;
        }
    }

 out:
  g_list_foreach (objects, (GFunc) g_object_unref, NULL);
  g_list_free (objects);
  return ret;
}

GList *
udisks_client_get_partitions (UDisksClient         *client,
                              UDisksPartitionTable *table)
{
  GList *ret = NULL;
  GDBusObject *table_object;
  const gchar *table_object_path;
  GList *l, *object_proxies = NULL;

  g_return_val_if_fail (UDISKS_IS_CLIENT (client), NULL);
  g_return_val_if_fail (UDISKS_IS_PARTITION_TABLE (table), NULL);

  table_object = g_dbus_interface_get_object (G_DBUS_INTERFACE (table));
  if (table_object == NULL)
    goto out;
  table_object_path = g_dbus_object_get_object_path (table_object);

  object_proxies = g_dbus_object_manager_get_objects (client->object_manager);
  for (l = object_proxies; l != NULL; l = l->next)
    {
      UDisksObject *object = UDISKS_OBJECT (l->data);
      UDisksPartition *partition;

      partition = udisks_object_get_partition (object);
      if (partition == NULL)
        continue;

      if (g_strcmp0 (udisks_partition_get_table (partition), table_object_path) == 0)
        ret = g_list_prepend (ret, g_object_ref (partition));

      g_object_unref (partition);
    }
  ret = g_list_reverse (ret);
 out:
  g_list_foreach (object_proxies, (GFunc) g_object_unref, NULL);
  g_list_free (object_proxies);
  return ret;
}

UDisksPartitionTable *
udisks_client_get_partition_table (UDisksClient     *client,
                                   UDisksPartition  *partition)
{
  UDisksPartitionTable *ret = NULL;
  UDisksObject *object;

  g_return_val_if_fail (UDISKS_IS_CLIENT (client), NULL);
  g_return_val_if_fail (UDISKS_IS_PARTITION (partition), NULL);

  object = udisks_client_get_object (client, udisks_partition_get_table (partition));
  if (object == NULL)
    goto out;

  ret = udisks_object_get_partition_table (object);
  g_object_unref (object);

 out:
  return ret;
}

static void
maybe_emit_changed_now (UDisksClient *client)
{
  if (client->changed_timeout_source == NULL)
    goto out;

  g_source_destroy (client->changed_timeout_source);
  client->changed_timeout_source = NULL;

  g_signal_emit (client, signals[CHANGED_SIGNAL], 0);

 out:
  ;
}

static gboolean
on_changed_timeout (gpointer user_data)
{
  UDisksClient *client = UDISKS_CLIENT (user_data);
  client->changed_timeout_source = NULL;
  g_signal_emit (client, signals[CHANGED_SIGNAL], 0);
  return FALSE; /* remove source */
}

void
udisks_client_queue_changed (UDisksClient *client)
{
  g_return_if_fail (UDISKS_IS_CLIENT (client));

  if (client->changed_timeout_source != NULL)
    goto out;

  client->changed_timeout_source = g_timeout_source_new (100);
  g_source_set_callback (client->changed_timeout_source,
                         (GSourceFunc) on_changed_timeout,
                         client,
                         NULL); /* destroy notify */
  g_source_attach (client->changed_timeout_source, client->context);
  g_source_unref (client->changed_timeout_source);

 out:
  ;
}

static void
on_object_added (GDBusObjectManager  *manager,
                 GDBusObject         *object,
                 gpointer             user_data)
{
  UDisksClient *client = UDISKS_CLIENT (user_data);
  GList *interfaces, *l;

  interfaces = g_dbus_object_get_interfaces (object);
  for (l = interfaces; l != NULL; l = l->next)
    {
      init_interface_proxy (client, G_DBUS_PROXY (l->data));
    }
  g_list_foreach (interfaces, (GFunc) g_object_unref, NULL);
  g_list_free (interfaces);

  udisks_client_queue_changed (client);
}

static void
on_object_removed (GDBusObjectManager  *manager,
                   GDBusObject         *object,
                   gpointer             user_data)
{
  UDisksClient *client = UDISKS_CLIENT (user_data);
  udisks_client_queue_changed (client);
}

static void
init_interface_proxy (UDisksClient *client,
                      GDBusProxy   *proxy)
{
  /* disable method timeouts */
  g_dbus_proxy_set_default_timeout (proxy, G_MAXINT);
}

static void
on_interface_added (GDBusObjectManager  *manager,
                    GDBusObject         *object,
                    GDBusInterface      *interface,
                    gpointer             user_data)
{
  UDisksClient *client = UDISKS_CLIENT (user_data);

  init_interface_proxy (client, G_DBUS_PROXY (interface));

  udisks_client_queue_changed (client);
}

static void
on_interface_removed (GDBusObjectManager  *manager,
                      GDBusObject         *object,
                      GDBusInterface      *interface,
                      gpointer             user_data)
{
  UDisksClient *client = UDISKS_CLIENT (user_data);
  udisks_client_queue_changed (client);
}

static void
on_interface_proxy_properties_changed (GDBusObjectManagerClient   *manager,
                                       GDBusObjectProxy           *object_proxy,
                                       GDBusProxy                 *interface_proxy,
                                       GVariant                   *changed_properties,
                                       const gchar *const         *invalidated_properties,
                                       gpointer                    user_data)
{
  UDisksClient *client = UDISKS_CLIENT (user_data);
  udisks_client_queue_changed (client);
}
