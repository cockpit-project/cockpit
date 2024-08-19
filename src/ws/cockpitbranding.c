/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

#include "common/cockpitwebserver.h"
#include "common/cockpittransport.h"
#include "common/cockpitsystem.h"

#include "cockpitauth.h"
#include "cockpitbranding.h"
#include "cockpitwebservice.h"

static const gchar * const*
get_system_data_dirs (void)
{
  const gchar *env;

  env = g_getenv ("XDG_DATA_DIRS");
  if (env && env[0])
    return g_get_system_data_dirs ();

  return NULL;
}

static void
add_system_dirs (GPtrArray *dirs)
{
  const gchar * const* system;
  system = get_system_data_dirs ();
  while (system && system[0])
    {
      g_ptr_array_add (dirs, g_build_filename (system[0], "cockpit", "static", NULL));
      system++;
    }
}

gchar **
cockpit_branding_calculate_static_roots (const gchar *os_id,
                                         const gchar *os_variant_id,
                                         const gchar *os_id_like,
                                         gboolean is_local)
{
  GPtrArray *dirs;
  gchar **roots;

  dirs = g_ptr_array_new_with_free_func (g_free);

  if (is_local)
    add_system_dirs (dirs);

  if (os_id)
    {
      if (os_variant_id)
          g_ptr_array_add (dirs, g_strdup_printf (DATADIR "/cockpit/branding/%s-%s", os_id, os_variant_id));
      g_ptr_array_add (dirs, g_strdup_printf (DATADIR "/cockpit/branding/%s", os_id));
    }

  if (os_id_like)
    {
      gchar **ids;

      ids = g_strsplit_set (os_id_like, " ", -1);
      for (gint i = 0; ids[i]; i += 1)
        g_ptr_array_add (dirs, g_strdup_printf (DATADIR "/cockpit/branding/%s", ids[i]));

      g_strfreev (ids);
    }

  if (!is_local)
    add_system_dirs (dirs);

  g_ptr_array_add (dirs, g_strdup (DATADIR "/cockpit/branding/default"));
  g_ptr_array_add (dirs, g_strdup (DATADIR "/cockpit/static"));
  g_ptr_array_add (dirs, NULL);

  roots = cockpit_web_response_resolve_roots ((const gchar **)dirs->pdata);

  g_ptr_array_free (dirs, TRUE);
  return roots;
}

static void
serve_branding_css_file (CockpitWebResponse *response,
                         const gchar *path,
                         const gchar **roots,
                         GHashTable *os_release)
{
  if (os_release)
    cockpit_web_response_template (response, path, roots, os_release);
  else
    cockpit_web_response_file (response, path, roots);
}

typedef struct {
  const gchar *path;
  CockpitWebResponse *response;
} CockpitBrandingData;


static void
serve_branding_css_with_init_data (CockpitWebService *service,
                                   CockpitWebResponse *response,
                                   const gchar *path)
{
  CockpitTransport *transport = NULL;
  GHashTable *os_release = NULL;
  gchar **roots = NULL;
  JsonObject *os = NULL;
  gboolean responded = FALSE;
  JsonObject *init = NULL;

  init = cockpit_web_service_get_init (service);
  if (!init)
    goto out;

  transport = cockpit_web_service_get_transport (service);
  if (!transport)
    goto out;

  roots = g_object_get_data (G_OBJECT (transport), "static-roots");
  if (!roots)
    {
      if (cockpit_json_get_object (init, "os-release", NULL, &os) && os)
        os_release = cockpit_json_to_hash_table (os, cockpit_system_os_release_fields ());

      if (os_release)
        {
          roots = cockpit_branding_calculate_static_roots (g_hash_table_lookup (os_release, "ID"),
                                                           g_hash_table_lookup (os_release, "VARIANT_ID"),
                                                           g_hash_table_lookup (os_release, "ID_LIKE"),
                                                           FALSE);
          g_object_set_data_full (G_OBJECT (transport), "os-release", os_release,
                                  (GDestroyNotify) g_hash_table_unref);
        }
      else
        {
          roots = cockpit_branding_calculate_static_roots (NULL, NULL, NULL, FALSE);
        }

      g_object_set_data_full (G_OBJECT (transport), "static-roots", roots,
                              (GDestroyNotify) g_strfreev);
    }
  else
    {
      os_release = g_object_get_data (G_OBJECT (transport), "os-release");
    }

  serve_branding_css_file (response, path, (const gchar **)roots, os_release);
  responded = TRUE;

out:
  if (!responded)
    cockpit_web_response_error (response, 502, NULL, NULL);
}

void
cockpit_branding_serve (CockpitWebService *service,
                        CockpitWebResponse *response,
                        const gchar *full_path,
                        const gchar *static_path,
                        GHashTable *local_os_release,
                        const gchar **local_roots)
{
  gboolean is_host = FALSE;
  gchar *application = cockpit_auth_parse_application (full_path, &is_host);

  /* Must be logged in to use a host url */
  if (is_host && !service)
    {
      cockpit_web_response_error (response, 403, NULL, NULL);
      goto out;
    }

  cockpit_web_response_set_cache_type (response, COCKPIT_WEB_RESPONSE_CACHE);

  if (g_str_has_suffix (static_path, ".css"))
    {
      if (!is_host)
        {
          serve_branding_css_file (response, static_path, local_roots, local_os_release);
        }
      else
        {
          serve_branding_css_with_init_data (service, response, static_path);
        }
    }
  else
    {
      cockpit_web_response_file (response, static_path, local_roots);
    }

out:
  g_free (application);
}
