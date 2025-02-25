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

 #include "hilschercontentprovider.h"

 /**
  * We are defining a new hilscher specific http resource to be able to provide content, that can be 
  * modified during runtime. All files provided via the static cockpit resource are located in the read only
  * file system of the device and therefor can't be changed after the OS is installed or updated.
  */
 static const char* systemNotificationResource = "/cockpit/hilscher/system/notification";
 
 void provideSystemUseNotification(CockpitWebResponse *response);
 
 /**
  * Provide the content of a hilscher specific resource from the host system.
  * 
  * \param response [in,out] The response object for the current webserver request.
  * \param resource [in]     The resource the content is requested for.
  */
 void  hilscher_provideResourceContent(CockpitWebResponse *response, const char* resource)
 { 
     if(g_str_equal(resource, systemNotificationResource))
     {
         provideSystemUseNotification(response);
     }
     else
     {
       cockpit_web_response_error (response, 404, NULL, NULL);
     }
 }
 
 /**
  * Provide the content from /etc/motd file containing the system use notification.
  * 
  * \param response [in,out] The response object for the current webserver request.
  */
 void provideSystemUseNotification(CockpitWebResponse *response)
 {
     const char* filename = "issue.net";
     const char* location = "/etc/";
     cockpit_web_response_file (response, filename, &location);
 }