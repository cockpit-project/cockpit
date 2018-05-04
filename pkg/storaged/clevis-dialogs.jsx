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
import React from "react";

import { dialog_open, SelectOne, TextInput, PassInput, CheckBox } from "./dialogx.jsx";

const _ = cockpit.gettext;

export function add(client, block) {
    dialog_open({ Title: _("Add network key"),
                  Fields: [
                      SelectOne("method", _("Method"), { },
                                [ { value: "tang",
                                    title: _("\"tang\" Binding server") },
                                { value: "http",
                                  title: _("\"http\" Key escrow") }
                                ]),
                      TextInput("http_url", _("URL"),
                                { validate: val => {
                                    if (val.length === 0)
                                        return _("URL cannot be empty");
                                    if (!val.startsWith("http:") && !val.startsWith("https:"))
                                        return _("URL must start with either \"http:\" or \"https:\"");
                                },
                                  visible: vals => vals.method == "http"
                                }),
                      CheckBox("allow_plain_http", _("Allow \"http://\" URL"),
                               { visible: vals => vals.method == "http",
                                 validate: (val, vals) => {
                                     if (vals.http_url.startsWith("http:") && !val)
                                         return _("This box must be checked to confirm that the key will be transported without HTTPS");
                                 }
                               }),
                      SelectOne("http_method", _("HTTP method"),
                                { visible: vals => vals.method == "http" },
                                [ { value: "PUT", title: "PUT" },
                                    { value: "POST", title: "POST" }
                                ]),
                      SelectOne("key_type", _("Type"),
                                { visible: vals => vals.method == "http" },
                                [ { value: "octet-stream", title: "octet-stream" },
                                    { value: "jwk+json", title: "jwk+json" }
                                ]),
                      TextInput("tang_url", _("Key server address"),
                                { validate: val => !val.length && _("Server address cannot be empty"),
                                  visible: vals => vals.method == "tang"
                                }),
                      PassInput("passphrase", _("Existing passphrase"),
                                { validate: val => !val.length && _("Passphrase cannot be empty"),
                                })
                  ],
                  Action: {
                      Title: _("Add"),
                      action: function (vals) {
                          if (vals.method == "tang") {
                              return client.clevis_overlay.get_tang_adv(vals.tang_url).then(function (info) {
                                  add_tang_adv(client, block, vals.tang_url, info, vals.passphrase);
                              });
                          } else if (vals.method == "http") {
                              return client.clevis_overlay.add(block, "http",
                                                               { url: vals.http_url,
                                                                 http: vals.allow_plain_http,
                                                                 type: vals.key_type,
                                                                 method: vals.http_method },
                                                               vals.passphrase);
                          }
                      }
                  }
    });
}

function add_tang_adv(client, block, url, info, passphrase) {
    verify_tang_adv(url, info,
                    _("Verify Key"),
                    null,
                    _("Trust Key"),
                    function () {
                        return client.clevis_overlay.add(block, "tang", { url: url, adv: info.adv }, passphrase);
                    });
}

function verify_tang_adv(url, info, title, extra, action_title, action) {
    var port_pos = url.lastIndexOf(":");
    var host = (port_pos >= 0) ? url.substr(0, port_pos) : url;
    var port = (port_pos >= 0) ? url.substr(port_pos + 1) : "";
    var cmd = cockpit.format("ssh $0 tang-show-keys $1", host, port);

    dialog_open({ Title: title,
                  Body: (
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
                      </div>
                  ),
                  Action: {
                      Title: action_title,
                      action: action
                  }
    });
}

export function remove(client, block, key) {
    dialog_open({ Title: _("Please confirm network key removal"),
                  Body: (
                      <div>
                          <p>{cockpit.format(_("The key of $0 will be removed."), key.url)}</p>
                          <p>{_("Removing network keys might prevent unattended booting.")}</p>
                      </div>
                  ),
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
    // Cases for tang:
    //
    // 0) server decrypts with key and advertises it -> say everything okay, do nothing
    // 1) server doesn't decrypt with key anymore -> let people remove
    // 2) server decrypts but doesn't advertise anymore -> let people update
    // 3) can't reach the server -> say that, do nothing
    //
    // Cases for http:
    //
    // 0) we get a key and that key decrypts -> say everything okay, do nothing
    // 1) we get a key but it doesn't decrypt -> let people remove
    // 2) can't reach the server -> say that, do nothing

    function key_is_okay() {
        dialog_open({ Title: _("Key is okay"),
                      Body: <p>{_("This network key works fine right now and the encrypted data can be unlocked with it.")}</p>
        });
    }

    function key_is_broken(reason) {
        dialog_open({ Title: _("Key does not work"),
                      Body: (
                          <div>
                              <p>{reason} {_("You might want to remove it.")}</p>
                              <p>{_("Removing network keys might prevent unattended booting.")}</p>
                          </div>
                      ),
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
            return client.clevis_overlay.replace(block, key.slot, "tang", { url: key.url, adv: info.adv });
        }

        for (var i = 0; i < key.sigkeys.length; i++) {
            if (info.sigkeys.indexOf(key.sigkeys[i]) >= 0) {
                dialog_open({ Title: _("Key is obsolete"),
                              Body: (
                                  <div>
                                      <p>{_("This network key is obsolete. It is still functional but it should be replaced. A new key has been securely retrieved from the server.")}</p>
                                  </div>
                              ),
                              Action: {
                                  Title: _("Use new key"),
                                  action: replace
                              }
                });
                return;
            }
        }

        verify_tang_adv(key.url, info,
                        _("Key is obsolete"),
                        _("This network key is obsolete. It is still functional but it should be replaced. A new key has been retrieved from the server."),
                        _("Trust new key"),
                        replace);
    }

    function server_cant_be_reached() {
        dialog_open({ Title: _("Server can't be reached"),
                      Body: (
                          <p>{cockpit.format(_("The key server at $0 can not be reached.  This network key can not unlock the encrypted data right now, but it might be able to when the server becomes reachable again."), key.url)}</p>
                      )
        });
    }

    function key_retrieval_failed(error) {
        var msg = error.toString();
        msg = msg.replace(/curl: (.*) Failed to connect to .*: /, "");
        dialog_open({ Title: _("Key can't be retrieved"),
                      Body: (
                          <p>{cockpit.format(_("Retrieving the key from $0 has failed: $1."),
                                             key.url, msg)}</p>
                      )
        });
    }

    if (key.type == "tang") {
        client.clevis_overlay.get_tang_adv(key.url)
                .then(function (info) {
                    client.clevis_overlay.check_key(block, key.slot)
                            .then(function () {
                                if (info.keys.indexOf(key.key) >= 0) {
                                    key_is_okay();
                                } else {
                                    key_is_obsolete(info);
                                }
                            })
                            .catch(function (error) {
                                console.log(error.toString());
                                key_is_broken(_("This network key is not recognized anymore by the server."));
                            });
                })
                .catch(function (error) {
                    console.log(error.toString());
                    server_cant_be_reached();
                });
    } else if (key.type == "http") {
        cockpit.spawn([ "curl", "-sSfg", "-o", "/dev/null", key.url ], { err: "message" })
                .then(() => {
                    client.clevis_overlay.check_key(block, key.slot)
                            .then(key_is_okay)
                            .catch(error => {
                                console.log(error.toString());
                                key_is_broken(_("The server has returned a key that doesn't work."));
                            });
                })
                .catch(error => {
                    console.log(error.toString());
                    key_retrieval_failed(error);
                });
    }
}
