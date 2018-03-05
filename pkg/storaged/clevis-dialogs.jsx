/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
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

import cockpit from "cockpit";
import dialog from "./dialog";
import React from "react";

const _ = cockpit.gettext;

// "React" is used implicitly by the <foo>...</foo> expansion but our
// hinter doesn't know about that.
React;

export function add(client, block) {
    dialog.open({ Title: _("Add network key"),
                  Fields: [
                      { TextInput: "url",
                        Title: _("Key server address")
                      },
                      { PassInput: "passphrase",
                        Title: _("Existing passphrase")
                      }
                  ],
                  Action: {
                      Title: _("Add"),
                      action: function (vals) {
                          return client.clevis_overlay.get_adv(vals.url).then(function (info) {
                              add_adv(client, block, vals.url, info, vals.passphrase);
                          });
                      }
                  }
    });
}

function add_adv(client, block, url, info, passphrase) {
    verify_adv(url, info,
               _("Verify Key"),
               null,
               _("Trust Key"),
               function () {
                   return client.clevis_overlay.add(block, url, info.adv, passphrase);
               });
}

function verify_adv( url, info, title, extra, action_title, action) {
    var port_pos = url.lastIndexOf(":");
    var host = (port_pos >= 0) ? url.substr(0, port_pos) : url;
    var port = (port_pos >= 0) ? url.substr(port_pos + 1) : "";
    var cmd = cockpit.format("ssh $0 tang-show-keys $1", host, port);

    dialog.open({ Title: title,
                  Fields: [ ],
                  ReactBody:
                  <div>
                      { extra ? <p>{extra}</p> : null }
                      <p>
                          <span>{_("Manually verify the key on the server: ")}</span>
                          <pre>{cmd}</pre>
                      </p>
                      <p>
                          <span>{_("The output should match this text: ")}</span>
                          <pre><samp>{info.sigkeys.join("\n")}</samp></pre>
                      </p>
                  </div>,
                  Action: {
                      Title: action_title,
                      action: action
                  }
    });
}

export function remove(client, block, key) {
    dialog.open({ Title: _("Please confirm network key removal"),
                  Fields: [ ],
                  ReactBody:
                  <div>
                      <p>{cockpit.format(_("The key of $0 will be removed."), key.url)}</p>
                      <p>{_("Removing network keys might prevent unattended booting.")}</p>
                  </div>,
                  Action: {
                      DangerButton: true,
                      Title: _("Remove key"),
                      action: function () {
                          return client.clevis_overlay.remove(block, key);
                      }
                  }
    });
}

export function check(client, block, key) {
    // Cases:
    // 0) server decrypts with key and advertises it -> say everything okay, do nothing
    // 1) server doesn't decrypt with key anymore -> let people remove
    // 2) server decrypts but doesn advertise anymore -> let people update
    // 3) can't reach the server -> say that, do nothing

    function key_is_okay() {
        dialog.open({ Title: _("Key is okay"),
                      Fields: [ ],
                      ReactBody: <p>{_("This network key works fine right now and the encrypted data can be unlocked with it.")}</p>
        });
    }

    function key_is_broken() {
        dialog.open({ Title: _("Key does not work"),
                      Fields: [ ],
                      ReactBody:
                      <div>
                          <p>{_("This network key is not recognized anymore by the server. You might want to remove it.")}</p>
                          <p>{_("Removing network keys might prevent unattended booting.")}</p>
                      </div>,
                      Action: {
                          DangerButton: true,
                          Title: _("Remove key"),
                          action: function () {
                              return client.clevis_overlay.remove(block, key);
                          }
                      }
        });
    }

    function key_is_obsolete(info) {
        function replace() {
            return client.clevis_overlay.replace(block, key.slot, key.url, info.adv);
        }

        for (var i = 0; i < key.sigkeys.length; i++) {
            if (info.sigkeys.indexOf(key.sigkeys[i]) >= 0) {
                dialog.open({ Title: _("Key is obsolete"),
                              Fields: [ ],
                              ReactBody:
                              <div>
                                  <p>{_("This network key is obsolete. It is still functional but it should be replaced. A new key has been securely retrieved from the server.")}</p>
                              </div>,
                              Action: {
                                  Title: _("Use new key"),
                                  action: replace
                              }
                });
                return;
            }
        }

        verify_adv(key.url, info,
                   _("Key is obsolete"),
                   _("This network key is obsolete. It is still functional but it should be replaced. A new key has been retrieved from the server."),
                   _("Trust new key"),
                   replace);
    }

    function server_cant_be_reached() {
        dialog.open({ Title: _("Server can't be reached"),
                      Fields: [ ],
                      ReactBody:
                      <p>{cockpit.format(_("The key server at $0 can not be reached.  This network key can not unlock the encrypted data right now, but it might be able to when the server becomes reachable again."), key.url)}</p>,
        });
    }

    client.clevis_overlay.get_adv(key.url)
              .then(function (info) {
                  client.clevis_overlay.check_key(block, key.slot)
                        .then(function () {
                            if (info.keys.indexOf(key.key) >= 0) {
                                key_is_okay();
                            } else {
                                key_is_obsolete(info);
                            }
                        })
                        .fail(function (error) {
                            console.log(error);
                            key_is_broken(key);
                        });
              })
              .fail(function (error) {
                  console.log(error);
                  server_cant_be_reached();
              });

}
