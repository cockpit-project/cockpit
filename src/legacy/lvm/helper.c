/* -*- mode: C; c-file-style: "gnu"; indent-tabs-mode: nil; -*-
 *
 * Copyright (C) 2013-2014 Red Hat, Inc.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 *
 */

/* This is a helper program used by storaged to query the state of
   LVM2 via the lvm2app library.

   The reasoning for doing this in a separate process goes like this:
   Calling lvm_vg_open might block for a long time when the volume
   group is locked by someone else.  When this happens, only that one
   volume group should be affected.  No other part of storaged and no
   other volume group updates should wait for it.  It doesn't seem to
   be possible to set "wait_for_locks" temporarily when using lvm2app,
   and we actually do want to wait the short amounts of time that a
   volume group is usually locked.  Thus, we need to query each volume
   group in its own thread or process.  The lvm2app library doesn't
   seem to be thread-safe, so we use processes.

   However, we don't want to risk blocking during startup of storaged.
   In that case, we ignore locks.

   The program can list all volume groups or can return all needed
   information for a single volume group.  Output is a GVariant, by
   default as text (mostly for debugging and because it is impolite to
   output binary data to a terminal) or serialized.
*/

#include <stdio.h>
#include <unistd.h>
#include <glib.h>
#include <lvm2app.h>
#include <config.h>

static gboolean opt_binary = FALSE;
static gboolean opt_no_lock = FALSE;

static void usage (void) G_GNUC_NORETURN;

static void
usage (void)
{
  fprintf (stderr, "Usage: cockpit-lvm-helper [-b] [-f] list\n");
  fprintf (stderr, "       cockpit-lvm-helper [-b] [-f] show VG\n");
  exit (1);
}

static lvm_t
init_lvm (void)
{
  if (opt_no_lock)
    return lvm_init (PACKAGE_DATA_DIR "/lvm-nolocking");
  else
    return lvm_init (NULL);
}

static GVariant *
list_volume_groups (void)
{
  lvm_t lvm;
  struct dm_list *vg_names;
  struct lvm_str_list *vg_name;
  GVariantBuilder result;

  g_variant_builder_init (&result, G_VARIANT_TYPE ("as"));

  lvm = init_lvm ();
  if (lvm)
    {
      vg_names = lvm_list_vg_names (lvm);
      dm_list_iterate_items (vg_name, vg_names)
        {
          g_variant_builder_add (&result, "s", vg_name->str);
        }
      lvm_quit (lvm);
    }

  return g_variant_builder_end (&result);
}

static void
add_string (GVariantBuilder *bob,
            const gchar *key,
            const gchar *val)
{
  g_variant_builder_add (bob, "{sv}", key, g_variant_new_string (val));
}

static void
add_uint64 (GVariantBuilder *bob,
            const gchar *key,
            guint64 val)
{
  g_variant_builder_add (bob, "{sv}", key, g_variant_new_uint64 (val));
}

static void
add_lvprop (GVariantBuilder *bob,
            const gchar *key,
            lv_t lv)
{
  lvm_property_value_t p = lvm_lv_get_property (lv, key);
  if (p.is_valid)
    {
      if (p.is_string && p.value.string)
        add_string (bob, key, p.value.string);
      else if (p.is_integer)
        add_uint64 (bob, key, p.value.integer);
    }
}

static GVariant *
show_logical_volume (vg_t vg,
                     lv_t lv)
{
  GVariantBuilder result;
  g_variant_builder_init (&result, G_VARIANT_TYPE ("a{sv}"));

  add_string (&result, "name", lvm_lv_get_name (lv));
  add_string (&result, "uuid", lvm_lv_get_uuid (lv));
  add_uint64 (&result, "size", lvm_lv_get_size (lv));

  add_lvprop (&result, "lv_attr", lv);
  add_lvprop (&result, "lv_path", lv);
  add_lvprop (&result, "move_pv", lv);
  add_lvprop (&result, "pool_lv", lv);
  add_lvprop (&result, "origin", lv);
  add_lvprop (&result, "data_percent", lv);
  add_lvprop (&result, "metadata_percent", lv);
  add_lvprop (&result, "copy_percent", lv);

  return g_variant_builder_end (&result);
}

static GVariant *
show_physical_volume (vg_t vg,
                      pv_t pv)
{
  GVariantBuilder result;
  g_variant_builder_init (&result, G_VARIANT_TYPE ("a{sv}"));

  add_string (&result, "device", lvm_pv_get_name (pv));
  add_string (&result, "uuid", lvm_pv_get_uuid (pv));
  add_uint64 (&result, "size", lvm_pv_get_size (pv));
  add_uint64 (&result, "free-size", lvm_pv_get_free (pv));

  return g_variant_builder_end (&result);
}

static GVariant *
show_volume_group (const char *name)
{
  lvm_t lvm;
  vg_t vg;
  GVariantBuilder result;

  g_variant_builder_init (&result, G_VARIANT_TYPE ("a{sv}"));

  lvm = init_lvm ();
  if (!lvm)
    return g_variant_builder_end (&result);

  vg = lvm_vg_open (lvm, name, "r", 0);

  if (vg)
    {
      struct dm_list *list;
      struct lvm_lv_list *lv_entry;
      struct lvm_pv_list *pv_entry;
      GVariantBuilder lvs;
      GVariantBuilder pvs;

      add_string (&result, "name", lvm_vg_get_name (vg));
      add_string (&result, "uuid", lvm_vg_get_uuid (vg));
      add_uint64 (&result, "size", lvm_vg_get_size (vg));
      add_uint64 (&result, "free-size", lvm_vg_get_free_size (vg));
      add_uint64 (&result, "extent-size", lvm_vg_get_extent_size (vg));

      g_variant_builder_init (&lvs, G_VARIANT_TYPE("aa{sv}"));
      list = lvm_vg_list_lvs (vg);
      if (list)
        {
          dm_list_iterate_items (lv_entry, list)
            g_variant_builder_add (&lvs, "@a{sv}", show_logical_volume (vg, lv_entry->lv));
        }
      g_variant_builder_add (&result, "{sv}", "lvs", g_variant_builder_end (&lvs));

      g_variant_builder_init (&pvs, G_VARIANT_TYPE("aa{sv}"));
      list = lvm_vg_list_pvs (vg);
      if (list)
        {
          dm_list_iterate_items (pv_entry, list)
            g_variant_builder_add (&pvs, "@a{sv}", show_physical_volume (vg, pv_entry->pv));
        }
      g_variant_builder_add (&result, "{sv}", "pvs", g_variant_builder_end (&pvs));

      lvm_vg_close (vg);
    }
  else
    {
      lvm_quit (lvm);
      exit (2);
    }

  lvm_quit (lvm);
  return g_variant_builder_end (&result);
}

static void
write_all (int fd,
           const char *mem,
           size_t size)
{
  while (size > 0)
    {
      int r = write (fd, mem, size);
      if (r < 0)
        {
          fprintf (stderr, "Write error: %m\n");
          exit (1);
        }
      size -= r;
      mem += r;
    }
}

int
main (int argc,
      char **argv)
{
  GVariant *result;

  while (argv[1] && argv[1][0] == '-')
    {
      if (strcmp (argv[1], "-b") == 0)
        opt_binary = TRUE;
      else if (strcmp (argv[1], "-f") == 0)
        opt_no_lock = TRUE;
      else
        usage ();
      argv++;
    }

  if (argv[1] && strcmp (argv[1], "list") == 0)
    result = list_volume_groups ();
  else if (argv[1] && strcmp (argv[1], "show") == 0)
    {
      if (argv[2])
        result = show_volume_group (argv[2]);
      else
        usage ();
    }
  else
    usage ();

  if (opt_binary)
    {
      GVariant *normal = g_variant_get_normal_form (result);
      gsize size = g_variant_get_size (normal);
      gconstpointer data = g_variant_get_data (normal);
      write_all (1, data, size);
    }
  else
    {
      gchar *text = g_variant_print (result, FALSE);
      printf ("%s\n", text);
      g_free (text);
    }

  exit (0);
}
