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

package helpers

import (
	"bytes"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
)

const CA_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"

type AuthError struct {
	msg string
}

func (v *AuthError) Error() string {
	return v.msg
}

func newAuthError(msg string) error {
	return &AuthError{msg}
}

// helpers
func namedArrayObject(key string, name string, m map[string]interface{}) []map[string]interface{} {
	nm := make(map[string]interface{})
	nm[key] = m
	nm["name"] = name
	s := make([]map[string]interface{}, 1)
	s[0] = nm
	return s
}

// Struct for decoding json
type userInfo struct {
	FullName string `json:"fullName"`
	MetaData struct {
		Name string `json:"name"`
	} `json:"metadata"`
}

type apiVersions struct {
	Versions []string `json:"versions"`
}

// Simple client
type Client struct {
	host    string
	version string

	caData           string
	insecure         bool
	requireOpenshift bool
	isOpenshift      bool

	userAPI string
	client  *http.Client
	creds   *Credentials
}

func doRequest(client *http.Client, method string, path string, auth string, body []byte) (*http.Response, error) {
	var req *http.Request
	var err error
	if body != nil {
		req, err = http.NewRequest(method, path, bytes.NewReader(body))
	} else {
		req, err = http.NewRequest(method, path, nil)
	}

	if err != nil {
		return nil, err
	}

	if auth != "" {
		req.Header.Add("Authorization", auth)
	}
	return client.Do(req)
}

func (self *Client) fetchVersion(authHeader string) error {
	path := fmt.Sprintf("%s/api", self.host)
	resp, err := doRequest(self.client, "GET", path, authHeader, nil)

	// Treat connection errors as internal errors and invalid
	// responses as auth errors
	if err != nil {
		return errors.New(fmt.Sprintf("Couldn't connect to the api: %s", err))
	}

	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return newAuthError(fmt.Sprintf("Couldn't get api version: %s", resp.Status))
	}

	data := apiVersions{}
	deErr := json.NewDecoder(resp.Body).Decode(&data)
	if deErr != nil {
		return newAuthError(fmt.Sprintf("Couldn't get api version: %s", deErr))
	}

	if len(data.Versions) < 1 {
		return newAuthError(fmt.Sprintf("Couldn't get api version: invalid data"))
	}

	self.version = data.Versions[0]
	return nil
}

func (self *Client) apiStatus(resource string, auth string) (int, error) {
	path := fmt.Sprintf("%s/api/%s/%s", self.host, self.version, resource)
	resp, rErr := doRequest(self.client, "GET", path, auth, nil)
	if rErr != nil {
		return 0, errors.New(fmt.Sprintf("Couldn't connect to api: %s", rErr))
	}

	defer resp.Body.Close()
	return resp.StatusCode, nil
}

func (self *Client) confirmBearerAuth(creds *Credentials) error {
	// There are no bugs we have to work around here
	// so just make sure we get a 200 or 403 to
	// a namespace call

	status, e := self.apiStatus("namespaces", creds.GetHeader())
	if e == nil && status != 403 && status != 200 {
		newAuthError(fmt.Sprintf("Couldn't verify bearer token with api: %s", status))
	}

	return e
}

func (self *Client) confirmBasicAuth(creds *Credentials) error {
	// Issue a request to the the /api API endpoint without any
	// auth data.
	// If we get 401 in response then we know our creds were good and we can log the user in.
	// If we get a 200 or a 403 then we don't know if are creds were correct and we need to
	// make more calls to figure it out.
	// Any other code is treated as an error.
	var e error
	var status int
	status, e = self.apiStatus("", "")
	success := status == 401

	if status == 200 || status == 403 {
		// Either /api is open or the current user, possibly (system:anonymous)
		// doesn't have permissions on it
		// Send a request to the /api/$version/namespaces endpoint with a
		// Authorization header that is guarenteed to be invalid.
		// This should return a 200 if the whole api is open or a 401 if the
		// api is protected.
		status, e = self.apiStatus("namespaces", "Basic Og==")
		if e != nil {
			return e
		}

		// Some versions of kubernetes return 403 instead of 401
		// when presented with bad basic auth data. In those cases
		// we need to refuse authentication, as we have no way
		// know if the credentials we have are in fact valid.
		// https://github.com/kubernetes/kubernetes/pull/41775
		if status == 403 {
			e = errors.New("This version of kubernetes is not supported. Turn off anonymous auth or upgrade.")
		} else if status == 200 {
			success = true
		} else if status == 401 {
			if creds.GetHeader() != "" {
				success = true
			} else {
				status = 403
			}
		}
	}

	if !success && e == nil {
		e = newAuthError(fmt.Sprintf("Couldn't verify authentication with api: %s", status))
	}

	return e
}

func (self *Client) confirmCreds(creds *Credentials) error {
	// Do this explictly so that we know we have a valid response
	// Kubernetes doesn't provide any way for a caller
	// to find out who it is, so we need to confirm the creds
	// we got some other way.
	err := self.fetchVersion(creds.GetHeader())
	if err != nil {
		return err
	}

	// If we are here we got a version for the api from the /api endpoint,
	// using the credentials the user gave us.
	// This happens when either
	// a) /api is protected and the credentials are correct
	// or
	// b) /api is open in which case we have no idea if our creds were correct
	// Confirming them is different for Basic or Bearer auth
	var e error
	if creds.UserName != "" {
		e = self.confirmBasicAuth(creds)
	} else {
		creds.UserName = "Unknown"
		e = self.confirmBearerAuth(creds)
	}

	creds.DisplayName = creds.UserName
	return e
}

func (self *Client) fetchUserData(creds *Credentials) error {
	resp, err := self.DoRequest("GET", self.userAPI, "users/~", creds, nil)
	if err != nil {
		return err
	}

	defer resp.Body.Close()

	// 404 or 403 are both responses we can
	// get when the oapi/users endpoint doesn't exists
	notFound := resp.StatusCode == 404 || resp.StatusCode == 403
	if notFound && self.requireOpenshift {
		return errors.New("Couldn't connect: Incompatible API")

		// This might be kubernetes, it doesn't have a way to
		// get user data, if we have a username try to
		// see if we can connect to it anyways
	} else if notFound {
		return self.confirmCreds(creds)
	} else if resp.StatusCode != 200 {
		return newAuthError(fmt.Sprintf("Couldn't get user data: %s", resp.Status))
	}

	self.isOpenshift = true
	data := userInfo{}
	deErr := json.NewDecoder(resp.Body).Decode(&data)
	if deErr != nil {
		return newAuthError(fmt.Sprintf("Couldn't get user json data: %s", deErr))
	}

	creds.UserName = data.MetaData.Name
	if creds.UserName != "" {
		creds.DisplayName = data.FullName
		if creds.DisplayName == "" {
			creds.DisplayName = creds.UserName
		}
	} else {
		return newAuthError(fmt.Sprintf("Openshift user data wasn't valid: %v", data))
	}
	return nil
}

func (self *Client) DoRequest(method string, api string, resource string,
	creds *Credentials, body []byte) (*http.Response, error) {
	if self.host == "" {
		return nil, errors.New("No kubernetes available")
	}

	authHeader := ""
	if creds != nil {
		authHeader = creds.GetHeader()
	}

	if self.version == "" {
		err := self.fetchVersion(authHeader)
		if err != nil {
			return nil, err
		}
	}

	path := fmt.Sprintf("%s/%s/%s/%s", self.host, api, self.version, resource)
	resp, rErr := doRequest(self.client, method, path, authHeader, body)
	if rErr != nil {
		return nil, errors.New(fmt.Sprintf("Couldn't connect: %s", rErr))
	}
	return resp, nil
}

func (self *Client) Login(authLine string) (map[string]interface{}, error) {
	parts := strings.SplitN(authLine, " ", 2)
	if len(parts) == 0 {
		return nil, newAuthError("Invalid Authorization line")
	}
	authData := ""
	authType := parts[0]
	if len(parts) == 2 {
		authData = parts[1]
	}

	creds, err := NewCredentials(authType, authData)
	if err == nil {
		err = self.fetchUserData(creds)
	}

	if err != nil {
		if creds != nil && creds.authType == "negotiate" {
			return nil, newAuthError(fmt.Sprintf("Negotiate failed: %s", err))
		}
		return nil, err
	}

	// Login successfull, save creds
	self.creds = creds
	user_data := creds.GetApiUserMap()
	cluster := make(map[string]interface{})
	cluster["server"] = self.host
	if self.caData != "" {
		cluster["certificate-authority-data"] = self.caData
	}

	cluster["insecure-skip-tls-verify"] = self.insecure
	clusters := namedArrayObject("cluster", "container-cluster", cluster)

	context := make(map[string]interface{})
	context["cluster"] = "container-cluster"
	context["user"] = user_data["name"]
	contexts := namedArrayObject("context", "container-context", context)

	users := make([]map[string]interface{}, 1)
	users[0] = user_data

	login_data := make(map[string]interface{})
	login_data["apiVersion"] = self.version
	login_data["displayName"] = creds.DisplayName
	login_data["current-context"] = "container-context"
	login_data["clusters"] = clusters
	login_data["contexts"] = contexts
	login_data["users"] = users

	return login_data, nil
}

func (self *Client) CleanUp() error {
	if self.creds != nil && self.isOpenshift {
		token := self.creds.GetToken()
		if token != "" {
			path := fmt.Sprintf("oauthaccesstokens/%s", token)
			resp, err := self.DoRequest("DELETE", self.userAPI, path, self.creds, nil)
			if err != nil {
				return err
			}

			if resp.StatusCode != 200 {
				log.Println(fmt.Sprintf("Invalid token cleanup response: %d", resp.StatusCode))
			}

			defer resp.Body.Close()
		}
	}
	return nil
}

func NewClient() *Client {
	var caData []byte = nil
	var pool *x509.CertPool

	ac := new(Client)
	ac.insecure = false
	ac.host = os.Getenv("KUBERNETES_SERVICE_HOST")
	if ac.host != "" {
		// assume we are always on https
		ac.host = fmt.Sprintf("https://%s", ac.host)
		port := os.Getenv("KUBERNETES_SERVICE_PORT")
		if port != "" {
			ac.host = fmt.Sprintf("%s:%s", ac.host, port)
		}
	}

	ac.userAPI = os.Getenv("KUBERNETES_USER_API")
	if ac.userAPI == "" {
		ac.userAPI = "oapi"
	}

	ac.requireOpenshift, _ = strconv.ParseBool(os.Getenv("REGISTRY_ONLY"))

	ac.insecure, _ = strconv.ParseBool(os.Getenv("KUBERNETES_INSECURE"))
	if !ac.insecure {
		data := os.Getenv("KUBERNETES_CA_DATA")
		if data != "" {
			caData = []byte(data)
		}

		if caData == nil {
			var err error
			caData, err = ioutil.ReadFile(CA_PATH)
			if err != nil {
				log.Println(fmt.Sprintf("Couldn't load CA data: %s", err))
			}
		}

		if caData != nil {
			pool = x509.NewCertPool()
			pool.AppendCertsFromPEM(caData)
			ac.caData = base64.StdEncoding.EncodeToString(caData)
		}
	}

	tr := &http.Transport{
		TLSClientConfig: &tls.Config{RootCAs: pool, InsecureSkipVerify: ac.insecure},
	}
	ac.client = &http.Client{Transport: tr}

	return ac
}
