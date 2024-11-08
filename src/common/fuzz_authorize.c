#include "config.h"

#include "cockpitauthorize.h"

#include <stdlib.h>
#include <stdint.h>
#include <string.h>

#define kMinInputLength 2
#define kMaxInputLength 1024

extern int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size);

int
LLVMFuzzerTestOneInput(const uint8_t *data, size_t size)
{
    char  *data_in;

    if (size < kMinInputLength || size > kMaxInputLength)
        return 0;

    data_in = calloc(size + 1, sizeof(char));
    if (data_in == NULL)
        return 0;

    memcpy(data_in, data, size);

    {
        char  *user = "a";
        char  *password = NULL;

        password = cockpit_authorize_parse_basic(data_in, &user);
        if (password != NULL) {
            free(password);
            free(user);
        }
    }
    {
        void  *result = NULL;

        result = cockpit_authorize_parse_negotiate(data_in, NULL);
        if (result != NULL)
            free(result);
    }
    {
        void  *result = NULL;
        char  *conversation = NULL;

        result = cockpit_authorize_parse_x_conversation(data_in, &conversation);
        if (result != NULL)
            free(result);

        if (conversation != NULL)
            free(conversation);
    }

    free(data_in);
    return 0;
}
