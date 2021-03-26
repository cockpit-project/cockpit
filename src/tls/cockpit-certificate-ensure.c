#include <assert.h>
#include <err.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <common/cockpitwebcertificate.h>

#include "certificate.h"
#include "utils.h"

// Renew certificates with less than 30 days validity
#define EXPIRY_THRESHOLD (30 * 24 * 60 * 60)

static bool
check_expiry (const char *filename)
{
  Certificate *certificate = certificate_load (filename);

  time_t expires = certificate_get_expiry (certificate);

  debug (ENSURE, "Certificate %s expires %ld", filename, (long) expires);

  certificate_unref (certificate);

  return expires > time (NULL) + EXPIRY_THRESHOLD;
}

static bool
have_certificate (void)
{
  char *error = NULL;
  char *filename = cockpit_certificate_locate (true, &error);

  if (error != NULL)
    errx (EXIT_FAILURE, "%s", error);

  if (filename == NULL)
    {
      debug (ENSURE, "Couldn't locate any certificate");
      return false;
    }

  if (strstr (filename, "/0-self-signed.cert"))
    {
      debug (ENSURE, "Certificate is self-signed, checking expiry");
      return check_expiry (filename);
    }

  debug (ENSURE, "Certificate looks good: %s", filename);

  return true;
}

#define COCKPIT_CERTIFICATE_HELPER   LIBEXECDIR "/cockpit-certificate-helper"

int
main (void)
{
  if (have_certificate ())
    return 0;

  debug (ENSURE, "Calling %s to create a certificate", COCKPIT_CERTIFICATE_HELPER);

  execl (COCKPIT_CERTIFICATE_HELPER, COCKPIT_CERTIFICATE_HELPER, "selfsign", NULL);
  err (EXIT_FAILURE, "execl: " COCKPIT_CERTIFICATE_HELPER);
}
