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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#include "hilscherlegaldisclaimer.h"

#include "common/cockpitjson.h"
#include "common/cockpitwebserver.h"

// String constants
static const char* DISCLAIMER_ACCEPTANCE_FILE = "/var/lib/cockpit/disclaimeraccepted.json";
static const char* DISCLAIMER_ACCEPTANCE_ATTRIBUTE = "legalDisclaimerAccepted";

/**
 * This enum defines the positions of the key and value 
 * in a splitted cookie string
 */
typedef enum
{
    COOKIE_INDEX_KEY = 0,  /*!< Position of the cookie key/name */
    COOKIE_INDEX_VALUE = 1 /*!< Position of the cookie value */
} COOKIE_KEY_VALUE_INDEX_E;

// Private functions
static void                      handleDisclaimerAcceptanceFileError (GError *error);

static gboolean                  createLegalDisclaimerAcceptanceFile (const gchar* path, 
                                                                      GError **error);

static JsonObject                *readJsonFile                       (const gchar *path,
                                                                      GError **error);

static gboolean                  writeJsonFile                       (JsonObject *object,
                                                                      const gchar *path, 
                                                                      GError **error);

static gchar                     *getCookies                         (GHashTable *headers);

static DISCLAIMER_COOKIE_STATE_E extractDisclaimerCookieState        (gchar *cookieString);

/**
 * Check if the hilscher legal disclaimer is accepted. 
 * 
 * Try to read the disclaimer acceptance file to check if the legal disclaimer was already accepted.
 * If the the file is not available it will be created.
 * 
 * \return Returns TRUE if the disclaimer was already accepted. Otherwise FALSE is returned.
 */
gboolean 
hilscher_legalDisclaimerAccepted(void)
{
    JsonObject *disclaimerAcceptanceInfo = NULL;
    GError *error = NULL;
    gboolean accepted = FALSE;
    gboolean success = FALSE;
    

    disclaimerAcceptanceInfo = readJsonFile(DISCLAIMER_ACCEPTANCE_FILE, &error);
    if (!disclaimerAcceptanceInfo)
    {
        handleDisclaimerAcceptanceFileError(error);
        return FALSE;
    }

    success = cockpit_json_get_bool(disclaimerAcceptanceInfo, DISCLAIMER_ACCEPTANCE_ATTRIBUTE, FALSE, &accepted);
    if(!success) 
    {
        g_warning("Could not check if legal disclaimer is accepted");
    }
    
    //Clean up
    json_object_unref(disclaimerAcceptanceInfo);
    return accepted;
}

/**
 * Read the file as bytes and parse those bytes as a json object.
 * 
 * \param directory [in]  The directory where to find the file.
 * \param error     [out] An error object to indicate possible errors.
 * \return Returns the parsed data as a json object or NULL if the file could not be read.
 */
static JsonObject *
readJsonFile(const gchar *path,
             GError **error)
{
    JsonObject *object = NULL;
    GMappedFile *mapped = NULL;
    GBytes *bytes = NULL;

    mapped = g_mapped_file_new(path, FALSE, error);

    if (!mapped)
    {
        return NULL;
    }

    bytes = g_mapped_file_get_bytes(mapped);
    object = cockpit_json_parse_bytes(bytes, error);
    g_mapped_file_unref(mapped);
    g_bytes_unref(bytes);

    return object;
}

/**
 * Handle the error if the read operation of the disclaimer acceptance file fails.
 * 
 * If the disclaimer acceptance file does not exists, it will be created. Otherwise the 
 * the error is simply logged.
 * 
 * \param error [in] The type of error that occurred.
 */
static void 
handleDisclaimerAcceptanceFileError(GError *error)
{
    gboolean success = FALSE;
    // If the legal disclaimer acceptance file does not exists try to create it.
    if (error->code == G_FILE_ERROR_NOENT)
    {
        g_clear_error(&error);
        success = createLegalDisclaimerAcceptanceFile(DISCLAIMER_ACCEPTANCE_FILE, &error);
        if(!success)
        {
            g_warning("Error creating legal disclaimer acceptance file: (%s)", error->message);
            g_clear_error(&error);
        }
    }
    else {
        g_warning("Error checking if legal disclaimer is accepted: (%s)", error->message);
        g_clear_error(&error);
    }
}

/**
 * Creates the file for the information about the legal disclaimer acceptance.
 * 
 * \param path  [in]  The path where to create the file.
 * \param error [out] An error value storing an error object in case of a failure.
 * \return TRUE if the file was created successfully. Otherwise FALSE.
 */
static gboolean 
createLegalDisclaimerAcceptanceFile(const gchar* path, GError **error)
{
    JsonObject *disclaimerAcceptanceInfo = NULL;
    gboolean success = FALSE;

    disclaimerAcceptanceInfo = json_object_new();
    json_object_set_boolean_member(disclaimerAcceptanceInfo, DISCLAIMER_ACCEPTANCE_ATTRIBUTE, FALSE);
    success = writeJsonFile(disclaimerAcceptanceInfo, path, error);

    return success;
}

/**
 * Checks if the disclaimer acceptance cookie is set to "true".
 * 
 * \param cookieString [in] The cookie string from the request.
 * \return TRUE if the cookie was set to "true". Otherwise FALSE.
 */
 DISCLAIMER_COOKIE_STATE_E
hilscher_getDisclaimerCookieState(GHashTable *headers)
{
    gchar *cookieString = NULL;
    
    cookieString = getCookies(headers);
    if(cookieString == NULL)
    {
        g_warning("Could not read cookies form request header");
        return DISCLAIMER_COOKIE_ERROR;
    }

    return extractDisclaimerCookieState(cookieString);
}

/**
 * Extract cookies from the request headers.
 * 
 * \param headers [in] The headers from the pending request.
 * \return The cookies as a string.
 */
static gchar* 
getCookies(GHashTable *headers)
{
    return (gchar*) g_hash_table_lookup(headers,g_strdup("Cookie"));

}

/**
 * Extract the state of the disclaimer cookie from the cookie string
 * 
 * Split the cookie string in to single cookies and search for the disclaimer
 * cookie. If the disclaimer cookie is found, it is split into name and value and 
 * the value read.
 * 
 * \param cookieString [in] A string containing all cookies.
 * \return The state of the disclaimer cookie DISCLAIMER_COOKIE_SET_TRUE or 
 *         DISCLAIMER_COOKIE_SET_FALSE. If the cookie is not found DISCLAIMER_COOKIE_NOT_SET
 *         is returned.
 */
static DISCLAIMER_COOKIE_STATE_E 
extractDisclaimerCookieState(gchar *cookieString)
{
    gchar **cookies = NULL;
    gchar **cookies_start = NULL;
    DISCLAIMER_COOKIE_STATE_E cookieState = DISCLAIMER_COOKIE_NOT_SET;

    //The blank in the delimiter is important so it's not part of 
    //the cookie name
    cookies = g_strsplit(cookieString, "; ", -1);
    //Need start of cookies array to free at the end
    cookies_start = cookies;

    //Iterate over all cookies
    for(gchar* cookie = cookies[0]; cookie != NULL; cookie = *(++cookies)){
        //Separate cookie into name and value
        gchar **cookieKeyValue = g_strsplit(cookie, "=", -1);

        //Check if cookie is the disclaimer acceptance cookie
        if(g_strcmp0(cookieKeyValue[COOKIE_INDEX_KEY], DISCLAIMER_ACCEPTANCE_ATTRIBUTE) == 0)
        {
            //Check if disclaimer is accepted
            if(g_strcmp0(cookieKeyValue[COOKIE_INDEX_VALUE], "true") == 0)
            {
                cookieState = DISCLAIMER_COOKIE_SET_TRUE;
            }
            else if(g_strcmp0(cookieKeyValue[COOKIE_INDEX_VALUE], "false") == 0)
            {
                cookieState = DISCLAIMER_COOKIE_SET_FALSE;
            }
            g_strfreev(cookieKeyValue);
            break;
        }
        g_strfreev(cookieKeyValue);
    }
    g_strfreev(cookies_start);

    return cookieState;
}


/**
 * Send an error response for the pending http request with the error code 401 and 
 * the reason "legal-disclaimer-acceptance-required".
 * With the response, the disclaimer acceptance cookie is set on client side.
 * 
 * \param response [in] The web response object needed to create the http response.
 */
void 
hilscher_sendErrorResponse(CockpitWebResponse *response)
{
    GHashTable *headers = NULL;
    headers = cockpit_web_server_new_table ();

    
    //Set the disclaimer acceptance cookie
    g_hash_table_insert (headers, g_strdup ("Set-Cookie"), g_strdup ("legalDisclaimerAccepted=false; Path=/; SameSite=Strict"));

    //Send the error response
    cockpit_web_response_error(response, 401, headers, "legal-disclaimer-acceptance-required");
}


/**
 * Accept the hilscher legal disclaimer.
 * 
 * Update the legal disclaimer acceptance file. Therefor the file is read and 
 * the disclaimer acceptance attribute is set to true. Than the updated file is
 * stored on the disk.
 * 
 * \return If the disclaimer acceptance file was successfully updated TRUE.
 *         Otherwise FALSE.
 */
gboolean hilscher_acceptLegalDisclaimer(void)
{
    JsonObject *disclaimerAcceptanceInfo = NULL;
    gboolean success  = FALSE;
    GError *error = NULL;

    disclaimerAcceptanceInfo = readJsonFile(DISCLAIMER_ACCEPTANCE_FILE, &error);
    if (!disclaimerAcceptanceInfo)
    {
        g_warning("Error checking if legal disclaimer is accepted: (%s)", error->message);
        g_clear_error(&error);
        return FALSE;
    }

    json_object_set_boolean_member(disclaimerAcceptanceInfo, DISCLAIMER_ACCEPTANCE_ATTRIBUTE, TRUE);

    success = writeJsonFile(disclaimerAcceptanceInfo, DISCLAIMER_ACCEPTANCE_FILE, &error);
    if(!success)
    {
        g_warning("Error storing disclaimer acceptance: (%s)", error->message);
        g_clear_error(&error);
    }

    json_object_unref(disclaimerAcceptanceInfo);
    return success;
}

/**
 * Write the json object content into the file reverenced by the path.
 * 
 * \param object [in]  The json object to be stored.
 * \param path   [in]  The path to the file.
 * \param error  [out] Information about an possible error.
 * \return TRUE if the json object was successfully written into the file.
 *         Otherwise FALSE and the error is set.
 */
static gboolean
writeJsonFile(JsonObject *object, const gchar *path, GError **error)
{
    gboolean success = FALSE;
    GFile *file;
    const gchar *content = NULL;
    gsize length ;

    file = g_file_new_for_path(path);
    content = cockpit_json_write_object(object, &length);
    success = g_file_replace_contents(file, content, length, NULL, FALSE, G_FILE_CREATE_REPLACE_DESTINATION, NULL, NULL, error);
    g_object_unref(file);

    return success;
}