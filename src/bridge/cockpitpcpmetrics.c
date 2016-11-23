/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
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

#define _GNU_SOURCE

#include "config.h"

#include "cockpitmetrics.h"
#include "cockpitpcpmetrics.h"

#include "common/cockpitjson.h"

#include <pcp/pmapi.h>
#include <math.h>

/**
 * CockpitPcpMetrics:
 *
 * A #CockpitMetrics channel that pulls data from PCP
 */

static int my_pmParseUnitsStr(const char *, pmUnits *, double *);

#define COCKPIT_PCP_METRICS(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_PCP_METRICS, CockpitPcpMetrics))

typedef struct {
  const gchar *name;
  const gchar *derive;
  pmID id;
  pmDesc desc;
  pmUnits *units;
  gdouble factor;

  pmUnits units_buf;
} MetricInfo;

typedef struct {
  int context;
  gint64 start;
} ArchiveInfo;

typedef struct {
  CockpitMetrics parent;
  const gchar *name;
  int direct_context;
  int numpmid;
  pmID *pmidlist;
  MetricInfo *metrics;
  gint64 interval;
  gint64 limit;
  guint idler;

  GList *archives;  /* of ArchiveInfo */
  GList *cur_archive;

  /* The previous samples sent */
  pmResult *last;
} CockpitPcpMetrics;

typedef struct {
  CockpitMetricsClass parent_class;
} CockpitPcpMetricsClass;

G_DEFINE_TYPE (CockpitPcpMetrics, cockpit_pcp_metrics, COCKPIT_TYPE_METRICS);

static void
cockpit_pcp_metrics_init (CockpitPcpMetrics *self)
{
  self->direct_context = -1;
}

static gboolean
result_meta_equal (CockpitPcpMetrics *self,
                   pmResult *r1,
                   pmResult *r2)
{
  pmValueSet *vs1;
  pmValueSet *vs2;
  int i, j;

  /* PCP guarantees that the result ids are same as requested */
  for (i = 0; i < r1->numpmid; i++)
    {
      /* We only care about instanced metrics.
       */
      if (self->metrics[i].desc.indom == PM_INDOM_NULL)
        continue;

      vs1 = r1->vset[i];
      vs2 = r2->vset[i];

      g_assert (vs1 && vs2);

      if (vs1->numval != vs2->numval)
        return FALSE;

      for (j = 0; j < vs1->numval; j++)
        {
          if (vs1->vlist[j].inst != vs2->vlist[j].inst)
            return FALSE;
        }
    }

  return TRUE;
}

static gint64
timestamp_from_timeval (struct timeval *tv)
{
  return tv->tv_sec * 1000 + tv->tv_usec / 1000;
}

static JsonObject *
build_meta (CockpitPcpMetrics *self,
            pmResult *result)
{
  JsonArray *metrics;
  JsonObject *metric;
  JsonArray *instances;
  JsonObject *root;
  pmValueSet *vs;
  struct timeval now_timeval;
  gint64 timestamp, now;
  char *instance;
  int i, j;
  int rc;

  gettimeofday (&now_timeval, NULL);

  timestamp = timestamp_from_timeval (&result->timestamp);
  now = timestamp_from_timeval (&now_timeval);

  root = json_object_new ();
  json_object_set_int_member (root, "timestamp", timestamp);
  json_object_set_int_member (root, "now", now);
  json_object_set_int_member (root, "interval", self->interval);

  metrics = json_array_new ();
  for (i = 0; i < result->numpmid; i++)
    {
      metric = json_object_new ();

      /* Name and derivation mode
       */
      json_object_set_string_member (metric, "name", self->metrics[i].name);
      if (self->metrics[i].derive)
        json_object_set_string_member (metric, "derive", self->metrics[i].derive);

      /* Instances
       */
      vs = result->vset[i];
      if (vs->numval < 0 || self->metrics[i].desc.indom == PM_INDOM_NULL)
        {
          /* When negative numval is an error code ... we don't care */
        }
      else
        {
          instances = json_array_new ();

          for (j = 0; j < vs->numval; j++)
            {
              /* PCP guarantees that the result is in the same order as requested */
              rc = pmNameInDom (self->metrics[i].desc.indom, vs->vlist[j].inst, &instance);
              if (rc != 0)
                {
                  g_warning ("%s: instance name lookup failed: %s", self->name, pmErrStr (rc));
                  instance = NULL;
                }

              /* HACK: We can't use json_builder_add_string_value here since
                 it turns empty strings into 'null' values inside arrays.

                 https://bugzilla.gnome.org/show_bug.cgi?id=730803
              */
              {
                JsonNode *string_element = json_node_alloc ();
                json_node_init_string (string_element, instance? instance : "");
                json_array_add_element (instances, string_element);
              }

              if (instance)
                free (instance);
            }
          json_object_set_array_member (metric, "instances", instances);
        }

      /* Units
       */
      if (self->metrics[i].factor == 1.0)
        {
          json_object_set_string_member (metric, "units", pmUnitsStr(self->metrics[i].units));
        }
      else
        {
          gchar *name = g_strdup_printf ("%s*%g", pmUnitsStr(self->metrics[i].units), 1.0/self->metrics[i].factor);
          json_object_set_string_member (metric, "units", name);
          g_free (name);
        }

      /* Semantics
       */
      switch (self->metrics[i].desc.sem) {
      case PM_SEM_COUNTER:
        json_object_set_string_member (metric, "semantics", "counter");
        break;
      case PM_SEM_INSTANT:
        json_object_set_string_member (metric, "semantics", "instant");
        break;
      case PM_SEM_DISCRETE:
        json_object_set_string_member (metric, "semantics", "discrete");
        break;
      default:
        break;
      }

      json_array_add_object_element (metrics, metric);
    }

  json_object_set_array_member (root, "metrics", metrics);
  return root;
}

static JsonObject *
build_meta_if_necessary (CockpitPcpMetrics *self,
                         pmResult *result)
{
  if (self->last)
    {
      /*
       * If we've already sent the first meta message, then only send
       * another when the set of instances in the results change.
       */

      if (result_meta_equal (self, self->last, result))
        return NULL;
    }

  return build_meta (self, result);
}

static void
build_sample (CockpitPcpMetrics *self,
              double **buffer,
              pmResult *result,
              int metric,
              int instance)
{
  MetricInfo *info = &self->metrics[metric];
  int valfmt = result->vset[metric]->valfmt;
  pmValue *value = &result->vset[metric]->vlist[instance];
  pmAtomValue sample;

  buffer[metric][instance] = NAN;

  if (info->desc.type == PM_TYPE_AGGREGATE || info->desc.type == PM_TYPE_EVENT)
    return;

  if (result->vset[metric]->numval <= instance)
    return;

  /* Make sure we keep the least 48 significant bits of 64 bit numbers
     since "delta" and "rate" derivation works on those, and the whole
     64 don't fit into a double.
  */

  if (info->desc.type == PM_TYPE_64)
    {
      if (pmExtractValue (valfmt, value, PM_TYPE_64, &sample, PM_TYPE_64) < 0)
        return;

      sample.d = (sample.ll << 16) >> 16;
    }
  else if (info->desc.type == PM_TYPE_U64)
    {
      if (pmExtractValue (valfmt, value, PM_TYPE_U64, &sample, PM_TYPE_U64) < 0)
        return;

      sample.d = (sample.ull << 16) >> 16;
    }
  else
    {
      if (pmExtractValue (valfmt, value, info->desc.type, &sample, PM_TYPE_DOUBLE) < 0)
        return;
    }

  if (info->units != &info->desc.units)
    {
      if (pmConvScale (PM_TYPE_DOUBLE, &sample, &info->desc.units, &sample, info->units) < 0)
        return;
      sample.d *= info->factor;
    }

  buffer[metric][instance] = sample.d;
}

static void
build_samples (CockpitPcpMetrics *self,
               pmResult *result)
{
  double **buffer;
  pmValueSet *vs;
  int i, j;

  buffer = cockpit_metrics_get_data_buffer (COCKPIT_METRICS (self));
  for (i = 0; i < result->numpmid; i++)
    {
      vs = result->vset[i];

      /* When negative numval is an error code ... we don't care */
      if (vs->numval < 0)
        {
          ;
        }
      else if (self->metrics[i].desc.indom == PM_INDOM_NULL)
        {
          build_sample (self, buffer, result, i, 0);
        }
      else
        {
          for (j = 0; j < vs->numval; j++)
            build_sample (self, buffer, result, i, j);
        }
    }
}

static void
cockpit_pcp_metrics_tick (CockpitMetrics *metrics,
                          gint64 timestamp)
{
  CockpitPcpMetrics *self = (CockpitPcpMetrics *)metrics;
  JsonObject *meta;
  pmResult *result;
  int rc;

  if (pmUseContext (self->direct_context) < 0)
    g_return_if_reached ();

  rc = pmFetch (self->numpmid, self->pmidlist, &result);
  if (rc < 0)
    {
      cockpit_channel_fail (COCKPIT_CHANNEL (self), "internal-error",
                            "%s: couldn't fetch metrics: %s", self->name, pmErrStr (rc));
      return;
    }

  meta = build_meta_if_necessary (self, result);
  if (meta)
    {
      cockpit_metrics_send_meta (metrics, meta, FALSE);
      json_object_unref (meta);
    }

  /* Send one set of samples */
  build_samples (self, result);
  cockpit_metrics_send_data (metrics, timestamp_from_timeval (&result->timestamp));
  cockpit_metrics_flush_data (metrics);

  if (self->last)
    pmFreeResult (self->last);
  self->last = result;
}

static void next_archive (CockpitPcpMetrics *self);

static gboolean
on_idle_batch (gpointer user_data)
{
  const int archive_batch = 60;
  CockpitPcpMetrics *self = user_data;
  ArchiveInfo *info;
  JsonObject *meta;
  pmResult *result;
  gint i;
  int rc;

  info = (ArchiveInfo *)(self->cur_archive->data);

  if (pmUseContext (info->context) < 0)
    {
      self->idler = 0;
      return FALSE;
    }

  for (i = 0; i < archive_batch; i++)
    {
      /* Sent enough samples? */
      self->limit--;
      if (self->limit < 0)
        {
          cockpit_metrics_flush_data (COCKPIT_METRICS (self));
          cockpit_channel_close (COCKPIT_CHANNEL (self), NULL);
          self->idler = 0;
          return FALSE;
        }

      rc = pmFetch (self->numpmid, self->pmidlist, &result);
      if (rc < 0)
        {
          self->idler = 0;

          if (rc == PM_ERR_EOL)
            {
              cockpit_metrics_flush_data (COCKPIT_METRICS (self));
              next_archive (self);
            }
          else
            {
              cockpit_channel_fail (COCKPIT_CHANNEL (self), "internal-error",
                                    "%s: couldn't read from archive: %s", self->name, pmErrStr (rc));
            }

          return FALSE;
        }

      meta = build_meta_if_necessary (self, result);
      if (meta)
        {
          cockpit_metrics_send_meta (COCKPIT_METRICS (self), meta, self->last == NULL);
          json_object_unref (meta);
        }

      build_samples (self, result);
      cockpit_metrics_send_data (COCKPIT_METRICS (self), timestamp_from_timeval (&result->timestamp));

      if (self->last)
        pmFreeResult (self->last);
      self->last = result;
    }

  cockpit_metrics_flush_data (COCKPIT_METRICS (self));
  return TRUE;
}

static gboolean
units_equal (pmUnits *a,
             pmUnits *b)
{
  return (a->scaleCount == b->scaleCount &&
          a->scaleTime == b->scaleTime &&
          a->scaleSpace == b->scaleSpace &&
          a->dimCount == b->dimCount &&
          a->dimTime == b->dimTime &&
          a->dimSpace == b->dimSpace);
}

static gboolean
units_convertible (pmUnits *a,
                   pmUnits *b)
{
  pmAtomValue dummy;
  dummy.d = 0;
  return pmConvScale (PM_TYPE_DOUBLE, &dummy, a, &dummy, b) >= 0;
}

static gboolean
convert_metric_description (CockpitPcpMetrics *self,
                            JsonNode *node,
                            MetricInfo *info,
                            int index,
                            gboolean *not_found)
{
  CockpitChannel *channel = COCKPIT_CHANNEL (self);
  const gchar *units;
  int rc;

  if (json_node_get_node_type (node) == JSON_NODE_OBJECT)
    {
      if (!cockpit_json_get_string (json_node_get_object (node), "name", NULL, &info->name)
          || info->name == NULL)
        {
          cockpit_channel_fail (channel, "protocol-error",
                                "%s: invalid \"metrics\" option was specified (no name for metric %d)",
                                self->name, index);
          return FALSE;
        }

      if (!cockpit_json_get_string (json_node_get_object (node), "units", NULL, &units))
        {
          cockpit_channel_fail (channel, "protocol-error",
                                "%s: invalid units for metric %s (not a string)",
                                self->name, info->name);
          return FALSE;
        }

      if (!cockpit_json_get_string (json_node_get_object (node), "derive", NULL, &info->derive))
        {
          cockpit_channel_fail (channel, "protocol-error",
                                "%s: invalid derivation mode for metric %s (not a string)",
                                self->name, info->name);
          return FALSE;
        }
    }
  else
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "%s: invalid \"metrics\" option was specified (not an object for metric %d)",
                            self->name, index);
      return FALSE;
    }

  rc = pmLookupName (1, (char **)&info->name, &info->id);
  if (rc < 0)
    {
      if (not_found)
        {
          *not_found = TRUE;
          g_message ("%s: no such metric: %s: %s", self->name, info->name, pmErrStr (rc));
        }
      else
        {
          cockpit_channel_fail (channel, "not-found",
                                "%s: no such metric: %s: %s", self->name, info->name, pmErrStr (rc));
        }
      return FALSE;
    }

  rc = pmLookupDesc (info->id, &info->desc);
  if (rc < 0)
    {
      if (not_found)
        {
          *not_found = TRUE;
        }
      else
        {
          cockpit_channel_fail (channel, "not-found",
                                "%s: no such metric: %s: %s", self->name, info->name, pmErrStr (rc));
        }
      return FALSE;
    }

  if (units)
    {
      if (my_pmParseUnitsStr (units, &info->units_buf, &info->factor) < 0)
        {
          cockpit_channel_fail (channel, "protocol-error",
                                "%s: failed to parse units: %s", self->name, units);
          return FALSE;
        }

      if (!units_convertible (&info->desc.units, &info->units_buf))
        {
          cockpit_channel_fail (channel, "protocol-error",
                                "%s: can't convert metric %s to units %s", self->name, info->name, units);
          return FALSE;
        }

      if (info->factor != 1.0 || !units_equal (&info->desc.units, &info->units_buf))
        info->units = &info->units_buf;
    }

  if (!info->units)
    {
      info->units = &info->desc.units;
      info->factor = 1.0;
    }

  return TRUE;
}

static gboolean
prepare_current_context (CockpitPcpMetrics *self,
                         gboolean *not_found)
{
  CockpitChannel *channel = COCKPIT_CHANNEL (self);
  JsonObject *options;
  gchar **instances = NULL;
  gchar **omit_instances = NULL;
  JsonArray *metrics;
  gboolean ret = FALSE;
  int i;

  g_free (self->metrics);
  g_free (self->pmidlist);

  self->numpmid = 0;
  self->metrics = NULL;
  self->pmidlist = NULL;

  options = cockpit_channel_get_options (channel);

  /* "instances" option */
  if (!cockpit_json_get_strv (options, "instances", NULL, (gchar ***)&instances))
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "%s: invalid \"instances\" option (not an array of strings)", self->name);
      goto out;
    }

  /* "omit-instances" option */
  if (!cockpit_json_get_strv (options, "omit-instances", NULL, (gchar ***)&omit_instances))
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "%s: invalid \"omit-instances\" option (not an array of strings)", self->name);
      goto out;
    }

  /* "metrics" option */
  if (!cockpit_json_get_array (options, "metrics", NULL, &metrics))
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "%s: invalid \"metrics\" option was specified (not an array)", self->name);
      goto out;
    }
  if (metrics)
    self->numpmid = json_array_get_length (metrics);

  self->pmidlist = g_new0 (pmID, self->numpmid);
  self->metrics = g_new0 (MetricInfo, self->numpmid);
  for (i = 0; i < self->numpmid; i++)
    {
      MetricInfo *info = &self->metrics[i];
      if (!convert_metric_description (self, json_array_get_element (metrics, i), info, i, not_found))
        goto out;

      self->pmidlist[i] = info->id;

      if (info->desc.indom != PM_INDOM_NULL)
        {
          if (instances)
            {
              pmDelProfile (info->desc.indom, 0, NULL);
              for (int i = 0; instances[i]; i++)
                {
                  int instid = pmLookupInDom (info->desc.indom, instances[i]);
                  if (instid >= 0)
                    pmAddProfile (info->desc.indom, 1, &instid);
                }
            }
          else if (omit_instances)
            {
              pmAddProfile (info->desc.indom, 0, NULL);
              for (int i = 0; omit_instances[i]; i++)
                {
                  int instid = pmLookupInDom (info->desc.indom, omit_instances[i]);
                  if (instid >= 0)
                    pmDelProfile (info->desc.indom, 1, &instid);
                }
            }
        }
    }

  ret = TRUE;

 out:
  g_free (instances);
  g_free (omit_instances);
  return ret;
}

static void start_archive (CockpitPcpMetrics *self, gint64 timestamp);

static gboolean
add_archive (CockpitPcpMetrics *self,
             const gchar *name)
{
  ArchiveInfo *info;
  pmLogLabel label;
  int rc;

  info = g_new0 (ArchiveInfo, 1);
  info->context = pmNewContext (PM_CONTEXT_ARCHIVE, name);
  if (info->context < 0)
    {
      if (info->context == -ENOENT)
        {
          g_debug ("%s: couldn't find pcp archive for %s", self->name, name);
          cockpit_channel_close (COCKPIT_CHANNEL (self), "not-found");
        }
      else
        {
          cockpit_channel_fail (COCKPIT_CHANNEL (self), "internal-error",
                                "%s: couldn't create pcp archive context for %s: %s",
                                self->name, name, pmErrStr (info->context));
        }
      g_free (info);
      return FALSE;
    }

  rc = pmGetArchiveLabel (&label);
  if (rc < 0)
    {
      cockpit_channel_fail (COCKPIT_CHANNEL (self), "internal-error",
                            "%s: couldn't read archive label of %s: %s",
                            self->name, name, pmErrStr (rc));
      pmDestroyContext (info->context);
      g_free (info);
      return FALSE;
    }

  info->start = label.ll_start.tv_sec * 1000 + label.ll_start.tv_usec / 1000;
  self->archives = g_list_prepend (self->archives, info);
  return TRUE;
}

static gint
cmp_archive_start (gconstpointer a,
                   gconstpointer b)
{
  const ArchiveInfo *a_info = a;
  const ArchiveInfo *b_info = b;

  if (a_info->start > b_info->start)
    return 1;
  else if (a_info->start < b_info->start)
    return -1;
  else
    return 0;
}

static gboolean
prepare_archives (CockpitPcpMetrics *self,
                  const gchar *name,
                  gint64 timestamp)
{
  gboolean ret = TRUE;
  GDir *dir;
  int count;
  GError *error = NULL;

  dir = g_dir_open (name, 0, &error);
  if (dir)
    {
      const gchar *entry;
      count = 0;
      while ((entry = g_dir_read_name (dir)) && count < 200)
        {
          if (g_str_has_suffix (entry, ".meta"))
            {
              gchar *path = g_build_filename (name, entry, NULL);
              path[strlen(path)-strlen(".meta")] = '\0';
              if (!add_archive (self, path))
                ret = FALSE;
              g_free (path);
              count += 1;
            }
        }
      g_dir_close (dir);
    }
  else if (g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_NOENT))
    {
      if (!add_archive (self, name))
        ret = FALSE;
    }
  else
    {
      cockpit_channel_fail (COCKPIT_CHANNEL (self), "internal-error",
                            "%s: %s", name, error->message);
      ret = FALSE;
    }

  g_clear_error (&error);

  if (self->archives == NULL)
    {
      if (ret)
        cockpit_channel_close (COCKPIT_CHANNEL (self), "not-found");
      return FALSE;
    }

  self->archives = g_list_sort (self->archives, cmp_archive_start);

  self->cur_archive = self->archives;
  start_archive (self, timestamp);
  return TRUE;
}

static void
start_archive (CockpitPcpMetrics *self,
               gint64 timestamp)
{
  CockpitChannel *channel = COCKPIT_CHANNEL (self);
  ArchiveInfo *info;
  struct timeval stamp;
  gboolean not_found;
  int rc;

  while (self->cur_archive && self->cur_archive->next
         && ((ArchiveInfo *)(self->cur_archive->next->data))->start < timestamp)
    self->cur_archive = self->cur_archive->next;

 again:
  if (self->cur_archive == NULL)
    {
      cockpit_channel_close (channel, NULL);
      return;
    }

  info = self->cur_archive->data;

  if (timestamp < info->start)
    timestamp = info->start;

  stamp.tv_sec = (timestamp / 1000);
  stamp.tv_usec = (timestamp % 1000) * 1000;

  rc = pmUseContext (info->context);
  if (rc < 0)
    {
      cockpit_channel_fail (channel, "internal-error",
                            "%s: couldn't switch pcp context: %s", self->name, pmErrStr (rc));
      return;
    }

  rc = pmSetMode (PM_MODE_INTERP | PM_XTB_SET(PM_TIME_MSEC), &stamp, self->interval);
  if (rc < 0)
    {
      cockpit_channel_fail (channel, "internal-error",
                            "%s: couldn't set pcp mode: %s", self->name, pmErrStr (rc));
      return;
    }

  not_found = TRUE;
  if (!prepare_current_context (self, &not_found))
    {
      if (not_found)
        {
          self->cur_archive = self->cur_archive->next;
          goto again;
        }
      return;
    }

  /* Make sure we send a meta message.
   */
  if (self->last)
    pmFreeResult (self->last);
  self->last = NULL;

  g_assert (self->idler == 0);
  self->idler = g_idle_add (on_idle_batch, self);
}

static void
next_archive (CockpitPcpMetrics *self)
{
  self->cur_archive = self->cur_archive->next;
  start_archive (self, 0);
}

static gboolean
ensure_pcp_conf (CockpitChannel *channel)
{
  gboolean res = TRUE;
  gchar *prefix;
  gchar *conf;
  gchar *confpath = NULL;
  FILE *fp = NULL;

  /* Libpcp is prone to call exit(1) behind our backs when it can't
     find its config file, so we check here first.
  */

  prefix = getenv("PCP_DIR");
  conf = getenv("PCP_CONF");

  if (conf == NULL)
    {
      if (prefix == NULL)
        confpath = g_strdup ("/etc/pcp.conf");
      else
        confpath = g_strdup_printf ("%s/etc/pcp.conf", prefix);
      conf = confpath;
    }

  if (access((const char *)conf, R_OK) < 0 ||
      (fp = fopen(conf, "r")) == NULL)
    {
      cockpit_channel_fail (channel, "internal-error", "could not access %s: %m", conf);
      res = FALSE;
    }

  if (fp)
    fclose (fp);
  g_free (confpath);
  return res;
}

static void
cockpit_pcp_metrics_prepare (CockpitChannel *channel)
{
  CockpitPcpMetrics *self = COCKPIT_PCP_METRICS (channel);
  JsonObject *options;
  const gchar *source;
  int type;
  char *name = NULL;
  gint64 timestamp;

  COCKPIT_CHANNEL_CLASS (cockpit_pcp_metrics_parent_class)->prepare (channel);

  options = cockpit_channel_get_options (channel);

  if (!ensure_pcp_conf (channel))
    goto out;

  /* "source" option */
  if (!cockpit_json_get_string (options, "source", NULL, &source))
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "invalid \"source\" option for metrics channel");
      goto out;
    }
  else if (!source)
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "no \"source\" option specified for metrics channel");
      goto out;
    }
  else if (g_str_has_prefix (source, "/"))
    {
      type = PM_CONTEXT_ARCHIVE;
      name = g_strdup (source);
    }
  else if (g_str_has_prefix (source, "pcp-archive"))
    {
      gchar *dir = pmGetConfig("PCP_LOG_DIR");
      gchar hostname[HOST_NAME_MAX + 1];
      if (gethostname (hostname, HOST_NAME_MAX) < 0)
        {
          cockpit_channel_fail (channel, "internal-error", "error getting hostname: %m");
          goto out;
        }
      hostname[HOST_NAME_MAX] = '\0';
      type = PM_CONTEXT_ARCHIVE;
      name = g_strdup_printf ("%s/pmlogger/%s", dir, hostname);
    }
  else if (g_str_equal (source, "direct"))
    {
      type = PM_CONTEXT_LOCAL;
      name = NULL;
    }
  else if (g_str_equal (source, "pmcd"))
    {
      type = PM_CONTEXT_HOST;
      name = g_strdup ("local:");
    }
  else
    {
      cockpit_channel_fail (channel, "not-supported",
                            "unsupported \"source\" option specified for metrics: %s", source);
      goto out;
    }

  self->name = source;

  /* "timestamp" option */
  if (!cockpit_json_get_int (options, "timestamp", 0, &timestamp))
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "%s: invalid \"timestamp\" option", self->name);
      goto out;
    }
  if (timestamp / 1000 < G_MINLONG || timestamp / 1000 > G_MAXLONG)
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "%s: invalid \"timestamp\" value: %" G_GINT64_FORMAT, self->name, timestamp);
      goto out;
    }

  if (timestamp < 0)
    {
      struct timeval now;
      gettimeofday (&now, NULL);
      timestamp = (now.tv_sec * 1000 + now.tv_usec / 1000) + timestamp;
    }

  /* "limit" option */
  if (!cockpit_json_get_int (options, "limit", G_MAXINT64, &self->limit))
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "%s: invalid \"limit\" option", self->name);
      goto out;
    }
  else if (self->limit <= 0)
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "%s: invalid \"limit\" option value: %" G_GINT64_FORMAT, self->name, self->limit);
      goto out;
    }

  /* "interval" option */
  if (!cockpit_json_get_int (options, "interval", 1000, &self->interval))
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "%s: invalid \"interval\" option", self->name);
      goto out;
    }
  else if (self->interval <= 0 || self->interval > G_MAXINT)
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "%s: invalid \"interval\" value: %" G_GINT64_FORMAT, self->name, self->interval);
      goto out;
    }

  if (type == PM_CONTEXT_ARCHIVE)
    {
      if (!prepare_archives (self, name, timestamp))
        goto out;
    }
  else
    {
      self->direct_context = pmNewContext(type, name);
      if (self->direct_context < 0)
        {
          if (self->direct_context == -ENOENT)
            {
              g_debug ("%s: couldn't create PCP context: %s", self->name, pmErrStr (self->direct_context));
              cockpit_channel_close (channel, "not-supported");
            }
          else
            {
              cockpit_channel_fail (channel, "internal-error",
                                    "%s: couldn't create PCP context: %s",
                                    self->name, pmErrStr (self->direct_context));
            }
          goto out;
        }

      if (!prepare_current_context (self, NULL))
        goto out;
    }

  if (type != PM_CONTEXT_ARCHIVE)
      cockpit_metrics_metronome (COCKPIT_METRICS (self), self->interval);
  cockpit_channel_ready (channel, NULL);

out:
  g_free (name);
}

static void
cockpit_pcp_metrics_dispose (GObject *object)
{
  CockpitPcpMetrics *self = COCKPIT_PCP_METRICS (object);

  if (self->idler)
    {
      g_source_remove (self->idler);
      self->idler = 0;
    }

  if (self->last)
    {
      pmFreeResult (self->last);
      self->last = NULL;
    }

  for (GList *a = self->archives; a; a = a->next)
    {
      ArchiveInfo *info = a->data;
      if (info->context >= 0)
        pmDestroyContext (info->context);
      g_free (info);
    }
  g_list_free (self->archives);
  self->archives = NULL;

  if (self->direct_context >= 0)
    {
      pmDestroyContext (self->direct_context);
      self->direct_context = -1;
    }

  G_OBJECT_CLASS (cockpit_pcp_metrics_parent_class)->dispose (object);
}

static void
cockpit_pcp_metrics_finalize (GObject *object)
{
  CockpitPcpMetrics *self = COCKPIT_PCP_METRICS (object);

  g_free (self->metrics);
  g_free (self->pmidlist);

  G_OBJECT_CLASS (cockpit_pcp_metrics_parent_class)->finalize (object);
}

static void
cockpit_pcp_metrics_class_init (CockpitPcpMetricsClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  CockpitMetricsClass *metrics_class = COCKPIT_METRICS_CLASS (klass);
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);

  gobject_class->dispose = cockpit_pcp_metrics_dispose;
  gobject_class->finalize = cockpit_pcp_metrics_finalize;

  channel_class->prepare = cockpit_pcp_metrics_prepare;
  metrics_class->tick = cockpit_pcp_metrics_tick;
}

/* This is the version of pmParseUnitsStr as proposed here:

   fche/units-parse @ git://sourceware.org/git/pcpfans.git
 */

/*
 * Copyright (c) 2014 Red Hat.
 * Copyright (c) 1995 Silicon Graphics, Inc.  All Rights Reserved.
 *
 * This library is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published
 * by the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Lesser General Public
 * License for more details.
 */

#include <math.h>
#include <inttypes.h>
#include <assert.h>
#include <ctype.h>

// Parse a general "N $units" string into a pmUnits tuple and a multiplier.
// $units can be a series of SCALE-UNIT^EXPONENT, each unit dimension appearing
// at most once.

// An internal variant of pmUnits, but without the narrow bitfields.
// That way, we can tolerate intermediate arithmetic that goes out of
// range of the 4-bit bitfields.
typedef struct pmUnitsBig {
    int dimSpace;    /* space dimension */
    int dimTime;     /* time dimension */
    int dimCount;    /* event dimension */
    unsigned scaleSpace;  /* one of PM_SPACE_* below */
    unsigned scaleTime;   /* one of PM_TIME_* below */
    int scaleCount;  /* one of PM_COUNT_* below */
} pmUnitsBig;

static int
__pmParseUnitsStrPart(const char *str, const char *str_end, pmUnitsBig *out, double *multiplier)
{
    int sts = 0;
    unsigned i;
    const char *ptr; // scanning along str
    enum dimension_t {d_none,d_space,d_time,d_count} dimension;
    struct unit_keyword_t { const char *keyword; int scale; };
    static const struct unit_keyword_t time_keywords[] = {
        { "nanoseconds", PM_TIME_NSEC }, { "nanosecond", PM_TIME_NSEC },
        { "nanosec", PM_TIME_NSEC }, { "ns", PM_TIME_NSEC },
        { "microseconds", PM_TIME_USEC }, { "microsecond", PM_TIME_USEC },
        { "microsec", PM_TIME_USEC }, { "us", PM_TIME_USEC },
        { "milliseconds", PM_TIME_MSEC }, { "millisecond", PM_TIME_MSEC },
        { "millisec", PM_TIME_MSEC }, { "ms", PM_TIME_MSEC },
        { "seconds", PM_TIME_SEC }, { "second", PM_TIME_SEC },
        { "sec", PM_TIME_SEC },
        { "s", PM_TIME_SEC },
        { "minutes", PM_TIME_MIN }, { "minute", PM_TIME_MIN }, { "min", PM_TIME_MIN },
        { "hours", PM_TIME_HOUR }, { "hour", PM_TIME_HOUR }, { "hr", PM_TIME_HOUR },
        { "time-0", 0 }, /* { "time-1", 1 }, */ { "time-2", 2 }, { "time-3", 3 },
        { "time-4", 4 }, { "time-5", 5 }, { "time-6", 6 }, { "time-7", 7 },
        { "time-8", 8 }, { "time-9", 9 }, { "time-10", 10 }, { "time-11", 11 },
        { "time-12", 12 }, { "time-13", 13 }, { "time-14", 14 }, { "time-15", 15 },
        { "time-1", 1 },
    };
    const size_t num_time_keywords = sizeof(time_keywords) / sizeof(time_keywords[0]);
    static const struct unit_keyword_t space_keywords[] = {
        { "bytes", PM_SPACE_BYTE }, { "byte", PM_SPACE_BYTE },
        { "Kbytes", PM_SPACE_KBYTE }, { "Kbyte", PM_SPACE_KBYTE },
        { "Kilobytes", PM_SPACE_KBYTE }, { "Kilobyte", PM_SPACE_KBYTE },
        { "KB", PM_SPACE_KBYTE },
        { "Mbytes", PM_SPACE_MBYTE }, { "Mbyte", PM_SPACE_MBYTE },
        { "Megabytes", PM_SPACE_MBYTE }, { "Megabyte", PM_SPACE_MBYTE },
        { "MB", PM_SPACE_MBYTE },
        { "Gbytes", PM_SPACE_GBYTE }, { "Gbyte", PM_SPACE_GBYTE },
        { "Gigabytes", PM_SPACE_GBYTE }, { "Gigabyte", PM_SPACE_GBYTE },
        { "GB", PM_SPACE_GBYTE },
        { "Tbytes", PM_SPACE_TBYTE }, { "Tbyte", PM_SPACE_TBYTE },
        { "Terabytes", PM_SPACE_TBYTE }, { "Terabyte", PM_SPACE_TBYTE },
        { "TB", PM_SPACE_TBYTE },
        { "Pbytes", PM_SPACE_PBYTE }, { "Pbyte", PM_SPACE_PBYTE },
        { "Petabytes", PM_SPACE_PBYTE }, { "Petabyte", PM_SPACE_PBYTE },
        { "PB", PM_SPACE_PBYTE },
        { "Ebytes", PM_SPACE_EBYTE }, { "Ebyte", PM_SPACE_EBYTE },
        { "Exabytes", PM_SPACE_EBYTE }, { "Exabyte", PM_SPACE_EBYTE },
        { "EB", PM_SPACE_EBYTE },
        { "space-0", 0 }, /* { "space-1", 1 }, */ { "space-2", 2 }, { "space-3", 3 },
        { "space-4", 4 }, { "space-5", 5 }, { "space-6", 6 }, { "space-7", 7 },
        { "space-8", 8 }, { "space-9", 9 }, { "space-10", 10 }, { "space-11", 11 },
        { "space-12", 12 }, { "space-13", 13 }, { "space-14", 14 }, { "space-15", 15 },
        { "space-1", 1 },
    };
    const size_t num_space_keywords = sizeof(space_keywords) / sizeof(space_keywords[0]);
    static const struct unit_keyword_t count_keywords[] = {
        { "count x 10^-8", -8 },
        { "count x 10^-7", -7 },
        { "count x 10^-6", -6 },
        { "count x 10^-5", -5 },
        { "count x 10^-4", -4 },
        { "count x 10^-3", -3 },
        { "count x 10^-2", -2 },
        { "count x 10^-1", -1 },
        /* { "count", 0 }, { "counts", 0 }, */
        /* { "count x 10", 1 },*/
        { "count x 10^2", 2 },
        { "count x 10^3", 3 },
        { "count x 10^4", 4 },
        { "count x 10^5", 5 },
        { "count x 10^6", 6 },
        { "count x 10^7", 7 },
        { "count x 10", 1 },
        { "counts", 0 },
        { "count", 0 },
        // NB: we don't support the anomalous "x 10^SCALE" syntax for the dimCount=0 case.
    };
    const size_t num_count_keywords = sizeof(count_keywords) / sizeof(count_keywords[0]);
    static const struct unit_keyword_t exponent_keywords[] = {
        { "^-8", -8 }, { "^-7", -7 }, { "^-6", -6 }, { "^-5", -5 },
        { "^-4", -4 }, { "^-3", -3 }, { "^-2", -2 }, { "^-1", -1 },
        { "^0", 0 }, /*{ "^1", 1 }, */ { "^2", 2 }, { "^3", 3 },
        { "^4", 4 }, { "^5", 5 }, { "^6", 6 }, { "^7", 7 },
        // NB: the following larger exponents are enabled by use of pmUnitsBig above.
        // They happen to be necessary because pmUnitsStr emits foo-dim=-8 as "/ foo^8",
        // so the denominator could encounter wider-than-bitfield exponents.
        { "^8", 8 }, { "^9", 9 }, { "^10", 10 }, { "^11", 11 },
        { "^12", 12 }, { "^13", 13 }, { "^14", 14 }, { "^15", 15 },
        { "^1", 1 },
    };
    const size_t num_exponent_keywords = sizeof(exponent_keywords) / sizeof(exponent_keywords[0]);

    *multiplier = 1.0;
    memset (out, 0, sizeof (*out));
    ptr = str;

    while (ptr != str_end) { // parse whole string
        assert (*ptr != '\0');

        if (isspace (*ptr)) { // skip whitespace
            ptr ++;
            continue;
        }

        if (*ptr == '-' || *ptr == '.' || isdigit(*ptr)) { // possible floating-point number
            // parse it with strtod(3).
            char *newptr;
            errno = 0;
            double m = strtod(ptr, &newptr);
            if (errno || newptr == ptr || newptr > str_end) {
                sts = PM_ERR_CONV;
                goto out;
            }
            ptr = newptr;
            *multiplier *= m;
            continue;
        }

        dimension = d_none; // classify dimension of base unit

        // match & skip over keyword (followed by space, ^, or EOL)
#define streqskip(q) (((ptr+strlen(q) <= str_end) &&        \
                       (strncasecmp(ptr,q,strlen(q))==0) && \
                       ((isspace(*(ptr+strlen(q)))) ||      \
                        (*(ptr+strlen(q))=='^') ||          \
                        (ptr+strlen(q)==str_end)))          \
                       ? (ptr += strlen(q), 1) : 0)

        // parse base unit, only once per input string.  We don't support
        // "microsec millisec", as that would require arithmetic on the scales.
        // We could support "sec sec" (and turn that into sec^2) in the future.
        for (i=0; i<num_time_keywords; i++)
            if (dimension == d_none && out->dimTime == 0 && streqskip (time_keywords[i].keyword)) {
                out->scaleTime = time_keywords[i].scale;
                dimension = d_time;
            }
        for (i=0; i<num_space_keywords; i++)
            if (dimension == d_none && out->dimSpace == 0 && streqskip (space_keywords[i].keyword)) {
                out->scaleSpace = space_keywords[i].scale;
                dimension = d_space;
            }
        for (i=0; i<num_count_keywords; i++)
            if (dimension == d_none && out->dimCount == 0 && streqskip (count_keywords[i].keyword)) {
                out->scaleCount = count_keywords[i].scale;
                dimension = d_count;
            }

        // parse optional dimension exponent
        switch (dimension) {
        case d_none:
            // unrecognized base unit, punt!
            sts = PM_ERR_CONV;
            goto out;

        case d_time:
            if (ptr == str_end || isspace(*ptr)) {
                out->dimTime = 1;
            } else {
                for (i=0; i<num_exponent_keywords; i++)
                    if (streqskip (exponent_keywords[i].keyword)) {
                        out->dimTime = exponent_keywords[i].scale;
                        break;
                    }
            }
            break;

        case d_space:
            if (ptr == str_end || isspace(*ptr)) {
                out->dimSpace = 1;
            } else {
                for (i=0; i<num_exponent_keywords; i++)
                    if (streqskip (exponent_keywords[i].keyword)) {
                        out->dimSpace = exponent_keywords[i].scale;
                        break;
                    }
            }
            break;

        case d_count:
            if (ptr == str_end || isspace(*ptr)) {
                out->dimCount = 1;
            } else {
                for (i=0; i<num_exponent_keywords; i++)
                    if (streqskip (exponent_keywords[i].keyword)) {
                        out->dimCount = exponent_keywords[i].scale;
                        break;
                    }
            }
            break;
        }

        // fall through to next unit^exponent bit, if any
    }

out:
    return sts;
}



// Parse a general "N $units / M $units" string into a pmUnits tuple and a multiplier.
static int
my_pmParseUnitsStr(const char *str, pmUnits *out, double *multiplier)
{
    const char *slash;
    double dividend_mult, divisor_mult;
    pmUnitsBig dividend, divisor;
    int sts;
    int dim;

    assert (str);
    assert (out);
    assert (multiplier);

    memset (out, 0, sizeof (*out));

    // Parse the dividend and divisor separately
    slash = strchr (str, '/');
    if (slash == NULL) {
        sts = __pmParseUnitsStrPart(str, str+strlen(str), & dividend, & dividend_mult);
        if (sts < 0)
            goto out;
        // empty string for nonexistent denominator; will just return (0,0,0,0,0,0)*1.0
        sts = __pmParseUnitsStrPart(str+strlen(str), str+strlen(str), & divisor, & divisor_mult);
        if (sts < 0)
            goto out;
    } else {
        sts = __pmParseUnitsStrPart(str, slash, & dividend, & dividend_mult);
        if (sts < 0)
            goto out;
        sts = __pmParseUnitsStrPart(slash+1, str+strlen(str), & divisor, & divisor_mult);
        if (sts < 0)
            goto out;
    }

    // Compute the quotient dimensionality, check for possible bitfield overflow.
    dim = dividend.dimSpace - divisor.dimSpace;
    if (dim < -8 || dim > 7) {
        sts = PM_ERR_CONV;
        goto out;
    } else {
        out->dimSpace = dim;
    }
    dim = dividend.dimTime - divisor.dimTime;
    if (dim < -8 || dim > 7) {
        sts = PM_ERR_CONV;
        goto out;
    } else {
        out->dimTime = dim;
    }
    dim = dividend.dimCount - divisor.dimCount;
    if (dim < -8 || dim > 7) {
        sts = PM_ERR_CONV;
        goto out;
    } else {
        out->dimCount = dim;
    }

    // Compute the individual scales.  In theory, we have considerable
    // freedom here, because we are also outputting a multiplier.  We
    // could just set all out->scale* to 0, and accumulate the
    // compensating scaling multipliers there.  But in order to
    // fulfill the testing-oriented invariant:
    //
    // for all valid pmUnits u:
    //     pmParseUnitsStr(pmUnitsStr(u), out_u, out_multiplier) succeeds, and
    //     out_u == u, and
    //     out_multiplier == 1.0
    //
    // we need to propagate scales to some extent.  It is helpful to
    // realize that pmUnitsStr() never generates multiplier literals,
    // nor the same dimension in the dividend and divisor.

    *multiplier = divisor_mult / dividend_mult; // NB: note reciprocation

    if (dividend.dimSpace == 0 && divisor.dimSpace != 0)
        out->scaleSpace = divisor.scaleSpace;
    else if (divisor.dimSpace == 0 && dividend.dimSpace != 0)
        out->scaleSpace = dividend.scaleSpace;
    else { // both have space dimension; must compute a scale/multiplier
        out->scaleSpace = PM_SPACE_BYTE;
        *multiplier *= pow (pow (1024.0, (double) dividend.scaleSpace), -(double)dividend.dimSpace);
        *multiplier *= pow (pow (1024.0, (double) divisor.scaleSpace), (double)divisor.dimSpace);
        if (out->dimSpace == 0) // became dimensionless?
            out->scaleSpace = 0;
    }

    if (dividend.dimCount == 0 && divisor.dimCount != 0)
        out->scaleCount = divisor.scaleCount;
    else if (divisor.dimCount == 0 && dividend.dimCount != 0)
        out->scaleCount = dividend.scaleCount;
    else { // both have count dimension; must compute a scale/multiplier
        out->scaleCount = PM_COUNT_ONE;
        *multiplier *= pow (pow (10.0, (double) dividend.scaleCount), -(double)dividend.dimCount);
        *multiplier *= pow (pow (10.0, (double) divisor.scaleCount), (double)divisor.dimCount);
        if (out->dimCount == 0) // became dimensionless?
            out->scaleCount = 0;
    }

    if (dividend.dimTime == 0 && divisor.dimTime != 0)
        out->scaleTime = divisor.scaleTime;
    else if (divisor.dimTime == 0 && dividend.dimTime != 0)
        out->scaleTime = dividend.scaleTime;
    else { // both have time dimension; must compute a scale/multiplier
        out->scaleTime = PM_TIME_SEC;
        static const double time_scales [] = {[PM_TIME_NSEC] = 0.000000001,
                                              [PM_TIME_USEC] = 0.000001,
                                              [PM_TIME_MSEC] = 0.001,
                                              [PM_TIME_SEC]  = 1,
                                              [PM_TIME_MIN]  = 60,
                                              [PM_TIME_HOUR] = 3600 };
        // guaranteed by __pmParseUnitsStrPart; ensure in-range array access
        assert (dividend.scaleTime >= PM_TIME_NSEC && dividend.scaleTime <= PM_TIME_HOUR);
        assert (divisor.scaleTime >= PM_TIME_NSEC && divisor.scaleTime <= PM_TIME_HOUR);
        *multiplier *= pow (time_scales[dividend.scaleTime], -(double)dividend.dimTime);
        *multiplier *= pow (time_scales[divisor.scaleTime], (double)divisor.dimTime);
        if (out->dimTime == 0) // became dimensionless?
            out->scaleTime = 0;
    }

 out:
    if (sts < 0) {
        memset (out, 0, sizeof (*out)); // clear partially filled in pmUnits
        *multiplier = 1.0;
    }
    return sts;
}
