/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

package main

import (
	"cockpit-kube-auth/helpers"
	"flag"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path"
	"strconv"
	"syscall"
	"text/template"
)

var OAUTH_CLIENT_ID = "cockpit-kube-client"
var CONFIG_FILE = "/etc/cockpit/cockpit.conf"
var CONFIG_TEMPLATE = "cockpit.conf.tmpl"

var confDir = flag.String("config-dir", "/container", "Directory with cockpit-kube-launch config files")

func writeConfigFile(confData map[string]interface{}) {
	tmpl, tErr := template.New("cockpit.conf.tmpl").ParseFiles(path.Join(*confDir, CONFIG_TEMPLATE))
	if tErr != nil {
		log.Fatalf("Invalid cockpit.conf template: %s", tErr)
	}

	f, fErr := os.Create(CONFIG_FILE)
	if fErr != nil {
		log.Fatalf("Could't open file config file: %s", fErr)
	}

	wErr := tmpl.Execute(f, confData)
	if wErr != nil {
		log.Fatalf("Could't write config file: %s", wErr)
	}
}

func linkFiles(src string, target string) {
	// Not using symlink because os.Symlink doesn't let you force.
	out, err := exec.Command("ln", "-sf", src, target).CombinedOutput()
	if err != nil {
		log.Fatalf("Could't link %s to %s: %v: %s", src, target, err, out)
	}
}

func setupCertificates() {
	// Ensure path exits
	dErr := os.MkdirAll("/etc/cockpit/ws-certs.d", os.ModeDir|0775)
	if dErr != nil {
		log.Fatalf("Couldn't create certificate directory %s", dErr)
	}

	// Finding these certificate files or setting ownership on
	// the certificate may fail so execute combine and ensure
	// and the check results without
	exec.Command("/usr/sbin/remotectl", "certificate",
		"/var/run/secrets/ws-certs.d/tls.crt",
		"/var/run/secrets/ws-certs.d/tls.key").CombinedOutput()
	exec.Command("/usr/sbin/remotectl", "certificate", "--ensure").CombinedOutput()
	out, rErr := exec.Command("/usr/sbin/remotectl", "certificate").CombinedOutput()
	if rErr != nil {
		log.Fatalf("Failed to generate certificates %s %s", rErr, out)
	}
}

func haveOpenShiftEndpoint() (bool, error) {
	var isOpenShift bool = false

	creds, err := helpers.NewCredentialsForSystem()
	if err != nil {
		return isOpenShift, err
	}

	client := helpers.NewClient()
	resp, e := client.DoRequest("GET", "oapi", "", creds, nil)
	if e != nil {
		return isOpenShift, e
	}

	defer resp.Body.Close()
	if resp.StatusCode == 200 {
		isOpenShift = true
	}

	return isOpenShift, nil
}

func main() {
	flag.Parse()

	var isOpenShift bool = false
	args := []string{
		"/usr/libexec/cockpit-ws",
	}

	insecure, _ := strconv.ParseBool(os.Getenv("COCKPIT_KUBE_INSECURE"))
	if insecure {
		args = append(args, "--no-tls")
	}

	setupCertificates()

	name := "kubernetes"
	isRegistry, _ := strconv.ParseBool(os.Getenv("REGISTRY_ONLY"))

	oauth_url := os.Getenv("OPENSHIFT_OAUTH_PROVIDER_URL")
	if oauth_url != "" {
		isOpenShift = true
		client_id := os.Getenv("OPENSHIFT_OAUTH_CLIENT_ID")
		if client_id == "" {
			client_id = OAUTH_CLIENT_ID
		}
		oauth_url = fmt.Sprintf("%s/oauth/authorize?client_id=%s&response_type=token",
			oauth_url, client_id)
	} else {
		oauth_url = os.Getenv("OAUTH_PROVIDER_URL")
		var osErr error = nil
		isOpenShift, osErr = haveOpenShiftEndpoint()
		if osErr != nil {
			log.Printf("Error checking for openshift endpoint %s", osErr)
		}
	}

	if isRegistry {
		name = "registry"
	} else if isOpenShift {
		name = "openshift"
	}

	confData := make(map[string]interface{})
	confData["login_command"] = "/usr/libexec/cockpit-kube-auth"
	confData["oauth_url"] = oauth_url
	confData["is_openshift"] = isOpenShift
	confData["is_registry"] = isRegistry
	confData["origins"] = os.Getenv("COCKPIT_KUBE_URL");
	writeConfigFile(confData)

	override := path.Join(*confDir, fmt.Sprintf("%s-override.json", name))
	brand := path.Join(*confDir, fmt.Sprintf("%s-brand", name))
	linkFiles(override, "/usr/share/cockpit/shell/override.json")
	linkFiles(brand, "/etc/os-release")

	if isRegistry {
		registry_override := path.Join(*confDir, "registry-dashboard-override.json")
		linkFiles(registry_override, "/usr/share/cockpit/kubernetes/override.json")
		linkFiles("/usr/share/cockpit/kubernetes/registry.html.gz",
			"/usr/share/cockpit/kubernetes/index.html.gz")
	} else {
		linkFiles("/usr/share/cockpit/kubernetes/original-index.gz",
			"/usr/share/cockpit/kubernetes/index.html.gz")
	}

	syscall.Exec(args[0], args, os.Environ())
}
