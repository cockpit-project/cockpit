#pragma once

#include "cockpitwebserver.h"

struct _CockpitWebRequest {
  int state;
  GIOStream *io;
  GByteArray *buffer;
  gint delayed_reply;
  CockpitWebServer *web_server;
  gboolean eof_okay;
  GSource *source;
  GSource *timeout;
  gboolean check_tls_redirect;

  GHashTable *headers;
  const gchar *original_path;
  const gchar *path;
  const gchar *host;
  const gchar *query;
  const gchar *method;
};

#define WebRequest(...) (&(CockpitWebRequest) {__VA_ARGS__})
