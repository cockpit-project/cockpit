#include "util.h"

#include <stdlib.h>

static gint
virtTestEncodeStr(const gchar *input,
                  const gchar *expected)
{
    g_autofree gchar *encoded = virtDBusUtilEncodeStr(input);

    if (!g_str_equal(encoded, expected)) {
        g_printerr("encode failed: expected '%s' actual '%s'\n",
                   expected, encoded);
        return -1;
    }

    return 0;
}

static gint
virtTestDecodeStr(const gchar *input,
                  const gchar *expected)
{
    g_autofree gchar *decoded = virtDBusUtilDecodeStr(input);

    if (!g_str_equal(decoded, expected)) {
        g_printerr("decode failed: expected '%s' actual '%s'\n",
                   expected, decoded);
        return -1;
    }

    return 0;
}

gint
main(void)
{
#define TEST_ENCODE_DECODE(input, output) \
    if (virtTestEncodeStr(input, output) < 0) \
        return EXIT_FAILURE; \
    if (virtTestDecodeStr(output, input) < 0) \
        return EXIT_FAILURE;

    TEST_ENCODE_DECODE("foobar", "foobar");
    TEST_ENCODE_DECODE("_", "_5f");
    TEST_ENCODE_DECODE("/path/to/some/file.img", "_2fpath_2fto_2fsome_2ffile_2eimg");

    return EXIT_SUCCESS;
}
