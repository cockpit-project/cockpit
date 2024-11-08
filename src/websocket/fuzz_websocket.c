#include "config.h"

#include "websocket.h"
#include "websocketprivate.h"

#include <stdint.h>

#define kMinInputLength 2
#define kMaxInputLength 1024

extern int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size);

int
LLVMFuzzerTestOneInput(const uint8_t *data, size_t size)
{
    char *data_in;

    if (size < kMinInputLength || size > kMaxInputLength)
        return 0;

    data_in = calloc(size + 1, sizeof(char));
    if (data_in == NULL)
        return 0;

    memcpy(data_in, data, size);

    {
        gchar  *path = NULL;
        gchar  *method = NULL;

        web_socket_util_parse_req_line((char *)data, size, &method, &path);
        if (method != NULL)
            g_free(method);

        if (path != NULL)
            g_free(path);
    }
    {
        guint  status;
        gchar  *reason = NULL;

        web_socket_util_parse_status_line(data_in, size + 1, NULL, &status, &reason);
        if (reason != NULL)
            g_free(reason);
    }
    {
        GHashTable  *headers = NULL;

        web_socket_util_parse_headers(data_in, size + 1, &headers);
        if (headers != NULL)
            g_hash_table_unref(headers);
    }

    free(data_in);
    return 0;
}
